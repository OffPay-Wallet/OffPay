import React, { useMemo } from 'react';
import { Text as RNText, StyleSheet, type StyleProp, type TextStyle } from 'react-native';

import { colors } from '@/constants/colors';
import { fontFamily } from '@/constants/typography';

interface MarkdownTextProps {
  text: string;
  variant?: 'user' | 'agent';
  style?: StyleProp<TextStyle>;
}

interface TextSegment {
  text: string;
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
}

function parseMarkdown(text: string): TextSegment[] {
  const segments: TextSegment[] = [];
  let remaining = text;

  const patterns = [
    { regex: /\*\*(.+?)\*\*/g, type: 'bold' as const },
    { regex: /\*(.+?)\*/g, type: 'italic' as const },
    { regex: /_(.+?)_/g, type: 'italic' as const },
    { regex: /`([^`]+)`/g, type: 'code' as const },
  ];

  while (remaining.length > 0) {
    let earliestMatch: { index: number; length: number; type: string; content: string } | null =
      null;

    for (const { regex, type } of patterns) {
      regex.lastIndex = 0;
      const match = regex.exec(remaining);
      if (match && (earliestMatch == null || match.index < earliestMatch.index)) {
        earliestMatch = {
          index: match.index,
          length: match[0].length,
          type,
          content: match[1],
        };
      }
    }

    if (earliestMatch == null) {
      if (remaining.length > 0) {
        segments.push({ text: remaining });
      }
      break;
    }

    if (earliestMatch.index > 0) {
      segments.push({ text: remaining.slice(0, earliestMatch.index) });
    }

    segments.push({
      text: earliestMatch.content,
      [earliestMatch.type]: true,
    });

    remaining = remaining.slice(earliestMatch.index + earliestMatch.length);
  }

  return segments;
}

const styles = StyleSheet.create({
  user: {
    fontFamily: fontFamily.ui,
    fontSize: 15,
    lineHeight: 21,
    color: colors.brand.deepShadow,
  },
  agent: {
    fontFamily: fontFamily.ui,
    fontSize: 15,
    lineHeight: 21,
    color: colors.brand.whiteStream,
  },
  bold: {
    fontFamily: fontFamily.uiBold,
    fontWeight: '700',
  },
  italic: {
    fontStyle: 'italic',
  },
  code: {
    fontFamily: fontFamily.mono,
    fontSize: 14,
    backgroundColor: 'rgba(0, 0, 0, 0.08)',
    paddingHorizontal: 4,
    borderRadius: 4,
  },
  codeAgent: {
    fontFamily: fontFamily.mono,
    fontSize: 14,
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    paddingHorizontal: 4,
    borderRadius: 4,
  },
});

export function MarkdownText({
  text,
  variant = 'agent',
  style,
}: MarkdownTextProps): React.JSX.Element {
  const segments = useMemo(() => parseMarkdown(text), [text]);

  return (
    <RNText style={[styles[variant], style]}>
      {segments.map((segment, index) => (
        <RNText
          key={index}
          style={[
            segment.bold && styles.bold,
            segment.italic && styles.italic,
            segment.code && (variant === 'user' ? styles.code : styles.codeAgent),
          ]}
        >
          {segment.text}
        </RNText>
      ))}
    </RNText>
  );
}
