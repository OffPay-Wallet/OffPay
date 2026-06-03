import { createNetworkCacheKey, memoryCache } from './cache.js';
import { getWalletBalance, getWalletTransactions } from './helius.js';
import type { Bindings, Network } from './types.js';

const RISK_SCORE_CACHE_TTL_MS = 60 * 60 * 1000;
const RISK_ANALYSIS_TRANSACTION_LIMIT = 50;
const FAILURE_RATE_MIN_SAMPLE = 5;
const NEW_BADGE_MIN_SCORE = 40;
const ZERO_HISTORY_FUNDED_SCORE = 42;
const ZERO_HISTORY_UNFUNDED_SCORE = 20;

type RiskBadge = 'NEW' | 'CAUTION' | 'ESTABLISHED' | 'FLAGGED';

interface RiskScoreResponse {
  address: string;
  badge: RiskBadge;
  score: number;
  factors: string[];
  assessedAt: number;
}

interface RiskScoreRequest {
  address: string;
  network: Network;
  useCache?: boolean;
}

interface RiskSignals {
  txCount: number;
  successfulTxCount: number;
  failedTxCount: number;
  uniqueCounterpartyCount: number;
  counterpartyDiversityRatio: number;
  spamTokenCount: number;
  verifiedTokenCount: number;
  nonSpamTokenCount: number;
  hasRecentActivity: boolean;
  solBalanceLamports: number;
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function uniqueStrings(values: Iterable<string>): string[] {
  return Array.from(new Set(values));
}

function summarizeSignals(
  balance: Awaited<ReturnType<typeof getWalletBalance>>,
  transactions: Awaited<ReturnType<typeof getWalletTransactions>>,
): RiskSignals {
  const uniqueCounterparties = uniqueStrings(
    transactions.transactions.flatMap((entry) =>
      entry.counterparties.map((counterparty) => counterparty.address),
    ),
  );

  const nowSeconds = Math.floor(Date.now() / 1000);

  return {
    txCount: transactions.transactions.length,
    successfulTxCount: transactions.transactions.filter((entry) => entry.status === 'success').length,
    failedTxCount: transactions.transactions.filter((entry) => entry.status === 'failed').length,
    uniqueCounterpartyCount: uniqueCounterparties.length,
    counterpartyDiversityRatio:
      transactions.transactions.length > 0
        ? uniqueCounterparties.length / transactions.transactions.length
        : 0,
    spamTokenCount: balance.tokens.filter((entry) => entry.spam).length,
    verifiedTokenCount: balance.tokens.filter((entry) => entry.verified && !entry.spam).length,
    nonSpamTokenCount: balance.tokens.filter((entry) => !entry.spam).length,
    hasRecentActivity: transactions.transactions.some(
      (entry) => nowSeconds - entry.timestamp <= 30 * 24 * 60 * 60,
    ),
    solBalanceLamports: balance.solBalance,
  };
}

function getRiskBadge(score: number, signals: RiskSignals): RiskBadge {
  if (score <= 25) {
    return 'FLAGGED';
  }

  if (
    signals.txCount < 5 &&
    signals.failedTxCount === 0 &&
    signals.spamTokenCount === 0 &&
    score >= NEW_BADGE_MIN_SCORE &&
    score < 75
  ) {
    return 'NEW';
  }

  if (score >= 75 && signals.txCount >= 5) {
    return 'ESTABLISHED';
  }

  return 'CAUTION';
}

function assertRiskAssessmentInvariants(
  score: number,
  badge: RiskBadge,
  signals: RiskSignals,
): void {
  if (score < 0 || score > 100) {
    throw new Error(`Risk score out of bounds: ${score}`);
  }

  if (badge === 'ESTABLISHED' && signals.txCount < 5) {
    throw new Error('ESTABLISHED badge requires at least 5 transactions.');
  }

  if (
    badge === 'NEW' &&
    (
      signals.txCount >= 5 ||
      signals.failedTxCount > 0 ||
      signals.spamTokenCount > 0 ||
      score < NEW_BADGE_MIN_SCORE ||
      score >= 75
    )
  ) {
    throw new Error('NEW badge requires a clean low-history wallet with a minimum score floor.');
  }

  if (badge !== 'FLAGGED' && score <= 25) {
    throw new Error(`Score ${score} must resolve to FLAGGED.`);
  }
}

function buildRiskAssessment(address: string, signals: RiskSignals): RiskScoreResponse {
  if (signals.txCount === 0) {
    const score =
      signals.solBalanceLamports > 0 ? ZERO_HISTORY_FUNDED_SCORE : ZERO_HISTORY_UNFUNDED_SCORE;
    const badge = getRiskBadge(score, signals);
    const factors = ['No transaction history was detected.'];

    if (signals.solBalanceLamports > 0) {
      factors.push('Wallet holds SOL but has not established any on-chain history yet.');
    } else {
      factors.push('Wallet has not established any funded on-chain activity.');
    }

    assertRiskAssessmentInvariants(score, badge, signals);

    return {
      address,
      badge,
      score,
      factors,
      assessedAt: Date.now(),
    };
  }

  let score = 55;
  const factors: string[] = [];

  if (signals.txCount < 5) {
    score -= 8;
    factors.push('Only a small amount of on-chain activity was found.');
  } else if (signals.txCount >= 25) {
    score += 14;
    factors.push('Consistent transaction history was detected.');
  } else {
    score += 6;
    factors.push('Moderate on-chain activity was detected.');
  }

  if (signals.uniqueCounterpartyCount >= 10 && signals.counterpartyDiversityRatio > 0.3) {
    score += 14;
    factors.push('Activity spans a broad set of counterparties.');
  } else if (signals.uniqueCounterpartyCount >= 10) {
    score += 6;
    factors.push('Activity touches many counterparties but remains concentrated.');
  } else if (signals.uniqueCounterpartyCount >= 3) {
    score += 8;
    factors.push('Activity spans multiple counterparties.');
  } else {
    score -= 6;
    factors.push('Counterparty history is still limited.');
  }

  if (signals.failedTxCount > 0) {
    const failureRate = signals.failedTxCount / Math.max(signals.txCount, FAILURE_RATE_MIN_SAMPLE);
    if (failureRate >= 0.25) {
      score -= 20;
      factors.push('Recent transaction failures raise reliability concerns.');
    } else if (failureRate >= 0.1) {
      score -= 8;
      factors.push('Some recent transaction failures were detected.');
    }
  }

  if (signals.spamTokenCount >= 3) {
    score -= 20;
    factors.push('Multiple suspicious token balances were detected.');
  } else if (signals.spamTokenCount > 0) {
    score -= 10;
    factors.push('A suspicious token balance was detected.');
  }

  if (signals.verifiedTokenCount >= 2) {
    score += 6;
    factors.push('Holdings include established token balances.');
  } else if (signals.nonSpamTokenCount > 0) {
    score += 3;
    factors.push('Holdings include non-spam token balances.');
  }

  if (signals.hasRecentActivity) {
    score += 8;
    factors.push('Recent activity was observed on-chain.');
  } else {
    score -= 8;
    factors.push('No recent activity was observed on-chain.');
  }

  if (signals.solBalanceLamports > 0) {
    score += 4;
  }

  const normalizedScore = clampScore(score);
  const badge = getRiskBadge(normalizedScore, signals);
  assertRiskAssessmentInvariants(normalizedScore, badge, signals);

  return {
    address,
    badge,
    score: normalizedScore,
    factors: Array.from(new Set(factors)).slice(0, 5),
    assessedAt: Date.now(),
  };
}

async function getRiskScore(
  bindings: Bindings,
  request: RiskScoreRequest,
): Promise<RiskScoreResponse> {
  const useCache = request.useCache ?? true;
  const cacheKey = createNetworkCacheKey(request.network, 'risk-score', [request.address]);

  const resolver = async () => {
    const [balance, transactions] = await Promise.all([
      getWalletBalance(bindings, {
        address: request.address,
        network: request.network,
      }),
      getWalletTransactions(bindings, {
        address: request.address,
        network: request.network,
        limit: RISK_ANALYSIS_TRANSACTION_LIMIT,
      }),
    ]);

    return buildRiskAssessment(request.address, summarizeSignals(balance, transactions));
  };

  return useCache ? memoryCache.getOrSet(cacheKey, RISK_SCORE_CACHE_TTL_MS, resolver) : resolver();
}

export {
  RISK_ANALYSIS_TRANSACTION_LIMIT,
  RISK_SCORE_CACHE_TTL_MS,
  getRiskScore,
  type RiskBadge,
  type RiskScoreRequest,
  type RiskScoreResponse,
  type RiskSignals,
};
