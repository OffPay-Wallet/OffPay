/**
 * Tab layout — bottom navigation with the custom notched tab bar.
 */
import { Tabs } from 'expo-router';
import { useMemo } from 'react';
import { Easing, StyleSheet, useWindowDimensions } from 'react-native';

import { TabBar } from '@/components/navigation/TabBar';

import type { BottomTabNavigationOptions } from '@react-navigation/bottom-tabs';

const TAB_SLIDE_DURATION_MS = 260;

export default function TabLayout(): React.JSX.Element {
  const { width } = useWindowDimensions();
  const slideDistance = Math.max(width, 1);
  const screenOptions = useMemo<BottomTabNavigationOptions>(
    () => ({
      headerShown: false,
      sceneStyle: styles.scene,
      lazy: true,
      tabBarStyle: styles.tabBarContainer,
      transitionSpec: {
        animation: 'timing' as const,
        config: {
          duration: TAB_SLIDE_DURATION_MS,
          easing: Easing.out(Easing.cubic),
        },
      },
      sceneStyleInterpolator: ({ current }) => ({
        sceneStyle: {
          transform: [
            {
              translateX: current.progress.interpolate({
                inputRange: [-1, 0, 1],
                outputRange: [-slideDistance, 0, slideDistance],
              }),
            },
          ],
        },
      }),
    }),
    [slideDistance],
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
