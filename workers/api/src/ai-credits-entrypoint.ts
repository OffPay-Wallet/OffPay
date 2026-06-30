import { WorkerEntrypoint } from 'cloudflare:workers';

import {
  consumeAiChatCredit,
  getAiChatCreditStatus,
  releaseAiChatCredit,
  type AiChatCreditConsumptionResult,
  type AiChatCreditReleaseReason,
  type AiChatCreditRequest,
  type AiChatCreditStatus,
} from './lib/ai-chat-credits.js';

import type { Bindings } from './lib/types.js';

export class AiCreditsEntrypoint extends WorkerEntrypoint<Bindings> {
  async getStatus(request: AiChatCreditRequest): Promise<AiChatCreditStatus> {
    try {
      return await getAiChatCreditStatus(this.env, request);
    } catch (error) {
      logAiCreditEntrypointError('status', error);
      throw error;
    }
  }

  async consume(request: AiChatCreditRequest): Promise<AiChatCreditConsumptionResult> {
    try {
      return await consumeAiChatCredit(this.env, request);
    } catch (error) {
      logAiCreditEntrypointError('consume', error);
      throw error;
    }
  }

  async release(
    request: AiChatCreditRequest,
    reason: AiChatCreditReleaseReason,
  ): Promise<AiChatCreditStatus> {
    try {
      return await releaseAiChatCredit(this.env, request, reason);
    } catch (error) {
      logAiCreditEntrypointError('release', error);
      throw error;
    }
  }
}

function logAiCreditEntrypointError(
  operation: 'status' | 'consume' | 'release',
  error: unknown,
): void {
  console.warn('api.aiChatCredits.entrypointError', {
    operation,
    message: error instanceof Error ? error.message : String(error),
  });
}
