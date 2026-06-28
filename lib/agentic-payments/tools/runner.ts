import type { AgentToolCall, AgentToolResult } from '@/lib/agentic-payments/types';

import { isAgenticToolParallelSafe, runToolHandler } from './registry';
import type {
  AgenticToolDraft,
  AgenticToolRun,
  AgenticToolRunnerContext,
  PayrollStageIntent,
  ToolHandlerOutcome,
} from './types';

const MAX_LOCAL_TOOL_RESULTS = 8;

export interface AgenticToolRunOptions {
  onToolStart?: (toolCalls: readonly AgentToolCall[]) => void;
}

export async function runAgenticTools(
  toolCalls: readonly AgentToolCall[],
  context: AgenticToolRunnerContext,
  options: AgenticToolRunOptions = {},
): Promise<AgenticToolRun> {
  const results: AgentToolResult[] = [];
  const drafts: AgenticToolDraft[] = [];
  const payrollIntents: PayrollStageIntent[] = [];
  const overflow = toolCalls.length > MAX_LOCAL_TOOL_RESULTS;
  const handledCalls = overflow ? toolCalls.slice(0, MAX_LOCAL_TOOL_RESULTS) : [...toolCalls];

  if (
    !overflow &&
    handledCalls.length > 1 &&
    handledCalls.every((call) => isAgenticToolParallelSafe(call.name))
  ) {
    options.onToolStart?.(handledCalls);
    const outcomes = await Promise.all(handledCalls.map((call) => runToolHandler(call, context)));
    for (let index = 0; index < handledCalls.length; index += 1) {
      const call = handledCalls[index];
      const outcome = outcomes[index];
      if (call == null || outcome == null) continue;
      appendToolOutcome({
        call,
        outcome,
        results,
        drafts,
        payrollIntents,
      });
    }
    return { toolCalls: handledCalls, results, drafts, payrollIntents };
  }

  for (let index = 0; index < handledCalls.length; index += 1) {
    const call = handledCalls[index];
    if (call == null) continue;
    if (overflow && index === MAX_LOCAL_TOOL_RESULTS - 1) {
      results.push({
        toolCallId: call.id,
        name: call.name,
        error: { code: 'too_many_tool_calls' },
      });
      continue;
    }

    options.onToolStart?.([call]);
    const outcome = await runToolHandler(call, context);
    appendToolOutcome({ call, outcome, results, drafts, payrollIntents });
  }

  return { toolCalls: handledCalls, results, drafts, payrollIntents };
}

function appendToolOutcome(params: {
  call: AgentToolCall;
  outcome: ToolHandlerOutcome;
  results: AgentToolResult[];
  drafts: AgenticToolDraft[];
  payrollIntents: PayrollStageIntent[];
}): void {
  params.results.push({
    toolCallId: params.call.id,
    name: params.call.name,
    ...(params.outcome.error != null
      ? { error: params.outcome.error }
      : { result: params.outcome.result }),
  });
  if (params.outcome.draft != null) params.drafts.push(params.outcome.draft);
  if (params.outcome.payrollIntent != null) {
    params.payrollIntents.push({
      toolCallId: params.call.id,
      source: params.outcome.payrollIntent.source,
    });
  }
}
