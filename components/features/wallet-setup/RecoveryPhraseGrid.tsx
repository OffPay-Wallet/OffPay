/**
 * Three-column grid of numbered recovery word chips.
 * Parent screen should scroll when using 24 words.
 */
import { StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui/Text';
import { colors } from '@/constants/colors';
import { radii, spacing } from '@/constants/spacing';

const COLUMNS = 3;

interface RecoveryPhraseGridProps {
  words: readonly string[];
}

export function RecoveryPhraseGrid({ words }: RecoveryPhraseGridProps): React.JSX.Element {
  const cells = words.map((word, i) => ({ index: i + 1, word }));

  const rows: (typeof cells)[] = [];
  for (let i = 0; i < cells.length; i += COLUMNS) {
    rows.push(cells.slice(i, i + COLUMNS));
  }

  return (
    <View style={styles.grid}>
      {rows.map((row, rowIdx) => (
        <View key={rowIdx} style={styles.row}>
          {row.map((cell) => (
            <WordChip key={cell.index} index={cell.index} word={cell.word} />
          ))}
          {row.length < COLUMNS
            ? Array.from({ length: COLUMNS - row.length }).map((_, i) => (
                <View key={`spacer-${rowIdx}-${i}`} style={styles.chipSpacer} />
              ))
            : null}
        </View>
      ))}
    </View>
  );
}

function WordChip({ index, word }: { index: number; word: string }): React.JSX.Element {
  return (
    <View style={styles.chip} accessibilityLabel={`Word ${index}, ${word}`}>
      <Text variant="small" color={colors.recoveryPhrase.chipIndex} style={styles.chipIndex}>
        {index}
      </Text>
      <Text
        variant="caption"
        color={colors.text.primary}
        style={styles.chipWord}
        numberOfLines={1}
        ellipsizeMode="tail"
      >
        {word}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    alignSelf: 'stretch',
    gap: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  chipSpacer: {
    flex: 1,
    minWidth: 0,
  },
  chip: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radii.full,
    borderWidth: 1,
    borderColor: colors.recoveryPhrase.chipBorder,
    backgroundColor: colors.recoveryPhrase.chipBackground,
  },
  chipIndex: {
    minWidth: spacing.lg,
  },
  chipWord: {
    flex: 1,
    minWidth: 0,
  },
});
