import Ionicons from '@expo/vector-icons/Ionicons';
import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { RwaAssetRow } from '@/components/features/rwa/RwaAssetRow';
import { type RwaTradeSide } from '@/components/features/rwa/rwa-trade-utils';
import { Text } from '@/components/ui/Text';
import { colors } from '@/constants/colors';
import { radii, spacing } from '@/constants/spacing';
import { fontFamily } from '@/constants/typography';

import type { RwaAsset } from '@/types/offpay-api';

export type RwaAssetCatalogContentState =
  | 'loading'
  | 'error'
  | 'unavailable'
  | 'empty'
  | 'ready';

interface RwaAssetCatalogProps {
  assetSearchInput: string;
  assetsCapabilityMessage: string;
  contentState: RwaAssetCatalogContentState;
  dense: boolean;
  errorMessage: string;
  filteredAssets: RwaAsset[];
  getBuyPending: (asset: RwaAsset) => boolean;
  getSellPending: (asset: RwaAsset) => boolean;
  getStartTradeDisabledReason: (asset: RwaAsset, side: RwaTradeSide) => string | null;
  onAssetSearchInputChange: (value: string) => void;
  onBuyAsset: (asset: RwaAsset) => void;
  onClearAssetSearch: () => void;
  onSellAsset: (asset: RwaAsset) => void;
}

export function RwaAssetCatalog({
  assetSearchInput,
  assetsCapabilityMessage,
  contentState,
  dense,
  errorMessage,
  filteredAssets,
  getBuyPending,
  getSellPending,
  getStartTradeDisabledReason,
  onAssetSearchInputChange,
  onBuyAsset,
  onClearAssetSearch,
  onSellAsset,
}: RwaAssetCatalogProps): React.JSX.Element {
  if (contentState === 'loading') {
    return (
      <View style={styles.statePanel}>
        <ActivityIndicator color={colors.text.primary} />
        <Text variant="caption" color={colors.text.secondary}>
          Loading RWA assets
        </Text>
      </View>
    );
  }

  if (contentState === 'error') {
    return (
      <View style={styles.statePanel}>
        <Ionicons name="warning-outline" size={22} color={colors.semantic.error} />
        <Text variant="body" color={colors.text.primary} align="center">
          RWA assets are unavailable
        </Text>
        <Text variant="caption" color={colors.text.secondary} align="center">
          {errorMessage}
        </Text>
      </View>
    );
  }

  if (contentState === 'unavailable') {
    return (
      <View style={styles.statePanel}>
        <Ionicons name="lock-closed-outline" size={22} color={colors.text.secondary} />
        <Text variant="body" color={colors.text.primary} align="center">
          {assetsCapabilityMessage}
        </Text>
      </View>
    );
  }

  if (contentState === 'empty') {
    return (
      <View style={styles.statePanel}>
        <Ionicons name="albums-outline" size={22} color={colors.text.secondary} />
        <Text variant="body" color={colors.text.primary} align="center">
          No RWA assets on this network
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.assetPickerPanel}>
      <View style={styles.assetSearchShell}>
        <Ionicons name="search-outline" size={18} color={colors.text.tertiary} />
        <TextInput
          value={assetSearchInput}
          onChangeText={onAssetSearchInputChange}
          placeholder="Search RWAs"
          placeholderTextColor={colors.text.placeholder}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          style={styles.assetSearchInput}
          selectionColor={colors.brand.glossAccent}
        />
        {assetSearchInput.trim().length > 0 ? (
          <Pressable
            onPress={onClearAssetSearch}
            style={({ pressed }) => [
              styles.assetSearchClearButton,
              pressed ? styles.actionButtonPressed : null,
            ]}
            accessibilityRole="button"
            accessibilityLabel="Clear RWA asset search"
          >
            <Ionicons name="close" size={16} color={colors.text.secondary} />
          </Pressable>
        ) : null}
      </View>

      {filteredAssets.length === 0 ? (
        <View style={styles.emptyFilterPanel}>
          <Text variant="caption" color={colors.text.secondary} align="center">
            No matching RWA assets
          </Text>
        </View>
      ) : (
        <View style={styles.assetList}>
          {filteredAssets.map((asset) => (
            <RwaAssetRow
              key={asset.id}
              asset={asset}
              dense={dense}
              buyDisabledReason={getStartTradeDisabledReason(asset, 'buy')}
              sellDisabledReason={getStartTradeDisabledReason(asset, 'sell')}
              isBuyPending={getBuyPending(asset)}
              isSellPending={getSellPending(asset)}
              onBuy={onBuyAsset}
              onSell={onSellAsset}
            />
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  statePanel: {
    minHeight: 180,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    padding: spacing.xl,
    borderRadius: radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rimSubtle,
    backgroundColor: colors.glass.clearFill,
  },
  assetPickerPanel: {
    gap: spacing.md,
  },
  assetSearchShell: {
    minHeight: 50,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rimSubtle,
    backgroundColor: colors.glass.clearFill,
  },
  assetSearchInput: {
    minWidth: 0,
    flex: 1,
    color: colors.text.primary,
    fontFamily: fontFamily.ui,
    fontSize: 16,
    paddingVertical: 0,
  },
  assetSearchClearButton: {
    width: 30,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 15,
    backgroundColor: colors.glass.smokeWash,
  },
  actionButtonPressed: {
    backgroundColor: colors.surface.glossPressed,
  },
  emptyFilterPanel: {
    minHeight: 86,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rimSubtle,
    backgroundColor: colors.glass.clearFill,
  },
  assetList: {
    gap: spacing.md,
  },
});
