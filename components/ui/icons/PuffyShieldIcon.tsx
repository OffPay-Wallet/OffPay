import React from 'react';
import Svg, { Path } from 'react-native-svg';

import { colors } from '@/constants/colors';

export interface PuffyShieldIconProps {
  size?: number;
  color?: string;
  focused?: boolean;
}

export function PuffyShieldIcon({
  size = 24,
  color = colors.text.primary,
  focused = true,
}: PuffyShieldIconProps) {
  // Bootstrap `bi-shield-fill` (16x16) path.
  // Uses `currentColor` so it automatically matches the native theme color passed in.
  const fillOpacity = focused ? 0.95 : 0.75;

  return (
    <Svg width={size} height={size} viewBox="0 0 16 16" color={color}>
      <Path
        d="M5.072.56C6.157.265 7.31 0 8 0s1.843.265 2.928.56c1.11.3 2.229.655 2.887.87a1.54 1.54 0 0 1 1.044 1.262c.596 4.477-.787 7.795-2.465 9.99a11.8 11.8 0 0 1-2.517 2.453 7 7 0 0 1-1.048.625c-.28.132-.581.24-.829.24s-.548-.108-.829-.24a7 7 0 0 1-1.048-.625 11.8 11.8 0 0 1-2.517-2.453C1.928 10.487.545 7.169 1.141 2.692A1.54 1.54 0 0 1 2.185 1.43 63 63 0 0 1 5.072.56"
        fill="currentColor"
        opacity={fillOpacity}
      />
    </Svg>
  );
}
