import { useLocalSearchParams } from 'expo-router';
import React from 'react';

import { PayrollReviewScreen } from '@/components/features/payroll/PayrollReviewScreen';

export default function PayrollReviewRoute(): React.JSX.Element {
  const { runId } = useLocalSearchParams<{ runId?: string }>();
  return <PayrollReviewScreen runId={typeof runId === 'string' ? runId : null} />;
}
