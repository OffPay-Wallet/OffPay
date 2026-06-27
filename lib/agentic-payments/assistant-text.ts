/**
 * Sanitize the model's free-text reply before it lands in the chat bubble.
 *
 * Instruction-tuned models can dump a private scratchpad before the visible
 * answer — for example "1. Greet the user. 2.
 * Briefly state my purpose…" or "I need to look at the safe client context".
 * When tools are attached the same scratchpad echoes the tool name in raw
 * call syntax. Both leak prompt internals and inflate the bubble.
 *
 * The sanitizer is conservative: it only filters lines that match clear
 * scratchpad markers, then collapses surviving whitespace. A hard char cap
 * is applied as defense-in-depth.
 *
 * This module is deliberately separate from the chat screen so it can be
 * unit-tested without pulling in React Native.
 */

const SCRATCHPAD_LINE_PATTERNS: readonly RegExp[] = [
  // Reasoning / plan section headers.
  /^(?:tool[\s_-]*call|function[\s_-]*call|reasoning|thought|thinking|analysis|plan|step\s*\d+|chain[\s_-]*of[\s_-]*thought)\s*[:.\-—]/i,
  // Numbered or bulleted reasoning steps that describe the agent's plan.
  // "1. Greet the user.", "2. Briefly state my purpose…", "- Check balance".
  /^\s*\d+[.)]\s+(?:greet|acknowledge|ask|briefly|check|look|present|state|reply|respond|formulate|consider|think|analyze|figure|determine|identify|understand|verify|review|confirm)\b/i,
  /^\s*[-*]\s+(?:greet|acknowledge|ask|briefly|check|look|present|state|reply|respond|formulate|consider|think|analyze|figure|determine|identify|understand|verify|review|confirm)\b/i,
  // First-person narration about the user or the model's own intent.
  /^(?:the\s+user\s+(?:is|wants|asked|asking|said|says|wrote))\b/i,
  /^(?:this\s+is\s+(?:a\s+)?(?:simple|basic|standard|generic|plain)\s+(?:greeting|question|request|message))\b/i,
  /^i\s+(?:need\s+to|should|will|can|am\s+going\s+to|have\s+to|must|am\s+(?:not|unable))\b/i,
  /^(?:so|therefore|thus|hence)\s+i\s+(?:will|should|can|need)\b/i,
  /^(?:let\s+me|let\s+us)\b/i,
  /^(?:my\s+(?:plan|approach|next\s+step|purpose|response|task))\b/i,
  // Hesitation markers used as line starters.
  /^(?:wait|hmm|actually|hold\s+on|ok(?:ay)?|alright|right|so)[, ]/i,
  // Self-references to the rules.
  /\binstructions?\s+(?:say|state|tell|require|specify)\b/i,
  /\bsystem\s+(?:instruction|prompt|context|rules?)\b/i,
  /\bsafe\s+client\s+context\b/i,
  /\bwalletbalanceapiresponse\b/i,
  // Lines that comment on the user's input rather than answering it.
  /^"[^"]+"\s+is\s+not\s+(?:a\s+)?standard\s+command\b/i,
  /\bnot\s+(?:a\s+)?standard\s+command\b/i,
  /\bmight\s+be\s+a\s+(?:name|typo|placeholder)\b/i,
  // Inline tool-call echo.
  /draft_(?:normal|private)_send\s*\(/i,
];

/**
 * Markers that indicate the visible answer has begun. If the model writes a
 * reasoning paragraph, then a blank line, then the actual answer, we drop
 * everything before the first marker line. Also used to extract an answer
 * from a line that concatenates a scratchpad sentence with the answer.
 */
const ANSWER_MARKER_PATTERN =
  /(?:^|\.\s*|\)\s*)(?<answer>(?:hi|hey|hello|sure|okay|sorry|here(?:'s| is)|you(?:'ll| can| are| have)?|your|to\s|sending|drafting|tell|drafted|i\s+(?:found|see|don't|cannot|can't|will))\b.*)$/i;

const MAX_VISIBLE_ASSISTANT_CHARS = 480;
const MIN_TEXT_WITH_DRAFT_CHARS = 36;

/**
 * Within a single line, split off a trailing answer if the line begins with
 * scratchpad-shaped prose and ends with what looks like the actual answer.
 * Catches the model's habit of writing "2. Briefly state my purpose
 * (assisting with wallet tasks).Hi! How can I help you with your wallet
 * today?" all on one line.
 */
function extractAnswerFromInlineScratchpad(line: string): string | null {
  const match = ANSWER_MARKER_PATTERN.exec(line);
  if (match?.groups?.answer == null) return null;
  const candidate = match.groups.answer.trim();
  // Require the answer to be at least a short sentence to avoid greedy
  // false positives (e.g. matching the trailing word "you" mid-sentence).
  if (candidate.length < 12) return null;
  return candidate;
}

/**
 * Strip the model's internal scratchpad from raw assistant text.
 *
 * @param rawText The model's raw response text.
 * @param hasToolDraft True when a tool-call draft has been produced and the
 *   confirmation card will render alongside the bubble. Short residual
 *   prose is dropped in that case so the card stands alone.
 */
export function sanitizeAssistantText(rawText: string, hasToolDraft: boolean): string {
  if (rawText.length === 0) return rawText;

  // Strip triple-backtick blocks entirely.
  const withoutFences = rawText.replace(/```[\s\S]*?```/g, '');

  // Pass 1: drop scratchpad lines, and within surviving lines extract the
  // trailing answer when a line starts as scratchpad and ends as answer.
  const lines = withoutFences.split(/\r?\n/);
  const filtered: string[] = [];
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.length === 0) {
      filtered.push('');
      continue;
    }
    if (SCRATCHPAD_LINE_PATTERNS.some((pattern) => pattern.test(line))) {
      // Even though this line is scratchpad-shaped, it may have a trailing
      // answer concatenated to it. Check before discarding.
      const inlineAnswer = extractAnswerFromInlineScratchpad(line);
      if (inlineAnswer != null) {
        filtered.push(inlineAnswer);
      }
      continue;
    }
    filtered.push(rawLine);
  }

  // Pass 2: if a clear answer marker appears later, drop everything before
  // it. Catches blank-separated reasoning paragraphs.
  const trimmed = filtered.map((line) => line.trim());
  const answerStart = trimmed.findIndex((line) =>
    /^(?:hi\b|hey\b|hello\b|here(?:'s| is)|sure\b|okay\b|sorry\b|you\b|your\b|to\s|sending\b|drafting\b|tell\b|i\s+(?:found|see|don't|cannot|can't))/i.test(
      line,
    ),
  );
  const finalLines = answerStart > 0 ? filtered.slice(answerStart) : filtered;

  const cleaned = finalLines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  // Hard length cap as defense-in-depth.
  const capped =
    cleaned.length > MAX_VISIBLE_ASSISTANT_CHARS
      ? `${cleaned.slice(0, MAX_VISIBLE_ASSISTANT_CHARS - 1).trimEnd()}…`
      : cleaned;

  // If a tool draft is attached, the confirmation card is the authoritative
  // summary. Drop short stubs that survived sanitization.
  if (hasToolDraft && capped.length < MIN_TEXT_WITH_DRAFT_CHARS) {
    return '';
  }
  return capped;
}
