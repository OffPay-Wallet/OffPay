module.exports = {
  preset: 'jest-expo',
  setupFiles: ['<rootDir>/jest.setup.ts'],
  setupFilesAfterEnv: ['<rootDir>/jest.after-env.ts'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
    '^@/(.*)$': '<rootDir>/$1',
    '^@solana/kit$': '<rootDir>/node_modules/@solana/kit/dist/index.node.cjs',
    '^@solana/kit/program-client-core$':
      '<rootDir>/node_modules/@solana/kit/dist/program-client-core.node.cjs',
    '^@solana/web3\\.js$': '<rootDir>/node_modules/@solana/web3.js/lib/index.cjs.js',
    '^@solana/buffer-layout$': '<rootDir>/node_modules/@solana/buffer-layout/lib/Layout.js',
    '^@solana/buffer-layout-utils$':
      '<rootDir>/node_modules/@solana/buffer-layout-utils/lib/cjs/index.js',
    '^@solana/spl-token$': '<rootDir>/node_modules/@solana/spl-token/lib/cjs/index.js',
    '^@solana/spl-token-group$':
      '<rootDir>/node_modules/@solana/spl-token-group/lib/cjs/index.js',
    '^@solana/spl-token-metadata$':
      '<rootDir>/node_modules/@solana/spl-token-metadata/lib/cjs/index.js',
    '^@solana/wallet-standard-features$':
      '<rootDir>/node_modules/@solana/wallet-standard-features/lib/cjs/index.js',
    '^@solana/(.*)$': '<rootDir>/node_modules/@solana/$1/dist/index.node.cjs',
    '^rpc-websockets$': '<rootDir>/node_modules/rpc-websockets/dist/index.cjs',
    '^uuid$': '<rootDir>/node_modules/rpc-websockets/node_modules/uuid/dist/cjs/index.js',
  },
  testPathIgnorePatterns: ['/node_modules/', '/.expo/', '/android/', '/ios/', '/dist/'],
  transformIgnorePatterns: [
    'node_modules/(?!(?:.pnpm/)?((jest-)?react-native|@react-native|react-native|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|expo-.*|@noble/.*|@scure/.*|@solana/.*|bs58|jayson|uuid|tweetnacl|@umbra-privacy/.*))',
  ],
};
