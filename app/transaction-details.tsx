import React from 'react';

import { TransactionDetailsScreen } from '@/components/features/history/TransactionDetailsScreen';
import { GlobalGradientShell } from '@/components/ui/GlobalGradientShell';

export default function TransactionDetailsRoute(): React.JSX.Element {
  return (
    <GlobalGradientShell>
      <TransactionDetailsScreen />
    </GlobalGradientShell>
  );
}
