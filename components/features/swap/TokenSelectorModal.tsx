import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  StyleSheet,
  TouchableWithoutFeedback,
  Dimensions,
  Pressable,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  FlatList,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  Easing,
  runOnJS,
} from 'react-native-reanimated';

import { TokenIcon } from '@/components/ui/TokenIcon';
import { ModalBackdropScrim } from '@/components/ui/ModalBackdropScrim';
import { Text } from '@/components/ui/Text';
import { colors } from '@/constants/colors';
import { layout, radii, spacing } from '@/constants/spacing';
import { fontFamily } from '@/constants/typography';
import { SWAP_CONTROL_SHADOW, SWAP_GLASS_COLORS, SWAP_PANEL_SHADOW } from './swapGlass';

import type { SwapTokenOption } from './types';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');
const TOKEN_ROW_HEIGHT = layout.avatarLg + spacing.lg;

interface TokenSelectorModalProps {
  visible: boolean;
  tokens: SwapTokenOption[];
  onClose: () => void;
  onSelect: (token: SwapTokenOption) => void;
}

function parseTokenBalanceValue(token: SwapTokenOption): number {
  const parsed = Number.parseFloat(token.balanceValue.replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function compareTokenSelectorRows(left: SwapTokenOption, right: SwapTokenOption): number {
  const leftBalance = parseTokenBalanceValue(left);
  const rightBalance = parseTokenBalanceValue(right);
  const leftHasBalance = leftBalance > 0;
  const rightHasBalance = rightBalance > 0;

  if (leftHasBalance !== rightHasBalance) return leftHasBalance ? -1 : 1;
  if (leftHasBalance && rightHasBalance && leftBalance !== rightBalance) {
    return rightBalance - leftBalance;
  }
  if (left.verified !== right.verified) return left.verified ? -1 : 1;

  return left.symbol.localeCompare(right.symbol, undefined, { sensitivity: 'base' });
}

export function TokenSelectorModal({
  visible,
  tokens,
  onClose,
  onSelect,
}: TokenSelectorModalProps): React.JSX.Element | null {
  const insets = useSafeAreaInsets();
  const [mounted, setMounted] = useState(visible);
  const [searchQuery, setSearchQuery] = useState('');
  const translateY = useSharedValue(-SCREEN_HEIGHT);
  const opacity = useSharedValue(0);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      opacity.value = withTiming(1, { duration: 300 });
      translateY.value = withTiming(0, {
        duration: 350,
        easing: Easing.out(Easing.poly(3)),
      });
    } else {
      translateY.value = withTiming(-SCREEN_HEIGHT, {
        duration: 250,
        easing: Easing.in(Easing.ease),
      });
      opacity.value = withTiming(0, { duration: 250 }, (finished) => {
        if (finished) runOnJS(setMounted)(false);
      });
      setTimeout(() => setSearchQuery(''), 300);
    }
  }, [visible, opacity, translateY]);

  const filteredTokens = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    const matchedTokens =
      query.length === 0
        ? tokens
        : tokens.filter((token) => {
            return (
              token.name.toLowerCase().includes(query) ||
              token.symbol.toLowerCase().includes(query) ||
              token.mint?.toLowerCase().includes(query)
            );
          });

    return [...matchedTokens].sort(compareTokenSelectorRows);
  }, [searchQuery, tokens]);

  const keyExtractor = useCallback((token: SwapTokenOption, index: number): string => {
    return token.mint ?? `${token.symbol}-${token.name}-${index}`;
  }, []);

  const handleClose = () => {
    translateY.value = withTiming(
      -SCREEN_HEIGHT,
      { duration: 250, easing: Easing.in(Easing.ease) },
      () => {
        runOnJS(onClose)();
      },
    );
    opacity.value = withTiming(0, { duration: 250 });
  };

  const handleSelect = useCallback((token: SwapTokenOption) => {
    onSelect(token);
    onClose();
  }, [onClose, onSelect]);

  const renderTokenRow = useCallback(
    ({ item: token }: { item: SwapTokenOption }) => (
      <Pressable
        style={({ pressed }) => [styles.tokenRow, pressed && styles.tokenRowPressed]}
        onPress={() => handleSelect(token)}
        accessibilityRole="button"
        accessibilityLabel={`Select ${token.symbol}`}
      >
        <View style={styles.tokenRowLeft}>
          <TokenIcon
            symbol={token.symbol}
            name={token.name}
            logoUri={token.logo}
            size={layout.buttonHeightSm}
          />
          <View style={styles.tokenText}>
            <View style={styles.symbolRow}>
              <Text
                variant="bodyBold"
                color={colors.text.primary}
                style={styles.tokenSymbol}
                numberOfLines={1}
                ellipsizeMode="tail"
              >
                {token.symbol}
              </Text>
              {token.verified ? (
                <Ionicons
                  name="checkmark-circle"
                  size={layout.iconSizeInline}
                  color={colors.brand.azureCyan}
                />
              ) : null}
            </View>
            <Text
              variant="small"
              color={colors.text.tertiary}
              numberOfLines={1}
              ellipsizeMode="tail"
            >
              {token.name}
            </Text>
          </View>
        </View>
        <Text
          variant="body"
          color={colors.text.primary}
          style={styles.tokenBalance}
          numberOfLines={2}
          ellipsizeMode="tail"
        >
          {token.balanceDisplay}
        </Text>
      </Pressable>
    ),
    [handleSelect],
  );

  const backdropStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
  }));

  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  if (!mounted) return null;

  return (
    <View style={[StyleSheet.absoluteFill, { zIndex: 9999, elevation: 9999 }]}>
      <Animated.View style={[StyleSheet.absoluteFill, backdropStyle]}>
        <ModalBackdropScrim />
        <TouchableWithoutFeedback onPress={handleClose}>
          <View style={StyleSheet.absoluteFill} />
        </TouchableWithoutFeedback>
      </Animated.View>

      <KeyboardAvoidingView
        style={[styles.overlay, { paddingTop: insets.top + spacing.xl }]}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Animated.View style={[styles.sheet, sheetStyle]}>
          <LinearGradient
            colors={[...SWAP_GLASS_COLORS]}
            style={[StyleSheet.absoluteFill, styles.sheetGradient]}
            start={{ x: 0.04, y: 0 }}
            end={{ x: 1, y: 1 }}
          />
          <View style={styles.headerRow}>
            <Text
              variant="h2"
              color={colors.text.primary}
              style={styles.headerTitle}
              numberOfLines={1}
            >
              Select Token
            </Text>
            <Pressable
              style={({ pressed }) => [styles.closeBtn, pressed && styles.controlPressed]}
              onPress={handleClose}
              accessibilityRole="button"
              accessibilityLabel="Close token selector"
            >
              <Ionicons name="close" size={layout.iconSizeNav} color={colors.brand.deepShadow} />
            </Pressable>
          </View>

          <View style={styles.searchBox}>
            <Ionicons name="search" size={layout.iconSizeInline} color={colors.text.secondary} />
            <TextInput
              style={styles.searchInput}
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder="Search ticker, name, or contract"
              placeholderTextColor={colors.text.tertiary}
              selectionColor={colors.brand.azureCyan}
            />
          </View>

          <FlatList
            style={styles.tokenList}
            data={filteredTokens}
            keyExtractor={keyExtractor}
            renderItem={renderTokenRow}
            ItemSeparatorComponent={TokenRowSeparator}
            ListEmptyComponent={TokenListEmptyState}
            contentContainerStyle={styles.tokenListContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            initialNumToRender={12}
            maxToRenderPerBatch={10}
            updateCellsBatchingPeriod={40}
            windowSize={7}
            removeClippedSubviews={Platform.OS === 'android'}
          />
        </Animated.View>
      </KeyboardAvoidingView>
    </View>
  );
}

function TokenRowSeparator(): React.JSX.Element {
  return <View style={styles.tokenSeparator} />;
}

function TokenListEmptyState(): React.JSX.Element {
  return (
    <View style={styles.emptyState}>
      <Text variant="bodyBold" color={colors.text.secondary}>
        No tokens found
      </Text>
      <Text variant="small" color={colors.text.tertiary}>
        Try another ticker, name, or contract.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'flex-start',
    paddingHorizontal: spacing.md,
  },
  sheet: {
    borderRadius: radii['2xl'],
    borderCurve: 'continuous',
    maxHeight: '100%',
    width: '100%',
    maxWidth: 430,
    alignSelf: 'center',
    padding: spacing.xl,
    overflow: 'hidden',
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rim,
    backgroundColor: colors.glass.strongFill,
    boxShadow: SWAP_PANEL_SHADOW,
  },
  sheetGradient: {
    borderRadius: radii['2xl'],
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.lg,
    gap: spacing.md,
  },
  headerTitle: {
    flex: 1,
    minWidth: 0,
    fontFamily: fontFamily.displaySemiBold,
  },
  closeBtn: {
    width: layout.minTouchTarget,
    height: layout.minTouchTarget,
    borderRadius: radii.full,
    borderCurve: 'continuous',
    backgroundColor: colors.glass.strongFill,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rim,
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: SWAP_CONTROL_SHADOW,
  },
  controlPressed: {
    opacity: 0.72,
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.glass.strongFill,
    borderRadius: radii.xl,
    borderCurve: 'continuous',
    paddingHorizontal: spacing.md,
    height: layout.buttonHeightMd,
    marginBottom: spacing.xl,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rimSubtle,
    gap: spacing.sm,
    boxShadow: SWAP_CONTROL_SHADOW,
  },
  searchInput: {
    flex: 1,
    minWidth: 0,
    color: colors.text.primary,
    fontFamily: fontFamily.medium,
    fontSize: 16,
    height: layout.buttonHeightMd,
  },
  tokenList: {
    flexShrink: 1,
  },
  tokenListContent: {
    paddingBottom: spacing.xs,
  },
  tokenRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: spacing.md,
    minHeight: TOKEN_ROW_HEIGHT,
    backgroundColor: colors.glass.strongFill,
    borderRadius: radii.xl,
    borderCurve: 'continuous',
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rimSubtle,
    boxShadow: `0 2px 6px rgba(14, 42, 53, 0.06), inset 0 1px 1px rgba(255, 255, 255, 0.6)`,
  },
  tokenRowPressed: {
    backgroundColor: colors.glass.textBacking,
  },
  tokenSeparator: {
    height: spacing.md,
  },
  tokenRowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    flex: 1,
    minWidth: 0,
  },
  tokenText: {
    flex: 1,
    minWidth: 0,
  },
  symbolRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    minWidth: 0,
  },
  tokenSymbol: {
    minWidth: 0,
    flexShrink: 1,
  },
  tokenBalance: {
    flexShrink: 1,
    minWidth: 0,
    textAlign: 'right',
    marginLeft: spacing.md,
    fontFamily: fontFamily.mono,
    fontVariant: ['tabular-nums'],
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing['2xl'],
    gap: spacing.xs,
  },
});
