import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '@/components/ui/Text';
import {
  SETTINGS_BACKDROP_ENTERING,
  SETTINGS_BACKDROP_EXITING,
} from '@/components/ui/settings-motion';
import { colors } from '@/constants/colors';
import { radii, spacing } from '@/constants/spacing';
import { fontFamily } from '@/constants/typography';
import { useNotificationStore } from '@/store/notificationStore';

import type { ComponentProps } from 'react';
import type { LocalNotificationVariant } from '@/store/notificationStore';

export type AppToastVariant = LocalNotificationVariant;
type IoniconName = ComponentProps<typeof Ionicons>['name'];

interface AppToastOptions {
  title: string;
  message?: string;
  variant?: AppToastVariant;
  durationMs?: number;
  notificationId?: string;
  persistToNotificationCenter?: boolean;
}

interface ToastState extends Required<
  Omit<AppToastOptions, 'notificationId' | 'persistToNotificationCenter'>
> {
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
    fill: string;
    icon: IoniconName;
  }
> = {
  success: {
    accent: colors.semantic.success,
    fill: colors.notificationIcon.successFill,
    icon: 'checkmark',
  },
  error: {
    accent: colors.semantic.error,
    fill: colors.notificationIcon.errorFill,
    icon: 'close',
  },
  warning: {
    accent: colors.semantic.warning,
    fill: colors.notificationIcon.warningFill,
    icon: 'warning',
  },
  info: {
    accent: colors.semantic.info,
    fill: colors.notificationIcon.infoFill,
    icon: 'information',
  },
};

const DEFAULT_DURATION_MS = 2400;
const TOAST_DEDUPE_WINDOW_MS = 4000;
const MAX_TOAST_TITLE_CHARS = 36;
const MAX_TOAST_MESSAGE_CHARS = 56;
const TOAST_MAX_WIDTH = 430;

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
    if (options.persistToNotificationCenter !== false) {
      useNotificationStore.getState().addNotification({
        id: options.notificationId ?? `toast-${nextIdRef.current}`,
        title,
        message,
        variant,
      });
    }
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
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const compact = windowWidth < 360 || windowHeight < 680 || fontScale > 1.12;
  const sideInset = compact ? spacing.md : spacing.xl;
  const maxToastWidth = Math.max(0, Math.min(TOAST_MAX_WIDTH, windowWidth - sideInset * 2));
  const topPadding = insets.top + (compact ? spacing.sm : spacing.md);
  const toastWidth = maxToastWidth;
  const textMaxWidth = Math.max(140, toastWidth - (compact ? 82 : 92));

  const dismiss = useCallback(() => {
    if (dismissTimerRef.current != null) {
      clearTimeout(dismissTimerRef.current);
      dismissTimerRef.current = null;
    }

    onDismiss();
  }, [onDismiss]);

  useEffect(() => {
    if (toast == null) return;

    if (dismissTimerRef.current != null) {
      clearTimeout(dismissTimerRef.current);
      dismissTimerRef.current = null;
    }

    dismissTimerRef.current = setTimeout(dismiss, toast.durationMs);

    return () => {
      if (dismissTimerRef.current != null) {
        clearTimeout(dismissTimerRef.current);
        dismissTimerRef.current = null;
      }
    };
  }, [dismiss, toast]);

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
      <Animated.View
        key={toast.id}
        entering={SETTINGS_BACKDROP_ENTERING}
        exiting={SETTINGS_BACKDROP_EXITING}
        style={[styles.toastWrap, { width: toastWidth }]}
      >
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
          <View style={[styles.toastSurface, compact ? styles.toastSurfaceCompact : null]}>
            <View
              style={[
                styles.toastIcon,
                compact ? styles.toastIconCompact : null,
                { backgroundColor: toastMeta.fill },
              ]}
            >
              <Ionicons name={toastMeta.icon} size={compact ? 16 : 18} color={toastMeta.accent} />
            </View>
            <View style={[styles.toastText, { maxWidth: textMaxWidth }]}>
              <Text
                variant="bodyBold"
                color={colors.text.primary}
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
            </View>
          </View>
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
    minHeight: 68,
    borderRadius: radii.xl,
    borderCurve: 'continuous',
    overflow: 'hidden',
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rim,
    backgroundColor: colors.surface.cardElevated,
    padding: 0,
    boxShadow: `0 18px 42px rgba(0, 0, 0, 0.42), inset 0 1px 0 rgba(255, 255, 255, 0.14)`,
  },
  toastSurface: {
    flex: 1,
    width: '100%',
    minHeight: 68,
    borderRadius: radii.xl,
    borderCurve: 'continuous',
    backgroundColor: colors.surface.cardElevated,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: spacing.sm,
  },
  toastCompact: {
    minHeight: 62,
  },
  toastSurfaceCompact: {
    minHeight: 62,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  toastPressed: {
    opacity: 0.84,
  },
  toastIcon: {
    width: 34,
    height: 34,
    borderRadius: radii.full,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  toastIconCompact: {
    width: 30,
    height: 30,
  },
  toastText: {
    alignItems: 'flex-start',
    justifyContent: 'center',
    minWidth: 0,
    gap: 2,
    flex: 1,
  },
  toastTitle: {
    fontFamily: fontFamily.uiSemiBold,
    letterSpacing: 0,
    textAlign: 'left',
    lineHeight: 20,
  },
  toastMessage: {
    fontFamily: fontFamily.ui,
    lineHeight: 17,
    letterSpacing: 0,
    textAlign: 'left',
  },
});
