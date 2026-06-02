import { fontFamily } from '@/constants/typography';

/** Runtime Cirka map — works in Expo Go and until a native rebuild picks up app.config fonts. */
export const cirkaFontMap = {
  [fontFamily.moneyBold]: require('./Cirka-Bold.otf'),
  [fontFamily.moneyLight]: require('./Cirka-Light.otf'),
} as const;
