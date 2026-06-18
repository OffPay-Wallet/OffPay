import { useLocalSearchParams } from 'expo-router';
import React, { Suspense, lazy } from 'react';

import { RouteLoadingFallback } from '@/components/ui/RouteLoadingFallback';

const PayrollReviewScreen = lazy(() =>
  import('@/components/features/payroll/PayrollReviewScreen').then((module) => ({
    default: module.PayrollReviewScreen,
  })),
);

export default function PayrollReviewRoute(): React.JSX.Element {
  const { runId } = useLocalSearchParams<{ runId?: string }>();
  return (
    <Suspense fallback={<RouteLoadingFallback />}>
      <PayrollReviewScreen runId={typeof runId === 'string' ? runId : null} />
    </Suspense>
  );
}
