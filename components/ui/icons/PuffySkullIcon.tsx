import React from 'react';
import Svg, { Path } from 'react-native-svg';

import { colors } from '@/constants/colors';

export interface PuffySkullIconProps {
  size?: number;
  color?: string;
  focused?: boolean;
}

/**
 * Bootstrap `bi-exclamation-octagon-fill` (16x16). Used for destructive
 * danger affordances — wallet self-destruct, irreversible reset.
 */
export function PuffySkullIcon({
  size = 24,
  color = colors.text.primary,
  focused = true,
}: PuffySkullIconProps): React.JSX.Element {
  const fillOpacity = focused ? 0.95 : 0.75;

  return (
    <Svg width={size} height={size} viewBox="0 0 16 16" color={color}>
      <Path
        d="M4.54.146A.5.5 0 0 1 4.893 0h6.214a.5.5 0 0 1 .353.146l4.394 4.394a.5.5 0 0 1 .146.353v6.214a.5.5 0 0 1-.146.353l-4.394 4.394a.5.5 0 0 1-.353.146H4.893a.5.5 0 0 1-.353-.146L.146 11.46A.5.5 0 0 1 0 11.107V4.893a.5.5 0 0 1 .146-.353zM8 4a.905.905 0 0 0-.9.995l.35 3.507a.552.552 0 0 0 1.1 0l.35-3.507A.905.905 0 0 0 8 4m.002 6a1 1 0 1 0 0 2 1 1 0 0 0 0-2"
        fill="currentColor"
        opacity={fillOpacity}
      />
    </Svg>
  );
}
