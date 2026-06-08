import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
  useWindowDimensions,
  Pressable,
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSharedValue, withTiming, Easing } from 'react-native-reanimated';
import * as Clipboard from 'expo-clipboard';
import Ionicons from '@expo/vector-icons/Ionicons';

import { AnimatedOffPayLogo } from '@/components/ui/AnimatedOffPayLogo';
import { GlassActionButton } from '@/components/ui/GlassActionButton';
import { Text } from '@/components/ui/Text';
import { useAppToast } from '@/components/ui/AppToast';
import { colors } from '@/constants/colors';
import { layout, radii, spacing } from '@/constants/spacing';
import { fontFamily } from '@/constants/typography';
import { OffpayApiError, checkInviteEmail, verifyInviteCode } from '@/lib/api/offpay-api-client';
import {
  getStoredInviteCode,
  getStoredInviteEmail,
  storeInviteCode,
  storeInviteEmail,
} from '@/lib/invite/invite-access';
import {
  getInviteCodeValidationMessage,
  normalizeInviteCodeInput,
  parseInviteCode,
} from '@/shared/invite-codes';
import { useAppStore } from '@/store/app';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const LOOK_DOWN_AMOUNT = 4.5;
const LOOK_DOWN_DURATION_MS = 350;

function isValidEmail(value: string): boolean {
  return EMAIL_PATTERN.test(value.trim());
}

function getInviteApiErrorMessage(error: unknown): string {
  if (!(error instanceof OffpayApiError)) {
    return 'Could not verify this invite. Try again.';
  }

  switch (error.code) {
    case 'INVALID_INVITE_CODE':
      return 'Invite code is invalid.';
    case 'INVITE_EXPIRED':
      return 'This invite code has expired.';
    case 'INVITE_REVOKED':
      return 'This invite code is no longer active.';
    case 'INVITE_ALREADY_USED':
      return 'This invite code has already been used.';
    case 'RATE_LIMITED':
      return 'Too many attempts. Try again shortly.';
    case 'OUTDATED_APP':
      return 'Please update OffPay before using this invite.';
    case 'UPSTREAM_UNAVAILABLE':
      return 'Invite verification is temporarily unavailable.';
    case 'INVALID_REQUEST':
      return error.message || 'Please check your details and try again.';
    default:
      return error.message || 'Could not verify this invite. Try again.';
  }
}

export default function InviteCodeScreen(): React.JSX.Element {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const inviteAccessVerified = useAppStore((state) => state.inviteAccessVerified);
  const setInviteAccessVerified = useAppStore((state) => state.setInviteAccessVerified);
  const setInviteEmail = useAppStore((state) => state.setInviteEmail);
  const [email, setEmail] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [stage, setStage] = useState<'email' | 'code'>('email');
  const [emailTouched, setEmailTouched] = useState(false);
  const [codeTouched, setCodeTouched] = useState(false);
  const [checkingEmail, setCheckingEmail] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const { showToast } = useAppToast();

  const lookDownOffset = useSharedValue(0);
  const focusCount = useSharedValue(0);

  const compact = width < 390 || height < 740;
  const horizontalPadding = width < 340 ? spacing.lg : compact ? spacing.xl : spacing['3xl'];
  const logoSize = compact ? 100 : 120;
  const validation = useMemo(() => parseInviteCode(inviteCode), [inviteCode]);
  const emailValid = isValidEmail(email);
  const canSubmit = validation.valid && emailValid && !submitting;

  // Responsive placeholder text based on screen width
  const inviteCodePlaceholder = width < 360 
    ? 'OFFPAY-B1-XXXXXX-00' 
    : width < 390 
      ? 'OFFPAY-B1-XXXXXXXXX-00' 
      : 'OFFPAY-B1-XXXXXXXXXXXX-00';

  const emailError =
    emailTouched && !emailValid && email.trim().length > 0
      ? 'Enter a valid email address.'
      : null;

  const codeError =
    serverError ??
    (codeTouched && !validation.valid
      ? getInviteCodeValidationMessage(validation.reason)
      : null);

  const animateLookDown = useCallback(
    (focused: boolean) => {
      if (focused) {
        focusCount.value += 1;
        lookDownOffset.value = withTiming(LOOK_DOWN_AMOUNT, {
          duration: LOOK_DOWN_DURATION_MS,
          easing: Easing.out(Easing.cubic),
        });
      } else {
        focusCount.value -= 1;
        // Only look back up if all inputs lost focus
        if (focusCount.value <= 0) {
          focusCount.value = 0;
          lookDownOffset.value = withTiming(0, {
            duration: LOOK_DOWN_DURATION_MS,
            easing: Easing.out(Easing.cubic),
          });
        }
      }
    },
    [focusCount, lookDownOffset],
  );

  useEffect(() => {
    if (inviteAccessVerified) {
      router.replace('/onboarding');
      return;
    }

    let cancelled = false;
    void Promise.all([getStoredInviteCode(), getStoredInviteEmail()]).then(
      ([storedCode, storedEmail]) => {
        if (cancelled) return;
        if (storedCode != null) setInviteCode(storedCode);
        if (storedEmail != null) setEmail(storedEmail);
      },
    );

    return () => {
      cancelled = true;
    };
  }, [inviteAccessVerified]);

  const handleEmailChange = useCallback((value: string): void => {
    setEmailTouched(true);
    setServerError(null);
    setEmail(value.trim());
    if (stage === 'code') setStage('email');
  }, [stage]);

  const handleEmailBlur = useCallback((): void => {
    animateLookDown(false);
  }, [animateLookDown]);

  const handleEmailContinue = useCallback(async (): Promise<void> => {
    if (!isValidEmail(email) || checkingEmail) return;

    setEmailTouched(true);
    setCheckingEmail(true);
    setServerError(null);
    try {
      const result = await checkInviteEmail(email.trim().toLowerCase());
      if (result.verified) {
        await storeInviteEmail(email.trim().toLowerCase());
        setInviteEmail(email.trim().toLowerCase());
        setInviteAccessVerified(true);
        showToast({
          title: 'Welcome back',
          message: 'Your invite access was restored.',
          variant: 'success',
        });
        router.replace('/onboarding');
      } else {
        setStage('code');
      }
    } catch (error) {
      // If error (e.g. not found), proceed to code stage
      setStage('code');
    } finally {
      setCheckingEmail(false);
    }
  }, [email, checkingEmail, setInviteEmail, setInviteAccessVerified, showToast]);

  const handleInviteChange = useCallback((value: string): void => {
    setCodeTouched(true);
    setServerError(null);
    setInviteCode(normalizeInviteCodeInput(value));
  }, []);

  const handleVerify = useCallback(async (): Promise<void> => {
    if (submitting) return;

    setEmailTouched(true);
    setCodeTouched(true);
    setServerError(null);

    if (!isValidEmail(email)) return;

    const parsed = parseInviteCode(inviteCode);
    if (!parsed.valid) return;

    setSubmitting(true);
    try {
      await verifyInviteCode(parsed.normalizedCode, email.trim().toLowerCase());
      await storeInviteCode(parsed.normalizedCode);
      await storeInviteEmail(email);
      setInviteEmail(email.trim().toLowerCase());
      setInviteAccessVerified(true);
      router.replace('/onboarding');
    } catch (error) {
      setServerError(getInviteApiErrorMessage(error));
    } finally {
      setSubmitting(false);
    }
  }, [email, inviteCode, setInviteAccessVerified, setInviteEmail, submitting]);

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: insets.top + (compact ? spacing['2xl'] : spacing['4xl']),
            paddingBottom: insets.bottom + spacing['3xl'],
            paddingHorizontal: horizontalPadding,
          },
        ]}
        keyboardShouldPersistTaps="handled"
        contentInsetAdjustmentBehavior="never"
        showsVerticalScrollIndicator={false}
      >
        {/* Animated logo — eyes look down when user is typing */}
        <View style={styles.logoContainer}>
          <AnimatedOffPayLogo
            size={logoSize}
            bodyColor={colors.brand.whiteStream}
            eyeColor={colors.brand.deepShadow}
            lookDownOffset={lookDownOffset}
          />
        </View>

        <View style={styles.card}>
          <View pointerEvents="none" style={styles.cardGloss} />
          <View style={styles.header}>
            <Text
              variant="h1"
              color={colors.text.primary}
              align="center"
              style={styles.title}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.8}
            >
              Invite access
            </Text>
            <Text variant="body" color={colors.text.secondary} align="center" style={styles.subtitle}>
              Enter your email and private beta code to continue.
            </Text>
          </View>

          {/* Email input (Stage 1) or Summary (Stage 2) */}
          {stage === 'email' ? (
            <View style={styles.inputGroup}>
              <Text variant="captionBold" color={colors.text.secondary} style={styles.inputLabel}>
                Email
              </Text>
              <View
                style={[
                  styles.inputFrame,
                  emailValid && emailTouched ? styles.inputFrameReady : null,
                ]}
              >
                <TextInput
                  value={email}
                  onChangeText={handleEmailChange}
                  onFocus={() => animateLookDown(true)}
                  onBlur={() => { void handleEmailBlur(); }}
                  onSubmitEditing={() => {
                    if (stage === 'email') void handleEmailContinue();
                  }}
                  placeholder="you@example.com"
                  placeholderTextColor={colors.text.placeholder}
                  autoCapitalize="none"
                  autoCorrect={false}
                  spellCheck={false}
                  keyboardType="email-address"
                  textContentType="emailAddress"
                  autoComplete="email"
                  returnKeyType="next"
                  maxLength={320}
                  numberOfLines={1}
                  style={styles.emailInput}
                />
              </View>
              <View style={styles.errorSlot}>
                {emailError != null ? (
                  <Text
                    variant="small"
                    color={colors.semantic.error}
                    numberOfLines={1}
                  >
                    {emailError}
                  </Text>
                ) : null}
              </View>
            </View>
          ) : (
            <View style={styles.inputGroup}>
              <Text variant="captionBold" color={colors.text.secondary} style={styles.inputLabel}>
                Email
              </Text>
              <View style={[styles.inputFrame, styles.inputFrameReady]}>
                <Text
                  variant="body"
                  color={colors.text.secondary}
                  style={[styles.emailInput, { flex: 1, opacity: 0.6 }]}
                  numberOfLines={1}
                >
                  {email}
                </Text>
                <Pressable
                  onPress={() => {
                    setStage('email');
                    setServerError(null);
                  }}
                  accessibilityLabel="Change email address"
                  accessibilityRole="button"
                  style={({ pressed }) => [{ padding: 8, opacity: pressed ? 0.6 : 1 }]}
                >
                  <Text variant="captionBold" color={colors.semantic.info}>
                    Edit
                  </Text>
                </Pressable>
              </View>
            </View>
          )}

          {/* Invite code input */}
          {stage === 'code' ? (
            <View style={styles.inputGroup}>
              <Text variant="captionBold" color={colors.text.secondary} style={styles.inputLabel}>
                Invite code
              </Text>
              <View style={[styles.inputFrame, validation.valid ? styles.inputFrameReady : null]}>
                <TextInput
                  value={inviteCode}
                  onChangeText={handleInviteChange}
                  onFocus={() => animateLookDown(true)}
                  onBlur={() => animateLookDown(false)}
                  onSubmitEditing={() => {
                    void handleVerify();
                  }}
                  placeholder={inviteCodePlaceholder}
                  placeholderTextColor={colors.text.placeholder}
                  autoCapitalize="characters"
                  autoCorrect={false}
                  spellCheck={false}
                  keyboardType="ascii-capable"
                  textContentType="oneTimeCode"
                  returnKeyType="done"
                  maxLength={64}
                  numberOfLines={1}
                  style={[styles.input, { flex: 1 }]}
                />
                {inviteCode.length === 0 ? (
                  <Pressable
                    onPress={async () => {
                      const content = await Clipboard.getStringAsync();
                      if (content) {
                        handleInviteChange(content);
                      }
                    }}
                    accessibilityLabel="Paste invite code"
                    accessibilityRole="button"
                    style={({ pressed }) => [{ padding: 8, opacity: pressed ? 0.6 : 1 }]}
                  >
                    <Ionicons name="clipboard-outline" size={20} color={colors.text.secondary} />
                  </Pressable>
                ) : null}
              </View>
              <View style={styles.errorSlot}>
                {codeError != null ? (
                  <Text
                    variant="small"
                    color={colors.semantic.error}
                    numberOfLines={1}
                  >
                    {codeError}
                  </Text>
                ) : null}
              </View>
            </View>
          ) : null}

          <GlassActionButton
            label={stage === 'email' ? 'Continue' : 'Verify invite'}
            onPress={() => {
              if (stage === 'email') {
                void handleEmailContinue();
              } else {
                void handleVerify();
              }
            }}
            loading={stage === 'email' ? checkingEmail : submitting}
            disabled={stage === 'email' ? (!emailValid || checkingEmail) : !canSubmit}
            accessibilityLabel={stage === 'email' ? 'Continue with email' : 'Verify invite code'}
          />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.surface.background,
  },
  scroll: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    gap: spacing.xl,
  },
  logoContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: {
    width: '100%',
    maxWidth: 520,
    alignSelf: 'center',
    gap: spacing.xl,
    padding: spacing['2xl'],
    borderRadius: radii['2xl'],
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rim,
    backgroundColor: colors.surface.cardElevated,
    overflow: 'hidden',
    boxShadow: [
      '0 24px 58px rgba(0, 0, 0, 0.48)',
      'inset 0 1px 2px rgba(255, 255, 255, 0.14)',
      'inset 0 -1px 2px rgba(0, 0, 0, 0.42)',
    ].join(', '),
  },
  cardGloss: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: '44%',
    backgroundColor: colors.glass.smokeWash,
  },
  header: {
    gap: spacing.sm,
  },
  title: {
    fontFamily: fontFamily.displaySemiBold,
  },
  subtitle: {
    fontFamily: fontFamily.uiMedium,
  },
  inputGroup: {
    gap: spacing.sm,
  },
  inputLabel: {
    fontFamily: fontFamily.uiSemiBold,
    textTransform: 'uppercase',
  },
  inputFrame: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: layout.buttonHeightLg,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    borderRadius: radii.lg,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rimSubtle,
    backgroundColor: colors.brand.graphiteDepth,
    overflow: 'hidden',
    boxShadow: [
      'inset 0 1px 1px rgba(255, 255, 255, 0.09)',
      'inset 0 -1px 2px rgba(0, 0, 0, 0.46)',
    ].join(', '),
  },
  inputFrameReady: {
    borderColor: colors.border.strong,
  },
  emailInput: {
    minHeight: 48,
    padding: 0,
    color: colors.text.primary,
    fontFamily: fontFamily.uiMedium,
    fontSize: 15,
    letterSpacing: 0.1,
    includeFontPadding: false,
    textAlignVertical: 'center',
  },
  input: {
    minHeight: 48,
    padding: 0,
    color: colors.text.primary,
    fontFamily: fontFamily.monoSemiBold,
    fontSize: 15,
    letterSpacing: 0.2,
    includeFontPadding: false,
    textAlignVertical: 'center',
  },
  errorSlot: {
    height: 18,
    justifyContent: 'center',
  },
});
