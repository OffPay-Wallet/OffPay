import MaskedView from '@react-native-masked-view/masked-view';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { memo, type ComponentProps } from 'react';
import { StyleSheet } from 'react-native';
import Animated from 'react-native-reanimated';

const IS_ANDROID = process.env.EXPO_OS === 'android';

// Real backdrop frost sitting behind the floating tab capsule + FAB.
// The blur itself is feathered at the top via a gradient mask so the
// band reads as a soft fade into the scene rather than a hard-edged box,
// and a dark tint gradient underneath fully occludes any content that
// scrolls beneath the bottom chrome.
// iOS renders a real native backdrop blur; Android falls back to the tint
// gradient below (see TINT_COLORS) since the new BlurView API needs a
// `blurTarget` we can't supply from this floating overlay.
const BLUR_INTENSITY = 64;

// Mask alpha ramp: transparent (no blur) at the very top edge, ramping to
// fully opaque (full blur) before the capsule so the top edge dissolves.
const MASK_COLORS = [
  'rgba(0, 0, 0, 0)',
  'rgba(0, 0, 0, 0.35)',
  'rgba(0, 0, 0, 0.85)',
  'rgba(0, 0, 0, 1)',
  'rgba(0, 0, 0, 1)',
] as const;
const MASK_LOCATIONS = [0, 0.18, 0.4, 0.6, 1] as const;

// Dark occlusion tint — grows toward the bottom so nothing behind the bar
// bleeds through, while staying clear at the feathered top edge. Android has
// no native backdrop blur under the new expo-blur API (that requires a
// `blurTarget` this floating overlay can't provide), so we lean on a slightly
// stronger tint there to keep content behind the bar fully occluded.
const TINT_COLORS = IS_ANDROID
  ? ([
      'rgba(5, 5, 5, 0)',
      'rgba(5, 5, 5, 0.52)',
      'rgba(5, 5, 5, 0.85)',
      'rgba(5, 5, 5, 0.97)',
    ] as const)
  : ([
      'rgba(5, 5, 5, 0)',
      'rgba(5, 5, 5, 0.4)',
      'rgba(5, 5, 5, 0.72)',
      'rgba(5, 5, 5, 0.86)',
    ] as const);
const TINT_LOCATIONS = [0, 0.32, 0.68, 1] as const;

interface TabBarBackdropProps {
  height: number;
  animatedStyle?: ComponentProps<typeof Animated.View>['style'];
}

export const TabBarBackdrop = memo(function TabBarBackdrop({
  height,
  animatedStyle,
}: TabBarBackdropProps): React.JSX.Element {
  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.root, { height }, animatedStyle]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <MaskedView
        style={StyleSheet.absoluteFill}
        maskElement={
          <LinearGradient
            style={StyleSheet.absoluteFill}
            colors={MASK_COLORS}
            locations={MASK_LOCATIONS}
            start={{ x: 0.5, y: 0 }}
            end={{ x: 0.5, y: 1 }}
          />
        }
      >
        <BlurView
          intensity={IS_ANDROID ? 0 : BLUR_INTENSITY}
          tint="dark"
          style={StyleSheet.absoluteFill}
        />
      </MaskedView>

      <LinearGradient
        pointerEvents="none"
        style={StyleSheet.absoluteFill}
        colors={TINT_COLORS}
        locations={TINT_LOCATIONS}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
      />
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  root: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
  },
});
