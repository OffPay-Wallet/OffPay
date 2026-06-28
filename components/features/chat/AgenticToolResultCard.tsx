import React from 'react';
import { StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui/Text';
import { colors } from '@/constants/colors';
import { radii, spacing } from '@/constants/spacing';
import { fontFamily } from '@/constants/typography';

import { ConfirmationCardSurface } from './ConfirmationCardSurface';

import type { AgenticChatToolCard, AgenticToolCardTone } from '@/store/agenticChatStore';

interface AgenticToolResultCardProps {
  card: AgenticChatToolCard;
}

function colorForTone(tone: AgenticToolCardTone | undefined): string {
  if (tone === 'danger') return colors.semantic.error;
  if (tone === 'warning') return colors.semantic.warning;
  if (tone === 'success') return colors.text.primary;
  return colors.text.secondary;
}

export function AgenticToolResultCard({ card }: AgenticToolResultCardProps): React.JSX.Element {
  const rows = card.rows ?? [];
  const items = card.items ?? [];

  return (
    <ConfirmationCardSurface>
      <View style={styles.header}>
        <View style={styles.titleStack}>
          <Text variant="bodyBold" color={colors.text.primary} style={styles.title}>
            {card.title}
          </Text>
          {card.subtitle != null ? (
            <Text variant="small" color={colorForTone(card.tone)} numberOfLines={1}>
              {card.subtitle}
            </Text>
          ) : null}
        </View>
      </View>

      {rows.length > 0 ? (
        <View style={styles.rows}>
          {rows.map((row) => (
            <View key={`${row.label}:${row.value}`} style={styles.row}>
              <Text variant="small" color={colors.text.tertiary} style={styles.rowLabel}>
                {row.label}
              </Text>
              <Text
                variant="captionBold"
                color={colorForTone(row.tone)}
                style={[styles.rowValue, row.mono === true && styles.mono]}
                numberOfLines={1}
                ellipsizeMode="middle"
              >
                {row.value}
              </Text>
            </View>
          ))}
        </View>
      ) : null}

      {items.length > 0 ? (
        <View style={styles.items}>
          {items.map((item, index) => (
            <View key={`${index}:${item.title}:${item.detail ?? ''}`} style={styles.item}>
              <View style={styles.itemBullet} />
              <View style={styles.itemTextStack}>
                <Text
                  variant="captionBold"
                  color={colorForTone(item.tone)}
                  style={styles.itemTitle}
                  numberOfLines={1}
                >
                  {item.title}
                </Text>
                {item.detail != null && item.detail.length > 0 ? (
                  <Text
                    variant="small"
                    color={colors.text.tertiary}
                    style={styles.itemDetail}
                    numberOfLines={1}
                  >
                    {item.detail}
                  </Text>
                ) : null}
              </View>
            </View>
          ))}
        </View>
      ) : null}

      {card.footer != null && card.footer.length > 0 ? (
        <Text variant="small" color={colors.text.tertiary} style={styles.footer}>
          {card.footer}
        </Text>
      ) : null}
    </ConfirmationCardSurface>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  titleStack: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  title: {
    fontFamily: fontFamily.uiSemiBold,
    fontSize: 18,
    lineHeight: 23,
  },
  rows: {
    gap: spacing.sm,
  },
  row: {
    minHeight: 26,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  rowLabel: {
    width: 92,
    flexShrink: 0,
  },
  rowValue: {
    flex: 1,
    textAlign: 'right',
    fontFamily: fontFamily.uiSemiBold,
  },
  mono: {
    fontFamily: fontFamily.mono,
  },
  items: {
    gap: spacing.sm,
  },
  item: {
    minHeight: 34,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: 2,
  },
  itemBullet: {
    width: 6,
    height: 6,
    borderRadius: radii.full,
    backgroundColor: colors.text.tertiary,
    flexShrink: 0,
  },
  itemTextStack: {
    flex: 1,
    minWidth: 0,
    gap: 1,
  },
  itemTitle: {
    fontFamily: fontFamily.uiSemiBold,
  },
  itemDetail: {
    fontFamily: fontFamily.ui,
  },
  footer: {
    lineHeight: 16,
  },
});
