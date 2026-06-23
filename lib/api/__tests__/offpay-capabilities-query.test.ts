import { QueryClient } from '@tanstack/react-query';

import { getCapabilities } from '@/lib/api/offpay-api-client';
import { offpayCapabilitiesCacheKey } from '@/lib/api/offpay-dashboard-cache';
import {
  buildUnavailableCapabilities,
  CAPABILITIES_FAST_TIMEOUT_MS,
} from '@/lib/api/offpay-capability-fallback';
import {
  offpayCapabilitiesQueryKey,
  offpayCapabilitiesQueryOptions,
  prefetchOffpayCapabilities,
} from '@/lib/api/offpay-capabilities-query';

jest.mock('@/lib/api/offpay-api-client', () => ({
  getCapabilities: jest.fn(),
  getWalletDashboard: jest.fn(),
}));

const mockGetCapabilities = getCapabilities as jest.MockedFunction<typeof getCapabilities>;
const queryClients: QueryClient[] = [];

function createQueryClient(): QueryClient {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });
  queryClients.push(queryClient);
  return queryClient;
}

function createCapabilities(message: string) {
  return buildUnavailableCapabilities('devnet', message);
}

describe('offpay capabilities query helpers', () => {
  afterEach(() => {
    for (const queryClient of queryClients.splice(0)) {
      queryClient.clear();
    }
  });

  it('uses the same network cache key that wallet dashboard hydration writes', () => {
    expect(offpayCapabilitiesQueryKey('devnet')).toEqual(offpayCapabilitiesCacheKey('devnet'));
  });

  it('fetches capabilities with the shared fast timeout and request owner', async () => {
    const queryClient = createQueryClient();
    const capabilities = createCapabilities('fresh capabilities');
    mockGetCapabilities.mockResolvedValueOnce(capabilities);

    const result = await queryClient.fetchQuery(
      offpayCapabilitiesQueryOptions({
        network: 'devnet',
        requestOwner: 'test.capabilities',
      }),
    );

    expect(result).toBe(capabilities);
    expect(mockGetCapabilities).toHaveBeenCalledWith(
      'devnet',
      expect.objectContaining({
        timeoutMs: CAPABILITIES_FAST_TIMEOUT_MS,
        requestOwner: 'test.capabilities',
      }),
    );
  });

  it('does not refetch fresh cached capabilities during startup prefetch', async () => {
    const queryClient = createQueryClient();
    const cachedCapabilities = createCapabilities('cached capabilities');

    queryClient.setQueryData(offpayCapabilitiesQueryKey('devnet'), cachedCapabilities, {
      updatedAt: Date.now(),
    });

    await prefetchOffpayCapabilities({
      queryClient,
      network: 'devnet',
      requestOwner: 'bootstrap.capabilities',
    });

    expect(mockGetCapabilities).not.toHaveBeenCalled();
    expect(queryClient.getQueryData(offpayCapabilitiesQueryKey('devnet'))).toBe(
      cachedCapabilities,
    );
  });

  it('forces a capabilities refresh after bootstrap recovery', async () => {
    const queryClient = createQueryClient();
    const cachedCapabilities = createCapabilities('cached capabilities');
    const refreshedCapabilities = createCapabilities('refreshed capabilities');

    queryClient.setQueryData(offpayCapabilitiesQueryKey('devnet'), cachedCapabilities, {
      updatedAt: Date.now(),
    });
    mockGetCapabilities.mockResolvedValueOnce(refreshedCapabilities);

    await prefetchOffpayCapabilities({
      queryClient,
      network: 'devnet',
      requestOwner: 'bootstrap.capabilities.recovery',
      force: true,
    });

    expect(mockGetCapabilities).toHaveBeenCalledWith(
      'devnet',
      expect.objectContaining({
        requestOwner: 'bootstrap.capabilities.recovery',
      }),
    );
    expect(queryClient.getQueryData(offpayCapabilitiesQueryKey('devnet'))).toEqual(
      refreshedCapabilities,
    );
  });
});
