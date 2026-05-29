beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = jest.fn() as typeof fetch;
  const secureStore = require('expo-secure-store') as { __INTERNAL_RESET?: () => void };
  const fileSystem = require('expo-file-system') as { __INTERNAL_RESET?: () => void };
  secureStore.__INTERNAL_RESET?.();
  fileSystem.__INTERNAL_RESET?.();
});
