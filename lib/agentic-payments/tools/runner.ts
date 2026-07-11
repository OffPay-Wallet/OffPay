import type { AgentToolCall, AgentToolResult } from '@/lib/agentic-payments/types';
import { projectAgenticToolResultForModel } from '@/lib/agentic-payments/tool-result-projection';

import {
  isAgenticToolParallelSafe,
  isAgenticWriteIntentTool,
  isRegisteredAgenticTool,
  runToolHandler,
} from './registry';
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
  /** False after this user turn has already accepted a write-capable tool. */
  allowWriteIntent?: boolean;
}

interface ToolExecutionGuard {
  offeredToolNames: ReadonlySet<string>;
  allowWriteIntent: boolean;
  writeIntentInFlight: boolean;
  writeIntentUsed: boolean;
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
  const guard: ToolExecutionGuard = {
    offeredToolNames: new Set(context.offeredToolNames),
    allowWriteIntent: options.allowWriteIntent !== false,
    writeIntentInFlight: false,
    writeIntentUsed: false,
  };

  if (
    !overflow &&
    handledCalls.length > 1 &&
    handledCalls.every((call) => isAgenticToolParallelSafe(call.name))
  ) {
    options.onToolStart?.(handledCalls);
    const outcomes = await Promise.all(
      handledCalls.map((call) => runGuardedToolHandler(call, context, guard)),
    );
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
    return {
      toolCalls: handledCalls,
      results,
      drafts,
      payrollIntents,
      writeIntentUsed: guard.writeIntentUsed,
    };
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
    const outcome = await runGuardedToolHandler(call, context, guard);
    appendToolOutcome({ call, outcome, results, drafts, payrollIntents });
  }

  return {
    toolCalls: handledCalls,
    results,
    drafts,
    payrollIntents,
    writeIntentUsed: guard.writeIntentUsed,
  };
}

async function runGuardedToolHandler(
  call: AgentToolCall,
  context: AgenticToolRunnerContext,
  guard: ToolExecutionGuard,
): Promise<ToolHandlerOutcome> {
  if (!isRegisteredAgenticTool(call.name)) {
    return { error: { code: 'unknown_tool' } };
  }

  if (!guard.offeredToolNames.has(call.name)) {
    return { error: { code: 'tool_not_available' } };
  }

  const isWriteIntent = isAgenticWriteIntentTool(call.name);
  if (isWriteIntent) {
    if (!guard.allowWriteIntent || guard.writeIntentInFlight || guard.writeIntentUsed) {
      return { error: { code: 'write_intent_already_created' } };
    }
    guard.writeIntentInFlight = true;
  }

  try {
    const outcome = await runToolHandler(call, context);
    if (isWriteIntent && (outcome.draft != null || outcome.payrollIntent != null)) {
      guard.writeIntentUsed = true;
    }
    return outcome;
  } finally {
    if (isWriteIntent) guard.writeIntentInFlight = false;
  }
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
      : { result: projectAgenticToolResultForModel(params.outcome.result) }),
  });
  if (params.outcome.draft != null) params.drafts.push(params.outcome.draft);
  if (params.outcome.payrollIntent != null) {
    params.payrollIntents.push({
      toolCallId: params.call.id,
      source: params.outcome.payrollIntent.source,
    });
  }
}
