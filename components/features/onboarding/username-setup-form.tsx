import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  Pressable,
  StyleSheet,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

import { WalletAvatar } from '@/components/features/settings/WalletAvatar';
import { GlassActionButton } from '@/components/ui/GlassActionButton';
import { Text } from '@/components/ui/Text';
import { colors } from '@/constants/colors';
import { layout, radii, spacing } from '@/constants/spacing';
import { fontFamily } from '@/constants/typography';
import { useLocalProfileImageManager } from '@/hooks/useLocalProfileImageManager';
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
  const {
    profileImageUri,
    pickingProfileImage,
    pickProfileImage,
    clearProfileImage,
  } = useLocalProfileImageManager();
  const normalizedUsername = useMemo(() => sanitizeOffpayUsernameInput(username), [username]);
  const usernameError = username.length > 0 ? getOffpayUsernameError(username) : null;
  const canContinue = formatOffpayUsername(username) != null;
  const titleFontSize = width < 360 ? 28 : width < 390 ? 30 : 32;
  const avatarSize = width < 360 ? 72 : 80;

  const handleSubmit = (): void => {
    const formatted = formatOffpayUsername(username);
    if (formatted == null || submitting) return;

    Keyboard.dismiss();
    onSubmit(formatted);
  };

  return (
    <View style={styles.shell}>
      <View style={styles.profileBlock}>
        <Pressable
          style={styles.avatarButton}
          onPress={() => {
            void pickProfileImage();
          }}
          disabled={pickingProfileImage || submitting}
          accessibilityRole="button"
          accessibilityLabel="Change profile photo"
        >
          <WalletAvatar size={avatarSize} solidFill />
          <View style={styles.avatarBadge}>
            {pickingProfileImage ? (
              <ActivityIndicator size="small" color={colors.text.onAccent} />
            ) : (
              <Ionicons name="camera-outline" size={14} color={colors.text.onAccent} />
            )}
          </View>
        </Pressable>

        <View style={styles.profileActions}>
          <Pressable
            style={({ pressed }) => [
              styles.profileAction,
              pressed && !pickingProfileImage && !submitting ? styles.profileActionPressed : null,
            ]}
            onPress={() => {
              void pickProfileImage();
            }}
            disabled={pickingProfileImage || submitting}
            accessibilityRole="button"
            accessibilityLabel="Change profile photo"
          >
            {pickingProfileImage ? (
              <ActivityIndicator size="small" color={colors.text.primary} />
            ) : (
              <Ionicons
                name="image-outline"
                size={layout.iconSizeInline}
                color={colors.text.primary}
              />
            )}
            <Text
              variant="buttonSmall"
              color={colors.text.primary}
              numberOfLines={1}
              maxFontSizeMultiplier={1.05}
              style={styles.profileActionLabel}
            >
              Change photo
            </Text>
          </Pressable>

          {profileImageUri != null ? (
            <Pressable
              style={({ pressed }) => [
                styles.profileAction,
                styles.profileActionDanger,
                pressed && !submitting ? styles.profileActionDangerPressed : null,
              ]}
              onPress={() => {
                void clearProfileImage();
              }}
              disabled={submitting}
              accessibilityRole="button"
              accessibilityLabel="Remove profile photo"
            >
              <Ionicons
                name="trash-outline"
                size={layout.iconSizeInline}
                color={colors.semantic.error}
              />
              <Text
                variant="buttonSmall"
                color={colors.semantic.error}
                numberOfLines={1}
                maxFontSizeMultiplier={1.05}
                style={styles.profileActionLabel}
              >
                Remove photo
              </Text>
            </Pressable>
          ) : null}
        </View>
      </View>

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
  profileBlock: {
    alignSelf: 'center',
    alignItems: 'center',
    gap: spacing.md,
  },
  avatarButton: {
    position: 'relative',
  },
  avatarBadge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 28,
    height: 28,
    borderRadius: radii.full,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.brand.glossAccent,
    borderWidth: 2,
    borderColor: colors.brand.glassTint,
  },
  profileActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  profileAction: {
    minHeight: 38,
    borderRadius: radii.full,
    borderCurve: 'continuous',
    paddingHorizontal: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    backgroundColor: colors.surface.backgroundTint,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rimSubtle,
  },
  profileActionPressed: {
    backgroundColor: colors.surface.pressed,
  },
  profileActionDanger: {
    backgroundColor: 'rgba(255, 77, 90, 0.1)',
    borderColor: 'rgba(255, 77, 90, 0.28)',
  },
  profileActionDangerPressed: {
    backgroundColor: 'rgba(255, 77, 90, 0.18)',
  },
  profileActionLabel: {
    flexShrink: 1,
    fontFamily: fontFamily.uiSemiBold,
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
    backgroundColor: colors.surface.backgroundTint,
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
