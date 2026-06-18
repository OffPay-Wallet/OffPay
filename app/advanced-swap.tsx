import React, { Suspense, lazy } from 'react';

import { RouteLoadingFallback } from '@/components/ui/RouteLoadingFallback';

const AdvancedSwapScreen = lazy(() =>
  import('@/components/features/swap').then((module) => ({
    default: module.AdvancedSwapScreen,
  })),
);

export default function AdvancedSwapRoute(): React.JSX.Element {
  return (
    <Suspense fallback={<RouteLoadingFallback />}>
      <AdvancedSwapScreen />
    </Suspense>
  );
}
