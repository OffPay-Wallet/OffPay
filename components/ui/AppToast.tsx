import { LinearGradient } from 'expo-linear-gradient';
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, {
  Easing,
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '@/components/ui/Text';
import { colors } from '@/constants/colors';
import { radii, spacing } from '@/constants/spacing';
import { fontFamily } from '@/constants/typography';
import { useNotificationStore } from '@/store/notificationStore';

import type { LocalNotificationVariant } from '@/store/notificationStore';

export type AppToastVariant = LocalNotificationVariant;

interface AppToastOptions {
  title: string;
  message?: string;
  variant?: AppToastVariant;
  durationMs?: number;
  notificationId?: string;
}

interface ToastState extends Required<Omit<AppToastOptions, 'notificationId'>> {
  id: number;
}

interface AppToastContextValue {
  showToast: (options: AppToastOptions) => void;
}

const AppToastContext = createContext<AppToastContextValue | null>(null);

const TOAST_META: Record<
  AppToastVariant,
  {
    accent: string;
  }
> = {
  success: {
    accent: colors.semantic.success,
  },
  error: {
    accent: colors.semantic.error,
  },
  warning: {
    accent: colors.semantic.warning,
  },
  info: {
    accent: colors.semantic.info,
  },
};

const DEFAULT_DURATION_MS = 2400;
const TOAST_DEDUPE_WINDOW_MS = 4000;
const MAX_TOAST_TITLE_CHARS = 28;
const MAX_TOAST_MESSAGE_CHARS = 42;
const TOAST_MAX_WIDTH = 340;
const TOAST_EXIT_MS = 220;
const TOAST_MIN_WIDTH = 220;

function compactToastText(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) return normalized;

  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

export function AppToastProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [toast, setToast] = useState<ToastState | null>(null);
  const nextIdRef = useRef(1);
  const recentToastKeysRef = useRef(new Map<string, number>());

  const showToast = useCallback((options: AppToastOptions) => {
    const title = compactToastText(options.title, MAX_TOAST_TITLE_CHARS);
    const message =
      options.message != null ? compactToastText(options.message, MAX_TOAST_MESSAGE_CHARS) : '';
    const variant = options.variant ?? 'info';
    const now = Date.now();
    const dedupeKey = `${variant}:${title}:${message}`;
    const previousShownAt = recentToastKeysRef.current.get(dedupeKey);

    if (previousShownAt != null && now - previousShownAt < TOAST_DEDUPE_WINDOW_MS) {
      return;
    }

    for (const [key, shownAt] of recentToastKeysRef.current) {
      if (now - shownAt >= TOAST_DEDUPE_WINDOW_MS) {
        recentToastKeysRef.current.delete(key);
      }
    }
    recentToastKeysRef.current.set(dedupeKey, now);

    setToast({
      id: nextIdRef.current,
      title,
      message,
      variant,
      durationMs: options.durationMs ?? DEFAULT_DURATION_MS,
    });
    useNotificationStore.getState().addNotification({
      id: options.notificationId ?? `toast-${nextIdRef.current}`,
      title,
      message,
      variant,
    });
    nextIdRef.current += 1;
  }, []);

  const contextValue = useMemo(() => ({ showToast }), [showToast]);

  return (
    <AppToastContext.Provider value={contextValue}>
      {children}
      <AppToastHost toast={toast} onDismiss={() => setToast(null)} />
    </AppToastContext.Provider>
  );
}

export function useAppToast(): AppToastContextValue {
  const value = useContext(AppToastContext);
  if (value == null) {
    throw new Error('useAppToast must be used within AppToastProvider');
  }
  return value;
}

function AppToastHost({
  toast,
  onDismiss,
}: {
  toast: ToastState | null;
  onDismiss: () => void;
}): React.JSX.Element | null {
  const insets = useSafeAreaInsets();
  const { width: windowWidth, height: windowHeight, fontScale } = useWindowDimensions();
  const reduceMotion = useReducedMotion();
  const entryProgress = useSharedValue(0);
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const compact = windowWidth < 360 || windowHeight < 680 || fontScale > 1.12;
  const sideInset = compact ? spacing.md : spacing.xl;
  const maxToastWidth = Math.max(0, Math.min(TOAST_MAX_WIDTH, windowWidth - sideInset * 2));
  const topPadding = insets.top + (compact ? spacing.sm : spacing.md);
  const longestLineLength = toast == null ? 0 : Math.max(toast.title.length, toast.message.length);
  const estimatedTextWidth = Math.min(
    compact ? 250 : 292,
    Math.max(140, longestLineLength * (compact ? 6.9 : 7.6)),
  );
  const toastWidth = Math.min(
    maxToastWidth,
    Math.max(TOAST_MIN_WIDTH, estimatedTextWidth + (compact ? 36 : 44)),
  );
  const textMaxWidth = Math.max(140, toastWidth - (compact ? 32 : 40));

  const dismiss = useCallback(() => {
    if (dismissTimerRef.current != null) {
      clearTimeout(dismissTimerRef.current);
      dismissTimerRef.current = null;
    }

    entryProgress.value = withTiming(
      0,
      { duration: reduceMotion ? 1 : TOAST_EXIT_MS, easing: Easing.in(Easing.cubic) },
      (finished) => {
        if (finished) runOnJS(onDismiss)();
      },
    );
  }, [entryProgress, onDismiss, reduceMotion]);

  useEffect(() => {
    if (toast == null) return;

    if (dismissTimerRef.current != null) {
      clearTimeout(dismissTimerRef.current);
      dismissTimerRef.current = null;
    }

    entryProgress.value = 0;

    if (reduceMotion) {
      entryProgress.value = withTiming(1, { duration: 1 });
    } else {
      entryProgress.value = withSpring(1, {
        damping: 16,
        stiffness: 210,
        mass: 0.74,
      });
    }

    dismissTimerRef.current = setTimeout(dismiss, toast.durationMs);

    return () => {
      if (dismissTimerRef.current != null) {
        clearTimeout(dismissTimerRef.current);
        dismissTimerRef.current = null;
      }
    };
  }, [dismiss, entryProgress, reduceMotion, toast]);

  const wrapStyle = useAnimatedStyle(() => {
    const progress = entryProgress.value;

    return {
      opacity: progress,
      transform: [
        { translateY: interpolate(progress, [0, 1], [-28, 0], Extrapolation.CLAMP) },
        {
          scaleX: reduceMotion
            ? 1
            : interpolate(progress, [0, 0.48, 0.78, 1], [0.62, 1.09, 0.98, 1], Extrapolation.CLAMP),
        },
        {
          scaleY: reduceMotion
            ? 1
            : interpolate(progress, [0, 0.48, 0.78, 1], [0.76, 0.9, 1.06, 1], Extrapolation.CLAMP),
        },
      ],
    };
  });

  const textStyle = useAnimatedStyle(() => {
    const progress = entryProgress.value;

    return {
      opacity: interpolate(progress, [0.22, 1], [0, 1], Extrapolation.CLAMP),
      transform: [{ translateY: interpolate(progress, [0, 1], [4, 0], Extrapolation.CLAMP) }],
    };
  });

  if (toast == null) return null;

  const toastMeta = TOAST_META[toast.variant];
  const hasMessage = toast.message.length > 0;
  const accessibilityLabel = hasMessage ? `${toast.title}. ${toast.message}` : toast.title;

  return (
    <View
      pointerEvents="box-none"
      style={[
        StyleSheet.absoluteFill,
        styles.host,
        {
          paddingTop: topPadding,
          paddingHorizontal: sideInset,
        },
      ]}
    >
      <Animated.View style={[styles.toastWrap, { width: toastWidth }, wrapStyle]}>
        <Pressable
          style={({ pressed }) => [
            styles.toast,
            compact ? styles.toastCompact : null,
            { width: toastWidth },
            pressed ? styles.toastPressed : null,
          ]}
          onPress={dismiss}
          hitSlop={spacing.xs}
          accessibilityRole="button"
          accessibilityLabel={accessibilityLabel}
          accessibilityHint="Dismiss notification"
          accessibilityLiveRegion={
            toast.variant === 'error' || toast.variant === 'warning' ? 'assertive' : 'polite'
          }
        >
          <LinearGradient
            colors={[
              'rgba(252, 252, 255, 0.98)',
              'rgba(223, 247, 250, 0.96)',
              'rgba(252, 252, 255, 0.98)',
            ]}
            start={{ x: 0.04, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={[styles.toastSurface, compact ? styles.toastSurfaceCompact : null]}
          >
            <Animated.View style={[styles.toastText, { maxWidth: textMaxWidth }, textStyle]}>
              <Text
                variant="bodyBold"
                color={toastMeta.accent}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.84}
                style={styles.toastTitle}
              >
                {toast.title}
              </Text>
              {hasMessage ? (
                <Text
                  variant="small"
                  color={colors.text.secondary}
                  numberOfLines={toast.variant === 'error' ? 2 : 1}
                  style={styles.toastMessage}
                >
                  {toast.message}
                </Text>
              ) : null}
            </Animated.View>
          </LinearGradient>
        </Pressable>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    zIndex: 20000,
    alignItems: 'center',
  },
  toastWrap: {
    position: 'relative',
    alignItems: 'center',
    overflow: 'visible',
  },
  toast: {
    position: 'relative',
    minHeight: 58,
    borderRadius: radii.full,
    borderCurve: 'continuous',
    overflow: 'hidden',
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rim,
    backgroundColor: colors.brand.whiteStream,
    padding: 0,
    boxShadow: `0 8px 24px rgba(14, 42, 53, 0.14)`,
  },
  toastSurface: {
    flex: 1,
    width: '100%',
    minHeight: 58,
    borderRadius: radii.full,
    borderCurve: 'continuous',
    backgroundColor: colors.brand.whiteStream,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  toastCompact: {
    minHeight: 54,
  },
  toastSurfaceCompact: {
    minHeight: 54,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  toastPressed: {
    opacity: 0.84,
  },
  toastText: {
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 0,
    width: '100%',
    gap: 2,
  },
  toastTitle: {
    fontFamily: fontFamily.uiSemiBold,
    letterSpacing: 0,
    textAlign: 'center',
  },
  toastMessage: {
    fontFamily: fontFamily.ui,
    lineHeight: 16,
    letterSpacing: 0,
    textAlign: 'center',
  },
});
