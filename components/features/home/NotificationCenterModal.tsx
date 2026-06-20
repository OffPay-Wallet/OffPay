import Ionicons from '@expo/vector-icons/Ionicons';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, {
  Easing,
  interpolate,
  LinearTransition,
  runOnJS,
  type SharedValue,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '@/components/ui/Text';
import { colors } from '@/constants/colors';
import { layout, radii, spacing } from '@/constants/spacing';
import { useNotificationStore } from '@/store/notificationStore';

import type { ComponentProps } from 'react';
import type { LocalNotification, LocalNotificationVariant } from '@/store/notificationStore';

type IoniconName = ComponentProps<typeof Ionicons>['name'];

export interface NotificationCenterModalProps {
  visible: boolean;
  onClose: () => void;
}

const VARIANT_TONE: Record<LocalNotificationVariant, { fill: string; ink: string }> = {
  success: {
    fill: colors.notificationIcon.successFill,
    ink: colors.notificationIcon.successInk,
  },
  error: {
    fill: colors.notificationIcon.errorFill,
    ink: colors.notificationIcon.errorInk,
  },
  warning: {
    fill: colors.notificationIcon.warningFill,
    ink: colors.notificationIcon.warningInk,
  },
  info: {
    fill: colors.notificationIcon.infoFill,
    ink: colors.notificationIcon.infoInk,
  },
};
const VARIANT_ICON: Record<LocalNotificationVariant, IoniconName> = {
  success: 'checkmark',
  error: 'close',
  warning: 'warning',
  info: 'information',
};
const MODAL_OPEN_MS = 240;
const MODAL_CLOSE_MS = 180;
const CLEAR_ROW_DURATION_MS = 220;
const CLEAR_ROW_STAGGER_MS = 56;
const CLEAR_FINISH_SETTLE_MS = 24;
const CLEAR_EMPTY_RESIZE_DELAY_MS = 160;
const SHEET_RESIZE_DURATION_MS = 260;
const ROW_STACK_SHIFT_DURATION_MS = 180;
const ROW_EXIT_TRANSLATE_X = 36;
const SHEET_SIZE_TRANSITION = LinearTransition.duration(SHEET_RESIZE_DURATION_MS).easing(
  Easing.out(Easing.cubic),
);
const ROW_STACK_SHIFT_TRANSITION = LinearTransition.duration(ROW_STACK_SHIFT_DURATION_MS).easing(
  Easing.out(Easing.cubic),
);

interface ClearRun {
  ids: string[];
  durationMs: number;
  staggerMs: number;
}

function NotificationRow({
  notification,
  index,
  clearProgress,
  clearDurationMs,
  clearStaggerMs,
  compact,
  dismissing,
  dismissProgress,
  animateLayout,
  onDismiss,
}: {
  notification: LocalNotification;
  index: number;
  clearProgress: SharedValue<number>;
  clearDurationMs: number;
  clearStaggerMs: number;
  compact: boolean;
  dismissing: boolean;
  dismissProgress: SharedValue<number>;
  animateLayout: boolean;
  onDismiss: (id: string) => void;
}): React.JSX.Element {
  const tone = VARIANT_TONE[notification.variant];
  const iconName = VARIANT_ICON[notification.variant];
  const clearStyle = useAnimatedStyle(() => {
    const elapsedMs = clearProgress.value * clearDurationMs;
    const delayedProgress = (elapsedMs - index * clearStaggerMs) / CLEAR_ROW_DURATION_MS;
    const rowProgress = Math.min(1, Math.max(0, delayedProgress));
    const dismissRowProgress = dismissing ? dismissProgress.value : 0;
    const progress = Math.max(rowProgress, dismissRowProgress);

    return {
      opacity: 1 - progress,
      transform: [{ translateX: progress * ROW_EXIT_TRANSLATE_X }],
    };
  });

  return (
    <Animated.View
      layout={animateLayout ? ROW_STACK_SHIFT_TRANSITION : undefined}
      style={[styles.notificationRow, compact ? styles.notificationRowCompact : null, clearStyle]}
    >
      <View
        style={[
          styles.statusIcon,
          compact ? styles.statusIconCompact : null,
          { backgroundColor: tone.fill },
        ]}
      >
        <Ionicons name={iconName} size={compact ? 16 : 18} color={tone.ink} />
      </View>
      <View style={styles.notificationText}>
        <Text
          variant="bodyBold"
          color={colors.text.primary}
          numberOfLines={1}
          ellipsizeMode="tail"
          style={styles.notificationTitle}
        >
          {notification.title}
        </Text>
        {notification.message.length > 0 ? (
          <Text
            variant="small"
            color={colors.text.secondary}
            style={styles.notificationMessage}
            numberOfLines={1}
            ellipsizeMode="tail"
          >
            {notification.message}
          </Text>
        ) : null}
      </View>
      <Pressable
        style={({ pressed }) => [styles.rowDismissButton, pressed ? styles.pressed : null]}
        onPress={() => onDismiss(notification.id)}
        accessibilityRole="button"
        accessibilityLabel={`Dismiss ${notification.title}`}
      >
        <Ionicons name="close" size={18} color={colors.text.tertiary} />
      </Pressable>
    </Animated.View>
  );
}

export function NotificationCenterModal({
  visible,
  onClose,
}: NotificationCenterModalProps): React.JSX.Element | null {
  const insets = useSafeAreaInsets();
  const { width: windowWidth, height: windowHeight, fontScale } = useWindowDimensions();
  const notifications = useNotificationStore((state) => state.notifications);
  const clearNotifications = useNotificationStore((state) => state.clearNotifications);
  const removeNotification = useNotificationStore((state) => state.removeNotification);
  const [rendered, setRendered] = useState(visible);
  const [clearing, setClearing] = useState(false);
  const [clearRun, setClearRun] = useState<ClearRun | null>(null);
  const [dismissingNotificationId, setDismissingNotificationId] = useState<string | null>(null);
  const [stableRowCount, setStableRowCount] = useState(0);
  const clearTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const resizeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reduceMotion = useReducedMotion();
  const sheetProgress = useSharedValue(visible ? 1 : 0);
  const clearProgress = useSharedValue(0);
  const dismissProgress = useSharedValue(0);
  const clearItemCount = clearRun?.ids.length ?? notifications.length;
  const clearStaggerMs = useMemo(() => {
    if (clearItemCount <= 1) return 0;
    return Math.max(18, Math.min(CLEAR_ROW_STAGGER_MS, 360 / (clearItemCount - 1)));
  }, [clearItemCount]);
  const clearDurationMs = useMemo(
    () => CLEAR_ROW_DURATION_MS + Math.max(0, clearItemCount - 1) * clearStaggerMs,
    [clearItemCount, clearStaggerMs],
  );
  const compactPanel = windowWidth < 360 || windowHeight < 680 || fontScale > 1.12;
  const sheetSideInset = compactPanel ? spacing.md : spacing.lg;
  const sheetWidth = Math.max(0, Math.min(420, windowWidth - sheetSideInset * 2));
  const sheetTopClearance = compactPanel ? spacing.lg : spacing['2xl'];
  const sheetTopInset = Math.max(insets.top + sheetTopClearance, spacing['3xl']);
  const sheetMaxHeight = Math.max(0, windowHeight - sheetTopInset - insets.bottom - spacing.lg);
  const sheetPadding = compactPanel ? spacing.md : spacing.lg;
  const closeButtonSize = compactPanel ? 40 : layout.minTouchTarget;
  const stableRowHeight = compactPanel ? 58 : 64;
  const displayedRowCount =
    notifications.length > 0 ? Math.max(stableRowCount, notifications.length) : stableRowCount;
  const stableListHeight =
    displayedRowCount > 0
      ? displayedRowCount * stableRowHeight + Math.max(0, displayedRowCount - 1) * spacing.sm
      : 0;
  const stableContentHeight =
    displayedRowCount > 0
      ? closeButtonSize + spacing.md + stableListHeight + spacing.md + layout.buttonHeightMd
      : closeButtonSize + spacing.md + (compactPanel ? 84 : 104);
  const sheetMinHeight = Math.min(sheetMaxHeight, sheetPadding * 2 + stableContentHeight);

  const clearScheduledTimers = useCallback((): void => {
    clearTimersRef.current.forEach(clearTimeout);
    clearTimersRef.current = [];
  }, []);

  const clearResizeTimer = useCallback((): void => {
    if (resizeTimerRef.current == null) return;
    clearTimeout(resizeTimerRef.current);
    resizeTimerRef.current = null;
  }, []);

  useEffect(() => {
    if (visible) setRendered(true);
  }, [visible]);

  useEffect(() => {
    if (!visible) {
      clearResizeTimer();
      setStableRowCount(0);
      return;
    }

    if (notifications.length > 0) {
      clearResizeTimer();
      setStableRowCount((count) => Math.max(count, notifications.length));
      return;
    }

    if (stableRowCount === 0) return;

    if (reduceMotion) {
      clearResizeTimer();
      setStableRowCount(0);
      return;
    }

    if (resizeTimerRef.current != null) return;

    resizeTimerRef.current = setTimeout(() => {
      resizeTimerRef.current = null;
      setStableRowCount(0);
    }, CLEAR_EMPTY_RESIZE_DELAY_MS);
  }, [clearResizeTimer, notifications.length, reduceMotion, stableRowCount, visible]);

  useEffect(() => {
    if (!rendered) return;

    if (visible) {
      // Snap to 0 first so the entrance always animates from "below
      // and faded out" — without this, re-opening the same instance
      // would skip the animation. The snap happens before paint so the
      // user only ever sees the timing tween.
      if (sheetProgress.value !== 0 && sheetProgress.value !== 1) {
        // mid-animation re-open: keep current value as the start point
      } else {
        sheetProgress.value = reduceMotion ? 1 : 0;
      }
      sheetProgress.value = withTiming(1, {
        duration: reduceMotion ? 0 : MODAL_OPEN_MS,
        easing: Easing.out(Easing.cubic),
      });
      return;
    }

    sheetProgress.value = withTiming(
      0,
      { duration: reduceMotion ? 0 : MODAL_CLOSE_MS, easing: Easing.in(Easing.cubic) },
      (finished) => {
        if (finished) runOnJS(setRendered)(false);
      },
    );
  }, [reduceMotion, rendered, sheetProgress, visible]);

  const finishClear = useCallback((): void => {
    clearScheduledTimers();
    clearProgress.value = 0;
    setClearing(false);
    setClearRun(null);
  }, [clearProgress, clearScheduledTimers]);

  const handleClear = useCallback((): void => {
    if (clearing || dismissingNotificationId != null || notifications.length === 0) return;
    const ids = notifications.map((notification) => notification.id);

    if (reduceMotion) {
      clearNotifications();
      return;
    }

    const runStaggerMs =
      ids.length <= 1 ? 0 : Math.max(18, Math.min(CLEAR_ROW_STAGGER_MS, 360 / (ids.length - 1)));
    const runDurationMs =
      CLEAR_ROW_DURATION_MS + Math.max(0, ids.length - 1) * runStaggerMs + CLEAR_FINISH_SETTLE_MS;

    clearScheduledTimers();
    setClearRun({ ids, durationMs: runDurationMs, staggerMs: runStaggerMs });
    setClearing(true);
    clearProgress.value = 0;
    clearProgress.value = withTiming(
      1,
      { duration: runDurationMs, easing: Easing.inOut(Easing.cubic) },
      (finished) => {
        if (finished) runOnJS(finishClear)();
      },
    );

    ids.forEach((id, index) => {
      const timer = setTimeout(
        () => {
          removeNotification(id);
        },
        index * runStaggerMs + CLEAR_ROW_DURATION_MS,
      );
      clearTimersRef.current.push(timer);
    });
  }, [
    clearProgress,
    clearScheduledTimers,
    clearNotifications,
    clearing,
    dismissingNotificationId,
    finishClear,
    notifications,
    reduceMotion,
    removeNotification,
  ]);

  const handleDismissNotification = useCallback(
    (id: string): void => {
      if (clearing || dismissingNotificationId != null) return;

      if (reduceMotion) {
        removeNotification(id);
        return;
      }

      setDismissingNotificationId(id);
      dismissProgress.value = 0;
      dismissProgress.value = withTiming(
        1,
        { duration: CLEAR_ROW_DURATION_MS, easing: Easing.in(Easing.cubic) },
        (finished) => {
          if (!finished) return;
          runOnJS(removeNotification)(id);
          dismissProgress.value = 0;
          runOnJS(setDismissingNotificationId)(null);
        },
      );
    },
    [clearing, dismissProgress, dismissingNotificationId, reduceMotion, removeNotification],
  );

  useEffect(() => {
    if (visible || !clearing) return;
    clearScheduledTimers();
    clearProgress.value = 0;
    setClearing(false);
    setClearRun(null);
  }, [clearProgress, clearScheduledTimers, clearing, visible]);

  useEffect(
    () => () => {
      clearScheduledTimers();
      clearResizeTimer();
    },
    [clearResizeTimer, clearScheduledTimers],
  );

  const clearButtonStyle = useAnimatedStyle(() => ({
    opacity: interpolate(clearProgress.value, [0, 0.18], [1, 0], 'clamp'),
  }));

  const backdropStyle = useAnimatedStyle(() => ({
    opacity: interpolate(sheetProgress.value, [0, 1], [0, 1]),
  }));

  const sheetStyle = useAnimatedStyle(() => ({
    opacity: interpolate(sheetProgress.value, [0, 1], [0, 1]),
    transform: [{ translateY: interpolate(sheetProgress.value, [0, 1], [-14, 0]) }],
  }));

  if (!rendered) return null;

  return (
    <Modal
      visible={rendered}
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View
        style={[
          styles.modalRoot,
          {
            paddingTop: sheetTopInset,
            paddingHorizontal: sheetSideInset,
            paddingBottom: Math.max(insets.bottom, spacing.md),
          },
        ]}
      >
        <Animated.View style={[styles.backdrop, backdropStyle]}>
          <Pressable style={styles.backdropPressable} onPress={onClose} />
        </Animated.View>
        <Animated.View
          style={[
            styles.sheetShell,
            {
              width: sheetWidth,
            },
            sheetStyle,
          ]}
        >
          <Animated.View
            layout={reduceMotion ? undefined : SHEET_SIZE_TRANSITION}
            style={[
              styles.sheet,
              {
                maxHeight: sheetMaxHeight,
                minHeight: sheetMinHeight,
                padding: sheetPadding,
              },
            ]}
          >
            <View pointerEvents="none" style={styles.sheetTint} />
            <View style={styles.header}>
              <View style={styles.headerCopy}>
                <Text
                  variant="h3"
                  color={colors.text.primary}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.82}
                >
                  Notifications
                </Text>
              </View>
              <Pressable
                style={[styles.closeButton, { width: closeButtonSize, height: closeButtonSize }]}
                onPress={onClose}
                accessibilityRole="button"
                accessibilityLabel="Close notifications"
              >
                <Ionicons name="close" size={layout.iconSizeInline} color={colors.text.primary} />
              </Pressable>
            </View>

            {notifications.length > 0 ? (
              <View style={styles.notificationBody}>
                <ScrollView
                  style={styles.list}
                  contentContainerStyle={styles.listContent}
                  showsVerticalScrollIndicator={false}
                >
                  {notifications.map((notification, index) => {
                    const clearIndex = clearRun?.ids.indexOf(notification.id);

                    return (
                      <NotificationRow
                        key={notification.id}
                        notification={notification}
                        index={clearIndex != null && clearIndex >= 0 ? clearIndex : index}
                        clearProgress={clearProgress}
                        clearDurationMs={clearRun?.durationMs ?? clearDurationMs}
                        clearStaggerMs={clearRun?.staggerMs ?? clearStaggerMs}
                        compact={compactPanel}
                        dismissing={dismissingNotificationId === notification.id}
                        dismissProgress={dismissProgress}
                        animateLayout={!reduceMotion && !clearing}
                        onDismiss={handleDismissNotification}
                      />
                    );
                  })}
                </ScrollView>
                <Animated.View style={[styles.clearButtonSlot, clearButtonStyle]}>
                  <Pressable
                    style={({ pressed }) => [
                      styles.clearButton,
                      pressed && !clearing ? styles.pressed : null,
                    ]}
                    onPress={handleClear}
                    disabled={clearing}
                    accessibilityRole="button"
                    accessibilityLabel="Clear notifications"
                    accessibilityState={{ disabled: clearing }}
                  >
                    <Text variant="buttonSmall" color={colors.text.primary}>
                      Clear
                    </Text>
                  </Pressable>
                </Animated.View>
              </View>
            ) : (
              <View style={[styles.emptyState, compactPanel ? styles.emptyStateCompact : null]}>
                <Text variant="bodyBold" color={colors.text.primary} align="center">
                  No notifications
                </Text>
              </View>
            )}
          </Animated.View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalRoot: {
    flex: 1,
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0, 2, 5, 0.78)',
  },
  backdropPressable: {
    ...StyleSheet.absoluteFill,
  },
  sheetShell: {
    alignSelf: 'center',
    maxWidth: 420,
  },
  sheet: {
    width: '100%',
    borderRadius: radii['2xl'],
    backgroundColor: colors.brand.glassTint,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rim,
    boxShadow: `0 18px 42px rgba(0, 0, 0, 0.46), inset 0 1px 0 rgba(255, 255, 255, 0.14)`,
    gap: spacing.md,
    overflow: 'hidden',
  },
  sheetTint: {
    ...StyleSheet.absoluteFill,
    backgroundColor: colors.brand.glassTint,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  headerCopy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  closeButton: {
    borderRadius: radii.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface.backgroundTint,
  },
  notificationBody: {
    flex: 1,
    minHeight: 0,
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  list: {
    flex: 1,
    flexGrow: 1,
    flexShrink: 1,
  },
  listContent: {
    gap: spacing.sm,
  },
  notificationRow: {
    minHeight: 64,
    borderRadius: radii.xl,
    backgroundColor: colors.surface.backgroundTint,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border.subtle,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    overflow: 'hidden',
  },
  notificationRowCompact: {
    minHeight: 58,
    paddingHorizontal: spacing.sm,
  },
  statusIcon: {
    width: 34,
    height: 34,
    borderRadius: radii.full,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusIconCompact: {
    width: 30,
    height: 30,
  },
  notificationText: {
    flex: 1,
    minWidth: 0,
    gap: 1,
  },
  notificationTitle: {
    flex: 1,
    minWidth: 0,
    lineHeight: 20,
  },
  notificationMessage: {
    lineHeight: 16,
  },
  rowDismissButton: {
    width: 40,
    height: 40,
    borderRadius: radii.full,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  clearButtonSlot: {
    flexShrink: 0,
  },
  clearButton: {
    height: layout.buttonHeightMd,
    borderRadius: radii.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface.backgroundTint,
  },
  pressed: {
    opacity: 0.84,
  },
  emptyState: {
    minHeight: 140,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  emptyStateCompact: {
    minHeight: 96,
    paddingHorizontal: spacing.md,
  },
});
