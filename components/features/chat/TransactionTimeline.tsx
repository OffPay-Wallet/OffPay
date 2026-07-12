/**
 * TransactionTimeline — a vertical "flight path" progress timeline shown on
 * agentic transaction cards (AI chat only) once the user approves (or rejects)
 * a draft.
 *
 * The rail is a dashed flight trail whose green segment fills forward as the
 * real action status advances (Approved -> Confirmed). The stage
 * still in progress shows the paper-plane glyph (from the supplied
 * Arrow/QuiverAI SVG) moving forward along the rail to the active node.
 * Cleared stages flip their empty circle into a green tick; failure/rejection
 * flips the terminal node into a red cross — both with a spring ZoomIn.
 *
 * Flow: after approval the plane moves slowly between the two nodes. A real
 * backend confirmation completes the final smooth arrival before the node
 * ticks green.
 *
 * All motion runs on the Reanimated UI thread (shared values + transforms,
 * plus a lightweight ZoomIn on the tick) and honours reduced motion.
 * This component is intentionally scoped to the chat confirmation cards.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import Svg, { Path } from 'react-native-svg';
import Animated, {
  Easing,
  ZoomIn,
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { Text } from '@/components/ui/Text';
import { colors } from '@/constants/colors';
import { spacing } from '@/constants/spacing';
import { fontFamily } from '@/constants/typography';

import type { AgenticActionStatus } from '@/store/agenticChatStore';

type TimelineNodeState = 'pending' | 'active' | 'done' | 'success' | 'error';

interface TimelineStepModel {
  key: string;
  title: string;
  subtitle?: string | null;
  state: TimelineNodeState;
  /** The step under which the tx link / queue id payload is shown. */
  hostsResult?: boolean;
}

interface TimelineModel {
  steps: TimelineStepModel[];
  /** How far the green trail has filled, in node-index units. */
  frontier: number;
  /** True on failure/rejection (progress trail turns red). */
  failed: boolean;
}

interface TransactionTimelineProps {
  status: AgenticActionStatus;
  /** Human noun used in subtitles, e.g. "transfer", "swap", "trade". */
  noun?: string;
  /**
   * Live tx signature. When present while `submitting`, the final stage label
   * changes from broadcasting to confirming.
   */
  signature?: string | null;
  /** Live failure reason surfaced on the terminal node when the txn fails. */
  errorMessage?: string | null;
  /** Live success payload (Solscan link / queue id) shown under the final node. */
  resultContent?: React.ReactNode;
}

// --- Geometry -------------------------------------------------------------
const RAIL_W = 34;
const ROW_H = 58;
const ROW_PAD_TOP = 6;
// captionBold line-height is 20, so a title's visual centre sits 10px down.
const TITLE_CENTER = 10;
const NODE = 24;
const NODE_R = NODE / 2;
const PLANE = 13;
const CENTER_X = RAIL_W / 2;
const TOP_Y = ROW_PAD_TOP + TITLE_CENTER;

// --- Motion ---------------------------------------------------------------
const MOVE_MS = 240;
const DEPART_TARGET = 0.18;
const DEPART_MS = 480;
const CONFIRMING_TARGET = 0.92;
const CONFIRMING_MOVE_MS = 40_000;
const CONFIRMED_MOVE_MS = 1_200;
const TICK_ENTER = ZoomIn.springify().damping(13).stiffness(210).mass(0.6);

function nodeCenterY(index: number): number {
  return TOP_Y + ROW_H * index;
}

/**
 * True once the user has acted on the draft — i.e. the timeline should be
 * visible instead of the plain confirm/cancel controls.
 */
export function hasTransactionStarted(status: AgenticActionStatus): boolean {
  return status !== 'needs_confirmation';
}

export function deriveTimeline(
  status: AgenticActionStatus,
  hasSignature: boolean,
  noun: string,
  errorMessage: string | null | undefined,
): TimelineModel {
  switch (status) {
    case 'submitting':
      return {
        steps: [
          { key: 'approve', title: 'Approved', subtitle: 'You confirmed', state: 'done' },
          {
            key: 'settle',
            title: 'Confirmation',
            subtitle: hasSignature ? 'Finalizing on-chain' : 'Waiting for the network',
            state: 'active',
            hostsResult: true,
          },
        ],
        frontier: 1,
        failed: false,
      };
    case 'submitted':
      return {
        steps: [
          { key: 'approve', title: 'Approved', state: 'done' },
          {
            key: 'settle',
            title: 'Confirmed',
            subtitle: `Your ${noun} is on its way`,
            state: 'success',
            hostsResult: true,
          },
        ],
        frontier: 1,
        failed: false,
      };
    case 'queued':
      return {
        steps: [
          { key: 'approve', title: 'Approved', state: 'done' },
          {
            key: 'settle',
            title: 'Queued',
            subtitle: 'Saved for automatic retry',
            state: 'success',
            hostsResult: true,
          },
        ],
        frontier: 1,
        failed: false,
      };
    case 'failed':
      return {
        steps: [
          { key: 'approve', title: 'Approved', state: 'done' },
          {
            key: 'settle',
            title: 'Failed',
            subtitle: errorMessage ?? `Could not complete the ${noun}`,
            state: 'error',
          },
        ],
        frontier: 1,
        failed: true,
      };
    case 'cancelled':
      return {
        steps: [
          {
            key: 'approve',
            title: 'Rejected',
            subtitle: `You cancelled the ${noun}`,
            state: 'error',
          },
          { key: 'settle', title: 'Confirmation', state: 'pending' },
        ],
        frontier: 0,
        failed: true,
      };
    default:
      return { steps: [], frontier: 0, failed: false };
  }
}

export function derivePlaneMotion(
  status: AgenticActionStatus,
): { target: number; duration: number; completesSuccess: boolean } {
  if (status === 'submitting') {
    return { target: CONFIRMING_TARGET, duration: CONFIRMING_MOVE_MS, completesSuccess: false };
  }
  if (status === 'submitted') {
    return { target: 1, duration: CONFIRMED_MOVE_MS, completesSuccess: true };
  }
  if (status === 'queued' || status === 'failed') {
    return { target: 1, duration: MOVE_MS, completesSuccess: false };
  }
  return { target: 0, duration: MOVE_MS, completesSuccess: false };
}

function titleColor(state: TimelineNodeState): string {
  if (state === 'success') return colors.semantic.receive;
  if (state === 'error') return colors.semantic.error;
  if (state === 'pending') return colors.text.tertiary;
  return colors.text.primary;
}

/** Paper-plane glyph extracted from the supplied Arrow/QuiverAI SVG. */
function PlaneGlyph({ size, color }: { size: number; color: string }): React.JSX.Element {
  return (
    <Svg width={size} height={size} viewBox="48.8 53.6 14 14">
      <Path
        d="m56.7 57.3v-2.9c0-2.4-1.6-3.5-2.1-0.2v3.2l-5.3 3.6v1.5l5.5-1.8 0.1 3.7-1.7 1.4v1.2l2.7-0.9 2.6 0.9v-1.2l-1.7-1.3 0.1-3.8 5.5 1.8v-1.5l-5.5-3.7h-0.2z"
        fill={color}
      />
    </Svg>
  );
}

/**
 * Milestone node. Cleared stages show a green tick (red cross on failure) that
 * zooms in; the in-progress stage shows an accent ring while the shared plane
 * moves to it; upcoming stages show a dim hollow ring.
 */
function TimelineNode({
  state,
  reduceMotion,
}: {
  state: TimelineNodeState;
  reduceMotion: boolean;
}): React.JSX.Element {
  if (state === 'done' || state === 'success' || state === 'error') {
    const isError = state === 'error';
    return (
      <View style={styles.node}>
        <Animated.View
          entering={reduceMotion ? undefined : TICK_ENTER}
          style={[
            styles.filledDisc,
            { backgroundColor: isError ? colors.semantic.error : colors.semantic.receive },
          ]}
        >
          <Ionicons
            name={isError ? 'close' : 'checkmark'}
            size={15}
            color={isError ? colors.brand.whiteStream : colors.brand.deepShadow}
          />
        </Animated.View>
      </View>
    );
  }

  if (state === 'active') {
    return (
      <View style={styles.node}>
        <View style={styles.activeRing} />
      </View>
    );
  }

  return (
    <View style={styles.node}>
      <View style={styles.pendingRing} />
    </View>
  );
}

export function TransactionTimeline({
  status,
  noun = 'transaction',
  signature,
  errorMessage,
  resultContent,
}: TransactionTimelineProps): React.JSX.Element | null {
  const reduceMotion = useReducedMotion();
  const hasSignature = signature != null && signature.length > 0;
  const [successArrived, setSuccessArrived] = useState(false);
  const successArrivalPending = status === 'submitted' && !successArrived && !reduceMotion;
  const displayStatus = successArrivalPending ? 'submitting' : status;
  const model = useMemo(
    () => deriveTimeline(displayStatus, hasSignature, noun, errorMessage),
    [displayStatus, hasSignature, noun, errorMessage],
  );
  const { steps, failed } = model;

  const trail = useSharedValue(0);

  useEffect(() => {
    if (status !== 'submitted') setSuccessArrived(false);
  }, [status]);

  useEffect(() => {
    const motion = derivePlaneMotion(status);
    if (reduceMotion) {
      trail.value = motion.target;
      return;
    }

    if (status === 'submitting') {
      trail.value = withSequence(
        withTiming(DEPART_TARGET, { duration: DEPART_MS, easing: Easing.out(Easing.cubic) }),
        withTiming(motion.target, { duration: motion.duration, easing: Easing.linear }),
      );
      return;
    }

    trail.value = withTiming(
      motion.target,
      {
        duration: motion.duration,
        easing:
          motion.completesSuccess
            ? Easing.inOut(Easing.cubic)
            : motion.target <= 0
              ? Easing.in(Easing.cubic)
            : Easing.linear,
      },
      (finished) => {
        if (finished && motion.completesSuccess) {
          runOnJS(setSuccessArrived)(true);
        }
      },
    );
  }, [reduceMotion, status, trail]);

  const trailStyle = useAnimatedStyle(() => ({
    height: Math.max(0, trail.value * ROW_H),
  }));
  const planeStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: trail.value * ROW_H }, { rotate: '180deg' }],
  }));

  if (steps.length === 0) return null;

  const railHeight = ROW_PAD_TOP + steps.length * ROW_H;
  const trailFullHeight = (steps.length - 1) * ROW_H;

  return (
    <Animated.View style={styles.container} accessibilityRole="progressbar">
      {/* Left rail: dashed flight trail, animated progress trail, nodes. */}
      <View style={[styles.rail, { height: railHeight }]}>
        <View
          style={[styles.trailBase, { top: TOP_Y, height: trailFullHeight }]}
          pointerEvents="none"
        />

        <Animated.View
          pointerEvents="none"
          style={[
            styles.trailProgress,
            { top: TOP_Y, backgroundColor: failed ? colors.semantic.error : colors.semantic.receive },
            trailStyle,
          ]}
        />

        {steps.map((step, index) => (
          <View key={step.key} style={[styles.nodeSlot, { top: nodeCenterY(index) - NODE_R }]}>
            <TimelineNode state={step.state} reduceMotion={reduceMotion} />
          </View>
        ))}

        {steps.some((step) => step.state === 'active') ? (
          <Animated.View pointerEvents="none" style={[styles.planeMarker, planeStyle]}>
            <PlaneGlyph size={PLANE} color={colors.text.primary} />
          </Animated.View>
        ) : null}
      </View>

      {/* Right column: milestone labels aligned to each node row. */}
      <View style={styles.labels}>
        {steps.map((step, index) => {
          const isLast = index === steps.length - 1;
          return (
            <View key={step.key} style={[styles.labelRow, isLast ? styles.labelRowLast : null]}>
              <Animated.View
                key={`${step.key}-${step.state}`}
                entering={reduceMotion ? undefined : ZoomIn.duration(220)}
              >
                <Text
                  variant="captionBold"
                  color={titleColor(step.state)}
                  style={styles.stepTitle}
                  numberOfLines={1}
                  maxFontSizeMultiplier={1.2}
                >
                  {step.title}
                </Text>
                {step.subtitle != null && step.subtitle.length > 0 ? (
                  <Text
                    variant="small"
                    color={step.state === 'error' ? colors.semantic.error : colors.text.secondary}
                    style={styles.stepSubtitle}
                    numberOfLines={2}
                    maxFontSizeMultiplier={1.2}
                  >
                    {step.subtitle}
                  </Text>
                ) : null}
              </Animated.View>

              {step.hostsResult === true && resultContent != null ? (
                <View style={styles.resultWrap}>{resultContent}</View>
              ) : null}
            </View>
          );
        })}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    flexDirection: 'row',
  },
  rail: {
    width: RAIL_W,
    position: 'relative',
  },
  trailBase: {
    position: 'absolute',
    left: CENTER_X - 0.5,
    width: 1,
    borderLeftWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.border.default,
    opacity: 0.7,
  },
  trailProgress: {
    position: 'absolute',
    left: CENTER_X - 1,
    width: 2,
    borderRadius: 1,
  },
  nodeSlot: {
    position: 'absolute',
    left: CENTER_X - NODE_R,
    width: NODE,
    height: NODE,
  },
  planeMarker: {
    position: 'absolute',
    top: TOP_Y - NODE_R,
    left: CENTER_X - NODE_R,
    width: NODE,
    height: NODE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  node: {
    width: NODE,
    height: NODE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pendingRing: {
    width: 15,
    height: 15,
    borderRadius: 7.5,
    borderWidth: 1.5,
    borderColor: colors.text.tertiary,
    backgroundColor: 'transparent',
  },
  activeRing: {
    width: NODE,
    height: NODE,
    borderRadius: NODE_R,
    borderWidth: 1.5,
    borderColor: colors.semantic.receive,
    backgroundColor: colors.surface.solidCardElevated,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filledDisc: {
    width: NODE,
    height: NODE,
    borderRadius: NODE_R,
    alignItems: 'center',
    justifyContent: 'center',
  },
  labels: {
    flex: 1,
    marginLeft: spacing.md,
    paddingTop: ROW_PAD_TOP,
  },
  labelRow: {
    height: ROW_H,
    justifyContent: 'flex-start',
  },
  labelRowLast: {
    height: undefined,
    minHeight: ROW_H,
    paddingBottom: spacing.xs,
  },
  stepTitle: {
    fontFamily: fontFamily.uiSemiBold,
  },
  stepSubtitle: {
    marginTop: 1,
  },
  resultWrap: {
    marginTop: spacing.sm,
  },
});
