import React from 'react';
import Svg, { Circle, Path } from 'react-native-svg';

import { colors } from '@/constants/colors';

export interface PuffyShoppingIconProps {
  size?: number;
  color?: string;
  focused?: boolean;
}

/**
 * Shopping-cart icon. Tuned to match the puffy weight of the other tab
 * icons — chunky strokes with rounded caps for the cart body, solid
 * filled wheels. The focused/filled variant pumps the stroke width up
 * so the silhouette reads like a solid shape from a distance, the
 * outline variant uses a slightly lighter stroke.
 */
export function PuffyShoppingIcon({
  size = 24,
  color = colors.text.primary,
  focused = true,
}: PuffyShoppingIconProps): React.JSX.Element {
  const cartBodyPath =
    'M2 3.55997C2 3.55997 6.64 3.49997 6 7.55997L5.31006 11.62C5.20774 12.1068 5.21778 12.6105 5.33954 13.0929C5.46129 13.5752 5.69152 14.0234 6.01263 14.4034C6.33375 14.7833 6.73733 15.0849 7.19263 15.2854C7.64793 15.4858 8.14294 15.5797 8.64001 15.56H16.64C17.7479 15.5271 18.8119 15.1196 19.6583 14.404C20.5046 13.6884 21.0834 12.7069 21.3 11.62L21.9901 7.50998C22.0993 7.0177 22.0939 6.50689 21.9744 6.017C21.8548 5.52712 21.6242 5.07126 21.3005 4.68467C20.9767 4.29807 20.5684 3.99107 20.1071 3.78739C19.6458 3.58371 19.1438 3.48881 18.64 3.50998H9.94';

  const strokeWidth = focused ? 3 : 2.2;
  const wheelRadius = focused ? 2.5 : 2.2;

  return (
    <Svg width={size} height={size} viewBox="-2.5 -2.5 30 30" fill="none">
      <Path
        d={cartBodyPath}
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <Circle cx={18.6} cy={19.57} r={wheelRadius} fill={color} />
      <Circle cx={8.6} cy={19.57} r={wheelRadius} fill={color} />
    </Svg>
  );
}
