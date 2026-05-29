import { useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';

import { WalletAvatar } from '@/components/features/settings/WalletAvatar';
import { Text } from '@/components/ui/Text';
import { colors } from '@/constants/colors';
import { spacing } from '@/constants/spacing';

import type { OfflineBleDiscoveredReceiver } from '@/lib/offline/offline-ble-transport';

const MAX_ORBIT_ITEMS = 10;
const PLACEMENT_SLOTS = [
  { x: 0.56, y: 0.2 },
  { x: 0.24, y: 0.34 },
  { x: 0.78, y: 0.36 },
  { x: 0.38, y: 0.52 },
  { x: 0.68, y: 0.58 },
  { x: 0.2, y: 0.68 },
  { x: 0.52, y: 0.78 },
  { x: 0.82, y: 0.72 },
  { x: 0.34, y: 0.22 },
  { x: 0.72, y: 0.22 },
] as const;

interface WalletPlacement {
  receiver: OfflineBleDiscoveredReceiver;
  centerX: number;
  centerY: number;
}

interface NearbyWalletOrbitProps {
  size: number;
  blobSize: number;
  bubbleSize: number;
  receivers: OfflineBleDiscoveredReceiver[];
  selectedWalletAddress?: string | null;
  onSelect: (receiver: OfflineBleDiscoveredReceiver) => void;
}

function hashString(value: string): number {
  let hash = 2166136261;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

function unitHash(value: string): number {
  return hashString(value) / 0xffffffff;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function getPlacementKey(receiver: OfflineBleDiscoveredReceiver): string {
  return receiver.walletAddress || receiver.id || receiver.displayName;
}

function buildPlacements(params: {
  receivers: OfflineBleDiscoveredReceiver[];
  size: number;
  bubbleSize: number;
  avatarSize: number;
  labelHeight: number;
}): WalletPlacement[] {
  const footprintHeight = params.avatarSize + params.labelHeight + spacing.xs;
  const safeInsetX = params.bubbleSize / 2 + spacing.xs;
  const safeInsetY = footprintHeight / 2 + spacing.xs;
  const minDistance = Math.max(params.bubbleSize * 0.92, params.avatarSize + spacing['2xl']);
  const jitter = Math.max(5, Math.min(18, params.size * 0.035));
  const placed: WalletPlacement[] = [];

  for (const receiver of params.receivers) {
    const placementKey = getPlacementKey(receiver);
    const rankedSlots = PLACEMENT_SLOTS
      .map((slot, slotIndex) => ({
        slot,
        slotIndex,
        score: unitHash(`${placementKey}:${slotIndex}:slot`),
      }))
      .sort((left, right) => left.score - right.score);

    let chosen = rankedSlots[0]!;
    for (const candidate of rankedSlots) {
      const candidateX = candidate.slot.x * params.size;
      const candidateY = candidate.slot.y * params.size;
      const overlaps = placed.some((placement) => {
        const deltaX = candidateX - placement.centerX;
        const deltaY = candidateY - placement.centerY;
        return Math.hypot(deltaX, deltaY) < minDistance;
      });

      if (!overlaps) {
        chosen = candidate;
        break;
      }
    }

    const jitterX = (unitHash(`${placementKey}:x`) - 0.5) * jitter;
    const jitterY = (unitHash(`${placementKey}:y`) - 0.5) * jitter;
    placed.push({
      receiver,
      centerX: clamp(chosen.slot.x * params.size + jitterX, safeInsetX, params.size - safeInsetX),
      centerY: clamp(chosen.slot.y * params.size + jitterY, safeInsetY, params.size - safeInsetY),
    });
  }

  return placed;
}

export function NearbyWalletOrbit({
  size,
  blobSize,
  bubbleSize,
  receivers,
  selectedWalletAddress,
  onSelect,
}: NearbyWalletOrbitProps): React.JSX.Element {
  const displayedReceivers = receivers.slice(0, MAX_ORBIT_ITEMS);
  const avatarSize = Math.max(42, Math.min(52, bubbleSize * 0.62));
  const labelHeight = 16;
  const placements = useMemo(
    () =>
      buildPlacements({
        receivers: displayedReceivers,
        size,
        bubbleSize,
        avatarSize,
        labelHeight,
      }),
    [avatarSize, bubbleSize, displayedReceivers, labelHeight, size],
  );

  return (
    <View pointerEvents="box-none" style={[styles.shell, { width: size, height: size }]}>
      <View
        pointerEvents="none"
        style={[
          styles.blobGuard,
          {
            width: blobSize,
            height: blobSize,
            borderRadius: blobSize / 2,
            left: (size - blobSize) / 2,
            top: (size - blobSize) / 2,
          },
        ]}
      />
      {placements.map(({ receiver, centerX, centerY }) => {
        const labelAboveAvatar = centerY > size * 0.62;
        const left = centerX - bubbleSize / 2;
        const top = centerY - avatarSize / 2 - (labelAboveAvatar ? labelHeight + spacing.xs : 0);
        const displayLabel = receiver.username != null ? `@${receiver.username}` : receiver.displayName;
        const selected = selectedWalletAddress === receiver.walletAddress;
        const avatar = <WalletAvatar size={selected ? avatarSize * 1.06 : avatarSize} solidFill />;
        const label = (
          <Text variant="small" color={colors.text.primary} numberOfLines={1} style={styles.name}>
            {displayLabel}
          </Text>
        );

        return (
          <Animated.View
            key={receiver.walletAddress}
            entering={FadeIn.duration(180)}
            exiting={FadeOut.duration(120)}
            style={[
              styles.walletBubble,
              {
                width: bubbleSize,
                left,
                top,
              },
            ]}
          >
            <Pressable
              style={({ pressed }) => [styles.walletButton, { width: bubbleSize }, pressed && styles.pressed]}
              onPress={() => onSelect(receiver)}
              accessibilityRole="button"
              accessibilityLabel={`Select ${displayLabel}`}
              accessibilityState={{ selected }}
            >
              {labelAboveAvatar ? label : avatar}
              {labelAboveAvatar ? avatar : label}
            </Pressable>
          </Animated.View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  shell: {
    position: 'absolute',
  },
  blobGuard: {
    position: 'absolute',
    borderColor: 'rgba(176, 239, 255, 0.16)',
    borderWidth: StyleSheet.hairlineWidth,
  },
  walletBubble: {
    position: 'absolute',
  },
  walletButton: {
    alignItems: 'center',
    gap: spacing.xs,
  },
  name: {
    width: '100%',
    textAlign: 'center',
    fontSize: 12,
    lineHeight: 16,
  },
  pressed: {
    opacity: 0.72,
  },
});
