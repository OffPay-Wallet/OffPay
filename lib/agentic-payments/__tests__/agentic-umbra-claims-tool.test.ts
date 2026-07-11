import { scanUmbraClaimsTool } from '@/lib/agentic-payments/tools/scan-umbra-claims';
import type { AgenticToolRunnerContext } from '@/lib/agentic-payments/tools/types';
import type { UmbraExecutionResult } from '@/lib/umbra/umbra-types';
import type { CapabilitiesResponse } from '@/types/offpay-api';

const mockScanUmbraPrivateP2PClaims = jest.fn();

jest.mock('@/lib/umbra/umbra-execution', () => ({
  scanUmbraPrivateP2PClaims: (...args: unknown[]) => mockScanUmbraPrivateP2PClaims(...args),
}));

jest.mock('@/lib/umbra/umbra-rn-zk-prover', () => ({
  isRnZkProverNativeModuleAvailable: jest.fn(() => true),
}));

const available = { available: true, reason: 'available', message: 'Available' } as const;
const capabilities: CapabilitiesResponse['capabilities'] = {
  wallet: { balance: available, transactions: available },
  stream: { walletActivity: available },
  swap: {
    tokens: available,
    price: available,
    normalSwap: available,
    privacySwap: available,
    triggerOrders: available,
    recurringSwap: available,
  },
  rwa: {
    assets: available,
    price: available,
    quote: available,
    execute: available,
    magicBlockIntent: available,
    magicBlockTransfer: available,
  },
  perps: {
    markets: available,
    trade: available,
    magicBlockExecution: available,
  },
  payment: {
    privateInitMint: available,
    privateBalance: available,
    privateSend: available,
    umbraPrivateP2p: available,
    settle: available,
    rpcBroadcast: available,
  },
  umbra: { execution: available },
};

const context: AgenticToolRunnerContext = {
  scope: { walletAddress: '11111111111111111111111111111111', network: 'mainnet' },
  walletMode: 'online',
  canUseNetwork: true,
  balance: null,
  capabilities,
  knownWallets: [],
  redactions: [],
  userText: 'claim my Umbra claims',
  walletId: 'wallet-1',
  walletImportMethod: 'generated',
  offeredToolNames: ['scan_umbra_claims'],
};

function pendingResult(): UmbraExecutionResult {
  return {
    action: 'claim',
    walletAddress: context.scope.walletAddress ?? '',
    network: 'mainnet',
    title: 'Private payment ready',
    subtitle: 'Two claims ready',
    signatures: [],
    pendingClaimCount: 2,
    pendingClaimUtxoInsertionIndices: [41, 42],
    nextScanStartIndex: '43',
    vaultState: 'exists',
    vaultRegistered: true,
    vaultCanShield: true,
    mixerRegistered: true,
  };
}

describe('scan_umbra_claims agent tool', () => {
  beforeEach(() => {
    mockScanUmbraPrivateP2PClaims.mockReset();
    mockScanUmbraPrivateP2PClaims.mockResolvedValue(pendingResult());
  });

  it('creates an exact local claim draft while keeping indices out of the result', async () => {
    const outcome = await scanUmbraClaimsTool.run(
      { id: 'claim-call', name: 'scan_umbra_claims', args: { action: 'claim' } },
      context,
    );

    expect(outcome.draft).toMatchObject({
      kind: 'umbra_claim',
      draft: {
        claimCount: 2,
        destination: 'umbra_encrypted_balance',
        utxoInsertionIndices: [41, 42],
      },
    });
    expect(outcome.result).toMatchObject({
      status: 'drafted',
      pendingClaimCount: 2,
      claimExecution: 'confirmation_required',
    });
    expect(outcome.result).not.toHaveProperty('pendingClaimUtxoInsertionIndices');
    expect(outcome.result).not.toHaveProperty('nextScanStartIndex');
    expect(mockScanUmbraPrivateP2PClaims).toHaveBeenCalledWith(
      expect.objectContaining({ pageLimit: 48 }),
    );
  });

  it('keeps a scan read-only and reports confirmation availability', async () => {
    const outcome = await scanUmbraClaimsTool.run(
      { id: 'scan-call', name: 'scan_umbra_claims', args: { action: 'scan' } },
      { ...context, userText: 'scan my Umbra claims' },
    );

    expect(outcome.draft).toBeUndefined();
    expect(outcome.result).toMatchObject({
      status: 'ok',
      claimExecution: 'confirmation_required',
      claimToolAvailable: true,
    });
  });

  it.each([
    ['do not claim my Umbra claims', 'requires_explicit_umbra_claim_request'],
    ['how do I claim my Umbra claims?', 'requires_explicit_umbra_claim_request'],
    ['claim my Umbra claims\nshow my balance', 'requires_explicit_umbra_claim_request'],
  ])('rejects a non-executable latest request: %s', async (userText, code) => {
    const outcome = await scanUmbraClaimsTool.run(
      { id: 'claim-call', name: 'scan_umbra_claims', args: { action: 'claim' } },
      { ...context, userText },
    );

    expect(outcome).toEqual({ error: { code } });
    expect(mockScanUmbraPrivateP2PClaims).not.toHaveBeenCalled();
  });
});
