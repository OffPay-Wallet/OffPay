import { useMemo, useState } from 'react';
import { Keyboard, StyleSheet, TextInput, useWindowDimensions, View } from 'react-native';

import { GlassActionButton } from '@/components/ui/GlassActionButton';
import { PuffyAvatarIcon } from '@/components/ui/icons/PuffyAvatarIcon';
import { Text } from '@/components/ui/Text';
import { colors } from '@/constants/colors';
import { layout, radii, spacing } from '@/constants/spacing';
import { fontFamily } from '@/constants/typography';
import {
  formatOffpayUsername,
  getOffpayUsernameError,
  OFFPAY_USERNAME_MAX_LENGTH,
  sanitizeOffpayUsernameInput,
} from '@/lib/api/offpay-username';

interface UsernameSetupFormProps {
  initialUsername?: string | null;
  onSubmit: (username: string) => void;
  onBack: () => void;
  submitting?: boolean;
}

export function UsernameSetupForm({
  initialUsername,
  onSubmit,
  onBack,
  submitting = false,
}: UsernameSetupFormProps): React.JSX.Element {
  const { width } = useWindowDimensions();
  const [username, setUsername] = useState(() =>
    sanitizeOffpayUsernameInput(initialUsername ?? ''),
  );
  const normalizedUsername = useMemo(() => sanitizeOffpayUsernameInput(username), [username]);
  const usernameError = username.length > 0 ? getOffpayUsernameError(username) : null;
  const canContinue = formatOffpayUsername(username) != null;
  const titleFontSize = width < 360 ? 28 : width < 390 ? 30 : 32;

  const handleSubmit = (): void => {
    const formatted = formatOffpayUsername(username);
    if (formatted == null || submitting) return;

    Keyboard.dismiss();
    onSubmit(formatted);
  };

  return (
    <View style={styles.shell}>
      <PuffyAvatarIcon
        size={layout.avatarLg + spacing['3xl']}
        color={colors.brand.glossAccent}
        style={styles.avatarIcon}
      />

      <View style={styles.copyBlock}>
        <Text
          variant="h1"
          color={colors.text.primary}
          style={[
            styles.title,
            {
              fontSize: titleFontSize,
              lineHeight: titleFontSize + spacing.sm,
            },
          ]}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.82}
        >
          Choose a username
        </Text>
      </View>

      <View style={styles.inputBlock}>
        <View style={[styles.inputShell, usernameError != null && styles.inputShellError]}>
          <Text variant="bodyBold" color={colors.text.tertiary} style={styles.atSign}>
            @
          </Text>
          <TextInput
            value={username}
            onChangeText={(value) => setUsername(sanitizeOffpayUsernameInput(value))}
            placeholder="wallet01"
            placeholderTextColor={colors.text.placeholder}
            selectionColor={colors.brand.glossAccent}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="username"
            textContentType="username"
            maxLength={OFFPAY_USERNAME_MAX_LENGTH}
            style={styles.input}
            returnKeyType="done"
            onSubmitEditing={handleSubmit}
          />
        </View>
        <Text
          variant="small"
          color={usernameError != null ? colors.semantic.warning : colors.text.secondary}
          style={styles.helper}
        >
          {usernameError ??
            `${normalizedUsername.length}/${OFFPAY_USERNAME_MAX_LENGTH} letters, numbers, or underscores`}
        </Text>
      </View>

      <View style={styles.actions}>
        <GlassActionButton
          label="Continue"
          onPress={handleSubmit}
          disabled={!canContinue || submitting}
          loading={submitting}
          size="compact"
          accessibilityLabel="Continue with username"
        />

        <GlassActionButton
          label="Back"
          onPress={onBack}
          variant="secondary"
          disabled={submitting}
          size="compact"
          accessibilityLabel="Go back"
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  shell: {
    width: '100%',
    gap: spacing['2xl'],
  },
  avatarIcon: {
    alignSelf: 'center',
  },
  copyBlock: {},
  title: {
    textAlign: 'center',
    fontFamily: fontFamily.bold,
  },
  inputBlock: {
    gap: spacing.sm,
  },
  inputShell: {
    minHeight: layout.buttonHeightMd,
    borderRadius: radii.full,
    borderCurve: 'continuous',
    backgroundColor: colors.brand.whiteStream,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rim,
    paddingHorizontal: spacing.xl,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  inputShellError: {
    borderColor: colors.semantic.warning,
    borderWidth: 1,
  },
  atSign: {
    fontSize: 20,
    lineHeight: 24,
  },
  input: {
    flex: 1,
    minWidth: 0,
    color: colors.text.primary,
    fontFamily: fontFamily.semiBold,
    fontSize: 20,
    lineHeight: 24,
    paddingVertical: 0,
  },
  helper: {
    textAlign: 'center',
  },
  actions: {
    gap: spacing.md,
  },
});
