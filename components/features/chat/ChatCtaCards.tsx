import React from 'react';
import { Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

import { Text } from '@/components/ui/Text';
import { colors } from '@/constants/colors';
import { radii, spacing } from '@/constants/spacing';
import { fontFamily } from '@/constants/typography';
import type { AgenticChatCtaId } from '@/lib/agentic-payments/agent-tools';

interface ChatCta {
  id: AgenticChatCtaId;
  title: string;
  caption: string;
  icon: keyof typeof Ionicons.glyphMap;
  prompt: string;
}

interface ChatCtaCardsProps {
  ctaIds: readonly AgenticChatCtaId[];
  disabled?: boolean;
  compact?: boolean;
  onSelect: (prompt: string) => void;
}

const UMBRA_TOOL_CTA_IDS = new Set<AgenticChatCtaId>([
  'umbra-deposit',
  'umbra-withdraw',
  'umbra-claims',
]);

const CHAT_CTAS: readonly ChatCta[] = [
  {
    id: 'balance',
    title: 'Balance',
    caption: 'Wallet overview',
    icon: 'wallet-outline',
    prompt: 'Show my wallet balance',
  },
  {
    id: 'activity',
    title: 'Activity',
    caption: 'Recent history',
    icon: 'time-outline',
    prompt: 'Show my recent wallet activity',
  },
  {
    id: 'send',
    title: 'Send',
    caption: 'Start transfer',
    icon: 'paper-plane-outline',
    prompt: 'I want to send money',
  },
  {
    id: 'private-send',
    title: 'Private',
    caption: 'Shield balance',
    icon: 'lock-closed-outline',
    prompt: 'Shield funds into my Umbra vault',
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
    id: 'umbra-vault',
    title: 'Umbra',
    caption: 'Vault balance',
    icon: 'key-outline',
    prompt: 'Show my Umbra vault balance',
  },
  {
    id: 'umbra-deposit',
    title: 'Deposit',
    caption: 'Shield in',
    icon: 'arrow-down-circle-outline',
    prompt: 'Deposit funds into my Umbra vault',
  },
  {
    id: 'umbra-withdraw',
    title: 'Withdraw',
    caption: 'Unshield',
    icon: 'arrow-up-circle-outline',
    prompt: 'Withdraw funds from my Umbra vault',
  },
  {
    id: 'umbra-claims',
    title: 'Claims',
    caption: 'Scan',
    icon: 'search-outline',
    prompt: 'Scan my Umbra claims',
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
  ctaIds,
  disabled = false,
  compact = false,
  onSelect,
}: ChatCtaCardsProps): React.JSX.Element {
  const { width, fontScale } = useWindowDimensions();
  const allowedCtaIds = new Set(ctaIds);
  const cards = CHAT_CTAS.filter((cta) => allowedCtaIds.has(cta.id));
  const primaryCards = cards.filter((cta) => !UMBRA_TOOL_CTA_IDS.has(cta.id));
  const umbraToolCards = cards.filter((cta) => UMBRA_TOOL_CTA_IDS.has(cta.id));
  const useThreeColumnUmbraRow = width >= 360 && fontScale <= 1.18;

  const renderCard = (cta: ChatCta, variant: 'primary' | 'umbra-tool' = 'primary') => {
    const isUmbraTool = variant === 'umbra-tool';
    return (
      <Pressable
        key={cta.id}
        disabled={disabled}
        onPress={() => onSelect(cta.prompt)}
        style={({ pressed }) => [
          styles.card,
          compact && styles.cardCompact,
          isUmbraTool && styles.umbraToolCard,
          isUmbraTool && !useThreeColumnUmbraRow && styles.umbraToolCardWrapped,
          disabled && styles.cardDisabled,
          pressed && !disabled && styles.cardPressed,
        ]}
        accessibilityRole="button"
        accessibilityLabel={`${cta.title}. ${cta.caption}`}
        accessibilityState={{ disabled }}
      >
        <View
          style={[
            styles.iconSlot,
            isUmbraTool && styles.umbraToolIconSlot,
            isUmbraTool && !useThreeColumnUmbraRow && styles.iconSlot,
          ]}
        >
          <Ionicons name={cta.icon} size={18} color={colors.brand.glossAccent} />
        </View>
        <View
          style={[
            styles.copyStack,
            isUmbraTool && styles.umbraToolCopyStack,
            isUmbraTool && !useThreeColumnUmbraRow && styles.umbraToolCopyStackWrapped,
          ]}
        >
          <Text
            variant="buttonSmall"
            color={colors.text.primary}
            style={[
              styles.title,
              isUmbraTool && styles.umbraToolText,
              isUmbraTool && !useThreeColumnUmbraRow && styles.umbraToolTextWrapped,
            ]}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.82}
          >
            {cta.title}
          </Text>
          <Text
            variant="small"
            color={colors.text.secondary}
            style={[
              styles.caption,
              isUmbraTool && styles.umbraToolText,
              isUmbraTool && !useThreeColumnUmbraRow && styles.umbraToolTextWrapped,
            ]}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.78}
          >
            {cta.caption}
          </Text>
        </View>
      </Pressable>
    );
  };

  return (
    <View style={[styles.container, compact && styles.containerCompact]}>
      {primaryCards.length > 0 ? (
        <View style={styles.grid}>{primaryCards.map((cta) => renderCard(cta))}</View>
      ) : null}

      {umbraToolCards.length > 0 ? (
        <View style={[styles.umbraToolRow, !useThreeColumnUmbraRow && styles.umbraToolRowWrapped]}>
          {umbraToolCards.map((cta) => renderCard(cta, 'umbra-tool'))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginTop: spacing.xl,
    width: '100%',
    maxWidth: 584,
    alignSelf: 'center',
    gap: spacing.sm,
  },
  containerCompact: {
    marginTop: spacing.lg,
  },
  grid: {
    width: '100%',
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: spacing.sm,
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
  umbraToolRow: {
    width: '100%',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  umbraToolRowWrapped: {
    flexWrap: 'wrap',
    justifyContent: 'center',
  },
  umbraToolCard: {
    minHeight: 86,
    minWidth: 0,
    flex: 1,
    flexBasis: 0,
    flexGrow: 1,
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  umbraToolCardWrapped: {
    minHeight: 64,
    minWidth: 122,
    flexBasis: '47%',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
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
  umbraToolIconSlot: {
    width: 34,
    height: 34,
  },
  copyStack: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  umbraToolCopyStack: {
    width: '100%',
    flex: 0,
    alignItems: 'center',
  },
  umbraToolCopyStackWrapped: {
    flex: 1,
    alignItems: 'flex-start',
  },
  title: {
    fontFamily: fontFamily.uiSemiBold,
  },
  caption: {
    fontFamily: fontFamily.ui,
  },
  umbraToolText: {
    width: '100%',
    textAlign: 'center',
  },
  umbraToolTextWrapped: {
    textAlign: 'left',
  },
});
