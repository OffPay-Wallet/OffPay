/**
 * OffPay Arctic Mist palette tokens.
 *
 * The app now uses a light liquid-glass system:
 *   #5BC8E8 — saturated arctic cyan backing
 *   #DFF7FA — frosted glass tint
 *   #FCFCFF — clear snow glass fill
 *   #0E2A35 — deep navy text and icon ink
 *
 * Usage: import { colors } from '@/constants/colors'
 * Never hardcode hex values in components — always use these tokens.
 */

/** Brand colors — Arctic Mist */
const brand = {
  /** Primary accent — active states, control glow, saturated backing */
  azureCyan: '#5BC8E8',
  /** Primary ink — deep navy text and filled control content */
  deepShadow: '#0E2A35',
  /** Secondary ink/surface depth */
  navyDepth: '#17485A',
  /** Medium cyan — secondary actions, links */
  azureBlue: '#2EAED2',
  /** Frost tint — translucent panel surface */
  iceBlue: '#DFF7FA',
  /** Clear snow — brightest glass fill */
  whiteStream: '#FCFCFF',
} as const;

/** Semantic colors — derived from brand + fintech conventions */
const semantic = {
  /** Settlement confirmed, positive amounts, receive */
  success: '#168A64',
  /** Failed transactions, negative amounts, warnings */
  error: '#C73A3A',
  /** Pending states, caution */
  warning: '#9A6B16',
  /** Info banners, notifications */
  info: '#227A96',
} as const;

/** Notification event icon badges — light fills with readable icon ink. */
const notificationIcon = {
  /** Success badge fill */
  successFill: '#B9F5D8',
  /** Success icon ink */
  successInk: '#0C6848',
  /** Error badge fill */
  errorFill: '#FFC9C9',
  /** Error icon ink */
  errorInk: '#9A2424',
  /** Warning badge fill — deliberately yellow, not brown */
  warningFill: '#FFE27A',
  /** Warning icon ink */
  warningInk: '#6C4A00',
  /** Info badge fill */
  infoFill: '#BDEFF7',
  /** Info icon ink */
  infoInk: brand.deepShadow,
} as const;

/** Text colors — optimized for light glass surfaces */
const text = {
  /** Primary text on glass */
  primary: brand.deepShadow,
  /** Subtitles, timestamps, secondary info */
  secondary: '#466A75',
  /** Disabled, inactive */
  tertiary: '#6F8F99',
  /** Placeholder text */
  placeholder: '#7D98A1',
  /** Text on filled dark controls */
  inverse: brand.whiteStream,
  /** Text on arctic cyan accent */
  onAccent: brand.deepShadow,
} as const;

/**
 * Surface/background colors — light glass palette.
 */
const surface = {
  /** Primary screen background — saturated backing for glass */
  background: '#5BC8E8',
  /** Secondary background — softer arctic field */
  backgroundAlt: '#BDEFF7',
  /** Cyan tint for selected/hovered surfaces */
  backgroundTint: '#DFF7FA',
  /** Card surfaces — semi-opaque fallback for glass panels */
  card: 'rgba(252, 252, 255, 0.68)',
  /** Elevated glass surface */
  cardElevated: 'rgba(252, 252, 255, 0.82)',
  /** Accent card surface */
  cardAccent: brand.azureCyan,
  /** Pressed/active state overlay */
  pressed: 'rgba(14, 42, 53, 0.08)',
  /** Disabled surface */
  disabled: 'rgba(223, 247, 250, 0.48)',
} as const;

/** Border colors — glass rims */
const border = {
  /** Default border */
  default: 'rgba(252, 252, 255, 0.68)',
  /** Subtle border (cards) */
  subtle: 'rgba(14, 42, 53, 0.1)',
  /** Strong border (inputs, focused) */
  strong: 'rgba(14, 42, 53, 0.24)',
  /** Accent border */
  accent: brand.azureCyan,
} as const;

/** Token colors for crypto assets */
const token = {
  /** USDC blue */
  usdc: '#2775CA',
  /** USDT green */
  usdt: '#26A17B',
  /** Solana purple */
  solana: '#9945FF',
  /** SOL gradient start */
  solanaGradientStart: '#9945FF',
  /** SOL gradient end */
  solanaGradientEnd: '#14F195',
} as const;

/**
 * App background gradient tokens — derived from Azure Cyan
 * layered over Deep Shadow. Kept here so background components do
 * not hardcode brand color math.
 */
const backgroundGradient = {
  /** Base layer */
  base: brand.azureCyan,
  /** Soft full-field layers — no isolated decorative orbs */
  blobTop: 'rgba(252, 252, 255, 0.34)',
  blobTopSoft: 'rgba(223, 247, 250, 0.52)',
  blobMid: 'rgba(252, 252, 255, 0.22)',
  blobLower: 'rgba(14, 42, 53, 0.08)',
  blobBlue: 'rgba(91, 200, 232, 0.36)',
  blobShadow: 'rgba(14, 42, 53, 0.12)',
  /** Film-grain noise */
  noiseLight: 'rgba(252, 252, 255, 0.5)',
  noiseGreen: 'rgba(223, 247, 250, 0.44)',
  noiseDark: 'rgba(14, 42, 53, 0.1)',
  /** Vignette */
  topDepth: 'rgba(252, 252, 255, 0.24)',
  bottomDepth: 'rgba(14, 42, 53, 0.1)',
} as const;

/** Holdings card gradient — clear snow glass fading into Arctic Mist. */
const holdingsCard = {
  /** Top — clear snow glass */
  gradientTop: 'rgba(252, 252, 255, 0.78)',
  /** Mid — frost tint */
  gradientMid: 'rgba(223, 247, 250, 0.58)',
  /** Bottom — arctic cyan bleed */
  gradientBottom: 'rgba(91, 200, 232, 0.24)',
  /** Top-edge glow for glass depth */
  innerGlow: 'rgba(252, 252, 255, 0.84)',
  /** Row separator */
  divider: 'rgba(14, 42, 53, 0.08)',
  /** Pressed row overlay */
  pressed: 'rgba(252, 252, 255, 0.44)',
} as const;

/**
 * Recovery phrase / backup UI.
 */
const recoveryPhrase = {
  chipBackground: 'rgba(252, 252, 255, 0.62)',
  chipBorder: 'rgba(14, 42, 53, 0.12)',
  chipIndex: '#5F818B',
} as const;

/** Liquid glass material recipes used by interactive surfaces. */
const glass = {
  clearFill: 'rgba(252, 252, 255, 0.62)',
  frostFill: 'rgba(223, 247, 250, 0.56)',
  strongFill: 'rgba(252, 252, 255, 0.82)',
  rim: 'rgba(252, 252, 255, 0.76)',
  rimSubtle: 'rgba(255, 255, 255, 0.48)',
  innerShadow: 'rgba(14, 42, 53, 0.1)',
  depthShadow: 'rgba(14, 42, 53, 0.18)',
  textBacking: 'rgba(252, 252, 255, 0.72)',
  badgeFill: 'rgba(252, 252, 255, 0.94)',
  azureCyanHalf: 'rgba(91, 200, 232, 0.5)',
  cyanWash: 'rgba(91, 200, 232, 0.28)',
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
