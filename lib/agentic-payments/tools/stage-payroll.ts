import { readStringArg } from './helpers';
import type { AgenticToolDefinition } from './types';

export const stagePayrollTool: AgenticToolDefinition = {
  name: 'stage_payroll',
  schema: {
    name: 'stage_payroll',
    description:
      'Opens batch-send intake UI so the user can upload or paste recipients and amounts. The app parses, validates, routes, and confirms locally. Never sends batch-send rows to the AI.',
    parameters: {
      type: 'object',
      properties: {
        source: {
          type: 'string',
          enum: ['upload', 'paste'],
          description: 'How the user wants to provide rows. Defaults to paste.',
        },
      },
    },
  },
  run: (call) => {
    const source = readStringArg(call, 'source') === 'upload' ? 'upload' : 'paste';
    return {
      result: { status: 'opening_payroll_intake', source },
      payrollIntent: { source },
    };
  },
};
