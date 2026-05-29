/**
 * Prompt dock — text input and send button. Pure presentation with
 * controlled input state owned by the parent. Voice input is not yet
 * wired; the previous mic affordance was removed to avoid showing a
 * dead button. Voice will return once the recording pipeline ships.
 */

import React, { type RefObject } from 'react';
import { ActivityIndicator, Pressable, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { colors } from '@/constants/colors';
import { spacing } from '@/constants/spacing';

import { promptStyles as styles } from './styles/prompt';

interface ChatPromptDockProps {
  inputRef: RefObject<TextInput | null>;
  prompt: string;
  busy: boolean;
  canSubmit: boolean;
  bottomInset: number;
  horizontalPadding: number;
  onChangeText: (next: string) => void;
  onSubmit: () => void;
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
}: ChatPromptDockProps): React.JSX.Element {
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
