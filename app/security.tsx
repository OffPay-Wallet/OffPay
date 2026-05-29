import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';

import { SecuritySettingsModal } from '@/components/features/settings/SecuritySettingsModal';

export default function SecurityScreen(): React.JSX.Element {
  const router = useRouter();
  const { action } = useLocalSearchParams<{ action?: string }>();
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    setVisible(true);
  }, []);

  return (
    <View style={{ flex: 1 }}>
      <SecuritySettingsModal
        visible={visible}
        initialAction={action === 'exportKeys' ? 'exportKeys' : undefined}
        onClose={() => {
          setVisible(false);
          router.back();
        }}
      />
    </View>
  );
}
