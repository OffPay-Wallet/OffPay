import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  TextInput,
  View,
  useWindowDimensions,
  Pressable,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedReaction,
  useAnimatedKeyboard,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import * as Clipboard from 'expo-clipboard';
import Ionicons from '@expo/vector-icons/Ionicons';

import { AnimatedOffPayLogo } from '@/components/ui/AnimatedOffPayLogo';
import { GlassActionButton } from '@/components/ui/GlassActionButton';
import { Text } from '@/components/ui/Text';
import { useAppToast } from '@/components/ui/AppToast';
import { PuffyPasteIcon } from '@/components/ui/icons/PuffyPasteIcon';
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
  firstRouteParam,
  getWalletFlowInvitePathname,
  isWalletFlowInviteFresh,
  normalizeWalletFlowInviteNext,
  normalizeWalletFlowInviteSource,
  WALLET_FLOW_INVITE_PURPOSE,
} from '@/lib/invite/wallet-flow-invite';
import {
  OFFPAY_INVITE_CODE_LENGTH,
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
  const params = useLocalSearchParams<{
    purpose?: string | string[];
    next?: string | string[];
    source?: string | string[];
  }>();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const inviteAccessVerified = useAppStore((state) => state.inviteAccessVerified);
  const appInviteEmail = useAppStore((state) => state.inviteEmail);
  const setInviteAccessVerified = useAppStore((state) => state.setInviteAccessVerified);
  const setInviteEmail = useAppStore((state) => state.setInviteEmail);
  const walletFlowInviteVerifiedAt = useAppStore((state) => state.walletFlowInviteVerifiedAt);
  const setWalletFlowInviteVerifiedAt = useAppStore((state) => state.setWalletFlowInviteVerifiedAt);
  const scrollRef = useRef<ScrollView>(null);
  const emailInputRef = useRef<TextInput>(null);
  const inviteInputRef = useRef<TextInput>(null);
  const shouldFocusEmailAfterBack = useRef(false);
  const [email, setEmail] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [stage, setStage] = useState<'email' | 'code'>('email');
  const [emailTouched, setEmailTouched] = useState(false);
  const [codeTouched, setCodeTouched] = useState(false);
  const [checkingEmail, setCheckingEmail] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [registeredInviteEmail, setRegisteredInviteEmail] = useState<string | null>(null);
  const { showToast } = useAppToast();
  const invitePurpose = firstRouteParam(params.purpose);
  const isWalletFlowInvite = invitePurpose === WALLET_FLOW_INVITE_PURPOSE;
  const walletFlowNext = normalizeWalletFlowInviteNext(params.next);
  const walletFlowSource = normalizeWalletFlowInviteSource(params.source);

  const lookDownOffset = useSharedValue(0);
  const focusCount = useSharedValue(0);
  const compact = width < 390 || height < 740;
  const horizontalPadding = width < 340 ? spacing.md : compact ? spacing.xl : spacing['3xl'];
  const cardPadding = width < 340 ? spacing.lg : compact ? spacing.xl : spacing['2xl'];
  const codeBoxGap = width < 360 ? 3 : spacing.xs;
  const codeRowGap = width < 360 ? spacing.xs : spacing.sm;
  const logoSize = compact ? 100 : 120;
  const topShaderHeight = Math.max(260, Math.min(420, height * 0.42));

  // Live keyboard height (iOS + Android). We lift the centered content
  // by the keyboard height so the input/button always clear the keypad,
  // and settle back to the resting bottom padding when it dismisses.
  const keyboard = useAnimatedKeyboard();
  const baseBottomPadding = insets.bottom + spacing['3xl'];
  const keyboardLiftLimit = compact ? 220 : 170;
  const keyboardLiftRatio = compact ? 0.72 : 0.5;
  const contentAnimatedStyle = useAnimatedStyle(() => ({
    paddingBottom: Math.max(
      baseBottomPadding,
      keyboard.height.value + insets.bottom + spacing['3xl'],
    ),
    transform: [
      {
        translateY: -Math.min(keyboard.height.value * keyboardLiftRatio, keyboardLiftLimit),
      },
    ],
  }));

  const validation = useMemo(() => parseInviteCode(inviteCode), [inviteCode]);
  const codeSlots = useMemo(
    () => Array.from({ length: OFFPAY_INVITE_CODE_LENGTH }, (_, index) => inviteCode[index] ?? ''),
    [inviteCode],
  );
  const emailValid = isValidEmail(email);
  const canSubmit = validation.valid && emailValid && !submitting;

  const emailError =
    emailTouched && !emailValid && email.trim().length > 0 ? 'Enter a valid email address.' : null;

  const codeError =
    serverError ??
    (codeTouched && !validation.valid ? getInviteCodeValidationMessage(validation.reason) : null);

  const scrollCardIntoView = useCallback((): void => {
    requestAnimationFrame(() => {
      scrollRef.current?.scrollToEnd({ animated: true });
    });
  }, []);

  useAnimatedReaction(
    () => keyboard.height.value,
    (currentHeight, previousHeight) => {
      if (currentHeight > 40 && (previousHeight ?? 0) <= 40) {
        runOnJS(scrollCardIntoView)();
      }
    },
    [scrollCardIntoView],
  );

  const goToWalletFlow = useCallback((): void => {
    router.replace({
      pathname: getWalletFlowInvitePathname(walletFlowNext),
      params: { source: walletFlowSource },
    });
  }, [walletFlowNext, walletFlowSource]);

  const restoreWalletFlowInviteFromEmail = useCallback(
    async (
      emailAddress: string,
      trustedRegisteredEmail: string | null | undefined,
    ): Promise<boolean> => {
      const normalizedEmail = emailAddress.trim().toLowerCase();
      const normalizedRegisteredEmail = trustedRegisteredEmail?.trim().toLowerCase() ?? null;
      if (
        !isWalletFlowInvite ||
        !isValidEmail(normalizedEmail) ||
        normalizedRegisteredEmail == null ||
        normalizedEmail !== normalizedRegisteredEmail
      ) {
        return false;
      }

      try {
        const result = await checkInviteEmail(normalizedEmail);
        if (!result.verified) {
          return false;
        }

        await storeInviteEmail(normalizedEmail);
        setInviteEmail(normalizedEmail);
        setInviteAccessVerified(true);
        setWalletFlowInviteVerifiedAt(Date.now());
        goToWalletFlow();
        return true;
      } catch {
        return false;
      }
    },
    [
      goToWalletFlow,
      isWalletFlowInvite,
      setInviteAccessVerified,
      setInviteEmail,
      setWalletFlowInviteVerifiedAt,
    ],
  );

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
    if (isWalletFlowInvite && isWalletFlowInviteFresh(walletFlowInviteVerifiedAt)) {
      goToWalletFlow();
      return;
    }

    if (!isWalletFlowInvite && inviteAccessVerified) {
      router.replace('/onboarding');
      return;
    }

    let cancelled = false;
    void Promise.all([getStoredInviteCode(), getStoredInviteEmail()]).then(
      ([storedCode, storedEmail]) => {
        if (cancelled) return;
        if (storedCode != null) setInviteCode(storedCode);
        const knownInviteEmail = storedEmail ?? appInviteEmail;
        if (knownInviteEmail != null) {
          setRegisteredInviteEmail(knownInviteEmail);
          setEmail(knownInviteEmail);
          if (isWalletFlowInvite) {
            setCheckingEmail(true);
            void restoreWalletFlowInviteFromEmail(knownInviteEmail, knownInviteEmail)
              .then((restored) => {
                if (!cancelled && !restored) {
                  setStage('code');
                }
              })
              .finally(() => {
                if (!cancelled) {
                  setCheckingEmail(false);
                }
              });
          }
        }
      },
    );

    return () => {
      cancelled = true;
    };
  }, [
    appInviteEmail,
    goToWalletFlow,
    inviteAccessVerified,
    isWalletFlowInvite,
    restoreWalletFlowInviteFromEmail,
    walletFlowInviteVerifiedAt,
  ]);

  useEffect(() => {
    if (stage !== 'email' || !shouldFocusEmailAfterBack.current) return;
    shouldFocusEmailAfterBack.current = false;
    requestAnimationFrame(() => {
      emailInputRef.current?.focus();
    });
  }, [stage]);

  const handleEmailChange = useCallback(
    (value: string): void => {
      setEmailTouched(true);
      setServerError(null);
      setEmail(value.trim());
      if (stage === 'code') setStage('email');
    },
    [stage],
  );

  const handleEmailBlur = useCallback((): void => {
    animateLookDown(false);
  }, [animateLookDown]);

  const handleInputFocus = useCallback((): void => {
    animateLookDown(true);
    scrollCardIntoView();
  }, [animateLookDown, scrollCardIntoView]);

  const handleEmailContinue = useCallback(async (): Promise<void> => {
    if (!isValidEmail(email) || checkingEmail) return;

    setEmailTouched(true);
    setCheckingEmail(true);
    setServerError(null);

    if (isWalletFlowInvite) {
      try {
        const restored = await restoreWalletFlowInviteFromEmail(email, registeredInviteEmail);
        if (!restored) {
          setStage('code');
        }
      } finally {
        setCheckingEmail(false);
      }
      return;
    }

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
    } catch (_error) {
      // If error (e.g. not found), proceed to code stage
      setStage('code');
    } finally {
      setCheckingEmail(false);
    }
  }, [
    email,
    checkingEmail,
    isWalletFlowInvite,
    registeredInviteEmail,
    restoreWalletFlowInviteFromEmail,
    setInviteEmail,
    setInviteAccessVerified,
    showToast,
  ]);

  const handleInviteChange = useCallback((value: string): void => {
    setCodeTouched(true);
    setServerError(null);
    setInviteCode(normalizeInviteCodeInput(value));
  }, []);

  const handleBackToEmail = useCallback((): void => {
    shouldFocusEmailAfterBack.current = true;
    setServerError(null);
    setCodeTouched(false);
    setStage('email');
  }, []);

  const focusInviteInput = useCallback((): void => {
    inviteInputRef.current?.focus();
  }, []);

  const handlePasteInviteCode = useCallback(async (): Promise<void> => {
    const content = await Clipboard.getStringAsync();
    if (content) {
      handleInviteChange(content);
      requestAnimationFrame(() => {
        inviteInputRef.current?.focus();
      });
    }
  }, [handleInviteChange]);

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
      const normalizedEmail = email.trim().toLowerCase();
      await storeInviteEmail(normalizedEmail);
      setRegisteredInviteEmail(normalizedEmail);
      setInviteEmail(normalizedEmail);
      setInviteAccessVerified(true);
      if (isWalletFlowInvite) {
        setWalletFlowInviteVerifiedAt(Date.now());
        goToWalletFlow();
        return;
      }
      router.replace('/onboarding');
    } catch (error) {
      setServerError(getInviteApiErrorMessage(error));
    } finally {
      setSubmitting(false);
    }
  }, [
    email,
    goToWalletFlow,
    inviteCode,
    isWalletFlowInvite,
    setInviteAccessVerified,
    setInviteEmail,
    setWalletFlowInviteVerifiedAt,
    submitting,
  ]);

  return (
    <View style={styles.screen}>
      <LinearGradient
        pointerEvents="none"
        colors={[
          'rgba(247, 247, 242, 0.32)',
          'rgba(247, 247, 242, 0.18)',
          'rgba(247, 247, 242, 0.06)',
          'rgba(247, 247, 242, 0)',
        ]}
        locations={[0, 0.28, 0.66, 1]}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        style={[styles.topShaderLight, { height: topShaderHeight }]}
      />
      <ScrollView
        ref={scrollRef}
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        contentInsetAdjustmentBehavior="never"
        showsVerticalScrollIndicator={false}
      >
        <Animated.View
          style={[
            styles.content,
            {
              paddingTop: insets.top + (compact ? spacing['2xl'] : spacing['4xl']),
              paddingHorizontal: horizontalPadding,
            },
            contentAnimatedStyle,
          ]}
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

          <View style={[styles.card, { padding: cardPadding }]}>
            {stage === 'code' || isWalletFlowInvite ? (
              <Pressable
                onPress={stage === 'code' ? handleBackToEmail : () => router.replace('/accounts')}
                accessibilityLabel={stage === 'code' ? 'Edit email address' : 'Back to accounts'}
                accessibilityRole="button"
                style={({ pressed }) => [styles.cardBackButton, { opacity: pressed ? 0.62 : 1 }]}
              >
                <Ionicons name="chevron-back" size={24} color={colors.text.primary} />
              </Pressable>
            ) : null}
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
              <Text
                variant="body"
                color={colors.text.secondary}
                align="center"
                style={styles.subtitle}
              >
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
                    ref={emailInputRef}
                    value={email}
                    onChangeText={handleEmailChange}
                    onFocus={handleInputFocus}
                    onBlur={() => {
                      void handleEmailBlur();
                    }}
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
                    <Text variant="small" color={colors.semantic.error} numberOfLines={1}>
                      {emailError}
                    </Text>
                  ) : null}
                </View>
              </View>
            ) : null}

            {/* Invite code input */}
            {stage === 'code' ? (
              <View style={styles.inputGroup}>
                <Text variant="captionBold" color={colors.text.secondary} style={styles.inputLabel}>
                  Invite code
                </Text>
                <View style={[styles.codeEntryRow, { gap: codeRowGap }]}>
                  <Pressable
                    onPress={focusInviteInput}
                    accessibilityLabel="Enter six-character invite code"
                    accessibilityRole="button"
                    style={styles.codeEntryWrap}
                  >
                    <View style={[styles.codeBoxes, { gap: codeBoxGap }]}>
                      {codeSlots.map((entry, index) => (
                        <View
                          key={`invite-code-slot-${index}`}
                          style={[
                            styles.codeBox,
                            entry.length > 0 ? styles.codeBoxFilled : null,
                            validation.valid ? styles.codeBoxReady : null,
                          ]}
                        >
                          <Text
                            variant="h2"
                            color={colors.text.onAccent}
                            align="center"
                            style={styles.codeBoxText}
                            numberOfLines={1}
                            adjustsFontSizeToFit
                            minimumFontScale={0.72}
                          >
                            {entry}
                          </Text>
                        </View>
                      ))}
                    </View>
                    <TextInput
                      ref={inviteInputRef}
                      value={inviteCode}
                      onChangeText={handleInviteChange}
                      onFocus={handleInputFocus}
                      onBlur={() => animateLookDown(false)}
                      onSubmitEditing={() => {
                        void handleVerify();
                      }}
                      autoCapitalize="characters"
                      autoCorrect={false}
                      spellCheck={false}
                      keyboardType="ascii-capable"
                      textContentType="oneTimeCode"
                      returnKeyType="done"
                      maxLength={OFFPAY_INVITE_CODE_LENGTH}
                      caretHidden
                      contextMenuHidden={false}
                      numberOfLines={1}
                      style={styles.codeInputHidden}
                    />
                  </Pressable>
                  <Pressable
                    onPress={() => {
                      void handlePasteInviteCode();
                    }}
                    accessibilityLabel="Paste invite code"
                    accessibilityRole="button"
                    hitSlop={4}
                    style={({ pressed }) => [
                      styles.codePasteButton,
                      pressed ? styles.codePasteButtonPressed : null,
                    ]}
                  >
                    <PuffyPasteIcon size={22} color={colors.text.primary} />
                  </Pressable>
                </View>
                <View style={styles.errorSlot}>
                  {codeError != null ? (
                    <Text variant="small" color={colors.semantic.error} numberOfLines={1}>
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
              disabled={stage === 'email' ? !emailValid || checkingEmail : !canSubmit}
              accessibilityLabel={stage === 'email' ? 'Continue with email' : 'Verify invite code'}
            />
          </View>
        </Animated.View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.surface.background,
  },
  topShaderLight: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 0,
  },
  scroll: {
    flex: 1,
    zIndex: 1,
  },
  scrollContent: {
    flexGrow: 1,
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
    position: 'relative',
    width: '100%',
    maxWidth: 520,
    alignSelf: 'center',
    gap: spacing.xl,
    borderRadius: radii['2xl'],
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rim,
    backgroundColor: colors.surface.cardElevated,
    overflow: 'hidden',
    boxShadow: '0 24px 58px rgba(0, 0, 0, 0.48)',
  },
  cardBackButton: {
    position: 'absolute',
    top: spacing.lg,
    left: spacing.lg,
    zIndex: 2,
    width: 42,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 21,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rimSubtle,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
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
  codeEntryWrap: {
    position: 'relative',
    flex: 1,
    minWidth: 0,
    minHeight: layout.minTouchTarget,
    justifyContent: 'center',
  },
  codeEntryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
  },
  codeBoxes: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  codeBox: {
    flex: 1,
    aspectRatio: 1,
    minWidth: 0,
    maxHeight: 66,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.lg,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border.subtle,
    backgroundColor: 'rgba(247, 247, 242, 0.88)',
    boxShadow: [
      '0 10px 18px rgba(0, 0, 0, 0.24)',
      'inset 0 1px 2px rgba(255, 255, 255, 0.9)',
      'inset 0 -1px 2px rgba(0, 0, 0, 0.12)',
    ].join(', '),
  },
  codeBoxFilled: {
    backgroundColor: colors.brand.glossAccent,
  },
  codeBoxReady: {
    borderColor: colors.border.accent,
  },
  codeBoxText: {
    color: colors.text.onAccent,
    fontFamily: fontFamily.uiSemiBold,
    fontSize: 24,
    lineHeight: 30,
  },
  codeInputHidden: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    opacity: 0.01,
    color: 'transparent',
  },
  codePasteButton: {
    width: layout.minTouchTarget,
    height: layout.minTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.full,
    borderCurve: 'continuous',
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rimSubtle,
    backgroundColor: colors.glass.textBacking,
    boxShadow: ['0 8px 16px rgba(0, 0, 0, 0.24)', 'inset 0 1px 1px rgba(255, 255, 255, 0.16)'].join(
      ', ',
    ),
  },
  codePasteButtonPressed: {
    opacity: 0.68,
    transform: [{ scale: 0.96 }],
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
