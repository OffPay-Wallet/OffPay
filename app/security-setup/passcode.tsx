import { useMemo } from 'react';
import { useLocalSearchParams } from 'expo-router';

import { PasscodeSetupScreen } from '@/components/features/security-setup/PasscodeSetupScreen';

type SecuritySetupIntent = 'create-wallet' | 'restore-wallet' | 'privy-wallet';

function parseIntent(raw: string | string[] | undefined): SecuritySetupIntent {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value === 'privy-wallet') return 'privy-wallet';
  return value === 'restore-wallet' ? 'restore-wallet' : 'create-wallet';
}

export default function PasscodeSetupRoute(): React.JSX.Element {
  const params = useLocalSearchParams<{ intent?: string | string[] }>();
  const intent = useMemo(() => parseIntent(params.intent), [params.intent]);

  return <PasscodeSetupScreen intent={intent} />;
}
