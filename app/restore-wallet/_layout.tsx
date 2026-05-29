/**
 * Restore wallet stack — import method selection → paste input (UI-only).
 * Uses the app-wide native iOS-style stack transition.
 */
import { Stack } from 'expo-router';

import { createWalletScreenOptions } from '@/constants/navigation';

export default function RestoreWalletLayout(): React.JSX.Element {
  return <Stack screenOptions={createWalletScreenOptions} />;
}
