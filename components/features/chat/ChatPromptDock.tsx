/**
 * Prompt dock — a rounded chat card with a multiline input on top and an
 * action row beneath (leading "+" on the left; mic + send/voice on the right).
 *
 * Voice: tapping the voice orb starts recording, which morphs the card into an
 * expanded voice card showing a live waveform. After transcription the card
 * shows the recognized text with discard (✕) and send (✓) controls, so the
 * user confirms before anything is sent. The morph uses a layout animation so
 * the expand/collapse is smooth.
 *
 * Upload and voice are optional: pass `onUpload` to show the "+" button and
 * `voice` to enable the mic. When neither is provided the dock is a plain
 * text composer.
 */

import React, { type RefObject } from 'react';
import { type LayoutChangeEvent, Pressable, StyleSheet, TextInput, View } from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  FadeOut,
  LinearTransition,
  useAnimatedStyle,
  useDerivedValue,
  withTiming,
} from 'react-native-reanimated';
import Ionicons from '@expo/vector-icons/Ionicons';

import { LazyLoadingSpinner } from '@/components/ui/lazy-loading-spinner';
import { colors } from '@/constants/colors';
import { spacing } from '@/constants/spacing';
import { Text } from '@/components/ui/Text';

import { AiLoaderLottie } from './AiLoaderLottie';
import { VoiceWaveform } from './VoiceWaveform';
import { PROMPT_ICON_SIZE } from './constants';
import { promptStyles as styles } from './styles/prompt';

const VOICE_CARD_EASE = Easing.inOut(Easing.ease);
const VOICE_CARD_TRANSITION_MS = 260;
const VOICE_CARD_LAYOUT_TRANSITION =
  LinearTransition.duration(VOICE_CARD_TRANSITION_MS).easing(VOICE_CARD_EASE);
const VOICE_CARD_ENTERING = FadeIn.duration(240)
  .easing(VOICE_CARD_EASE)
  .withInitialValues({
    opacity: 0,
    transform: [
      { translateX: PROMPT_ICON_SIZE * 0.35 },
      { translateY: PROMPT_ICON_SIZE * 0.35 },
      { scale: 0.98 },
    ],
  });
const VOICE_CARD_EXITING = FadeOut.duration(180).easing(VOICE_CARD_EASE);
const COMPOSER_CARD_ENTERING = FadeIn.duration(180).easing(VOICE_CARD_EASE);
const COMPOSER_CARD_EXITING = FadeOut.duration(160).easing(VOICE_CARD_EASE);
const KEYBOARD_DOCK_TIMING = {
  duration: 220,
  easing: Easing.out(Easing.cubic),
} as const;

export type ChatVoiceState = 'idle' | 'recording' | 'transcribing' | 'review';

interface ChatVoiceControl {
  state: ChatVoiceState;
  /** Transcript awaiting review (review state only). */
  transcript: string;
  /** Normalized 0..1 input level for the waveform (recording state). */
  level: number;
  /** Start recording (idle) / stop + transcribe (recording). */
  onPress: () => void;
  /** Send the reviewed transcript (review state). */
  onAccept: () => void;
  /** Discard the recording/transcript and collapse the card. */
  onCancel: () => void;
}

interface ChatSpeechControl {
  state: 'idle' | 'loading' | 'speaking';
  muted: boolean;
  onStop: () => void;
  onToggleMuted: () => void;
}

interface ChatPromptDockProps {
  inputRef: RefObject<TextInput | null>;
  prompt: string;
  busy: boolean;
  canSubmit: boolean;
  bottomInset: number;
  keyboardOffset?: number;
  horizontalPadding: number;
  onLayout?: (event: LayoutChangeEvent) => void;
  onChangeText: (next: string) => void;
  onSubmit: () => void;
  /** Optional batch-send/file upload affordance ("+" button). */
  onUpload?: () => void;
  /** Optional long-press on upload (e.g. open paste sheet). */
  onUploadLongPress?: () => void;
  onPastePayroll?: () => void;
  uploadBusy?: boolean;
  /** Optional voice control. Omit to hide the mic. */
  voice?: ChatVoiceControl;
  /** Optional spoken-output control. Omit to hide the speaker toggle. */
  speech?: ChatSpeechControl;
  placeholder?: string;
}

function speechIconName(speech: ChatSpeechControl): keyof typeof Ionicons.glyphMap {
  if (speech.state !== 'idle') return 'stop-circle';
  return speech.muted ? 'volume-mute-outline' : 'volume-high-outline';
}

export function ChatPromptDock({
  inputRef,
  prompt,
  busy,
  canSubmit,
  bottomInset,
  keyboardOffset = 0,
  horizontalPadding,
  onLayout,
  onChangeText,
  onSubmit,
  onUpload,
  onUploadLongPress,
  onPastePayroll,
  uploadBusy = false,
  voice,
  speech,
  placeholder = 'Chat with Yuga',
}: ChatPromptDockProps): React.JSX.Element {
  const voiceCardActive =
    voice != null && (voice.state === 'recording' || voice.state === 'review');
  const keyboardShift = useDerivedValue(
    () => withTiming(keyboardOffset, KEYBOARD_DOCK_TIMING),
    [keyboardOffset],
  );

  const dockStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: -keyboardShift.value }],
  }));

  return (
    <Animated.View
      onLayout={onLayout}
      pointerEvents="box-none"
      style={[
        styles.promptDock,
        {
          bottom: 0,
          paddingHorizontal: horizontalPadding,
          paddingBottom: Math.max(bottomInset, spacing.lg),
        },
        dockStyle,
      ]}
    >
      <Animated.View layout={VOICE_CARD_LAYOUT_TRANSITION}>
        {voiceCardActive && voice != null ? (
          <VoiceCard voice={voice} />
        ) : (
          <Animated.View entering={COMPOSER_CARD_ENTERING} exiting={COMPOSER_CARD_EXITING}>
            <ComposerCard
              inputRef={inputRef}
              prompt={prompt}
              busy={busy}
              canSubmit={canSubmit}
              placeholder={placeholder}
              onChangeText={onChangeText}
              onSubmit={onSubmit}
              onUpload={onUpload}
              onUploadLongPress={onUploadLongPress}
              onPastePayroll={onPastePayroll}
              uploadBusy={uploadBusy}
              voice={voice}
              speech={speech}
            />
          </Animated.View>
        )}
      </Animated.View>
    </Animated.View>
  );
}

interface ComposerCardProps {
  inputRef: RefObject<TextInput | null>;
  prompt: string;
  busy: boolean;
  canSubmit: boolean;
  placeholder: string;
  onChangeText: (next: string) => void;
  onSubmit: () => void;
  onUpload?: () => void;
  onUploadLongPress?: () => void;
  onPastePayroll?: () => void;
  uploadBusy: boolean;
  voice?: ChatVoiceControl;
  speech?: ChatSpeechControl;
}

function ComposerCard({
  inputRef,
  prompt,
  busy,
  canSubmit,
  placeholder,
  onChangeText,
  onSubmit,
  onUpload,
  onUploadLongPress,
  onPastePayroll,
  uploadBusy,
  voice,
  speech,
}: ComposerCardProps): React.JSX.Element {
  const hasText = prompt.trim().length > 0;
  const transcribing = voice?.state === 'transcribing';

  return (
    <Pressable
      style={({ pressed }) => [styles.prompt, pressed && styles.promptPressed]}
      onPress={() => inputRef.current?.focus()}
    >
      <View style={styles.promptInputRow}>
        <TextInput
          ref={inputRef}
          value={prompt}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={colors.text.placeholder}
          style={styles.promptInput}
          returnKeyType="send"
          onSubmitEditing={onSubmit}
          blurOnSubmit
          multiline
          maxLength={500}
          accessibilityLabel="Ask Yuga"
        />
      </View>

      <View style={styles.promptActionRow}>
        <View style={styles.promptActionGroup}>
          {onUpload != null ? (
            <Pressable
              onPress={onUpload}
              onLongPress={onUploadLongPress}
              disabled={uploadBusy}
              style={({ pressed }) => [
                styles.promptAccessory,
                pressed && !uploadBusy && styles.promptAccessoryPressed,
              ]}
              accessibilityRole="button"
              accessibilityLabel="Upload batch send file"
              accessibilityHint="Long press to paste batch send rows"
              hitSlop={8}
            >
              {uploadBusy ? (
                <LazyLoadingSpinner size={18} color={colors.text.primary} />
              ) : (
                <Ionicons name="add" size={24} color={colors.text.primary} />
              )}
            </Pressable>
          ) : null}
          {onPastePayroll != null ? (
            <Pressable
              onPress={onPastePayroll}
              disabled={uploadBusy}
              style={({ pressed }) => [
                styles.promptAccessory,
                pressed && !uploadBusy && styles.promptAccessoryPressed,
              ]}
              accessibilityRole="button"
              accessibilityLabel="Paste batch send rows"
              hitSlop={8}
            >
              <Ionicons name="document-text-outline" size={21} color={colors.text.primary} />
            </Pressable>
          ) : null}
        </View>

        <View style={styles.promptActionGroup}>
          {speech != null ? (
            <Pressable
              onPress={speech.state !== 'idle' ? speech.onStop : speech.onToggleMuted}
              style={({ pressed }) => [
                styles.promptAccessory,
                pressed && styles.promptAccessoryPressed,
              ]}
              accessibilityRole="button"
              accessibilityLabel={
                speech.state !== 'idle'
                  ? 'Stop voice response'
                  : speech.muted
                    ? 'Unmute voice responses'
                    : 'Mute voice responses'
              }
              accessibilityState={{ selected: !speech.muted }}
              hitSlop={8}
            >
              <Ionicons
                name={speechIconName(speech)}
                size={22}
                color={
                  speech.state !== 'idle'
                    ? colors.brand.glossAccent
                    : speech.muted
                      ? colors.text.tertiary
                      : colors.text.primary
                }
              />
            </Pressable>
          ) : null}

          {/* When the user has typed, the send button takes priority. Voice is
              the default action on an empty composer (matches the design). */}
          {hasText ? (
            <Pressable
              onPress={onSubmit}
              disabled={!canSubmit}
              style={({ pressed }) => [
                styles.promptSend,
                !canSubmit && styles.promptSendDisabled,
                pressed && canSubmit && styles.promptSendPressed,
              ]}
              accessibilityRole="button"
              accessibilityLabel="Send prompt"
              accessibilityState={{ disabled: !canSubmit }}
              hitSlop={8}
            >
              {busy ? (
                <AiLoaderLottie size={20} tone="onLight" accessibilityLabel="Sending to Yuga" />
              ) : (
                <Ionicons name="arrow-up" size={18} color={colors.text.onAccent} />
              )}
            </Pressable>
          ) : voice != null ? (
            <Pressable
              onPress={voice.onPress}
              disabled={transcribing}
              style={({ pressed }) => [
                styles.voiceOrb,
                pressed && styles.voiceOrbPressed,
                transcribing && styles.voiceControlDisabled,
              ]}
              accessibilityRole="button"
              accessibilityLabel="Start voice input"
              hitSlop={8}
            >
              {transcribing ? (
                <LazyLoadingSpinner size={18} color={colors.text.onAccent} />
              ) : (
                <VoiceOrbGlyph />
              )}
            </Pressable>
          ) : (
            <Pressable
              onPress={onSubmit}
              disabled={!canSubmit}
              style={({ pressed }) => [
                styles.promptSend,
                !canSubmit && styles.promptSendDisabled,
                pressed && canSubmit && styles.promptSendPressed,
              ]}
              accessibilityRole="button"
              accessibilityLabel="Send prompt"
              accessibilityState={{ disabled: !canSubmit }}
              hitSlop={8}
            >
              {busy ? (
                <AiLoaderLottie size={20} tone="onLight" accessibilityLabel="Sending to Yuga" />
              ) : (
                <Ionicons name="arrow-up" size={18} color={colors.text.onAccent} />
              )}
            </Pressable>
          )}
        </View>
      </View>
    </Pressable>
  );
}

function VoiceOrbGlyph(): React.JSX.Element {
  // A small static waveform cluster (matches the design's dark voice orb).
  return (
    <View style={orbStyles.row}>
      {ORB_BAR_HEIGHTS.map((height, index) => (
        <View key={index} style={[orbStyles.bar, { height }]} />
      ))}
    </View>
  );
}

const ORB_BAR_HEIGHTS = [6, 11, 16, 11, 6];

const orbStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  bar: {
    width: 2,
    borderRadius: 1,
    backgroundColor: colors.text.onAccent,
  },
});

function VoiceCard({ voice }: { voice: ChatVoiceControl }): React.JSX.Element {
  const isReview = voice.state === 'review';
  const canAccept = isReview && voice.transcript.trim().length > 0;

  return (
    <Animated.View
      entering={VOICE_CARD_ENTERING}
      exiting={VOICE_CARD_EXITING}
      style={styles.voiceCard}
    >
      {isReview ? (
        <Text style={styles.voiceTranscript}>{voice.transcript}</Text>
      ) : (
        <Text style={styles.voiceTranscriptPlaceholder}>Listening…</Text>
      )}

      <View style={styles.voiceWaveRow}>
        <VoiceWaveform level={voice.level} active={voice.state === 'recording'} />

        <View style={styles.voiceControls}>
          <Pressable
            onPress={voice.onCancel}
            style={({ pressed }) => [
              styles.voiceControlNeutral,
              pressed && styles.voiceControlNeutralPressed,
            ]}
            accessibilityRole="button"
            accessibilityLabel="Discard voice input"
            hitSlop={8}
          >
            <Ionicons name="close" size={20} color={colors.text.primary} />
          </Pressable>

          <Pressable
            onPress={isReview ? voice.onAccept : voice.onPress}
            disabled={isReview && !canAccept}
            style={({ pressed }) => [
              styles.voiceControlPrimary,
              isReview && !canAccept && styles.voiceControlDisabled,
              pressed && !(isReview && !canAccept) && styles.voiceControlPrimaryPressed,
            ]}
            accessibilityRole="button"
            accessibilityLabel={isReview ? 'Send voice input' : 'Stop and transcribe'}
            hitSlop={8}
          >
            <Ionicons
              name={isReview ? 'checkmark' : 'stop'}
              size={20}
              color={colors.text.onAccent}
            />
          </Pressable>
        </View>
      </View>
    </Animated.View>
  );
}
