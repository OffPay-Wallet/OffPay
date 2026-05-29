import React from 'react';
import Svg, { Path } from 'react-native-svg';

export interface PuffyTwitterXIconProps {
  size?: number;
  color?: string;
  focused?: boolean;
}

export function PuffyTwitterXIcon({
  size = 24,
  color = '#000',
  focused = true,
}: PuffyTwitterXIconProps): React.JSX.Element {
  // Bootstrap `bi-twitter-x` (16x16) path.
  // Uses `currentColor` so it automatically matches the native theme color passed in.
  const fillOpacity = focused ? 0.95 : 0.75;

  return (
    <Svg width={size} height={size} viewBox="0 0 16 16" color={color}>
      <Path
        d="M12.6.75h2.454l-5.36 6.142L16 15.25h-4.937l-3.867-5.07-4.425 5.07H.316l5.733-6.57L0 .75h5.063l3.495 4.633L12.601.75Zm-.86 13.028h1.36L4.323 2.145H2.865z"
        fill="currentColor"
        opacity={fillOpacity}
      />
    </Svg>
  );
}
