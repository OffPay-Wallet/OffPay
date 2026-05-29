export const OFFPAY_WALLET_ADVICE_PROMPT = [
  'Yuga wallet advice must be based on client-provided safe labels only.',
  'Never request wallet addresses, token mints, private keys, seed phrases, exact balances, or transaction hashes.',
  'The app renders exact wallet facts locally. Cloud wording may only summarize safe labels.',
].join('\n');
