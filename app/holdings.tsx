import React, { Suspense } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { HoldingsScreenContent } from '@/components/features/holdings/HoldingsScreenContent';
import { GlobalGradientShell } from '@/components/ui/GlobalGradientShell';

export default function HoldingsScreen(): React.JSX.Element {
  const insets = useSafeAreaInsets();

  return (
    <GlobalGradientShell>
      <Suspense fallback={null}>
        <HoldingsScreenContent paddingTop={insets.top} />
      </Suspense>
    </GlobalGradientShell>
  );
}
