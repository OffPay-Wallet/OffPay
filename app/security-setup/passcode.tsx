import { useMemo } from 'react';
import { useLocalSearchParams } from 'expo-router';

import { PasscodeSetupScreen } from '@/components/features/security-setup/PasscodeSetupScreen';

import type { WalletFlowInviteSource } from '@/lib/invite/wallet-flow-invite';

type SecuritySetupIntent = 'create-wallet' | 'restore-wallet' | 'privy-wallet';

function parseIntent(raw: string | string[] | undefined): SecuritySetupIntent {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value === 'privy-wallet') return 'privy-wallet';
  return value === 'restore-wallet' ? 'restore-wallet' : 'create-wallet';
}

function parseSource(raw: string | string[] | undefined): WalletFlowInviteSource {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value === 'accounts' ? 'accounts' : 'onboarding';
}

export default function PasscodeSetupRoute(): React.JSX.Element {
  const params = useLocalSearchParams<{ intent?: string | string[]; source?: string | string[] }>();
  const intent = useMemo(() => parseIntent(params.intent), [params.intent]);
  const source = useMemo(() => parseSource(params.source), [params.source]);

  return <PasscodeSetupScreen intent={intent} source={source} />;
}
