import { StyleSheet } from 'react-native';

import { spacing } from '@/constants/spacing';
import { fontFamily } from '@/constants/typography';

export const privacyNoteStyles = StyleSheet.create({
  screenOverlay: {
    ...StyleSheet.absoluteFill,
    justifyContent: 'center',
    alignItems: 'center',
    pointerEvents: 'none',
  },
  card: {
    maxWidth: 280,
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.lg,
  },
  text: {
    fontFamily: fontFamily.ui,
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
  },
});
