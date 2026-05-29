#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const sourceRoots = ['app', 'backend', 'components', 'constants', 'hooks', 'lib', 'providers', 'store', 'types'];
const allowedFetchFiles = new Set([
  path.join('backend', 'private-payments.ts'),
  path.join('backend', 'provider-router.ts'),
  path.join('backend', 'umbra.ts'),
  path.join('lib', 'offpay-api-client.ts'),
  path.join('lib', 'umbra-rn-zk-prover.ts'),
]);

const disallowedProviderPatterns = [
  /api\.jup\.ag/i,
  /helius/i,
  /@magicblock/i,
  /payments\.magicblock\.app/i,
  /https?:\/\/[^'"\s]*magicblock/i,
  /api\.mainnet-beta\.solana\.com/i,
  /api\.devnet\.solana\.com/i,
  /wss:\/\/api\./i,
];

const sourceHygienePatterns = [
  /\bmock(?:Data|Transactions|Balances|Tokens)?\b/i,
  /\bstub\b/i,
  /\bcoming soon\b/i,
  /\bTODO\b/,
];

const unstableStoreSelectorPatterns = [
  /use[A-Za-z0-9]+Store\(\s*\([^)]*\)\s*=>\s*[^;\n)]*\.(?:filter|map|slice)\s*\(/,
  /use[A-Za-z0-9]+Store\(\s*\([^)]*\)\s*=>\s*\n\s*[^;\n)]*\.(?:filter|map|slice)\s*\(/,
  /use[A-Za-z0-9]+Store\(\s*\([^)]*\)\s*=>\s*(?:\[|\{)/,
];

function isTestLikeFile(relativePath) {
  return (
    relativePath.includes(`${path.sep}__tests__${path.sep}`) ||
    /\.(?:test|spec)\.[jt]sx?$/.test(relativePath)
  );
}

function isClientBackendAdapter(relativePath) {
  return relativePath.split(path.sep)[0] === 'backend';
}

function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(fullPath);
    if (!/\.(ts|tsx|js|jsx)$/.test(entry.name)) return [];
    return [fullPath];
  });
}

function readRelative(filePath) {
  return path.relative(root, filePath);
}

function assertGitignored(requiredPath) {
  const gitignore = fs.readFileSync(path.join(root, '.gitignore'), 'utf8');
  const normalized = requiredPath.replace(/\\/g, '/');
  const ignored = gitignore
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))
    .some((line) => line === normalized || line === `/${normalized}`);

  if (!ignored) {
    throw new Error(`${requiredPath} must remain in .gitignore.`);
  }
}

function assertFileDoesNotMatch(relativePath, pattern, message) {
  const source = fs.readFileSync(path.join(root, relativePath), 'utf8');
  if (pattern.test(source)) {
    throw new Error(message);
  }
}

function reportFailure(message, failures) {
  failures.push(message);
}

const files = sourceRoots.flatMap((sourceRoot) => walk(path.join(root, sourceRoot)));
const failures = [];

for (const file of files) {
  const relative = readRelative(file);
  const source = fs.readFileSync(file, 'utf8');
  const testLike = isTestLikeFile(relative);

  if (!testLike && /\bfetch\s*\(/.test(source) && !allowedFetchFiles.has(relative)) {
    reportFailure(
      `${relative}: fetch() must stay in lib/offpay-api-client.ts or the client-side backend adapters.`,
      failures,
    );
  }

  for (const pattern of disallowedProviderPatterns) {
    if (testLike || isClientBackendAdapter(relative)) break;
    if (pattern.test(source)) {
      reportFailure(`${relative}: direct provider/RPC reference matched ${pattern}.`, failures);
    }
  }

  for (const pattern of sourceHygienePatterns) {
    if (testLike) break;
    if (pattern.test(source)) {
      reportFailure(`${relative}: source hygiene pattern matched ${pattern}.`, failures);
    }
  }

  for (const pattern of unstableStoreSelectorPatterns) {
    if (testLike) break;
    if (pattern.test(source)) {
      reportFailure(
        `${relative}: Zustand selectors must return stable store values; derive arrays/objects with useMemo after selecting raw state.`,
        failures,
      );
    }
  }
}

assertGitignored('plan.md');
assertGitignored('client-module-status.md');
assertGitignored('missing-ui-screens.md');
assertFileDoesNotMatch(
  path.join('providers', 'OffpayBootstrapProvider.tsx'),
  /=\s*prototypeBypassOffpayAttestationAdapter\b/,
  'OffpayBootstrapProvider must not default to prototype attestation bypass.',
);
assertFileDoesNotMatch(
  path.join('lib', 'bootstrap', 'offpay-bootstrap.ts'),
  /\?\?\s*prototypeBypassOffpayAttestationAdapter\b/,
  'bootstrapOffpayRequestSecret must not default to prototype attestation bypass.',
);
assertFileDoesNotMatch(
  path.join('lib', 'offpay-api-client.ts'),
  /OFFPAY_APP_VERSION\s*=\s*['"]/,
  'OFFPAY_APP_VERSION must come from Expo/native metadata, not a hardcoded string.',
);

const offlineSlotsSource = fs.readFileSync(path.join(root, 'lib', 'offline-payment-slots.ts'), 'utf8');
if (
  !/spendAuthorization:\s*OfflineSlotSpendAuthorization/.test(offlineSlotsSource) ||
  !/params\.spendAuthorization\s*!==\s*'user-confirmed'/.test(offlineSlotsSource)
) {
  throw new Error(
    'prepareOfflinePaymentSlots must require explicit user-confirmed spend authorization before spending SOL.',
  );
}
if (
  !/reclaimAuthorization:\s*OfflineSlotReclaimAuthorization/.test(offlineSlotsSource) ||
  !/params\.reclaimAuthorization\s*!==\s*'user-confirmed'/.test(offlineSlotsSource)
) {
  throw new Error(
    'reclaimOfflinePaymentSlotRent must require explicit user-confirmed authorization before closing nonce accounts.',
  );
}

const offlineSlotsHookSource = fs.readFileSync(path.join(root, 'hooks', 'useOfflinePaymentSlots.ts'), 'utf8');
const autoSyncMatch = offlineSlotsHookSource.match(
  /export function useOfflinePaymentSlotsAutoSync\(\): void \{[\s\S]*?\n\}/,
);
if (autoSyncMatch != null && /prepareMutation\.mutate|prepareOfflinePaymentSlots/.test(autoSyncMatch[0])) {
  throw new Error('Offline payment slot auto-sync must never prepare or broadcast SOL-spending transactions.');
}

if (failures.length > 0) {
  console.error('Client hardening verification failed:');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log('Client hardening verification passed.');
