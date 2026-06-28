import React from 'react';
import { LinearGradient } from 'expo-linear-gradient';

import { colors } from '@/constants/colors';

import { confirmationStyles as styles } from './styles/confirmation';

const ACTION_CARD_GRADIENT_COLORS = [
  colors.holdingsCard.gradientTop,
  colors.surface.solidCardElevated,
  colors.holdingsCard.gradientBottom,
] as const;

export function ConfirmationCardSurface({
  children,
}: {
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <LinearGradient
      colors={ACTION_CARD_GRADIENT_COLORS}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={styles.confirmationCard}
    >
      {children}
    </LinearGradient>
  );
}
