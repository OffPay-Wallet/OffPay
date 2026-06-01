import React from 'react';
import Svg, { Path } from 'react-native-svg';

import { colors } from '@/constants/colors';

export interface PuffyLockIconProps {
  size?: number;
  color?: string;
  focused?: boolean;
}

export function PuffyLockIcon({
  size = 24,
  color = colors.text.primary,
  focused = true,
}: PuffyLockIconProps): React.JSX.Element {
  // Bootstrap `bi-lock-fill` (16x16) path.
  // Uses `currentColor` so it automatically matches the native theme color passed in.
  const fillOpacity = focused ? 0.95 : 0.75;

  return (
    <Svg width={size} height={size} viewBox="0 0 16 16" color={color}>
      <Path
        d="M8 0a4 4 0 0 1 4 4v2.05a2.5 2.5 0 0 1 2 2.45v5a2.5 2.5 0 0 1-2.5 2.5h-7A2.5 2.5 0 0 1 2 13.5v-5a2.5 2.5 0 0 1 2-2.45V4a4 4 0 0 1 4-4m0 1a3 3 0 0 0-3 3v2h6V4a3 3 0 0 0-3-3"
        fill="currentColor"
        opacity={fillOpacity}
      />
    </Svg>
  );
}
