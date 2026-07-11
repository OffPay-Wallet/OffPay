import type { AgenticToolDefinition } from '../types';

/**
 * Kept only as an internal fail-closed handler for stale callers. It is not
 * registered or exposed to the model while withdrawal is unavailable.
 */
export const flashFundAccountTool: AgenticToolDefinition = {
  name: 'flash_fund_account',
  schema: {
    name: 'flash_fund_account',
    description:
      'Unavailable: Flash deposits are disabled while OffPay cannot safely withdraw funds.',
    parameters: {
      type: 'object',
      properties: {},
    },
  },
  run: async () => ({
    error: { code: 'flash_funding_disabled_withdrawal_unavailable' },
  }),
};
