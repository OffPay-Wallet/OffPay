import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Ionicons } from '@expo/vector-icons';
import QRCode from 'react-native-qrcode-svg';

import { PillButton } from '@/components/ui/PillButton';
import { CopyableAddress } from '@/components/ui/CopyableAddress';
import { useAppToast } from '@/components/ui/AppToast';
import { Text } from '@/components/ui/Text';
import { colors } from '@/constants/colors';
import { layout, radii, spacing } from '@/constants/spacing';
import { fontFamily } from '@/constants/typography';
import { buildSolanaPayRequestQr } from '@/lib/offline/offline-payments';

const PRIVATE_RECEIVE_QR_LOGO =
  require('../../../assets/appIcons/android/playstore-icon.png') as number;

interface PrivatePaymentReceivePanelProps {
  walletAddress: string | null;
  mint: string | null;
}

export function PrivatePaymentReceivePanel({
  walletAddress,
  mint,
}: PrivatePaymentReceivePanelProps): React.JSX.Element {
  const { showToast } = useAppToast();
  const payload =
    walletAddress != null && mint != null && mint.length > 0
      ? buildSolanaPayRequestQr({
          recipient: walletAddress,
          amount: null,
          token: mint,
          memo: null,
        })
      : null;

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.iconWrap}>
          <Ionicons name="arrow-down" size={layout.iconSizeTab} color={colors.brand.azureCyan} />
        </View>
        <View style={styles.headerText}>
          <Text variant="h3" color={colors.text.primary} style={styles.title}>
            Receive payment
          </Text>
          <Text variant="small" color={colors.text.tertiary} style={styles.subtitle}>
            Let the sender scan your QR or copy your wallet address.
          </Text>
        </View>
      </View>

      <View style={styles.qrCard}>
        {payload != null ? (
          <QRCode
            value={payload}
            size={layout.avatarLg * 3}
            color={colors.brand.deepShadow}
            backgroundColor={colors.text.primary}
            ecl="H"
            quietZone={6}
            logo={PRIVATE_RECEIVE_QR_LOGO}
            logoSize={layout.avatarSm}
            logoBackgroundColor={colors.brand.whiteStream}
            logoBorderRadius={12}
            logoMargin={4}
          />
        ) : (
          <Text variant="bodyBold" color={colors.brand.deepShadow}>
            Stablecoin mint required
          </Text>
        )}
      </View>

      <View style={styles.copyBlock}>
        <Text variant="small" color={colors.text.tertiary}>
          Receiving wallet
        </Text>
        {walletAddress != null ? (
          <CopyableAddress address={walletAddress} color={colors.text.primary} />
        ) : (
          <Text variant="bodyBold" color={colors.text.secondary}>
            Unlock a wallet first
          </Text>
        )}
      </View>

      <View style={styles.actionRow}>
        <PillButton
          label="Copy payment link"
          variant="primary"
          disabled={payload == null}
          onPress={() => {
            if (payload == null) return;
            void Clipboard.setStringAsync(payload);
            showToast({
              title: 'Payment link copied',
              message: 'Ready to share.',
              variant: 'success',
            });
          }}
        />
        <Pressable
          style={styles.secondaryButton}
          disabled={walletAddress == null}
          onPress={() => {
            if (walletAddress == null) return;
            void Clipboard.setStringAsync(walletAddress);
            showToast({
              title: 'Address copied',
              message: 'Ready to share.',
              variant: 'success',
            });
          }}
        >
          <Text variant="buttonSmall" color={colors.text.primary}>
            Copy address
          </Text>
        </Pressable>
      </View>

      <View style={styles.copyBlock}>
        <Text variant="small" color={colors.text.tertiary}>
          Current private stablecoin mint
        </Text>
        {mint != null && mint.length > 0 ? (
          <CopyableAddress address={mint} color={colors.text.secondary} />
        ) : (
          <Text variant="body" color={colors.text.secondary}>
            The backend default mint loads with private balance.
          </Text>
        )}
      </View>

      <Text variant="small" color={colors.text.tertiary} style={styles.note}>
        OffPay handles the protected transfer path under the hood once the sender confirms the
        payment.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radii['2xl'],
    borderWidth: 1,
    borderColor: colors.border.default,
    padding: spacing.xl,
    gap: spacing.lg,
    backgroundColor: colors.surface.card,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  iconWrap: {
    minWidth: layout.avatarLg,
    minHeight: layout.avatarLg,
    borderRadius: radii.full,
    backgroundColor: colors.holdingsCard.pressed,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerText: {
    flex: 1,
    minWidth: 0,
    gap: spacing.xs,
  },
  title: {
    fontFamily: fontFamily.semiBold,
  },
  subtitle: {
    lineHeight: 18,
  },
  qrCard: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.xl,
    backgroundColor: colors.text.primary,
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.lg,
  },
  copyBlock: {
    gap: spacing.xs,
    minWidth: 0,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  secondaryButton: {
    minHeight: layout.buttonHeightMd,
    borderRadius: radii.full,
    borderWidth: 1,
    borderColor: colors.border.default,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  note: {
    fontFamily: fontFamily.regular,
    lineHeight: 18,
  },
});
