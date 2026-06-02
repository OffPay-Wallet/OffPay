import { Pressable, StyleSheet, View } from 'react-native';

import { PuffyReceiveArrowIcon } from '@/components/ui/icons/PuffyReceiveArrowIcon';
import { PuffySendIcon } from '@/components/ui/icons/PuffySendIcon';
import { PuffySwapIcon } from '@/components/ui/icons/PuffySwapIcon';
import { SlotText } from '@/components/ui/SlotText';
import { Text } from '@/components/ui/Text';
import { TokenIcon } from '@/components/ui/TokenIcon';
import { colors } from '@/constants/colors';
import { radii, spacing } from '@/constants/spacing';
import { fontFamily } from '@/constants/typography';

import type {
  OffpayDisplayTone,
  OffpayDisplayTransactionType,
  TokenLogoLookup,
} from '@/lib/api/offpay-wallet-data';

export interface ActivityTransactionRowData {
  id: string;
  type: OffpayDisplayTransactionType;
  title: string;
  subtitle: string;
  sourceLabel: string | null;
  amountLabel: string | null;
  secondaryAmountLabel: string | null;
  amountTone: OffpayDisplayTone;
  tokenMint: string | null;
  tokenSymbol: string | null;
  tokenName: string | null;
  tokenLogo: string | null;
  status: 'confirmed' | 'pending' | 'failed';
}

const AMOUNT_COLORS: Record<OffpayDisplayTone, string> = {
  positive: colors.semantic.success,
  negative: colors.semantic.error,
  neutral: colors.text.secondary,
  failed: colors.semantic.error,
};
// Recent-activity card material: glossy graphite glass with a neutral
// rim so each row separates from the dark app background without
// pulling in coloured tints.
const HOME_CONTAINER_SHADOW =
  '0 12px 26px rgba(0, 0, 0, 0.42), inset 0 1px 1px rgba(255, 255, 255, 0.14)';
const ACTION_BADGE_SHADOW =
  '0 6px 14px rgba(0, 0, 0, 0.36), inset 0 1px 1px rgba(255, 255, 255, 0.22)';

const TOKEN_SYMBOL_PATTERN = /(?:^|[\s+-])(?:\d[\d,.]*\s+)?([A-Za-z][A-Za-z0-9]{1,15})$/;

function extractSymbol(label: string | null): string | null {
  if (label == null) return null;
  const match = label.trim().match(TOKEN_SYMBOL_PATTERN);
  return match?.[1]?.toUpperCase() ?? null;
}

function TransactionActionIcon({
  type,
  size,
}: {
  type: OffpayDisplayTransactionType;
  size: number;
}): React.JSX.Element {
  const actionColor = colors.brand.glossAccent;

  if (type === 'receive') {
    return <PuffyReceiveArrowIcon size={size} color={actionColor} />;
  }

  if (type === 'swap') {
    return <PuffySwapIcon size={size} color={actionColor} focused />;
  }

  return <PuffySendIcon size={size} color={actionColor} />;
}

function TransactionAssetIcon({
  tx,
  size,
  tokenLogos,
}: {
  tx: ActivityTransactionRowData;
  size: number;
  tokenLogos: TokenLogoLookup;
}): React.JSX.Element {
  const primarySymbol = extractSymbol(tx.amountLabel) ?? tx.tokenSymbol;
  const secondarySymbol = extractSymbol(tx.secondaryAmountLabel);
  const hasSwapPair = tx.type === 'swap' && secondarySymbol != null;
  const actionBadgeSize = Math.max(20, Math.round(size * 0.5));
  const actionGlyphSize = Math.max(17, Math.round(actionBadgeSize * 0.72));
  const framePadding = Math.max(3, Math.round(size * 0.08));
  const frameWidth = size + Math.round(actionBadgeSize * 0.44) + framePadding * 2;
  const frameHeight = size + framePadding * 2;
  const pairedAssetSize = Math.round(size * 0.7);
  const primarySize = hasSwapPair ? pairedAssetSize : size;
  const secondarySize = pairedAssetSize;

  const primaryLogo =
    tx.tokenLogo ??
    (tx.tokenMint == null ? null : (tokenLogos.byMint?.get(tx.tokenMint) ?? null)) ??
    (primarySymbol == null ? null : (tokenLogos.bySymbol?.get(primarySymbol) ?? null));
  const secondaryLogo =
    secondarySymbol == null ? null : (tokenLogos.bySymbol?.get(secondarySymbol) ?? null);
  const canRenderPrimaryAsset =
    primarySymbol != null || primaryLogo != null || tx.tokenMint != null || tx.tokenName != null;
  const primaryDisplaySymbol = primarySymbol ?? tx.tokenSymbol ?? 'Token';
  const primaryDisplayName = tx.tokenName ?? primarySymbol ?? tx.tokenMint ?? primaryDisplaySymbol;

  return (
    <View
      style={[
        styles.assetIconFrame,
        {
          width: frameWidth,
          height: frameHeight,
          borderRadius: frameHeight / 2,
        },
      ]}
    >
      {hasSwapPair ? (
        <>
          <View
            style={[
              styles.swapSecondaryIcon,
              {
                left: framePadding,
                top: framePadding,
              },
            ]}
          >
            <TokenIcon
              symbol={secondarySymbol}
              name={secondarySymbol}
              logoUri={secondaryLogo}
              size={secondarySize}
            />
          </View>
          <View
            style={[
              styles.swapPrimaryIcon,
              {
                right: Math.round(actionBadgeSize * 0.28) + framePadding,
                bottom: framePadding,
              },
            ]}
          >
            <TokenIcon
              symbol={primarySymbol}
              name={primarySymbol}
              logoUri={primaryLogo}
              size={primarySize}
            />
          </View>
        </>
      ) : canRenderPrimaryAsset ? (
        <View
          style={[
            styles.singleAssetIcon,
            {
              left: framePadding,
              top: framePadding,
            },
          ]}
        >
          <TokenIcon
            symbol={primaryDisplaySymbol}
            name={primaryDisplayName}
            logoUri={primaryLogo}
            size={size}
          />
        </View>
      ) : (
        <View
          style={[
            styles.unknownAssetIcon,
            {
              width: size,
              height: size,
              left: framePadding,
              top: framePadding,
            },
          ]}
        >
          <TransactionActionIcon type={tx.type} size={Math.round(size * 0.78)} />
        </View>
      )}
      <View
        style={[
          styles.actionBadge,
          {
            width: actionBadgeSize,
            height: actionBadgeSize,
            borderRadius: actionBadgeSize / 2,
            right: framePadding - 1,
            bottom: framePadding - 1,
          },
        ]}
      >
        <TransactionActionIcon type={tx.type} size={actionGlyphSize} />
      </View>
    </View>
  );
}

interface TransactionActivityRowProps {
  tx: ActivityTransactionRowData;
  compact?: boolean;
  privacyHidden?: boolean;
  onPress?: (id: string) => void;
  variant?: 'home' | 'screen';
  tokenLogos?: TokenLogoLookup;
  metaLabel?: string | null;
}

export function TransactionActivityRow({
  tx,
  compact = false,
  privacyHidden = false,
  onPress,
  variant = 'screen',
  tokenLogos = {},
  metaLabel,
}: TransactionActivityRowProps): React.JSX.Element {
  const amountLabel = privacyHidden ? '****' : tx.amountLabel;
  const secondaryAmountLabel = privacyHidden ? '****' : tx.secondaryAmountLabel;
  const visibleMetaLabel = privacyHidden ? '****' : metaLabel;
  const iconSize = variant === 'home' ? (compact ? 36 : 40) : compact ? 42 : 46;
  const amountColWidth = variant === 'home' ? (compact ? 82 : 96) : compact ? 104 : 118;
  const amountA11y =
    tx.amountLabel == null ? '' : ` ${privacyHidden ? 'amount hidden' : tx.amountLabel}`;

  return (
    <Pressable
      style={({ pressed }) => [
        styles.shell,
        variant === 'home' && styles.shellHome,
        pressed && onPress != null && styles.pressed,
      ]}
      disabled={onPress == null}
      onPress={() => onPress?.(tx.id)}
      accessibilityRole={onPress == null ? undefined : 'button'}
      accessibilityLabel={`${tx.title}${amountA11y}. ${tx.subtitle}`}
    >
      <View
        style={[
          styles.card,
          variant === 'home' && styles.cardHome,
          compact && styles.cardCompact,
          variant === 'home' && compact && styles.cardHomeCompact,
        ]}
      >
        <TransactionAssetIcon tx={tx} size={iconSize} tokenLogos={tokenLogos} />

        <View style={styles.info}>
          <View style={styles.titleRow}>
            <Text
              variant="bodyBold"
              color={colors.text.primary}
              style={[
                styles.title,
                variant === 'home' && styles.titleHome,
                compact && styles.titleCompact,
              ]}
              numberOfLines={1}
              ellipsizeMode="tail"
              maxFontSizeMultiplier={1}
            >
              {tx.title}
            </Text>
            {tx.status !== 'confirmed' ? (
              <View
                style={[
                  styles.statusDot,
                  {
                    backgroundColor:
                      tx.status === 'failed' ? colors.semantic.error : colors.semantic.warning,
                  },
                ]}
              />
            ) : null}
            {tx.sourceLabel != null ? (
              <View style={styles.sourceBadge}>
                <Text
                  variant="small"
                  color={colors.text.secondary}
                  style={styles.sourceBadgeText}
                  numberOfLines={1}
                  maxFontSizeMultiplier={1}
                >
                  {tx.sourceLabel}
                </Text>
              </View>
            ) : null}
          </View>
          <Text
            variant="small"
            color={colors.text.secondary}
            style={[styles.subtitle, compact && styles.subtitleCompact]}
            numberOfLines={1}
            ellipsizeMode="tail"
            maxFontSizeMultiplier={1}
          >
            {tx.type === 'swap' ? 'Jupiter' : tx.subtitle}
          </Text>
          {visibleMetaLabel != null && visibleMetaLabel.length > 0 ? (
            <Text
              variant="small"
              color={colors.text.tertiary}
              style={[styles.meta, compact && styles.metaCompact]}
              numberOfLines={1}
              ellipsizeMode="tail"
              maxFontSizeMultiplier={1}
            >
              {visibleMetaLabel}
            </Text>
          ) : null}
        </View>

        {tx.amountLabel != null ? (
          <View style={[styles.amountCol, { width: amountColWidth }]}>
            <SlotText
              value={amountLabel ?? ''}
              variant="bodyBold"
              color={AMOUNT_COLORS[tx.amountTone]}
              style={[styles.amount, compact && styles.amountCompact]}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.78}
              maxFontSizeMultiplier={1}
            />
            {secondaryAmountLabel != null ? (
              <SlotText
                value={secondaryAmountLabel ?? ''}
                variant="small"
                color={colors.text.secondary}
                style={[styles.secondaryAmount, compact && styles.secondaryAmountCompact]}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.82}
                maxFontSizeMultiplier={1}
              />
            ) : null}
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  shell: {
    width: '100%',
    borderRadius: radii['2xl'],
    overflow: 'hidden',
    borderCurve: 'continuous',
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 255, 255, 0.16)',
    backgroundColor: colors.surface.cardElevated,
    boxShadow: HOME_CONTAINER_SHADOW,
  },
  shellHome: {
    borderRadius: radii['2xl'],
  },
  pressed: {
    opacity: 0.78,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 78,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    minWidth: 0,
    backgroundColor: 'transparent',
  },
  cardHome: {
    minHeight: 70,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  cardCompact: {
    minHeight: 74,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    gap: spacing.sm,
  },
  cardHomeCompact: {
    minHeight: 66,
    paddingVertical: spacing.sm,
  },
  info: {
    flex: 1,
    minWidth: 0,
    gap: 3,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    minWidth: 0,
  },
  title: {
    fontFamily: fontFamily.uiSemiBold,
    flexShrink: 1,
    minWidth: 0,
    fontSize: 18,
    lineHeight: 23,
  },
  titleHome: {
    fontSize: 15,
    lineHeight: 19,
  },
  titleCompact: {
    fontSize: 14,
    lineHeight: 18,
  },
  subtitle: {
    minWidth: 0,
    fontSize: 14,
    lineHeight: 18,
  },
  subtitleCompact: {
    fontSize: 12,
    lineHeight: 16,
  },
  meta: {
    minWidth: 0,
    fontSize: 11,
    lineHeight: 14,
    fontVariant: ['tabular-nums'],
  },
  metaCompact: {
    fontSize: 10,
    lineHeight: 13,
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    flexShrink: 0,
  },
  sourceBadge: {
    flexShrink: 0,
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
    borderRadius: radii.full,
    borderCurve: 'continuous',
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 255, 255, 0.14)',
  },
  sourceBadgeText: {
    fontSize: 9,
    lineHeight: 11,
    fontFamily: fontFamily.uiSemiBold,
  },
  assetIconFrame: {
    flexShrink: 0,
    overflow: 'visible',
    backgroundColor: 'transparent',
  },
  singleAssetIcon: {
    position: 'absolute',
  },
  swapSecondaryIcon: {
    position: 'absolute',
  },
  swapPrimaryIcon: {
    position: 'absolute',
  },
  unknownAssetIcon: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionBadge: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rim,
    backgroundColor: colors.surface.backgroundTint,
    boxShadow: ACTION_BADGE_SHADOW,
  },
  amountCol: {
    alignItems: 'flex-end',
    gap: 1,
    flexShrink: 0,
    minWidth: 0,
  },
  amount: {
    fontFamily: fontFamily.moneyBold,
    fontVariant: ['tabular-nums'],
    textAlign: 'right',
    fontSize: 14,
    lineHeight: 18,
  },
  amountCompact: {
    fontSize: 12,
    lineHeight: 16,
  },
  secondaryAmount: {
    fontFamily: fontFamily.moneyLight,
    fontVariant: ['tabular-nums'],
    textAlign: 'right',
    fontSize: 11,
    lineHeight: 14,
  },
  secondaryAmountCompact: {
    fontSize: 10,
    lineHeight: 13,
  },
});
