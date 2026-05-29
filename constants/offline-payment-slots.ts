export const OFFLINE_PAYMENT_SLOT_MIN = 10;
export const OFFLINE_PAYMENT_SLOT_MAX = 50;
export const OFFLINE_PAYMENT_SLOT_DEFAULT = 10;
export const OFFLINE_PAYMENT_SLOT_PRESETS = [10, 20, 50] as const;

export function clampOfflinePaymentSlotCount(value: number): number {
  if (!Number.isFinite(value)) return OFFLINE_PAYMENT_SLOT_DEFAULT;

  return Math.max(
    OFFLINE_PAYMENT_SLOT_MIN,
    Math.min(OFFLINE_PAYMENT_SLOT_MAX, Math.trunc(value)),
  );
}
