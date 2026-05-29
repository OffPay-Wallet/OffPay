import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';

import { PreferencesModal } from '@/components/features/settings/PreferencesModal';

export default function PreferencesScreen(): React.JSX.Element {
  const router = useRouter();
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    setVisible(true);
  }, []);

  return (
    <View style={{ flex: 1 }}>
      <PreferencesModal
        visible={visible}
        onClose={() => {
          setVisible(false);
          router.back();
        }}
      />
    </View>
  );
}
