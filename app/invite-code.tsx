import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GlassActionButton } from '@/components/ui/GlassActionButton';
import { Text } from '@/components/ui/Text';
import { colors } from '@/constants/colors';
import { layout, radii, spacing } from '@/constants/spacing';
import { fontFamily } from '@/constants/typography';
import { OffpayApiError, verifyInviteCode } from '@/lib/api/offpay-api-client';
import { getStoredInviteCode, storeInviteCode } from '@/lib/invite/invite-access';
import {
  getInviteCodeValidationMessage,
  normalizeInviteCodeInput,
  parseInviteCode,
} from '@/shared/invite-codes';
import { useAppStore } from '@/store/app';

const APP_ICON_SOURCE = require('../assets/AppIcons/playstore.png') as number;

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
    default:
      return error.message || 'Could not verify this invite. Try again.';
  }
}

export default function InviteCodeScreen(): React.JSX.Element {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const inviteAccessVerified = useAppStore((state) => state.inviteAccessVerified);
  const setInviteAccessVerified = useAppStore((state) => state.setInviteAccessVerified);
  const [inviteCode, setInviteCode] = useState('');
  const [touched, setTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const compact = width < 390 || height < 740;
  const horizontalPadding = width < 340 ? spacing.lg : compact ? spacing.xl : spacing['3xl'];
  const validation = useMemo(() => parseInviteCode(inviteCode), [inviteCode]);
  const canSubmit = validation.valid && !submitting;
  const helperText =
    serverError ??
    (validation.valid
      ? 'Invite ready.'
      : touched
        ? getInviteCodeValidationMessage(validation.reason)
        : 'Use the private beta invite shared with you.');

  useEffect(() => {
    if (inviteAccessVerified) {
      router.replace('/onboarding');
      return;
    }

    let cancelled = false;
    void getStoredInviteCode().then((storedCode) => {
      if (!cancelled && storedCode != null) {
        setInviteCode(storedCode);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [inviteAccessVerified]);

  const handleInviteChange = useCallback((value: string): void => {
    setTouched(true);
    setServerError(null);
    setInviteCode(normalizeInviteCodeInput(value));
  }, []);

  const handleVerify = useCallback(async (): Promise<void> => {
    if (submitting) return;

    setTouched(true);
    setServerError(null);

    const parsed = parseInviteCode(inviteCode);
    if (!parsed.valid) return;

    setSubmitting(true);
    try {
      await verifyInviteCode(parsed.normalizedCode);
      await storeInviteCode(parsed.normalizedCode);
      setInviteAccessVerified(true);
      router.replace('/onboarding');
    } catch (error) {
      setServerError(getInviteApiErrorMessage(error));
    } finally {
      setSubmitting(false);
    }
  }, [inviteCode, setInviteAccessVerified, submitting]);

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
        <View style={styles.brandLockup}>
          <Image
            source={APP_ICON_SOURCE}
            style={styles.brandIcon}
            contentFit="contain"
            tintColor={colors.brand.whiteStream}
            transition={0}
            accessible={false}
          />
          <Text variant="h2" color={colors.text.primary} style={styles.brandText}>
            OffPay
          </Text>
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
              Verify your private beta code to continue.
            </Text>
          </View>

          <View style={styles.inputGroup}>
            <Text variant="captionBold" color={colors.text.secondary} style={styles.inputLabel}>
              Invite code
            </Text>
            <View style={[styles.inputFrame, validation.valid ? styles.inputFrameReady : null]}>
              <TextInput
                value={inviteCode}
                onChangeText={handleInviteChange}
                onSubmitEditing={() => {
                  void handleVerify();
                }}
                placeholder="OFFPAY-B1-XXXXXXXXXXXX-00"
                placeholderTextColor={colors.text.placeholder}
                autoCapitalize="characters"
                autoCorrect={false}
                spellCheck={false}
                keyboardType="ascii-capable"
                textContentType="oneTimeCode"
                returnKeyType="done"
                maxLength={64}
                numberOfLines={1}
                style={styles.input}
              />
            </View>
            <Text
              variant="small"
              color={serverError != null || (!validation.valid && touched) ? colors.semantic.error : colors.text.secondary}
              style={styles.helperText}
              numberOfLines={2}
            >
              {helperText}
            </Text>
          </View>

          <GlassActionButton
            label="Verify invite"
            onPress={() => {
              void handleVerify();
            }}
            loading={submitting}
            disabled={!canSubmit}
            accessibilityLabel="Verify invite code"
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
    gap: spacing['3xl'],
  },
  brandLockup: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  brandIcon: {
    width: 42,
    height: 42,
    borderRadius: 21,
  },
  brandText: {
    fontFamily: fontFamily.uiSemiBold,
  },
  card: {
    width: '100%',
    maxWidth: 520,
    alignSelf: 'center',
    gap: spacing['2xl'],
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
  input: {
    minHeight: 48,
    padding: 0,
    color: colors.text.primary,
    fontFamily: fontFamily.monoSemiBold,
    fontSize: 15,
    letterSpacing: 0.2,
  },
  helperText: {
    minHeight: 32,
    fontFamily: fontFamily.uiMedium,
  },
});
