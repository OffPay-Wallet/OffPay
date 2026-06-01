import React from 'react';
import Svg, { Path } from 'react-native-svg';

import { colors } from '@/constants/colors';

export interface PuffyChevronRightIconProps {
  size?: number;
  color?: string;
  focused?: boolean;
}

export function PuffyChevronRightIcon({
  size = 24,
  color = colors.text.primary,
  focused = true,
}: PuffyChevronRightIconProps): React.JSX.Element {
  const strokeOpacity = focused ? 0.84 : 0.58;

  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" color={color}>
      <Path
        d="M9.25 5.5 15.75 12l-6.5 6.5"
        stroke="currentColor"
        strokeWidth={2.4}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={strokeOpacity}
      />
    </Svg>
  );
}
