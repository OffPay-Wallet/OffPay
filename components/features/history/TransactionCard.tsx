import { TransactionActivityRow } from '@/components/features/history/TransactionActivityRow';

import type { OffpayHistoryTransactionView, TokenLogoLookup } from '@/lib/api/offpay-wallet-data';

export function TransactionCard({
  tx,
  tokenLogos,
  compact = false,
  onPress,
}: {
  tx: OffpayHistoryTransactionView;
  tokenLogos?: TokenLogoLookup;
  compact?: boolean;
  onPress?: (transaction: OffpayHistoryTransactionView) => void;
}): React.JSX.Element {
  return (
    <TransactionActivityRow
      tx={tx}
      compact={compact}
      tokenLogos={tokenLogos}
      variant="home"
      onPress={onPress == null ? undefined : () => onPress(tx)}
    />
  );
}
