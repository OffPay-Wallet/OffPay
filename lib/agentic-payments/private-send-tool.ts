import type { AgentToolSchema } from '@/lib/agentic-payments/types';

export const AGENTIC_PRIVATE_SEND_TOOL_NAME = 'draft_private_send';

export const AGENTIC_PRIVATE_SEND_TOOL_SCHEMA: AgentToolSchema = {
  name: AGENTIC_PRIVATE_SEND_TOOL_NAME,
  description:
    'Draft a MagicBlock private stablecoin send for explicit in-app confirmation. Use this only when the user asks for MagicBlock, private route, shielded/private payment, or private send. Do not use this for normal route requests. The active wallet is the sender by default. Use the active wallet as recipient only when the user explicitly asks to send to themselves, their own wallet, or the same wallet. If the user says "from my wallet to <address>", the recipient is the address after "to". This tool never submits or signs a transaction.',
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
          'Stablecoin symbol or mint from the current wallet context, for example USDC, USDT, dUSDC, or a mint address.',
      },
    },
    required: ['recipient', 'amount', 'token'],
  },
};
