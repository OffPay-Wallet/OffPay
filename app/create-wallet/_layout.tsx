/**
 * Create wallet stack — word count selection to backup phrase.
 * Uses the app-wide native iOS-style stack transition.
 */
import { Stack } from 'expo-router';

import { createWalletScreenOptions } from '@/constants/navigation';

export default function CreateWalletLayout(): React.JSX.Element {
  return <Stack screenOptions={createWalletScreenOptions} />;
}
