import React, { Suspense, lazy } from 'react';

import { RouteLoadingFallback } from '@/components/ui/RouteLoadingFallback';

const UmbraVaultScreen = lazy(() =>
  import('@/components/features/umbra-vault/umbra-vault-screen').then((module) => ({
    default: module.UmbraVaultScreen,
  })),
);

export default function UmbraPrivacyScreen(): React.JSX.Element {
  return (
    <Suspense fallback={<RouteLoadingFallback />}>
      <UmbraVaultScreen />
    </Suspense>
  );
}
