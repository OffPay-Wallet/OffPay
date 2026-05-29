import { colors } from '@/constants/colors';

export const SWAP_GLASS_COLORS = [
  colors.glass.strongFill,
  colors.glass.frostFill,
  colors.glass.clearFill,
] as const;

export const SWAP_PANEL_SHADOW =
  '0 16px 30px rgba(14, 42, 53, 0.12), inset 0 1px 1px rgba(255, 255, 255, 0.78), inset 0 -12px 24px rgba(91, 200, 232, 0.12)';

export const SWAP_CONTROL_SHADOW =
  '0 8px 16px rgba(14, 42, 53, 0.12), inset 0 1px 1px rgba(255, 255, 255, 0.86), inset 0 -8px 14px rgba(91, 200, 232, 0.1)';
