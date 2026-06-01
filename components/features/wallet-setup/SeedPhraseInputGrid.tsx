/**
 * Editable seed phrase grid — 3-column numbered input cells.
 *
 * Key behaviors:
 *   - 3×4 grid for 12 words, 3×8 for 24 words
 *   - Paste detection: pasting a full phrase into any cell auto-distributes
 *     all words across the grid
 *   - Handles multiple paste formats: space-separated, newline-separated,
 *     comma-separated, numbered (e.g. "1. word"), tab-separated, mixed
 *   - Individual cell editing with auto-advance on space
 *   - All text normalized to lowercase, trimmed
 *   - Parent is notified of changes via `onWordsChange`
 */
import { useCallback, useRef } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

import { Text } from '@/components/ui/Text';
import { colors } from '@/constants/colors';
import { layout, radii, spacing } from '@/constants/spacing';
import { fontFamily } from '@/constants/typography';

import type { RecoveryWordCount } from '@/types/wallet';

const COLUMNS = 3;

interface SeedPhraseInputGridProps {
  wordCount: RecoveryWordCount;
  words: string[];
  onWordsChange: (words: string[]) => void;
}

// ---------------------------------------------------------------------------
// Paste parser — handles all common clipboard formats
// ---------------------------------------------------------------------------

/**
 * Parse a raw pasted string into individual mnemonic words.
 *
 * Handles:
 *   "apple banana cherry"            (space-separated)
 *   "apple\nbanana\ncherry"          (newline-separated)
 *   "apple,banana,cherry"            (comma-separated)
 *   "apple\tbanana\tcherry"          (tab-separated)
 *   "1. apple 2. banana 3. cherry"   (numbered with period)
 *   "1 apple 2 banana 3 cherry"      (numbered without period)
 *   "1.apple 2.banana"               (numbered, no space after period)
 *   Mixed whitespace, extra spaces, leading/trailing junk
 */
export function parseSeedPhrase(raw: string): string[] {
  let cleaned = raw
    // Normalize all whitespace (tabs, newlines, multiple spaces) to single space
    .replace(/[\s]+/g, ' ')
    // Remove numbering patterns: "1. " or "1." or "1 " at word boundaries
    .replace(/\b\d+\.\s*/g, ' ')
    // Remove standalone numbers that look like indices (e.g. "1 apple 2 banana")
    .replace(/(?:^|\s)\d+(?=\s[a-zA-Z])/g, ' ')
    // Remove commas
    .replace(/,/g, ' ')
    .trim()
    .toLowerCase();

  // Split on spaces, filter empty strings
  return cleaned.split(/\s+/).filter((w) => w.length > 0);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SeedPhraseInputGrid({
  wordCount,
  words,
  onWordsChange,
}: SeedPhraseInputGridProps): React.JSX.Element {
  const inputRefs = useRef<(TextInput | null)[]>([]);

  const setRef = useCallback(
    (index: number) => (ref: TextInput | null) => {
      inputRefs.current[index] = ref;
    },
    [],
  );

  /** Focus a specific cell by index */
  const focusCell = useCallback((index: number) => {
    inputRefs.current[index]?.focus();
  }, []);

  /**
   * Handle text change on a specific cell.
   * Detects paste (multi-word input) and distributes across all cells.
   */
  const handleCellChange = useCallback(
    (index: number, text: string) => {
      const trimmed = text.trim().toLowerCase();

      // Paste detection: if the input contains spaces/newlines/commas,
      // it's likely a pasted full phrase
      if (/[\s,]/.test(trimmed) || trimmed.split(/\s+/).length > 1) {
        const parsed = parseSeedPhrase(text);
        if (parsed.length > 1) {
          // Distribute across all cells, truncate to wordCount
          const newWords = Array.from({ length: wordCount }, (_, i) => parsed[i] ?? '');
          onWordsChange(newWords);

          // Focus the last filled cell or the first empty one
          const lastFilledIdx = Math.min(parsed.length, wordCount) - 1;
          const nextEmptyIdx = newWords.findIndex((w) => w === '');
          const targetIdx = nextEmptyIdx >= 0 ? nextEmptyIdx : lastFilledIdx;
          setTimeout(() => focusCell(targetIdx), 50);
          return;
        }
      }

      // Single word typed with trailing space → set word and auto-advance
      if (text.endsWith(' ') && trimmed.length > 0) {
        const newWords = [...words];
        newWords[index] = trimmed;
        onWordsChange(newWords);

        // Advance to next cell
        if (index < wordCount - 1) {
          setTimeout(() => focusCell(index + 1), 50);
        }
        return;
      }

      // Normal single-character typing
      const newWords = [...words];
      newWords[index] = trimmed;
      onWordsChange(newWords);
    },
    [words, wordCount, onWordsChange, focusCell],
  );

  /** Handle backspace on empty cell → go back to previous cell */
  const handleKeyPress = useCallback(
    (index: number, key: string) => {
      if (key === 'Backspace' && words[index] === '' && index > 0) {
        focusCell(index - 1);
      }
    },
    [words, focusCell],
  );

  // Build rows
  const cells = Array.from({ length: wordCount }, (_, i) => i);
  const rows: number[][] = [];
  for (let i = 0; i < cells.length; i += COLUMNS) {
    rows.push(cells.slice(i, i + COLUMNS));
  }

  return (
    <View style={styles.grid}>
      {rows.map((row, rowIdx) => (
        <View key={rowIdx} style={styles.row}>
          {row.map((cellIdx) => (
            <View key={cellIdx} style={styles.cell}>
              <Text
                variant="small"
                color={colors.recoveryPhrase.chipIndex}
                style={styles.cellIndex}
              >
                {cellIdx + 1}.
              </Text>
              <TextInput
                ref={setRef(cellIdx)}
                style={styles.cellInput}
                value={words[cellIdx] ?? ''}
                onChangeText={(text) => handleCellChange(cellIdx, text)}
                onKeyPress={({ nativeEvent }) => handleKeyPress(cellIdx, nativeEvent.key)}
                placeholder=""
                placeholderTextColor={colors.text.placeholder}
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="off"
                spellCheck={false}
                selectionColor={colors.brand.glossAccent}
                keyboardAppearance="dark"
                returnKeyType={cellIdx < wordCount - 1 ? 'next' : 'done'}
                onSubmitEditing={() => {
                  if (cellIdx < wordCount - 1) {
                    focusCell(cellIdx + 1);
                  }
                }}
                blurOnSubmit={cellIdx === wordCount - 1}
                accessibilityLabel={`Word ${cellIdx + 1}`}
              />
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const CELL_HEIGHT = layout.minTouchTarget;

const styles = StyleSheet.create({
  grid: {
    alignSelf: 'stretch',
    gap: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  cell: {
    flex: 1,
    minWidth: 0,
    height: CELL_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.recoveryPhrase.chipBorder,
    backgroundColor: colors.recoveryPhrase.chipBackground,
  },
  cellIndex: {
    minWidth: spacing.xl,
  },
  cellInput: {
    flex: 1,
    minWidth: 0,
    height: CELL_HEIGHT,
    color: colors.text.primary,
    fontFamily: fontFamily.regular,
    fontSize: 14,
    padding: 0,
    margin: 0,
  },
});
