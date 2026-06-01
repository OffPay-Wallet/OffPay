import React from 'react';
import Svg, { Path } from 'react-native-svg';

import { colors } from '@/constants/colors';

export interface PuffyWalletIconProps {
  size?: number;
  color?: string;
  focused?: boolean;
}

export function PuffyWalletIcon({
  size = 24,
  color = colors.text.primary,
  focused = true,
}: PuffyWalletIconProps): React.JSX.Element {
  const strokeOpacity = focused ? 0.9 : 0.66;

  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" color={color}>
      <Path
        d="M5.5 6.25h11.75a2.75 2.75 0 0 1 2.75 2.75v7.25A2.75 2.75 0 0 1 17.25 19H6.75A3.75 3.75 0 0 1 3 15.25v-6.5a2.5 2.5 0 0 1 2.5-2.5Z"
        fill="currentColor"
        opacity={focused ? 0.12 : 0.08}
      />
      <Path
        d="M5.5 6.25h11.75a2.75 2.75 0 0 1 2.75 2.75v7.25A2.75 2.75 0 0 1 17.25 19H6.75A3.75 3.75 0 0 1 3 15.25v-6.5a2.5 2.5 0 0 1 2.5-2.5Z"
        stroke="currentColor"
        strokeWidth={1.7}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={strokeOpacity}
      />
      <Path
        d="M17.25 10.25h2.75v4.5h-2.75A2.25 2.25 0 0 1 15 12.5v0a2.25 2.25 0 0 1 2.25-2.25Z"
        fill="currentColor"
        opacity={focused ? 0.18 : 0.1}
      />
      <Path
        d="M17.25 10.25h2.75v4.5h-2.75A2.25 2.25 0 0 1 15 12.5v0a2.25 2.25 0 0 1 2.25-2.25Z"
        stroke="currentColor"
        strokeWidth={1.7}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={strokeOpacity}
      />
      <Path
        d="M17.2 12.5h.08"
        stroke="currentColor"
        strokeWidth={2.2}
        strokeLinecap="round"
        opacity={strokeOpacity}
      />
    </Svg>
  );
}
