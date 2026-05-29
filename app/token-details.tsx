import React from 'react';

import { TokenDetailsScreen } from '@/components/features/token-details/TokenDetailsScreen';
import { GlobalGradientShell } from '@/components/ui/GlobalGradientShell';

export default function TokenDetailsRoute(): React.JSX.Element {
  return (
    <GlobalGradientShell>
      <TokenDetailsScreen />
    </GlobalGradientShell>
  );
}
