import React from 'react';
import Svg, { Path } from 'react-native-svg';

import { colors } from '@/constants/colors';

export interface PuffyIconProps {
  size?: number;
  color?: string;
  focused?: boolean;
}

export function PuffySwapIcon({
  size = 24,
  color = colors.text.primary,
  focused = false,
}: PuffyIconProps) {
  // Ultra-thick organic swap half-arrows, precisely math-crafted to match the provided layout.
  const strokeWidth = focused ? '3.2' : '2.5';

  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinejoin="round"
      strokeLinecap="round"
    >
      {/* Top half-arrow: hooks up from left, runs right, points UP-LEFT (outward) */}
      <Path d="M5 11 A 4 4 0 0 1 9 7 L20 7 L15 2" />
      {/* Bottom half-arrow: hooks down from right, runs left, points DOWN-RIGHT (outward) */}
      <Path d="M19 13 A 4 4 0 0 1 15 17 L4 17 L9 22" />
    </Svg>
  );
}
