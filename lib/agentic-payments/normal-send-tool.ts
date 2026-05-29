import type { AgentToolSchema } from '@/lib/agentic-payments/types';

export const AGENTIC_NORMAL_SEND_TOOL_NAME = 'draft_normal_send';

export const AGENTIC_NORMAL_SEND_TOOL_SCHEMA: AgentToolSchema = {
  name: AGENTIC_NORMAL_SEND_TOOL_NAME,
  description:
    'Draft a normal public wallet transfer for explicit in-app confirmation. Use this when the user asks for normal route, public route, direct transfer, or does not request a private route. The active wallet is the sender by default. Use the active wallet as recipient only when the user explicitly asks to send to themselves, their own wallet, or the same wallet. This tool never submits or signs a transaction.',
  parameters: {
    type: 'object',
    properties: {
      recipient: {
        type: 'string',
        description:
          'Recipient public address. This may be resolved from safe wallet context when the user names one of their local wallets.',
      },
      amount: {
        type: 'string',
        description: 'Decimal token amount exactly as requested by the user.',
      },
      token: {
        type: 'string',
        description:
          'Token symbol or mint from the current wallet context, for example SOL, USDC, dUSDC, or a mint address.',
      },
    },
    required: ['recipient', 'amount', 'token'],
  },
};
