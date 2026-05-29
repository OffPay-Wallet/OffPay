import React from 'react';
import Svg, { Path } from 'react-native-svg';

export interface PuffyExternalLinkIconProps {
  size?: number;
  color?: string;
  focused?: boolean;
}

export function PuffyExternalLinkIcon({
  size = 24,
  color = '#000',
  focused = true,
}: PuffyExternalLinkIconProps): React.JSX.Element {
  const strokeOpacity = focused ? 0.84 : 0.58;

  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" color={color}>
      <Path
        d="M8 6.75h9.25V16"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={strokeOpacity}
      />
      <Path
        d="m7.25 16.75 9.5-9.5"
        stroke="currentColor"
        strokeWidth={2.4}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={strokeOpacity}
      />
    </Svg>
  );
}
