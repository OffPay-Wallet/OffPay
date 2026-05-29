/**
 * Spacing, radii, and layout constants.
 * Based on 4px base grid system.
 */

/** Spacing scale — 4px base unit */
export const spacing = {
  /** 4px — icon gaps, tight inline spacing */
  xs: 4,
  /** 8px — inline spacing, small gaps */
  sm: 8,
  /** 12px — compact padding */
  md: 12,
  /** 16px — card padding, section gaps */
  lg: 16,
  /** 20px — component internal padding */
  xl: 20,
  /** 24px — between cards, generous gaps */
  '2xl': 24,
  /** 32px — screen horizontal padding */
  '3xl': 32,
  /** 48px — major section breaks */
  '4xl': 48,
} as const;

/** Border radius tokens */
export const radii = {
  /** 4px — small chips, tags */
  xs: 4,
  /** 8px — inputs, small buttons */
  sm: 8,
  /** 12px — buttons, smaller cards */
  md: 12,
  /** 16px — medium cards */
  lg: 16,
  /** 20px — main cards */
  xl: 20,
  /** 24px — large cards, sheets */
  '2xl': 24,
  /** fully round — avatars, circular buttons */
  full: 9999,
} as const;

/** Layout constants */
export const layout = {
  /** Screen horizontal padding */
  screenPaddingHorizontal: spacing['3xl'],
  /** Minimum touch target (Apple HIG) */
  minTouchTarget: 44,
  /** Tab bar height */
  tabBarHeight: 72,
  /** Card padding */
  cardPadding: spacing.xl,
  /** Default card border radius */
  cardRadius: radii.xl,
  /** Button height — large */
  buttonHeightLg: 56,
  /** Button height — medium */
  buttonHeightMd: 48,
  /** Button height — small */
  buttonHeightSm: 36,
  /** Icon size — inline */
  iconSizeInline: 20,
  /** Icon size — navigation */
  iconSizeNav: 24,
  /** Icon size — tab bar */
  iconSizeTab: 28,
  /** Avatar size — small */
  avatarSm: 32,
  /** Avatar size — medium */
  avatarMd: 40,
  /** Avatar size — large */
  avatarLg: 56,
} as const;
