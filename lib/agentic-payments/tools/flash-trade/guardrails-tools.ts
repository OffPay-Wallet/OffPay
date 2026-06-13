import type { AgenticToolDefinition } from '../types';
import { requireMainnet } from './helpers';

const SENSITIVE_DATA_ERROR = {
  code: 'sensitive_data_denied',
  message: 'This request involves sensitive data that cannot be exposed through agent tools.',
};

const ALLOWED_PUBLIC_POOLS = new Set([
  'crypto.1',
  'virtual.1',
  'governance.1',
  'community.1',
  'community.2',
  'equity.1',
]);

const SENSITIVE_TOPICS = [
  'private key',
  'seed phrase',
  'mnemonic',
  'password',
  'api key',
  'secret',
  'credential',
  'auth',
];

export const flashGetDataPoolsTool: AgenticToolDefinition = {
  name: 'flash_get_data_pools',
  schema: {
    name: 'flash_get_data_pools',
    description:
      'Get available data pools for analytics. Only PUBLIC pools are accessible. Private data pools require explicit authorization.',
    parameters: {
      type: 'object',
      properties: {
        includePrivate: {
          type: 'boolean',
          description: 'Request access to private pools (requires authorization)',
        },
      },
    },
  },
  run: async (call, context) => {
    const networkCheck = requireMainnet(context.scope.network);
    if (!networkCheck.ok) {
      return { error: { code: networkCheck.code } };
    }

    const includePrivate = call.args.includePrivate as boolean | undefined;

    if (includePrivate) {
      return {
        result: {
          status: 'authorization_required',
          message: 'Access to private data pools requires explicit user authorization and is not available through agent tools.',
          publicPools: Array.from(ALLOWED_PUBLIC_POOLS),
          privatePools: ['[REDACTED] - Requires authorization'],
          dataAccessPolicy: 'Only aggregated public pool data is accessible. User-specific data requires explicit consent.',
          timestamp: Date.now(),
        },
      };
    }

    return {
      result: {
        status: 'ok',
        publicPools: Array.from(ALLOWED_PUBLIC_POOLS).map((name) => ({
          name,
          type: 'public',
          accessible: true,
          dataTypes: ['prices', 'positions', 'orders', 'liquidations'],
        })),
        dataAccessPolicy: 'Only aggregated public pool data is accessible. All user-specific data is privacy-protected.',
        timestamp: Date.now(),
      },
    };
  },
};

export const flashValidateDataAccessTool: AgenticToolDefinition = {
  name: 'flash_validate_data_access',
  schema: {
    name: 'flash_validate_data_access',
    description: 'Validate if requested data access is permitted under privacy guardrails.',
    parameters: {
      type: 'object',
      properties: {
        requestedDataType: {
          type: 'string',
          description: 'Type of data being requested (e.g., positions, orders, liquidations)',
        },
        scope: {
          type: 'string',
          enum: ['own', 'all', 'aggregated'],
          description: 'Data scope: own (user data), all (all users), aggregated (anonymized stats)',
        },
        poolName: {
          type: 'string',
          description: 'Optional pool name if requesting pool-specific data',
        },
      },
      required: ['requestedDataType', 'scope'],
    },
  },
  run: async (call, context) => {
    const requestedDataType = call.args.requestedDataType as string;
    const scope = call.args.scope as 'own' | 'all' | 'aggregated';
    const poolName = call.args.poolName as string | undefined;

    if (SENSITIVE_TOPICS.some((topic) => requestedDataType.toLowerCase().includes(topic))) {
      return { error: SENSITIVE_DATA_ERROR };
    }

    if (poolName && !ALLOWED_PUBLIC_POOLS.has(poolName.toLowerCase())) {
      return {
        result: {
          status: 'denied',
          reason: 'private_pool',
          message: 'Private pool data is not accessible through agent tools.',
          requestedPool: poolName,
          accessiblePools: Array.from(ALLOWED_PUBLIC_POOLS),
          timestamp: Date.now(),
        },
      };
    }

    const dataByScope: Record<string, { allowed: boolean; reason?: string }> = {
      own: {
        allowed: !!context.scope.walletAddress,
        reason: context.scope.walletAddress
          ? undefined
          : 'Wallet must be connected to access own data',
      },
      all: {
        allowed: false,
        reason: 'Access to all users data is not permitted for privacy reasons',
      },
      aggregated: {
        allowed: true,
      },
    };

    const access = dataByScope[scope];

    if (!access.allowed) {
      return {
        result: {
          status: 'denied',
          reason: 'scope_restricted',
          message: access.reason,
          requestedScope: scope,
          allowedScopes: Object.entries(dataByScope)
            .filter(([, v]) => v.allowed)
            .map(([k]) => k),
          timestamp: Date.now(),
        },
      };
    }

    const allowedDataTypes = ['prices', 'positions', 'orders', 'liquidations', 'markets', 'poolStats'];
    if (!allowedDataTypes.includes(requestedDataType.toLowerCase())) {
      return {
        result: {
          status: 'denied',
          reason: 'invalid_data_type',
          message: `'${requestedDataType}' is not a recognized data type.`,
          allowedDataTypes,
          timestamp: Date.now(),
        },
      };
    }

    return {
      result: {
        status: 'approved',
        message: 'Data access validated and approved.',
        validatedAccess: {
          dataType: requestedDataType,
          scope,
          poolName: poolName || 'all_public_pools',
          restrictions: [
            'No personally identifiable information',
            'Wallet addresses will be anonymized in aggregated views',
            'Private key and credential data is never accessible',
          ],
        },
        timestamp: Date.now(),
      },
    };
  },
};

export const flashGetRateLimitsTool: AgenticToolDefinition = {
  name: 'flash_get_rate_limits',
  schema: {
    name: 'flash_get_rate_limits',
    description: 'Get current rate limit status for Flash Trade API calls.',
    parameters: {
      type: 'object',
      properties: {},
    },
  },
  run: async () => {
    return {
      result: {
        status: 'ok',
        rateLimits: {
          rest: {
            requestsPerSecond: 10,
            currentUsage: 'Monitor via response headers',
            note: '429 Too Many Requests returned when limit exceeded',
          },
          analytics: {
            timeoutMs: 60000,
            cacheTtlMs: 15000,
            note: 'Long-running analysis may timeout. Results are cached for performance.',
          },
        },
        bestPractices: [
          'Cache results when possible',
          'Use batch endpoints to reduce request count',
          'Implement exponential backoff on 429 errors',
          'Monitor AbortError for timeout handling',
        ],
        timestamp: Date.now(),
      },
    };
  },
};
