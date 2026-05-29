import React from 'react';
import Svg, { Path } from 'react-native-svg';

export interface PuffyIconProps {
  size?: number;
  color?: string;
  focused?: boolean;
}

export function PuffySettingsIcon({ size = 24, color = '#000', focused = false }: PuffyIconProps) {
  // Ultra-thick chunky solid gear matching the pristine fully-filled organic series.
  const opacity = focused ? 1 : 0.4; // Fade into glassmorphism on inactive state

  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" opacity={opacity}>
      <Path
        fillRule="evenodd"
        clipRule="evenodd"
        fill={color}
        stroke={color}
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
        // Outer gear structure wrapping cleanly around an inner negative space hole cut out via evenodd.
        d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z M12 16.5a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9z"
      />
    </Svg>
  );
}
