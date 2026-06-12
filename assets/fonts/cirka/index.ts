import { fontFamily } from '@/constants/typography';

/** Runtime Cirka map — loaded at runtime for first-render consistency. */
export const cirkaFontMap = {
  [fontFamily.moneyBold]: require('./Cirka-Bold.otf'),
  [fontFamily.moneyLight]: require('./Cirka-Light.otf'),
} as const;
