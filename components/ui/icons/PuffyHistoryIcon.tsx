import React from 'react';
import Svg, { Path, Rect, Circle, Mask, Defs } from 'react-native-svg';

export interface PuffyIconProps {
  size?: number;
  color?: string;
  focused?: boolean;
}

export function PuffyHistoryIcon({ size = 24, color = '#000', focused = false }: PuffyIconProps) {
  // Ultra-thick, solid document with overlapping clock, featuring a pristine transparent cutout gap
  const opacity = focused ? 1 : 0.4; // Fades naturally into glassmorphism when inactive

  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" opacity={opacity}>
      <Defs>
        <Mask id="docMask">
          <Rect x="0" y="0" width="24" height="24" fill="white" />
          {/* Circular transparent gap around the clock */}
          <Circle cx="16" cy="16" r="8.5" fill="black" />

          {/* Document embossed lines */}
          <Rect x="5" y="6" width="10" height="2.5" rx="1.2" fill="black" />
          <Rect x="5" y="11" width="6" height="2.5" rx="1.2" fill="black" />
        </Mask>

        <Mask id="clockMask">
          <Rect x="0" y="0" width="24" height="24" fill="white" />
          {/* Cutout hands of the clock */}
          <Path
            d="M16 12 L16 16 L19 16"
            fill="none"
            stroke="black"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </Mask>
      </Defs>

      {/* Back Document Shape */}
      <Rect x="2" y="2" width="16" height="20" rx="5" fill={color} mask="url(#docMask)" />

      {/* Front Clock Shape */}
      <Circle cx="16" cy="16" r="6.5" fill={color} mask="url(#clockMask)" />
    </Svg>
  );
}
