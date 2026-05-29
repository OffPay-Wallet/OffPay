/**
 * Empty-conversation surface.
 *
 * Yuga is agent-first: every meaningful reply must come from the agent,
 * never from hardcoded canned text. So the empty state is intentionally
 * minimal — a one-line privacy reassurance plus three tappable prompt
 * seeds. Each seed feeds the prompt input and goes through the agent like
 * any other user message.
 */

import React from 'react';
import { Pressable, View } from 'react-native';

import { Text } from '@/components/ui/Text';
import { colors } from '@/constants/colors';

import { suggestionStyles as styles } from './styles/suggestions';

export interface ChatSuggestion {
  /** Display label shown on the pill. */
  label: string;
  /** Prompt seeded into the input when the pill is tapped. */
  prompt: string;
}

const DEFAULT_SUGGESTIONS: readonly ChatSuggestion[] = [
  {
    label: 'Show my tokens',
    prompt: 'Show me my token balances on this wallet.',
  },
  {
    label: 'Send privately',
    prompt: 'Walk me through sending a private payment.',
  },
  {
    label: 'Wallet check',
    prompt: 'Run a quick health check on my wallet.',
  },
];

interface ChatSuggestionsProps {
  reduceMotion?: boolean;
  suggestions?: readonly ChatSuggestion[];
  onPickSuggestion: (suggestion: ChatSuggestion) => void;
}

export function ChatSuggestions({
  suggestions,
  onPickSuggestion,
}: ChatSuggestionsProps): React.JSX.Element {
  const items = suggestions ?? DEFAULT_SUGGESTIONS;

  return (
    <View style={styles.wrapper}>
      <Text variant="small" color={colors.text.secondary} style={styles.privacyHint}>
        Your wallet stays on this device. Yuga only sees what you type.
      </Text>
      <View style={styles.pillRow}>
        {items.map((suggestion) => (
          <Pressable
            key={suggestion.label}
            style={({ pressed }) => [styles.pill, pressed && styles.pillPressed]}
            onPress={() => onPickSuggestion(suggestion)}
            accessibilityRole="button"
            accessibilityLabel={`Use prompt: ${suggestion.prompt}`}
          >
            <Text variant="captionBold" color={colors.text.primary}>
              {suggestion.label}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}
