import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import Animated, { FadeIn, FadeOut, LinearTransition } from 'react-native-reanimated';

import { Text } from '@/components/ui/Text';
import { colors } from '@/constants/colors';
import { radii, spacing } from '@/constants/spacing';
import { fontFamily } from '@/constants/typography';
import { shortenWalletAddress } from '@/lib/api/offpay-wallet-data';

import type { RecentRecipientOption } from './types';

interface SendRecipientStepProps {
  recipient: string;
  helper: string | null;
  clipboardRecipient: string | null;
  recentRecipients: RecentRecipientOption[];
  isOfflineMode: boolean;
  onRecipientChange: (value: string) => void;
  onUseClipboard: () => void;
  onSelectRecent: (address: string) => void;
  onClearRecent: () => void;
  onScanQr: () => void;
  onScanNearby: () => void;
}

// Pin the input baseline so the placeholder/value cannot shift on
// type/clear. Android's TextInput baseline floats by 1–2px when the
// font metrics change between the placeholder and the value font;
// fixing `lineHeight` removes the wobble. The input is multiline so a
// full wallet address (44 chars) wraps to a second line and stays
// fully visible instead of being clipped/scrolled out of view.
const RECIPIENT_INPUT_FONT_SIZE = 17;
const RECIPIENT_INPUT_LINE_HEIGHT = 22;

export function SendRecipientStep({
  recipient,
  helper,
  clipboardRecipient,
  recentRecipients,
  isOfflineMode,
  onRecipientChange,
  onUseClipboard,
  onSelectRecent,
  onClearRecent,
  onScanQr,
  onScanNearby,
}: SendRecipientStepProps): React.JSX.Element {
  return (
    <Animated.View
      entering={FadeIn.duration(220)}
      layout={LinearTransition.duration(220)}
      style={styles.step}
    >
      <View style={styles.toRow}>
        <Text variant="bodyBold" color={colors.text.secondary}>
          To:
        </Text>
        <TextInput
          value={recipient}
          onChangeText={onRecipientChange}
          // Short on purpose. Android's TextInput will wrap a long
          // placeholder onto a second line when the row narrows
          // (paste button + "To:" eat horizontal space). Keeping the
          // hint short lets the row stay single-line on every device.
          placeholder="@handle, .sol, or wallet"
          placeholderTextColor={colors.text.placeholder}
          style={styles.recipientInput}
          selectionColor={colors.brand.glossAccent}
          autoCapitalize="none"
          autoCorrect={false}
          maxFontSizeMultiplier={1}
          // Multiline so a pasted 44-char wallet address wraps to a
          // second line and stays fully visible instead of being
          // cropped at the row edge.
          multiline
          scrollEnabled={false}
          textAlignVertical="center"
          allowFontScaling={false}
          underlineColorAndroid="transparent"
        />
        <Pressable
          style={({ pressed }) => [styles.pasteButton, pressed && styles.pressed]}
          onPress={onUseClipboard}
          accessibilityRole="button"
          accessibilityLabel="Paste wallet address"
          hitSlop={8}
        >
          <Ionicons name="clipboard-outline" size={20} color={colors.brand.glossAccent} />
        </Pressable>
      </View>

      <View style={styles.quickActions}>
        <Pressable
          style={({ pressed }) => [styles.textAction, pressed && styles.pressed]}
          onPress={onScanQr}
          accessibilityRole="button"
          accessibilityLabel="Scan recipient QR"
        >
          <Text variant="captionBold" color={colors.text.primary}>
            Scan QR
          </Text>
        </Pressable>
        {isOfflineMode ? (
          <Pressable
            style={({ pressed }) => [styles.textAction, pressed && styles.pressed]}
            onPress={onScanNearby}
            accessibilityRole="button"
            accessibilityLabel="Scan nearby wallets"
          >
            <Text variant="captionBold" color={colors.text.primary}>
              Scan nearby wallets
            </Text>
          </Pressable>
        ) : null}
      </View>

      {clipboardRecipient != null && clipboardRecipient.trim() !== recipient.trim() ? (
        <Animated.View
          entering={FadeIn.duration(200)}
          exiting={FadeOut.duration(160)}
          layout={LinearTransition.duration(220)}
        >
          <Pressable
            style={({ pressed }) => [styles.clipboardCard, pressed && styles.pressed]}
            onPress={onUseClipboard}
            accessibilityRole="button"
            accessibilityLabel="Paste recipient from clipboard"
          >
            <Text variant="small" color={colors.text.secondary}>
              Paste from clipboard
            </Text>
            <Text variant="bodyBold" color={colors.text.primary} numberOfLines={2}>
              {clipboardRecipient}
            </Text>
          </Pressable>
        </Animated.View>
      ) : null}

      {recentRecipients.length > 0 ? (
        <View style={styles.recentBlock}>
          <View style={styles.recentHeader}>
            <Text variant="bodyBold" color={colors.text.secondary} numberOfLines={1}>
              Recently Used
            </Text>
            <Pressable
              style={({ pressed }) => [styles.clearButton, pressed && styles.pressed]}
              onPress={onClearRecent}
              accessibilityRole="button"
              accessibilityLabel="Clear recent wallet history"
              hitSlop={6}
            >
              <Text variant="captionBold" color={colors.text.primary}>
                Clear
              </Text>
            </Pressable>
          </View>
          <View style={styles.recentList}>
            {recentRecipients.map((item) => (
              <Pressable
                key={item.address}
                style={({ pressed }) => [styles.recentRow, pressed && styles.pressed]}
                onPress={() => onSelectRecent(item.address)}
                accessibilityRole="button"
                accessibilityLabel={`Use ${shortenWalletAddress(item.address)}`}
              >
                <Text variant="bodyBold" color={colors.text.primary} numberOfLines={1}>
                  {shortenWalletAddress(item.address)}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}

      {/* Helper slot — fixed-height container so the page below
          (the bottom-pinned Next CTA in the parent footer) never
          reflows when the helper toggles. */}
      <View style={styles.helperSlot}>
        {helper != null ? (
          <Text
            variant="small"
            color={colors.semantic.warning}
            style={styles.helper}
            numberOfLines={3}
          >
            {helper}
          </Text>
        ) : null}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  step: {
    gap: spacing.lg,
  },
  toRow: {
    minHeight: 64,
    borderRadius: radii.xl,
    borderCurve: 'continuous',
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rim,
    backgroundColor: colors.glass.strongFill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    boxShadow: `0 2px 6px rgba(16, 16, 16, 0.06), inset 0 1px 1px rgba(255, 255, 255, 0.6)`,
  },
  recipientInput: {
    flex: 1,
    minWidth: 0,
    color: colors.text.primary,
    fontFamily: fontFamily.uiSemiBold,
    fontSize: RECIPIENT_INPUT_FONT_SIZE,
    lineHeight: RECIPIENT_INPUT_LINE_HEIGHT,
    paddingVertical: 0,
    // Android-only style; harmless on iOS. Lives in the StyleSheet
    // because TextInputProps doesn't accept it as a JSX prop.
    includeFontPadding: false,
  },
  pasteButton: {
    width: 40,
    height: 40,
    borderRadius: radii.full,
    borderCurve: 'continuous',
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rimSubtle,
    backgroundColor: colors.glass.textBacking,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  textAction: {
    minHeight: 42,
    borderRadius: radii.full,
    borderCurve: 'continuous',
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rim,
    backgroundColor: colors.glass.strongFill,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: `0 2px 6px rgba(16, 16, 16, 0.06), inset 0 1px 1px rgba(255, 255, 255, 0.6)`,
  },
  clipboardCard: {
    borderRadius: radii['2xl'],
    borderCurve: 'continuous',
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rim,
    backgroundColor: colors.glass.strongFill,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    gap: spacing.xs,
    boxShadow: `0 2px 6px rgba(16, 16, 16, 0.06), inset 0 1px 1px rgba(255, 255, 255, 0.6)`,
  },
  recentBlock: {
    gap: spacing.md,
  },
  recentHeader: {
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  clearButton: {
    minHeight: 40,
    borderRadius: radii.full,
    borderCurve: 'continuous',
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rim,
    backgroundColor: colors.glass.strongFill,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recentList: {
    gap: spacing.sm,
  },
  recentRow: {
    minHeight: 58,
    borderRadius: radii.xl,
    borderCurve: 'continuous',
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rim,
    backgroundColor: colors.glass.strongFill,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    justifyContent: 'center',
    gap: 2,
    boxShadow: `0 2px 6px rgba(16, 16, 16, 0.06), inset 0 1px 1px rgba(255, 255, 255, 0.6)`,
  },
  // Reserves vertical room for up to ~3 lines of helper copy. The
  // helper carries advisory hints (handle not registered, online-mode
  // required, etc.) that can wrap onto multiple lines on narrow
  // phones — the slot keeps the bottom Next CTA pinned regardless.
  helperSlot: {
    minHeight: 56,
    justifyContent: 'flex-start',
  },
  helper: {
    lineHeight: 18,
  },
  pressed: {
    opacity: 0.78,
  },
});
