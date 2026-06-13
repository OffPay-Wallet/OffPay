/**
 * Tab layout — bottom navigation with the custom notched tab bar.
 */
import { Tabs } from 'expo-router';
import { useMemo } from 'react';
import { StyleSheet } from 'react-native';

import { TabBar } from '@/components/navigation/TabBar';

import type { BottomTabNavigationOptions } from 'expo-router/js-tabs';

export default function TabLayout(): React.JSX.Element {
  const screenOptions = useMemo<BottomTabNavigationOptions>(
    () => ({
      headerShown: false,
      sceneStyle: styles.scene,
      lazy: true,
      freezeOnBlur: true,
      tabBarStyle: styles.tabBarContainer,
      animation: 'none',
    }),
    [],
  );

  return (
    <Tabs tabBar={(props) => <TabBar {...props} />} screenOptions={screenOptions}>
      <Tabs.Screen name="index" />
      <Tabs.Screen name="swap" />
      <Tabs.Screen name="scanner" />
      <Tabs.Screen name="history" />
      <Tabs.Screen name="chat" />
      <Tabs.Screen name="shopping" />
      <Tabs.Screen name="rwas" />
      <Tabs.Screen name="settings" />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  scene: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  tabBarContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 0,
    overflow: 'visible',
    backgroundColor: 'transparent',
    borderTopWidth: 0,
    elevation: 0,
  },
});
