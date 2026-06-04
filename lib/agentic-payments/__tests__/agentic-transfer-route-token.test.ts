import { resolveTransferTokenForRoute } from '@/lib/agentic-payments/transfer-route-token';

import type { AgenticPrivateSendAction } from '@/store/agenticChatStore';
import type { WalletBalanceResponse } from '@/types/offpay-api';

const MAINNET_USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const MAINNET_USDT = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB';
const DEVNET_MAGICBLOCK_USDC = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
const DEVNET_UMBRA_DUSDC = '4oG4sjmopf5MzvTHLE8rpVJ2uyczxfsw2K84SUTpNDx7';

function action(
  overrides: Pick<AgenticPrivateSendAction, 'network' | 'tokenMint' | 'tokenSymbol'>,
): Pick<AgenticPrivateSendAction, 'network' | 'tokenMint' | 'tokenSymbol'> {
  return overrides;
}

function balanceWith(tokens: WalletBalanceResponse['tokens']): WalletBalanceResponse {
  return {
    address: 'wallet',
    network: 'devnet',
    solBalance: 1,
    fetchedAt: 1,
    tokens,
  };
}

function token(mint: string, symbol: string): WalletBalanceResponse['tokens'][number] {
  return {
    mint,
    name: symbol,
    symbol,
    logo: null,
    balance: '10',
    decimals: 6,
    verified: true,
    spam: false,
  };
}

describe('resolveTransferTokenForRoute', () => {
  it('keeps mainnet USDC on the same mint for Umbra and MagicBlock', () => {
    const source = action({ network: 'mainnet', tokenMint: MAINNET_USDC, tokenSymbol: 'USDC' });
    const balance = balanceWith([token(MAINNET_USDC, 'USDC')]);

    expect(resolveTransferTokenForRoute({ action: source, route: 'umbra', balance })).toEqual({
      ok: true,
      token: MAINNET_USDC,
    });
    expect(resolveTransferTokenForRoute({ action: source, route: 'magicblock', balance })).toEqual({
      ok: true,
      token: MAINNET_USDC,
    });
  });

  it('keeps mainnet USDT on the same mint for Umbra and MagicBlock', () => {
    const source = action({ network: 'mainnet', tokenMint: MAINNET_USDT, tokenSymbol: 'USDT' });
    const balance = balanceWith([token(MAINNET_USDT, 'USDT')]);

    expect(resolveTransferTokenForRoute({ action: source, route: 'umbra', balance })).toEqual({
      ok: true,
      token: MAINNET_USDT,
    });
    expect(resolveTransferTokenForRoute({ action: source, route: 'magicblock', balance })).toEqual({
      ok: true,
      token: MAINNET_USDT,
    });
  });

  it('maps devnet MagicBlock USDC to Umbra dUSDC when the user selects Umbra', () => {
    const source = action({
      network: 'devnet',
      tokenMint: DEVNET_MAGICBLOCK_USDC,
      tokenSymbol: 'USDC',
    });
    const balance = balanceWith([
      token(DEVNET_MAGICBLOCK_USDC, 'USDC'),
      token(DEVNET_UMBRA_DUSDC, 'dUSDC'),
    ]);

    expect(resolveTransferTokenForRoute({ action: source, route: 'umbra', balance })).toEqual({
      ok: true,
      token: DEVNET_UMBRA_DUSDC,
    });
  });

  it('maps devnet Umbra dUSDC back to USDC when the user selects MagicBlock', () => {
    const source = action({
      network: 'devnet',
      tokenMint: DEVNET_UMBRA_DUSDC,
      tokenSymbol: 'dUSDC',
    });
    const balance = balanceWith([
      token(DEVNET_MAGICBLOCK_USDC, 'USDC'),
      token(DEVNET_UMBRA_DUSDC, 'dUSDC'),
    ]);

    expect(resolveTransferTokenForRoute({ action: source, route: 'magicblock', balance })).toEqual({
      ok: true,
      token: 'USDC',
    });
  });
});
