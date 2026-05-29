import { Stack } from 'expo-router';
import { createWalletScreenOptions } from '@/constants/navigation';

export default function SecuritySetupLayout(): React.JSX.Element {
  return <Stack screenOptions={createWalletScreenOptions} />;
}
