import React from 'react';
import Svg, { Path } from 'react-native-svg';

export interface PuffyKeyIconProps {
  size?: number;
  color?: string;
  focused?: boolean;
}

export function PuffyKeyIcon({ size = 24, color = '#000', focused = true }: PuffyKeyIconProps) {
  // Bootstrap `bi-key-fill` (16x16) path.
  // Uses `currentColor` so it automatically matches the native theme color passed in.
  const fillOpacity = focused ? 0.95 : 0.75;

  return (
    <Svg width={size} height={size} viewBox="0 0 16 16" color={color}>
      <Path
        d="M3.5 11.5a3.5 3.5 0 1 1 3.163-5H14L15.5 8 14 9.5l-1-1-1 1-1-1-1 1-1-1-1 1H6.663a3.5 3.5 0 0 1-3.163 2M2.5 9a1 1 0 1 0 0-2 1 1 0 0 0 0 2"
        fill="currentColor"
        opacity={fillOpacity}
      />
    </Svg>
  );
}
