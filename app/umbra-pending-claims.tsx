import React, { Suspense, lazy } from 'react';

import { RouteLoadingFallback } from '@/components/ui/RouteLoadingFallback';

const UmbraPendingClaimsScreen = lazy(() =>
  import('@/components/features/receive/UmbraPendingClaimsScreen').then((module) => ({
    default: module.UmbraPendingClaimsScreen,
  })),
);

export default function UmbraPendingClaimsRoute(): React.JSX.Element {
  return (
    <Suspense fallback={<RouteLoadingFallback />}>
      <UmbraPendingClaimsScreen />
    </Suspense>
  );
}
