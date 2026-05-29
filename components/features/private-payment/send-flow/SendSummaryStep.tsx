import { StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { GlassSliderButton } from '@/components/ui/glass-slider-button';
import { Text } from '@/components/ui/Text';
import { colors } from '@/constants/colors';
import { radii, spacing } from '@/constants/spacing';
import { fontFamily } from '@/constants/typography';
import { shortenWalletAddress } from '@/lib/api/offpay-wallet-data';

import { PrivateRouteSelector } from './PrivateRouteSelector';
import type {
  PrivatePaymentRoute,
  PrivatePaymentRouteOption,
  SendNetwork,
  SendTokenOption,
} from './types';

interface SendSummaryStepProps {
  token: SendTokenOption | null;
  amount: string;
  amountMetaLabel: string;
  recipientAddress: string;
  network: SendNetwork;
  modeLabel: string;
  networkFeeLabel: string;
  selfSend: boolean;
  canSubmit: boolean;
  sending: boolean;
  privateRouteOptions: PrivatePaymentRouteOption[];
  selectedPrivateRoute: PrivatePaymentRoute | null;
  onSelectPrivateRoute: (route: PrivatePaymentRoute) => void;
  onSubmit: () => void;
}

export function SendSummaryStep({
  token,
  amount,
  amountMetaLabel,
  recipientAddress,
  network,
  modeLabel,
  networkFeeLabel,
  selfSend,
  canSubmit,
  sending,
  privateRouteOptions,
  selectedPrivateRoute,
  onSelectPrivateRoute,
  onSubmit,
}: SendSummaryStepProps): React.JSX.Element {
  const symbol = token?.symbol ?? '';
  const { height } = useWindowDimensions();
  const compact = height < 820;
  const privateSelfSend =
    selfSend && modeLabel !== 'Normal transfer' && modeLabel !== 'Offline P2P';

  return (
    <Animated.View
      entering={FadeIn.duration(220)}
      style={[styles.step, compact && styles.stepCompact]}
    >
      <View style={[styles.amountBlock, compact && styles.amountBlockCompact]}>
        <Text
          variant="h1"
          color={colors.text.primary}
          align="center"
          style={[styles.amount, compact && styles.amountCompact]}
          numberOfLines={2}
          adjustsFontSizeToFit
          minimumFontScale={0.72}
        >
          {amount} {symbol}
        </Text>
        <Text
          variant="bodyBold"
          color={colors.text.secondary}
          align="center"
          style={[styles.metaLabel, compact && styles.metaLabelCompact]}
          numberOfLines={1}
          adjustsFontSizeToFit
        >
          {amountMetaLabel}
        </Text>
      </View>

      {selfSend ? (
        <View style={[styles.warningBox, compact && styles.warningBoxCompact]}>
          <Text
            variant="caption"
            color={colors.text.inverse}
            align="center"
            numberOfLines={3}
            maxFontSizeMultiplier={1}
            style={styles.warningText}
          >
            {privateSelfSend
              ? 'This is your current address. The private route will still create a private P2P payment for this wallet.'
              : 'This is your current address. Sending will incur transfer fees with no other balance changes.'}
          </Text>
        </View>
      ) : null}

      <View style={styles.summaryCard}>
        <SummaryRow label="To" value={shortenWalletAddress(recipientAddress)} compact={compact} />
        <SummaryRow
          label="Network"
          value={network === 'devnet' ? 'Solana Devnet' : 'Solana'}
          compact={compact}
        />
        <SummaryRow label="Mode" value={modeLabel} compact={compact} />
        <SummaryRow label="Network fee" value={networkFeeLabel} compact={compact} />
      </View>

      <PrivateRouteSelector
        routes={privateRouteOptions}
        selectedRoute={selectedPrivateRoute}
        onSelectRoute={onSelectPrivateRoute}
      />

      <GlassSliderButton
        label="Slide to Send"
        loadingLabel="Sending"
        disabled={!canSubmit}
        loading={sending}
        onComplete={onSubmit}
      />
    </Animated.View>
  );
}

function SummaryRow({
  label,
  value,
  compact,
}: {
  label: string;
  value: string;
  compact: boolean;
}): React.JSX.Element {
  return (
    <View style={[styles.summaryRow, compact && styles.summaryRowCompact]}>
      <Text variant="caption" color={colors.text.secondary} style={styles.summaryLabel}>
        {label}
      </Text>
      <Text
        variant="captionBold"
        color={colors.text.primary}
        numberOfLines={2}
        style={styles.summaryValue}
      >
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  step: {
    flexGrow: 1,
    justifyContent: 'flex-start',
    gap: spacing.md,
  },
  stepCompact: {
    gap: spacing.sm,
  },
  amountBlock: {
    alignItems: 'center',
    gap: 2,
    paddingTop: spacing.md,
    paddingBottom: spacing.xs,
  },
  amountBlockCompact: {
    paddingTop: spacing.xs,
    paddingBottom: 0,
  },
  amount: {
    fontFamily: fontFamily.semiBold,
    fontSize: 32,
    lineHeight: 38,
  },
  amountCompact: {
    fontSize: 28,
    lineHeight: 34,
  },
  metaLabel: {
    fontFamily: fontFamily.semiBold,
    fontSize: 16,
    lineHeight: 22,
  },
  metaLabelCompact: {
    fontSize: 14,
    lineHeight: 19,
  },
  warningBox: {
    minHeight: 72,
    borderRadius: radii.xl,
    backgroundColor: colors.semantic.warning,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  warningBoxCompact: {
    minHeight: 64,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  warningText: {
    fontSize: 14,
    lineHeight: 19,
    includeFontPadding: false,
  },
  summaryCard: {
    borderRadius: radii.xl,
    borderCurve: 'continuous',
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rim,
    backgroundColor: colors.glass.strongFill,
    overflow: 'hidden',
    boxShadow: `0 16px 30px rgba(14, 42, 53, 0.12), inset 0 1px 1px rgba(255, 255, 255, 0.78), inset 0 -12px 24px rgba(91, 200, 232, 0.12)`,
  },
  summaryRow: {
    minHeight: 42,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border.subtle,
    paddingHorizontal: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  summaryRowCompact: {
    minHeight: 38,
    paddingHorizontal: spacing.sm,
  },
  summaryLabel: {
    flexShrink: 0,
  },
  summaryValue: {
    flex: 1,
    minWidth: 0,
    textAlign: 'right',
    fontSize: 13,
    lineHeight: 17,
  },
});
