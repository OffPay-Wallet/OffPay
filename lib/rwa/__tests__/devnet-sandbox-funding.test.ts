import {
  assertRwaDevnetSandboxFaucetCoversRequirement,
  getRwaDevnetSandboxFundingRequirement,
} from '@/lib/rwa/devnet-sandbox-funding';

import type { RwaAsset, RwaQuoteResponse, WalletBalanceResponse } from '@/types/offpay-api';
import type { DevnetAirdropResult } from '@/lib/faucet/devnet-airdrop';

const ASSET_MINT = 'CrieBJEXarFm2C7vgPJs9v7M9PLuHV6axkNWhjUTwKZq';
const SETTLEMENT_MINT = 'GN2nuuhUG2PnG6RsdGEcucuu1Ev2HRaacmrprVWBmKdE';

const asset: Pick<
  RwaAsset,
  'decimals' | 'devnetSandbox' | 'mint' | 'settlementMint' | 'settlementSymbol' | 'symbol'
> = {
  decimals: 6,
  devnetSandbox: true,
  mint: ASSET_MINT,
  settlementMint: SETTLEMENT_MINT,
  settlementSymbol: 'USDC',
  symbol: 'AAPLd',
};

const quote: Pick<
  RwaQuoteResponse,
  'assetMint' | 'cashAmount' | 'providerEnvironment' | 'quantity' | 'settlementMint'
> = {
  assetMint: ASSET_MINT,
  cashAmount: '1',
  providerEnvironment: 'devnet_sandbox',
  quantity: '0.005066',
  settlementMint: SETTLEMENT_MINT,
};

function walletBalance(tokens: WalletBalanceResponse['tokens']): WalletBalanceResponse {
  return {
    address: 'wallet',
    fetchedAt: 1,
    network: 'devnet',
    solBalance: 1,
    tokens,
  };
}

function faucetResult(tokens: DevnetAirdropResult['tokens']): DevnetAirdropResult {
  return {
    nextEligibleAt: 2,
    signature: 'signature',
    sol: 0.25,
    tokens,
  };
}

describe('RWA Devnet sandbox funding requirements', () => {
  it('checks the real settlement mint for sandbox buys', () => {
    const requirement = getRwaDevnetSandboxFundingRequirement({
      asset,
      inputAmount: '1',
      network: 'devnet',
      quote,
      side: 'buy',
      walletBalance: walletBalance([]),
    });

    expect(requirement).toMatchObject({
      amount: '1',
      balanceAmount: '0',
      hasEnough: false,
      mint: SETTLEMENT_MINT,
      missingAmount: '1',
      symbol: 'RWAUSDC',
    });
  });

  it('passes when the wallet already has enough settlement tokens', () => {
    const requirement = getRwaDevnetSandboxFundingRequirement({
      asset,
      inputAmount: '1',
      network: 'devnet',
      quote,
      side: 'buy',
      walletBalance: walletBalance([
        {
          balance: '2.5',
          decimals: 6,
          logo: null,
          mint: SETTLEMENT_MINT,
          name: 'Devnet RWA Settlement USDC',
          spam: false,
          symbol: 'RWAUSDC',
          verified: true,
        },
      ]),
    });

    expect(requirement?.hasEnough).toBe(true);
    expect(requirement?.balanceAmount).toBe('2.5');
  });

  it('checks the asset mint for sandbox sells', () => {
    const requirement = getRwaDevnetSandboxFundingRequirement({
      asset,
      inputAmount: '0.25',
      network: 'devnet',
      quote: {
        ...quote,
        quantity: '0.25',
      },
      side: 'sell',
      walletBalance: walletBalance([]),
    });

    expect(requirement).toMatchObject({
      amount: '0.25',
      hasEnough: false,
      mint: ASSET_MINT,
      missingAmount: '0.25',
      symbol: 'AAPLd',
    });
  });

  it('rejects faucet results that do not include the required sandbox token', () => {
    const requirement = getRwaDevnetSandboxFundingRequirement({
      asset,
      inputAmount: '1',
      network: 'devnet',
      quote,
      side: 'buy',
      walletBalance: walletBalance([]),
    });

    expect(() =>
      assertRwaDevnetSandboxFaucetCoversRequirement(
        requirement!,
        faucetResult([
          {
            amount: 100,
            capAmount: 100,
            capRawAmount: '100000000',
            decimals: 6,
            mint: '4oG4sjmopf5MzvTHLE8rpVJ2uyczxfsw2K84SUTpNDx7',
            rawAmount: '100000000',
            recipientTokenAccount: 'ata',
            symbol: 'dUSDC',
          },
        ]),
      ),
    ).toThrow('Devnet faucet did not return RWAUSDC');
  });

  it('rejects orders above the sandbox faucet cap', () => {
    const requirement = getRwaDevnetSandboxFundingRequirement({
      asset,
      inputAmount: '2000',
      network: 'devnet',
      quote: {
        ...quote,
        cashAmount: '2000',
      },
      side: 'buy',
      walletBalance: walletBalance([]),
    });

    expect(() =>
      assertRwaDevnetSandboxFaucetCoversRequirement(
        requirement!,
        faucetResult([
          {
            amount: 1000,
            capAmount: 1000,
            capRawAmount: '1000000000',
            decimals: 6,
            mint: SETTLEMENT_MINT,
            rawAmount: '1000000000',
            recipientTokenAccount: 'ata',
            symbol: 'RWAUSDC',
          },
        ]),
      ),
    ).toThrow('Devnet faucet caps RWAUSDC at 1000');
  });
});
