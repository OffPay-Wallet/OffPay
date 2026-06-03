import type { AgentToolCall, AgentToolResult } from '@/lib/agentic-payments/types';

import { runToolHandler } from './registry';
import type {
  AgenticToolDraft,
  AgenticToolRun,
  AgenticToolRunnerContext,
  PayrollStageIntent,
} from './types';

const MAX_LOCAL_TOOL_RESULTS = 8;

export async function runAgenticTools(
  toolCalls: readonly AgentToolCall[],
  context: AgenticToolRunnerContext,
): Promise<AgenticToolRun> {
  const results: AgentToolResult[] = [];
  const drafts: AgenticToolDraft[] = [];
  const payrollIntents: PayrollStageIntent[] = [];
  const handledCalls =
    toolCalls.length > MAX_LOCAL_TOOL_RESULTS
      ? toolCalls.slice(0, MAX_LOCAL_TOOL_RESULTS)
      : [...toolCalls];

  for (let index = 0; index < handledCalls.length; index += 1) {
    const call = handledCalls[index];
    if (toolCalls.length > MAX_LOCAL_TOOL_RESULTS && index === MAX_LOCAL_TOOL_RESULTS - 1) {
      results.push({
        toolCallId: call.id,
        name: call.name,
        error: { code: 'too_many_tool_calls' },
      });
      continue;
    }

    const outcome = await runToolHandler(call, context);
    results.push({
      toolCallId: call.id,
      name: call.name,
      ...(outcome.error != null ? { error: outcome.error } : { result: outcome.result }),
    });
    if (outcome.draft != null) drafts.push(outcome.draft);
    if (outcome.payrollIntent != null) {
      payrollIntents.push({ toolCallId: call.id, source: outcome.payrollIntent.source });
    }
  }

  return { toolCalls: handledCalls, results, drafts, payrollIntents };
}
