const path = require('path');

const { getDefaultConfig } = require('expo/metro-config');
const exclusionListModule = require('metro-config/private/defaults/exclusionList');
const exclusionList = exclusionListModule.default ?? exclusionListModule;

const config = getDefaultConfig(__dirname);
const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const fromProjectRoot = (relativePath) =>
  new RegExp(`${escapeRegExp(path.resolve(__dirname, relativePath))}(?:/.*)?$`);
const sideEffectModuleBlockList = Object.fromEntries(
  [
    path.resolve(__dirname, 'lib/crypto/polyfills.ts'),
    path.resolve(__dirname, 'lib/api/network-access-policy.ts'),
  ].map((filePath) => [filePath, true]),
);

// Resolve `jose` to its browser-safe ESM bundle.
//
// jose@4 declares `exports['.'].import = './dist/node/esm/index.js'` AND
// `exports['.'].browser = './dist/browser/index.js'`. Metro picks `import`
// for React Native (since RN isn't a browser env), which pulls the Node
// implementation that does `import { createDecipheriv } from 'crypto'`
// — Node's standard library is unavailable in the Hermes runtime.
//
// The browser bundle uses WebCrypto (which we already polyfill in
// `lib/polyfills.ts`) and is the same one jose targets for browsers,
// Cloudflare Workers, Deno, and Bun. It is the correct entrypoint for
// React Native too.
//
// Privy's `@privy-io/js-sdk-core` imports `jose` for JWT/JWE handling,
// so we have to handle the bare `'jose'` specifier as well as the
// internal subpath imports the bundler hoists.
const JOSE_BROWSER_ENTRY = path.resolve(__dirname, 'node_modules/jose/dist/browser/index.js');

// Pin every nested copy of @noble/hashes' `./crypto.js` subpath to a
// single resolved file. @noble/hashes@1.8.x dropped the `./crypto.js`
// alias from its package.exports map (only `./crypto` remains), so a
// downstream caller that requests the .js form trips Metro's exports
// validator and emits a noisy fallback warning per occurrence. We
// resolve to web3.js's nested copy because it still exports both
// forms and is the version `lib/polyfills.ts` is wired against.
const NOBLE_HASHES_CRYPTO_TARGET = path.resolve(
  __dirname,
  'node_modules/@solana/web3.js/node_modules/@noble/hashes/crypto.js',
);

// Release bundles are minified by Metro/Terser. Strip development telemetry
// calls from APK bundles while keeping warnings/errors available for real
// failure paths. Dev builds are not minified, so local perf logs still show up
// while iterating with Metro.
config.transformer.minifierConfig = {
  ...(config.transformer.minifierConfig ?? {}),
  compress: {
    ...((config.transformer.minifierConfig ?? {}).compress ?? {}),
    pure_funcs: [
      ...(((config.transformer.minifierConfig ?? {}).compress ?? {}).pure_funcs ?? []),
      'console.debug',
      'console.info',
      'console.log',
    ],
  },
};

// Keep source-only folders and unused binary variants out of Metro's
// file map. EAS upload is guarded separately by .easignore; this guard
// prevents accidental runtime imports from reintroducing bulky assets.
config.resolver.blockList = exclusionList([
  fromProjectRoot('.expo'),
  fromProjectRoot('coverage'),
  fromProjectRoot('dist'),
  fromProjectRoot('web-build'),
  fromProjectRoot('android/app/build'),
  fromProjectRoot('android/app/.cxx'),
  fromProjectRoot('android/build'),
  fromProjectRoot('ios/build'),
  fromProjectRoot('workers'),
  fromProjectRoot('documentation'),
  fromProjectRoot('backend-docs'),
  fromProjectRoot('client-docs'),
  fromProjectRoot('applications'),
  fromProjectRoot('umbra-reference'),
  fromProjectRoot('assets/AppIcons/Assets.xcassets'),
  fromProjectRoot('assets/AppIcons/android'),
  fromProjectRoot('assets/onboarding_icons'),
  new RegExp(`${escapeRegExp(path.resolve(__dirname, 'assets/lotties/ai-loader.lottie'))}$`),
  new RegExp(
    `${escapeRegExp(path.resolve(__dirname, 'assets/fonts/Geist'))}/(?:otf|webfonts|variable)/.*`,
  ),
  new RegExp(
    `${escapeRegExp(path.resolve(__dirname, 'assets/fonts/GeistMono'))}/(?:otf|webfonts|variable)/.*`,
  ),
  new RegExp(
    `${escapeRegExp(path.resolve(__dirname, 'assets/fonts/Quicksand/Quicksand-VariableFont_wght.ttf'))}$`,
  ),
  new RegExp(`${escapeRegExp(path.resolve(__dirname, 'assets/fonts/cirka/Cirka-Variable.ttf'))}$`),
]);

config.resolver.resolveRequest = (context, moduleName, platform) => {
  const normalizedModuleName = moduleName.replace(/\\/g, '/');

  if (
    moduleName === 'rpc-websockets' ||
    normalizedModuleName.endsWith('/node_modules/rpc-websockets')
  ) {
    return {
      type: 'sourceFile',
      filePath: path.resolve(__dirname, 'node_modules/rpc-websockets/dist/index.browser.cjs'),
    };
  }

  // Force `jose` (and any subpath import that bypasses the package
  // root) onto the browser bundle. The browser bundle is a single
  // self-contained file, so any deeper import like `jose/jwt/verify`
  // can also be served from it.
  if (
    moduleName === 'jose' ||
    moduleName.startsWith('jose/') ||
    normalizedModuleName.endsWith('/node_modules/jose') ||
    normalizedModuleName.includes('/node_modules/jose/dist/node/')
  ) {
    return {
      type: 'sourceFile',
      filePath: JOSE_BROWSER_ENTRY,
    };
  }

  if (
    moduleName === '@noble/hashes/crypto.js' ||
    moduleName === '@noble/hashes/crypto' ||
    normalizedModuleName.endsWith('/node_modules/@noble/hashes/crypto.js') ||
    normalizedModuleName.endsWith('/node_modules/@noble/hashes/crypto')
  ) {
    return {
      type: 'sourceFile',
      filePath: NOBLE_HASHES_CRYPTO_TARGET,
    };
  }

  return context.resolveRequest(context, moduleName, platform);
};

const getBaseTransformOptions = config.transformer.getTransformOptions;
config.transformer.getTransformOptions = async (...args) => {
  const baseOptions =
    typeof getBaseTransformOptions === 'function'
      ? await getBaseTransformOptions(...args)
      : { transform: {} };

  return {
    ...baseOptions,
    transform: {
      ...baseOptions.transform,
      inlineRequires: {
        blockList: sideEffectModuleBlockList,
      },
    },
  };
};

module.exports = config;
