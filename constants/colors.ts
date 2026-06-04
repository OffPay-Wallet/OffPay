/**
 * OffPay glossy dark palette tokens.
 *
 * The app uses a black/white system:
 *   #050505 - primary screen background
 *   #111111 - raised dark surfaces
 *   #F7F7F2 - glossy highlight and primary copy
 *   #C8C8C2 - muted secondary copy
 *   #FF4D5A - destructive and failed-state accent
 *
 * Usage: import { colors } from '@/constants/colors'
 * Never hardcode hex values in components - always use these tokens.
 */

/** Brand colors - glossy dark monochrome */
const brand = {
  /** Gloss highlight surface - active states and filled light controls */
  glossAccent: '#F7F7F2',
  /** Primary black ink and deepest surface */
  deepShadow: '#050505',
  /** Secondary dark depth */
  graphiteDepth: '#111111',
  /** Strong dark action fill */
  actionFill: '#050505',
  /** Soft neutral tint for translucent panels */
  glassTint: '#242424',
  /** Brightest highlight fill */
  whiteStream: '#F7F7F2',
} as const;

/** Semantic colors - dark-theme role accents */
const semantic = {
  /** Settlement confirmed and success chrome */
  success: '#F7F7F2',
  /** Received funds and positive token deltas */
  receive: '#31E981',
  /** Failed transactions, negative amounts, warnings */
  error: '#FF4D5A',
  /** Pending states, caution */
  warning: '#D7D7CE',
  /** Info banners, notifications */
  info: '#F7F7F2',
} as const;

/** Notification event icon badges - dark fills with readable icon ink. */
const notificationIcon = {
  /** Success badge fill */
  successFill: 'rgba(247, 247, 242, 0.16)',
  /** Success icon ink */
  successInk: '#F7F7F2',
  /** Error badge fill */
  errorFill: 'rgba(255, 77, 90, 0.18)',
  /** Error icon ink */
  errorInk: '#FF4D5A',
  /** Warning badge fill */
  warningFill: 'rgba(215, 215, 206, 0.18)',
  /** Warning icon ink */
  warningInk: '#D7D7CE',
  /** Info badge fill */
  infoFill: 'rgba(247, 247, 242, 0.14)',
  /** Info icon ink */
  infoInk: brand.whiteStream,
} as const;

/** Text colors - optimized for glossy dark surfaces */
const text = {
  /** Primary text on glass */
  primary: brand.whiteStream,
  /** Subtitles, timestamps, secondary info */
  secondary: '#C8C8C2',
  /** Disabled, inactive */
  tertiary: '#94948E',
  /** Placeholder text */
  placeholder: '#767670',
  /** Text on filled dark controls */
  inverse: brand.whiteStream,
  /** Text on filled light gloss controls */
  onAccent: brand.deepShadow,
} as const;

/**
 * Surface/background colors - glossy dark glass palette.
 */
const surface = {
  /** Primary screen background */
  background: '#050505',
  /** Secondary background */
  backgroundAlt: '#101010',
  /** Tint for selected/hovered surfaces */
  backgroundTint: '#181818',
  /** Card surfaces - semi-opaque fallback for glass panels */
  card: 'rgba(22, 22, 22, 0.76)',
  /** Elevated glass surface */
  cardElevated: 'rgba(34, 34, 34, 0.9)',
  /** Accent card surface */
  cardAccent: brand.glossAccent,
  /** Pressed/active state overlay */
  pressed: 'rgba(255, 255, 255, 0.1)',
  /** Disabled surface */
  disabled: 'rgba(255, 255, 255, 0.08)',
} as const;

/** Border colors - glass rims */
const border = {
  /** Default border */
  default: 'rgba(255, 255, 255, 0.18)',
  /** Subtle border (cards) */
  subtle: 'rgba(255, 255, 255, 0.1)',
  /** Strong border (inputs, focused) */
  strong: 'rgba(255, 255, 255, 0.28)',
  /** Accent border */
  accent: brand.glossAccent,
} as const;

/** Token colors for crypto assets - monochrome variants */
const token = {
  /** USDC monochrome */
  usdc: '#1A1A1A',
  /** USDT monochrome */
  usdt: '#2B2B2B',
  /** Solana monochrome */
  solana: '#3D3D3D',
  /** SOL gradient start */
  solanaGradientStart: '#111111',
  /** SOL gradient end */
  solanaGradientEnd: '#565656',
} as const;

/**
 * App background gradient tokens - derived from monochrome neutrals.
 * Kept here so background components do
 * not hardcode brand color math.
 */
const backgroundGradient = {
  /** Base layer */
  base: surface.background,
  /** Soft full-field layers - no isolated decorative orbs */
  blobTop: 'rgba(255, 255, 255, 0.14)',
  blobTopSoft: 'rgba(255, 255, 255, 0.08)',
  blobMid: 'rgba(255, 255, 255, 0.06)',
  blobLower: 'rgba(255, 255, 255, 0.04)',
  blobGloss: 'rgba(255, 255, 255, 0.1)',
  blobShadow: 'rgba(0, 0, 0, 0.58)',
  /** Film-grain noise */
  noiseLight: 'rgba(255, 255, 255, 0.12)',
  noiseSoft: 'rgba(255, 255, 255, 0.08)',
  noiseDark: 'rgba(0, 0, 0, 0.42)',
  /** Vignette */
  topDepth: 'rgba(255, 255, 255, 0.1)',
  bottomDepth: 'rgba(0, 0, 0, 0.68)',
} as const;

/** Holdings card gradient - dark glass fading into black. */
const holdingsCard = {
  /** Top - glossy dark glass */
  gradientTop: 'rgba(42, 42, 42, 0.9)',
  /** Mid - soft neutral tint */
  gradientMid: 'rgba(26, 26, 26, 0.78)',
  /** Bottom - black bleed */
  gradientBottom: 'rgba(8, 8, 8, 0.82)',
  /** Top-edge glow for glass depth */
  innerGlow: 'rgba(255, 255, 255, 0.2)',
  /** Row separator */
  divider: 'rgba(255, 255, 255, 0.08)',
  /** Pressed row overlay */
  pressed: 'rgba(255, 255, 255, 0.08)',
} as const;

/**
 * Recovery phrase / backup UI.
 */
const recoveryPhrase = {
  chipBackground: 'rgba(255, 255, 255, 0.08)',
  chipBorder: 'rgba(255, 255, 255, 0.14)',
  chipIndex: '#A6A6A0',
} as const;

/** Liquid glass material recipes used by interactive surfaces. */
const glass = {
  clearFill: 'rgba(26, 26, 26, 0.74)',
  frostFill: 'rgba(38, 38, 38, 0.66)',
  strongFill: 'rgba(48, 48, 48, 0.9)',
  rim: 'rgba(255, 255, 255, 0.2)',
  rimSubtle: 'rgba(255, 255, 255, 0.12)',
  innerShadow: 'rgba(255, 255, 255, 0.08)',
  depthShadow: 'rgba(0, 0, 0, 0.58)',
  textBacking: 'rgba(255, 255, 255, 0.1)',
  badgeFill: 'rgba(255, 255, 255, 0.16)',
  accentVeil: 'rgba(255, 255, 255, 0.24)',
  smokeWash: 'rgba(255, 255, 255, 0.08)',
} as const;

/** Complete color palette — single import for the entire app */
export const colors = {
  brand,
  semantic,
  text,
  surface,
  border,
  notificationIcon,
  token,
  backgroundGradient,
  recoveryPhrase,
  holdingsCard,
  glass,
} as const;
