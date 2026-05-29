import { ed25519 } from '@noble/curves/ed25519.js';
import bs58 from 'bs58';

import { validateAgenticNormalSendDraft } from '@/lib/agentic-payments/normal-send';
import { validateAgenticPrivateSendDraft } from '@/lib/agentic-payments/private-send';

import type { CapabilitiesResponse, WalletBalanceResponse } from '@/types/offpay-api';

const available = {
  available: true,
  reason: 'available',
  message: 'Available',
} as const;

const capabilities: CapabilitiesResponse['capabilities'] = {
  wallet: {
    balance: available,
    transactions: available,
  },
  stream: {
    walletActivity: available,
  },
  swap: {
    tokens: available,
    price: available,
    normalSwap: available,
    privacySwap: available,
    triggerOrders: available,
    recurringSwap: available,
  },
  payment: {
    privateInitMint: available,
    privateBalance: available,
    privateSend: available,
    settle: available,
    rpcBroadcast: available,
  },
};

const walletAddress = addressFromSeedByte(1);
const recipient = addressFromSeedByte(2);
const namedWalletRecipient = addressFromSeedByte(3);
const devnetUsdcMint = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
const devnetUmbraDusdcMint = '4oG4sjmopf5MzvTHLE8rpVJ2uyczxfsw2K84SUTpNDx7';
const knownWallets = [
  { name: 'Account 1', address: walletAddress, active: true },
  { name: 'Savings Wallet', address: namedWalletRecipient, active: false },
];

function addressFromSeedByte(byte: number): string {
  return bs58.encode(ed25519.getPublicKey(new Uint8Array(32).fill(byte)));
}

const balance: WalletBalanceResponse = {
  address: walletAddress,
  network: 'devnet',
  solBalance: 1_000_000_000,
  tokens: [
    {
      mint: devnetUsdcMint,
      name: 'Devnet USDC',
      symbol: 'USDC',
      logo: null,
      balance: '10',
      decimals: 6,
      verified: true,
      spam: false,
    },
  ],
  fetchedAt: 1_713_996_000_000,
};

describe('validateAgenticPrivateSendDraft', () => {
  it('uses the single non-active address from user text when AI drafted the active wallet', () => {
    const result = validateAgenticPrivateSendDraft({
      input: {
        recipient: walletAddress,
        amount: '5',
        token: 'dusdc',
      },
      userText: `Can you send 5dusdc from my wallet to ${recipient} using magicblock route`,
      walletAddress,
      knownWallets,
      network: 'devnet',
      walletMode: 'online',
      canUseNetwork: true,
      balance,
      capabilities,
    });

    expect(result).toMatchObject({
      ok: true,
      draft: {
        recipient,
        rawAmount: '5000000',
        tokenMint: devnetUsdcMint,
      },
    });
  });

  it('blocks explicit network mismatches instead of silently using the active network', () => {
    const result = validateAgenticPrivateSendDraft({
      input: {
        recipient,
        amount: '5',
        token: 'USDC',
      },
      userText: `Send 5 USDC on devnet to ${recipient}`,
      walletAddress,
      knownWallets,
      network: 'mainnet',
      walletMode: 'online',
      canUseNetwork: true,
      balance: { ...balance, network: 'mainnet' },
      capabilities,
    });

    expect(result).toMatchObject({
      ok: false,
      message: expect.stringContaining('mentions devnet'),
    });
  });

  it('does not treat compact stablecoin token wording as a network hint', () => {
    const result = validateAgenticPrivateSendDraft({
      input: {
        recipient,
        amount: '5',
        token: 'dusdc',
      },
      userText: `Can you send 5dusdc from my wallet to ${recipient} using magicblock route`,
      walletAddress,
      knownWallets,
      network: 'mainnet',
      walletMode: 'online',
      canUseNetwork: true,
      // Pretend the wallet has a `dUSDC` row on mainnet so the validator
      // does not bail on missing token; the point of the test is that
      // typing `dusdc` no longer trips the network mismatch guard.
      balance: {
        ...balance,
        network: 'mainnet',
        tokens: [
          {
            mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
            name: 'USD Coin',
            symbol: 'USDC',
            logo: null,
            balance: '10',
            decimals: 6,
            verified: true,
            spam: false,
          },
        ],
      },
      capabilities,
    });

    // Either the draft succeeds (token resolved as USDC) or the validator
    // reports a different error — the only outcome we're asserting against
    // is that it does not falsely accuse the user of mentioning devnet.
    if (!result.ok) {
      expect(result.message).not.toContain('mentions devnet');
    } else {
      expect(result.draft.tokenSymbol).toBe('USDC');
    }
  });

  it('allows the active wallet as recipient when the user asks for their own wallet', () => {
    const result = validateAgenticPrivateSendDraft({
      input: {
        recipient: walletAddress,
        amount: '1',
        token: 'dusdc',
      },
      userText: 'Send 1 dUSDC to my own wallet using magicblock',
      walletAddress,
      knownWallets,
      network: 'devnet',
      walletMode: 'online',
      canUseNetwork: true,
      balance,
      capabilities,
    });

    expect(result).toMatchObject({
      ok: true,
      draft: {
        recipient: walletAddress,
        rawAmount: '1000000',
      },
    });
  });

  it('does not accept the active wallet as recipient when self-send was not requested', () => {
    const result = validateAgenticPrivateSendDraft({
      input: {
        recipient: walletAddress,
        amount: '1',
        token: 'dusdc',
      },
      userText: 'Send 1 dUSDC with magicblock',
      walletAddress,
      knownWallets,
      network: 'devnet',
      walletMode: 'online',
      canUseNetwork: true,
      balance,
      capabilities,
    });

    expect(result).toMatchObject({
      ok: false,
      message: expect.stringContaining('recipient wallet address'),
    });
  });

  it('resolves a named local wallet from safe wallet context', () => {
    const result = validateAgenticPrivateSendDraft({
      input: {
        recipient: 'Savings Wallet',
        amount: '2',
        token: 'dusdc',
      },
      userText: 'Send 2 dUSDC to Savings Wallet using magicblock',
      walletAddress,
      knownWallets,
      network: 'devnet',
      walletMode: 'online',
      canUseNetwork: true,
      balance,
      capabilities,
    });

    expect(result).toMatchObject({
      ok: true,
      draft: {
        recipient: namedWalletRecipient,
        rawAmount: '2000000',
      },
    });
  });

  it('recognizes "to my main wallet" as a self-recipient request', () => {
    const result = validateAgenticPrivateSendDraft({
      input: {
        recipient: walletAddress,
        amount: '1',
        token: 'dusdc',
      },
      userText: 'Send 1 dUSDC to my main wallet via magicblock',
      walletAddress,
      knownWallets,
      network: 'devnet',
      walletMode: 'online',
      canUseNetwork: true,
      balance,
      capabilities,
    });

    expect(result).toMatchObject({
      ok: true,
      selfRecipientRequested: true,
      draft: {
        recipient: walletAddress,
        selfRecipientRequested: true,
      },
    });
  });

  it('recognizes "back to me" as a self-recipient request', () => {
    const result = validateAgenticPrivateSendDraft({
      input: {
        recipient: walletAddress,
        amount: '1',
        token: 'dusdc',
      },
      userText: 'Please send 1 dUSDC back to me through magicblock',
      walletAddress,
      knownWallets,
      network: 'devnet',
      walletMode: 'online',
      canUseNetwork: true,
      balance,
      capabilities,
    });

    expect(result).toMatchObject({
      ok: true,
      selfRecipientRequested: true,
    });
  });

  it('does not classify "to my brother\'s wallet" as a self-recipient request', () => {
    const result = validateAgenticPrivateSendDraft({
      input: {
        recipient: walletAddress,
        amount: '1',
        token: 'dusdc',
      },
      userText: "Send 1 dUSDC to my brother's wallet using magicblock",
      walletAddress,
      knownWallets,
      network: 'devnet',
      walletMode: 'online',
      canUseNetwork: true,
      balance,
      capabilities,
    });

    expect(result).toMatchObject({
      ok: false,
      message: expect.stringContaining('recipient wallet address'),
    });
  });

  it('treats a clarification reply of "My own wallet" as a self-recipient request', () => {
    const result = validateAgenticPrivateSendDraft({
      input: {
        recipient: walletAddress,
        amount: '5',
        token: 'usdc',
      },
      // Simulates the chat screen folding the prior user turn into the
      // validator text: "5 usdc" was the original prompt and "My own
      // wallet" is the clarification reply.
      userText: '5 usdc\nMy own wallet',
      walletAddress,
      knownWallets,
      network: 'devnet',
      walletMode: 'online',
      canUseNetwork: true,
      balance,
      capabilities,
    });

    expect(result).toMatchObject({
      ok: true,
      selfRecipientRequested: true,
      draft: {
        recipient: walletAddress,
      },
    });
  });

  it('treats a bare "myself" reply as a self-recipient request', () => {
    const result = validateAgenticPrivateSendDraft({
      input: {
        recipient: walletAddress,
        amount: '2',
        token: 'usdc',
      },
      userText: '2 usdc\nmyself',
      walletAddress,
      knownWallets,
      network: 'devnet',
      walletMode: 'online',
      canUseNetwork: true,
      balance,
      capabilities,
    });

    expect(result).toMatchObject({
      ok: true,
      selfRecipientRequested: true,
    });
  });

  it('does not match incidental "tell me" phrasing as a self-recipient request', () => {
    const result = validateAgenticPrivateSendDraft({
      input: {
        recipient: walletAddress,
        amount: '1',
        token: 'usdc',
      },
      userText: 'Send 1 USDC and tell me when done',
      walletAddress,
      knownWallets,
      network: 'devnet',
      walletMode: 'online',
      canUseNetwork: true,
      balance,
      capabilities,
    });

    expect(result).toMatchObject({
      ok: false,
      message: expect.stringContaining('recipient wallet address'),
    });
  });
});

describe('validateAgenticNormalSendDraft', () => {
  it('drafts normal-route self-send only when the user requests their own wallet', () => {
    const result = validateAgenticNormalSendDraft({
      input: {
        recipient: walletAddress,
        amount: '3',
        token: 'dusdc',
      },
      userText: 'Hey send 3 dusdc using normal route to my own wallet',
      walletAddress,
      knownWallets,
      network: 'devnet',
      walletMode: 'online',
      canUseNetwork: true,
      balance,
      capabilities,
    });

    expect(result).toMatchObject({
      ok: true,
      draft: {
        recipient: walletAddress,
        rawAmount: '3000000',
        tokenMint: devnetUsdcMint,
      },
    });
  });

  it('blocks normal-route active-wallet recipient when self-send was not requested', () => {
    const result = validateAgenticNormalSendDraft({
      input: {
        recipient: walletAddress,
        amount: '3',
        token: 'dusdc',
      },
      userText: 'Hey send 3 dusdc using normal route',
      walletAddress,
      knownWallets,
      network: 'devnet',
      walletMode: 'online',
      canUseNetwork: true,
      balance,
      capabilities,
    });

    expect(result).toMatchObject({
      ok: false,
      message: expect.stringContaining('recipient wallet address'),
    });
  });

  it('prefers the exact symbol match over an alias match on a different mint', () => {
    // When devnet has both real USDC and a dUSDC token whose alias list
    // contains "USDC", typing "USDC" must resolve to the real USDC mint
    // rather than asking the user to disambiguate. An exact symbol match
    // outranks an alias match by precedence.
    const ambiguousBalance: WalletBalanceResponse = {
      ...balance,
      tokens: [
        balance.tokens[0],
        {
          mint: devnetUmbraDusdcMint,
          name: 'Devnet USDC (Umbra test)',
          symbol: 'dUSDC',
          logo: null,
          balance: '499.970126',
          decimals: 6,
          verified: true,
          spam: false,
        },
      ],
    };

    const result = validateAgenticNormalSendDraft({
      input: {
        recipient,
        amount: '3',
        token: 'USDC',
      },
      userText: `Hey send 3 USDC using normal route to ${recipient}`,
      walletAddress,
      knownWallets,
      network: 'devnet',
      walletMode: 'online',
      canUseNetwork: true,
      balance: ambiguousBalance,
      capabilities,
    });

    expect(result).toMatchObject({
      ok: true,
      draft: {
        tokenMint: devnetUsdcMint,
        tokenSymbol: 'USDC',
      },
    });
  });

  it('uses the exact token ticker when the user disambiguates similar tokens', () => {
    const ambiguousBalance: WalletBalanceResponse = {
      ...balance,
      tokens: [
        balance.tokens[0],
        {
          mint: devnetUmbraDusdcMint,
          name: 'Devnet USDC (Umbra test)',
          symbol: 'dUSDC',
          logo: null,
          balance: '499.970126',
          decimals: 6,
          verified: true,
          spam: false,
        },
      ],
    };

    const result = validateAgenticNormalSendDraft({
      input: {
        recipient,
        amount: '3',
        token: 'dUSDC',
      },
      userText: `Hey send 3 dUSDC using normal route to ${recipient}`,
      walletAddress,
      knownWallets,
      network: 'devnet',
      walletMode: 'online',
      canUseNetwork: true,
      balance: ambiguousBalance,
      capabilities,
    });

    expect(result).toMatchObject({
      ok: true,
      draft: {
        tokenMint: devnetUmbraDusdcMint,
        tokenSymbol: 'dUSDC',
      },
    });
  });
});
