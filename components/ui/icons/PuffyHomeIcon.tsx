import React from 'react';
import Svg, { Path } from 'react-native-svg';

export interface PuffyHomeIconProps {
  size?: number;
  color?: string;
  focused?: boolean;
}

export function PuffyHomeIcon({ size = 24, color = '#000', focused = true }: PuffyHomeIconProps) {
  // Ultra-rounded thick house, mimicking modern puffy squircle glassmorphic icon paradigms.
  const d =
    'M20 10.126v8.374a3.5 3.5 0 0 1-3.5 3.5H15a1 1 0 0 1-1-1v-4.5a2 2 0 1 0-4 0V21a1 1 0 0 1-1 1H7.5a3.5 3.5 0 0 1-3.5-3.5v-8.374a2.5 2.5 0 0 1 1.054-2.036l4.604-3.23c1.378-.968 3.306-.968 4.684 0l4.604 3.23A2.5 2.5 0 0 1 20 10.126z';

  if (focused) {
    return (
      <Svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
        <Path d={d} />
      </Svg>
    );
  }

  // Outline variant for inactive state
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="1.8"
      strokeLinejoin="round"
      strokeLinecap="round"
    >
      <Path d={d} />
    </Svg>
  );
}
