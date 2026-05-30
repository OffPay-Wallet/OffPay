/**
 * Prompt dock — text input, optional upload + mic affordances, and send
 * button. Pure presentation with controlled input state owned by the parent.
 *
 * Upload and voice are optional: pass `onUpload` to show the payroll file
 * button and `voice` to show the mic. When neither is provided the dock
 * renders exactly as before, so non-payroll surfaces are unaffected.
 */

import React, { type RefObject } from 'react';
import { ActivityIndicator, Pressable, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { colors } from '@/constants/colors';
import { spacing } from '@/constants/spacing';

import { promptStyles as styles } from './styles/prompt';

export type ChatVoiceState = 'idle' | 'recording' | 'transcribing' | 'speaking';

interface ChatVoiceControl {
  state: ChatVoiceState;
  onPress: () => void;
}

interface ChatPromptDockProps {
  inputRef: RefObject<TextInput | null>;
  prompt: string;
  busy: boolean;
  canSubmit: boolean;
  bottomInset: number;
  horizontalPadding: number;
  onChangeText: (next: string) => void;
  onSubmit: () => void;
  /** Optional payroll/file upload affordance. */
  onUpload?: () => void;
  /** Optional long-press on upload (e.g. open paste sheet). */
  onUploadLongPress?: () => void;
  uploadBusy?: boolean;
  /** Optional voice control. Omit to hide the mic. */
  voice?: ChatVoiceControl;
}

function voiceIconName(state: ChatVoiceState): keyof typeof Ionicons.glyphMap {
  switch (state) {
    case 'recording':
      return 'stop-circle';
    case 'speaking':
      return 'volume-high';
    default:
      return 'mic-outline';
  }
}

export function ChatPromptDock({
  inputRef,
  prompt,
  busy,
  canSubmit,
  bottomInset,
  horizontalPadding,
  onChangeText,
  onSubmit,
  onUpload,
  onUploadLongPress,
  uploadBusy = false,
  voice,
}: ChatPromptDockProps): React.JSX.Element {
  const voiceActive = voice != null && voice.state !== 'idle';

  return (
    <View
      pointerEvents="box-none"
      style={[
        styles.promptDock,
        {
          paddingHorizontal: horizontalPadding,
          paddingBottom: Math.max(bottomInset, spacing.lg),
        },
      ]}
    >
      <Pressable style={styles.prompt} onPress={() => inputRef.current?.focus()}>
        {onUpload != null ? (
          <Pressable
            onPress={onUpload}
            onLongPress={onUploadLongPress}
            disabled={uploadBusy}
            style={styles.promptAccessory}
            accessibilityRole="button"
            accessibilityLabel="Upload payroll file"
            accessibilityHint="Long press to paste payroll rows"
            hitSlop={8}
          >
            {uploadBusy ? (
              <ActivityIndicator size="small" color={colors.brand.deepShadow} />
            ) : (
              <Ionicons name="add-circle-outline" size={22} color={colors.brand.deepShadow} />
            )}
          </Pressable>
        ) : null}

        <TextInput
          ref={inputRef}
          value={prompt}
          onChangeText={onChangeText}
          placeholder="Ask anything"
          placeholderTextColor={colors.text.placeholder}
          style={styles.promptInput}
          returnKeyType="send"
          onSubmitEditing={onSubmit}
          blurOnSubmit
          multiline={false}
          maxLength={500}
          accessibilityLabel="Ask Yuga"
        />

        {voice != null ? (
          <Pressable
            onPress={voice.onPress}
            style={styles.promptAccessory}
            accessibilityRole="button"
            accessibilityLabel={voice.state === 'recording' ? 'Stop recording' : 'Start voice input'}
            hitSlop={8}
          >
            {voice.state === 'transcribing' ? (
              <ActivityIndicator size="small" color={colors.brand.deepShadow} />
            ) : (
              <Ionicons
                name={voiceIconName(voice.state)}
                size={22}
                color={voiceActive ? colors.brand.azureBlue : colors.brand.deepShadow}
              />
            )}
          </Pressable>
        ) : null}

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
            <ActivityIndicator size="small" color={colors.brand.whiteStream} />
          ) : (
            <Ionicons
              name="arrow-up"
              size={18}
              color={canSubmit ? colors.brand.whiteStream : 'rgba(252, 252, 255, 0.6)'}
            />
          )}
        </Pressable>
      </Pressable>
    </View>
  );
}
