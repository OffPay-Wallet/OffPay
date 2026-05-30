jest.mock('@/lib/umbra/umbra-execution', () => ({
  __esModule: true,
  fetchUmbraVaultRegistrationStatus: jest.fn(),
}));
jest.mock('@/lib/umbra/umbra-offpay-providers', () => ({
  __esModule: true,
  verifyOffpayUmbraVaultFeeAccountReadiness: jest.fn(),
}));

import {
  gatherPayrollRunReadiness,
  PAYROLL_MIN_FEE_LAMPORTS,
} from '@/lib/payroll/payroll-run-readiness';
import { fetchUmbraVaultRegistrationStatus } from '@/lib/umbra/umbra-execution';
import { verifyOffpayUmbraVaultFeeAccountReadiness } from '@/lib/umbra/umbra-offpay-providers';

const mockRegistration = fetchUmbraVaultRegistrationStatus as jest.Mock;
const mockVaultFee = verifyOffpayUmbraVaultFeeAccountReadiness as jest.Mock;

const MAINNET_USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

function baseParams() {
  return {
    walletAddress: 'sender',
    walletId: null,
    network: 'mainnet' as const,
    mint: MAINNET_USDC,
    solLamports: PAYROLL_MIN_FEE_LAMPORTS,
    umbraEligible: true,
  };
}

describe('gatherPayrollRunReadiness', () => {
  beforeEach(() => {
    mockRegistration.mockReset();
    mockVaultFee.mockReset();
  });

  it('resolves real sender mixer + vault-fee readiness and fee buffer', async () => {
    mockRegistration.mockResolvedValue({ mixerRegistered: true });
    mockVaultFee.mockResolvedValue({ available: true });

    const readiness = await gatherPayrollRunReadiness(baseParams());

    expect(readiness).toEqual({
      umbraSenderMixerRegistered: true,
      umbraVaultFeeReady: true,
      hasFeeSol: true,
    });
  });

  it('reports sender not registered when the probe says so (drives setup prompt)', async () => {
    mockRegistration.mockResolvedValue({ mixerRegistered: false });
    mockVaultFee.mockResolvedValue({ available: true });

    const readiness = await gatherPayrollRunReadiness(baseParams());
    expect(readiness.umbraSenderMixerRegistered).toBe(false);
    expect(readiness.umbraVaultFeeReady).toBe(true);
  });

  it('flags insufficient SOL below the fee buffer', async () => {
    mockRegistration.mockResolvedValue({ mixerRegistered: true });
    mockVaultFee.mockResolvedValue({ available: true });

    const readiness = await gatherPayrollRunReadiness({
      ...baseParams(),
      solLamports: PAYROLL_MIN_FEE_LAMPORTS - 1,
    });
    expect(readiness.hasFeeSol).toBe(false);
  });

  it('skips Umbra probes entirely when not Umbra-eligible', async () => {
    const readiness = await gatherPayrollRunReadiness({ ...baseParams(), umbraEligible: false });

    expect(readiness.umbraSenderMixerRegistered).toBe(false);
    expect(readiness.umbraVaultFeeReady).toBe(false);
    expect(mockRegistration).not.toHaveBeenCalled();
    expect(mockVaultFee).not.toHaveBeenCalled();
  });

  it('treats probe failures as not ready', async () => {
    mockRegistration.mockRejectedValue(new Error('rpc'));
    mockVaultFee.mockRejectedValue(new Error('rpc'));

    const readiness = await gatherPayrollRunReadiness(baseParams());
    expect(readiness.umbraSenderMixerRegistered).toBe(false);
    expect(readiness.umbraVaultFeeReady).toBe(false);
  });
});
