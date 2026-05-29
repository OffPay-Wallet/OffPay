#!/usr/bin/env node

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const nodeCommand = process.execPath;
const jestBin = require.resolve('jest/bin/jest');
const startedAt = Date.now();
const rawArgs = process.argv.slice(2);
const coverageEnabled = rawArgs.includes('--coverage');
const androidExportEnabled = rawArgs.includes('--with-android-export');
const helpRequested = rawArgs.includes('--help') || rawArgs.includes('-h');
const passthroughJestArgs = rawArgs.filter(
  (arg) => arg !== '--coverage' && arg !== '--with-android-export',
);
const jestResultsPath = path.join(os.tmpdir(), `offpay-jest-results-${process.pid}.json`);

const liveSuites = [
  {
    name: 'Umbra live contract',
    flag: 'OFFPAY_LIVE_CONTRACT_TESTS',
    required: [
      'OFFPAY_LIVE_WALLET_ADDRESS',
      'OFFPAY_LIVE_SIGNING_SEED_HEX',
      'OFFPAY_LIVE_REQUEST_SECRET',
      'OFFPAY_LIVE_DEVICE_ID',
      'OFFPAY_LIVE_BOOTSTRAP_VERSION',
    ],
  },
  {
    name: 'Umbra execution live E2E',
    flag: 'OFFPAY_LIVE_UMBRA_EXECUTION_E2E',
    required: [
      'OFFPAY_LIVE_WALLET_ADDRESS',
      'OFFPAY_LIVE_SIGNING_SEED_HEX',
      'OFFPAY_LIVE_REQUEST_SECRET',
      'OFFPAY_LIVE_DEVICE_ID',
      'OFFPAY_LIVE_BOOTSTRAP_VERSION',
      'OFFPAY_LIVE_UMBRA_AMOUNT',
      'OFFPAY_LIVE_UMBRA_RECIPIENT',
    ],
  },
];

function formatDuration(ms) {
  const seconds = Math.round(ms / 100) / 10;
  return `${seconds.toFixed(1)}s`;
}

function printHelp() {
  console.log(`OffPay full test runner

Usage:
  npm run test:all
  npm run test:all -- --coverage
  npm run test:all -- --with-android-export
  npm run test:all -- --coverage --testNamePattern="offline"

Runs:
  1. TypeScript typecheck
  2. Expo lint
  3. Client hardening verification
  4. Every Jest-discovered unit, integration, contract, and E2E test file

Live tests:
  Live contract/E2E suites are included in Jest discovery, but their own guards skip them unless
  the OFFPAY_LIVE_* credentials are present.
`);
}

function runStep(label, command, args, options = {}) {
  const stepStartedAt = Date.now();
  console.log(`\n==> ${label}`);
  console.log(`$ ${[command, ...args].join(' ')}`);

  const result = spawnSync(command, args, {
    cwd: root,
    env: process.env,
    stdio: 'inherit',
    ...options,
  });
  const duration = formatDuration(Date.now() - stepStartedAt);

  if (result.error != null) {
    console.error(`\n${label} failed to start after ${duration}: ${result.error.message}`);
    process.exit(1);
  }

  if (result.status !== 0) {
    console.error(`\n${label} failed after ${duration}.`);
    process.exit(result.status ?? 1);
  }

  console.log(`${label} passed in ${duration}.`);
}

function listJestTests() {
  const result = spawnSync(nodeCommand, [jestBin, '--listTests'], {
    cwd: root,
    env: process.env,
    encoding: 'utf8',
  });

  if (result.status !== 0) {
    return [];
  }

  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function printLiveSuiteStatus() {
  console.log('\nLive test gates:');
  for (const suite of liveSuites) {
    const enabled = process.env[suite.flag] === 'true';
    const missing = suite.required.filter((key) => process.env[key] == null || process.env[key] === '');
    if (!enabled) {
      console.log(`- ${suite.name}: skipped unless ${suite.flag}=true`);
    } else if (missing.length > 0) {
      console.log(`- ${suite.name}: skipped, missing ${missing.join(', ')}`);
    } else {
      console.log(`- ${suite.name}: enabled`);
    }
  }
}

function printJestSummary() {
  if (!fs.existsSync(jestResultsPath)) return;

  try {
    const results = JSON.parse(fs.readFileSync(jestResultsPath, 'utf8'));
    console.log('\nJest summary:');
    console.log(`- Test suites: ${results.numPassedTestSuites}/${results.numTotalTestSuites} passed`);
    console.log(`- Tests: ${results.numPassedTests}/${results.numTotalTests} passed`);
    console.log(`- Skipped tests: ${results.numPendingTests}`);
    console.log(`- Failed tests: ${results.numFailedTests}`);
    if (typeof results.coverageMap === 'object' || coverageEnabled) {
      console.log('- Coverage: generated under coverage/');
    }
  } catch (error) {
    console.log(`\nCould not read Jest JSON summary: ${error.message}`);
  } finally {
    fs.rmSync(jestResultsPath, { force: true });
  }
}

if (helpRequested) {
  printHelp();
  process.exit(0);
}

console.log('OffPay full verification suite');
console.log(`Working directory: ${root}`);

const testFiles = listJestTests();
console.log(`Jest discovered ${testFiles.length} test file${testFiles.length === 1 ? '' : 's'}.`);
for (const testFile of testFiles) {
  console.log(`- ${path.relative(root, testFile)}`);
}
printLiveSuiteStatus();

runStep('TypeScript typecheck', npmCommand, ['run', 'typecheck']);
runStep('Expo lint', npmCommand, ['run', 'lint']);
runStep('Client hardening verification', npmCommand, ['run', 'verify:hardening']);

const jestArgs = [
  jestBin,
  '--runInBand',
  '--detectOpenHandles',
  '--json',
  '--outputFile',
  jestResultsPath,
  ...passthroughJestArgs,
];
if (coverageEnabled) {
  jestArgs.push('--coverage');
}

runStep('Jest unit/integration/contract/E2E suites', nodeCommand, jestArgs);
printJestSummary();

if (androidExportEnabled) {
  runStep('Android Metro bundle smoke test', 'npx', ['expo', 'export', '-p', 'android', '--clear']);
}

console.log(`\nAll requested checks passed in ${formatDuration(Date.now() - startedAt)}.`);
