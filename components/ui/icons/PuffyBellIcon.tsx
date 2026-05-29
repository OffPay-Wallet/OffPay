import React from 'react';
import Svg, { Path } from 'react-native-svg';

export interface PuffyBellIconProps {
  size?: number;
  color?: string;
  focused?: boolean;
}

export function PuffyBellIcon({
  size = 24,
  color = '#000',
  focused = true,
}: PuffyBellIconProps): React.JSX.Element {
  // Bootstrap `bi-bell-fill` (16x16) path.
  // Uses `currentColor` so it automatically matches the native theme color passed in.
  const fillOpacity = focused ? 0.95 : 0.75;

  return (
    <Svg width={size} height={size} viewBox="0 0 16 16" color={color}>
      <Path
        d="M8 16a2 2 0 0 0 2-2H6a2 2 0 0 0 2 2m.995-14.901a1 1 0 1 0-1.99 0A5 5 0 0 0 3 6c0 1.098-.5 6-2 7h14c-1.5-1-2-5.902-2-7 0-2.42-1.72-4.44-4.005-4.901"
        fill="currentColor"
        opacity={fillOpacity}
      />
    </Svg>
  );
}
