import { StyleSheet } from 'react-native';

import { spacing } from '@/constants/spacing';
import { fontFamily } from '@/constants/typography';

export const privacyNoteStyles = StyleSheet.create({
  screenOverlay: {
    alignItems: 'center',
    marginTop: spacing.lg,
    paddingBottom: spacing.xl,
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
