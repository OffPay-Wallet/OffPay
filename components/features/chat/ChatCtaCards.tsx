import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

import { Text } from '@/components/ui/Text';
import { colors } from '@/constants/colors';
import { radii, spacing } from '@/constants/spacing';
import { fontFamily } from '@/constants/typography';

type ChatCtaId = 'send' | 'swap' | 'payroll' | 'flash';

interface ChatCta {
  id: ChatCtaId;
  title: string;
  caption: string;
  icon: keyof typeof Ionicons.glyphMap;
  prompt: string;
}

interface ChatCtaCardsProps {
  disabled?: boolean;
  compact?: boolean;
  onSelect: (prompt: string) => void;
}

const CHAT_CTAS: readonly ChatCta[] = [
  {
    id: 'send',
    title: 'Send',
    caption: 'Start transfer',
    icon: 'paper-plane-outline',
    prompt: 'I want to send money',
  },
  {
    id: 'swap',
    title: 'Swap',
    caption: 'Quote tokens',
    icon: 'swap-horizontal-outline',
    prompt: 'I want to swap tokens',
  },
  {
    id: 'payroll',
    title: 'Batch Send',
    caption: 'Upload recipients',
    icon: 'people-outline',
    prompt: 'Run batch send',
  },
  {
    id: 'flash',
    title: 'Flash',
    caption: 'Positions & orders',
    icon: 'flash-outline',
    prompt: 'Show my Flash Trade positions and open orders',
  },
];

export function ChatCtaCards({
  disabled = false,
  compact = false,
  onSelect,
}: ChatCtaCardsProps): React.JSX.Element {
  return (
    <View style={[styles.grid, compact && styles.gridCompact]}>
      {CHAT_CTAS.map((cta) => (
        <Pressable
          key={cta.id}
          disabled={disabled}
          onPress={() => onSelect(cta.prompt)}
          style={({ pressed }) => [
            styles.card,
            compact && styles.cardCompact,
            disabled && styles.cardDisabled,
            pressed && !disabled && styles.cardPressed,
          ]}
          accessibilityRole="button"
          accessibilityLabel={`${cta.title}. ${cta.caption}`}
          accessibilityState={{ disabled }}
        >
          <View style={styles.iconSlot}>
            <Ionicons name={cta.icon} size={18} color={colors.brand.glossAccent} />
          </View>
          <View style={styles.copyStack}>
            <Text
              variant="buttonSmall"
              color={colors.text.primary}
              style={styles.title}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.86}
            >
              {cta.title}
            </Text>
            <Text
              variant="small"
              color={colors.text.secondary}
              style={styles.caption}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.82}
            >
              {cta.caption}
            </Text>
          </View>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    marginTop: spacing.xl,
    width: '100%',
    maxWidth: 584,
    alignSelf: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  gridCompact: {
    marginTop: spacing.lg,
  },
  card: {
    minHeight: 72,
    minWidth: 132,
    flexBasis: '47%',
    flexGrow: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderRadius: radii.lg,
    borderCurve: 'continuous',
    backgroundColor: colors.surface.cardElevated,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rimSubtle,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  cardCompact: {
    minHeight: 64,
    minWidth: 122,
  },
  cardPressed: {
    backgroundColor: colors.surface.pressed,
  },
  cardDisabled: {
    opacity: 0.5,
  },
  iconSlot: {
    width: 36,
    height: 36,
    borderRadius: radii.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.glass.clearFill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rimSubtle,
  },
  copyStack: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  title: {
    fontFamily: fontFamily.uiSemiBold,
  },
  caption: {
    fontFamily: fontFamily.ui,
  },
});
