/**
 * Avatar icon — flat 2D silhouette.
 *
 * Single solid path, no gradients, no offset shadow stack, no rim
 * stroke. The component API stays the same so existing call sites
 * (`solidFill`, `focused`, `color`) continue to work; the visual
 * recipe is now one filled silhouette in the current theme tone (or any
 * caller-supplied colour).
 */
import React from 'react';
import Svg, { Path } from 'react-native-svg';

import { colors } from '@/constants/colors';

import type { StyleProp, ViewStyle } from 'react-native';

const AVATAR_PATH =
  'M232.043,157.557L216.22,2l-32.915,51.122c0,0-28.733-21.024-66.301-21.024c-37.577,0-60.744,17.332-60.744,17.332L9.57,2 L1.957,157.557h4.675C11.901,213.818,59.385,258,117,258s105.099-44.182,110.368-100.443H232.043z M47.147,109.233 c2.105-7.719,11.19-11.065,17.794-6.556l35.635,24.35H42.293L47.147,109.233z M169.194,102.677 c6.604-4.508,15.698-1.163,17.803,6.556l4.845,17.794h-58.283L169.194,102.677z';

interface PuffyAvatarIconProps {
  size?: number;
  /** Fill colour. Defaults to the current theme text tone. */
  color?: string;
  /**
   * Reserved for parity with the previous API. When `false`, the
   * silhouette is rendered at slightly reduced opacity so the
   * symbol can recede into a row.
   */
  focused?: boolean;
  /**
   * Kept for API parity with previous call sites. The flat icon
   * uses a single solid fill regardless, so this flag is now a
   * no-op visually.
   */
  solidFill?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function PuffyAvatarIcon({
  size = 48,
  color = colors.text.primary,
  focused = true,
  // `solidFill` is kept for compatibility — see prop comment above.
  solidFill: _solidFill = false,
  style,
}: PuffyAvatarIconProps): React.JSX.Element {
  const fillOpacity = focused ? 1 : 0.72;
  return (
    <Svg width={size} height={size} viewBox="-16 -16 266 292" style={style}>
      <Path d={AVATAR_PATH} fill={color} fillOpacity={fillOpacity} />
    </Svg>
  );
}
