import React from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';

import { formatRwaChangeLabel } from '@/components/features/rwa/rwa-trade-utils';
import { Text } from '@/components/ui/Text';
import { TokenIcon } from '@/components/ui/TokenIcon';
import { colors } from '@/constants/colors';
import { radii, spacing } from '@/constants/spacing';
import { fontFamily } from '@/constants/typography';

import { ConfirmationCardSurface } from './ConfirmationCardSurface';

import type {
  AgenticChatToolCard,
  AgenticRwaAssetCardPreview,
  AgenticToolCardTone,
} from '@/store/agenticChatStore';

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

  if (card.rwaAsset != null) {
    return <RwaAssetPreviewToolCard asset={card.rwaAsset} />;
  }

  return (
    <ConfirmationCardSurface>
      <View style={styles.header}>
        <View style={styles.titleStack}>
          <Text
            variant="bodyBold"
            color={colors.text.primary}
            style={styles.title}
            maxFontSizeMultiplier={1.15}
          >
            {card.title}
          </Text>
          {card.subtitle != null ? (
            <Text
              variant="small"
              color={colorForTone(card.tone)}
              numberOfLines={1}
              maxFontSizeMultiplier={1.15}
            >
              {card.subtitle}
            </Text>
          ) : null}
        </View>
      </View>

      {rows.length > 0 ? (
        <View style={styles.rows}>
          {rows.map((row) => (
            <View key={`${row.label}:${row.value}`} style={styles.row}>
              <Text
                variant="small"
                color={colors.text.tertiary}
                style={styles.rowLabel}
                maxFontSizeMultiplier={1.15}
              >
                {row.label}
              </Text>
              <Text
                variant="captionBold"
                color={colorForTone(row.tone)}
                style={[styles.rowValue, row.mono === true && styles.mono]}
                numberOfLines={1}
                ellipsizeMode="middle"
                adjustsFontSizeToFit
                minimumFontScale={0.78}
                maxFontSizeMultiplier={1.15}
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
                  maxFontSizeMultiplier={1.15}
                >
                  {item.title}
                </Text>
                {item.detail != null && item.detail.length > 0 ? (
                  <Text
                    variant="small"
                    color={colors.text.tertiary}
                    style={styles.itemDetail}
                    numberOfLines={1}
                    maxFontSizeMultiplier={1.15}
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
        <Text
          variant="small"
          color={colors.text.tertiary}
          style={styles.footer}
          maxFontSizeMultiplier={1.15}
        >
          {card.footer}
        </Text>
      ) : null}
    </ConfirmationCardSurface>
  );
}

function RwaAssetPreviewToolCard({
  asset,
}: {
  asset: AgenticRwaAssetCardPreview;
}): React.JSX.Element {
  const { width: windowWidth, fontScale } = useWindowDimensions();
  const compact = windowWidth < 390 || fontScale > 1.05;
  const detail = [
    asset.categoryLabel,
    asset.underlyingSymbol ?? asset.symbol,
    asset.tradable ? null : 'Trading unavailable',
  ]
    .filter((value): value is string => value != null && value.length > 0)
    .join(' · ');
  const changeLabel = formatRwaChangeLabel(asset.change24hPct);
  const changeColor =
    asset.change24hPct == null
      ? colors.text.secondary
      : asset.change24hPct >= 0
        ? colors.semantic.receive
        : colors.semantic.error;

  return (
    <ConfirmationCardSurface>
      <View style={[styles.rwaAssetIdentity, compact && styles.rwaAssetIdentityCompact]}>
        <View style={[styles.rwaAssetLogoFrame, compact && styles.rwaAssetLogoFrameCompact]}>
          <TokenIcon
            symbol={asset.underlyingSymbol ?? asset.symbol}
            name={asset.name}
            logoUri={asset.logoUri}
            size={compact ? 44 : 48}
            recyclingKey={asset.symbol}
          />
        </View>
        <View style={styles.rwaAssetNameBlock}>
          <Text
            variant="bodyBold"
            color={colors.text.primary}
            style={styles.rwaAssetName}
            numberOfLines={2}
            maxFontSizeMultiplier={1.15}
          >
            {asset.displayName}
          </Text>
          <Text
            variant="small"
            color={colors.text.tertiary}
            numberOfLines={1}
            maxFontSizeMultiplier={1.15}
          >
            {detail}
          </Text>
        </View>
      </View>

      <View style={styles.rwaAssetMarketRow}>
        <View style={styles.rwaAssetMetric}>
          <Text variant="small" color={colors.text.tertiary} maxFontSizeMultiplier={1.15}>
            Price
          </Text>
          <Text
            variant="money"
            color={colors.text.primary}
            style={styles.rwaAssetMetricValue}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.78}
            maxFontSizeMultiplier={1.15}
          >
            {asset.priceLabel}
          </Text>
        </View>
        {changeLabel != null ? (
          <View style={[styles.rwaAssetMetric, styles.rwaAssetMetricEnd]}>
            <Text variant="small" color={colors.text.tertiary} maxFontSizeMultiplier={1.15}>
              24h
            </Text>
            <Text
              variant="captionBold"
              color={changeColor}
              style={styles.rwaAssetMetricValue}
              numberOfLines={1}
              maxFontSizeMultiplier={1.15}
            >
              {changeLabel}
            </Text>
          </View>
        ) : null}
      </View>

      {asset.holding != null ? (
        <View style={styles.rwaAssetHoldingRow}>
          <Text variant="small" color={colors.text.tertiary} maxFontSizeMultiplier={1.15}>
            Holding
          </Text>
          <Text
            variant="captionBold"
            color={colors.text.primary}
            style={styles.rwaAssetHolding}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.72}
            maxFontSizeMultiplier={1.15}
          >
            {asset.holding} {asset.symbol}
          </Text>
        </View>
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
    fontSize: 17,
    lineHeight: 22,
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
    flex: 1,
    minWidth: 0,
  },
  rowValue: {
    maxWidth: '62%',
    flexShrink: 1,
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
  rwaAssetIdentity: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  rwaAssetIdentityCompact: {
    gap: spacing.sm,
  },
  rwaAssetLogoFrame: {
    width: 52,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  rwaAssetLogoFrameCompact: {
    width: 46,
    height: 44,
  },
  rwaAssetNameBlock: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  rwaAssetName: {
    fontFamily: fontFamily.uiSemiBold,
  },
  rwaAssetMarketRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.lg,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rimSubtle,
  },
  rwaAssetMetric: {
    flex: 1,
    minWidth: 0,
    gap: spacing.xs,
  },
  rwaAssetMetricEnd: {
    alignItems: 'flex-end',
  },
  rwaAssetMetricValue: {
    fontVariant: ['tabular-nums'],
  },
  rwaAssetHoldingRow: {
    minHeight: 28,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.lg,
  },
  rwaAssetHolding: {
    flex: 1,
    minWidth: 0,
    flexShrink: 1,
    textAlign: 'right',
    fontFamily: fontFamily.uiSemiBold,
    fontVariant: ['tabular-nums'],
  },
});
