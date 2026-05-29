const mockSecureStoreValues = new Map<string, string>();
const mockFileSystemValues = new Map<string, string>();
const mockMmkvInstances = new Map<string, Map<string, string>>();
const mockDirectories = new Set<string>(['file:///cache', 'file:///document']);
const mockDownloadFileAsync = jest.fn(async (_url: string, destination: { uri: string }) => {
  mockDirectories.add(mockGetParentDirectory(destination.uri));
  // Umbra zkeys are ~30MB+. Tests expect completeness checks at >=10MB, so the
  // mock needs to match that minimum for `isCompleteZkeyFile` to accept it.
  mockFileSystemValues.set(destination.uri, 'x'.repeat(10_000_001));
  return destination;
});

function mockNormalizeFileSystemPart(part: unknown): string {
  if (typeof part === 'string') {
    return part;
  }

  if (typeof part === 'object' && part != null && 'uri' in part) {
    const candidate = part as { uri?: unknown };
    if (typeof candidate.uri === 'string') {
      return candidate.uri;
    }
  }

  return String(part ?? '');
}

function mockNormalizeFileSystemPath(...parts: unknown[]): string {
  const normalized = parts
    .map(mockNormalizeFileSystemPart)
    .filter((part) => part.length > 0)
    .map((part, index) => {
      if (index === 0) {
        return part.replace(/\/+$/g, '');
      }

      return part.replace(/^\/+/g, '').replace(/\/+$/g, '');
    });

  return normalized.join('/');
}

function mockGetParentDirectory(path: string): string {
  const trimmed = path.replace(/\/+$/g, '');
  const index = trimmed.lastIndexOf('/');
  return index <= 'file://'.length ? 'file:///document' : trimmed.slice(0, index);
}

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    expoConfig: { version: '9.9.9-test' },
    nativeAppVersion: '9.9.9-test',
  },
}));

jest.mock('expo-secure-store', () => {
  function assertValidSecureStoreKey(key: string): void {
    if (!/^[A-Za-z0-9._-]+$/.test(key)) {
      throw new Error(
        'Invalid key provided to SecureStore. Keys must not be empty and contain only alphanumeric characters, ".", "-", and "_".',
      );
    }
  }

  const getItemAsync = jest.fn(async (key: string) => {
    assertValidSecureStoreKey(key);
    return mockSecureStoreValues.get(key) ?? null;
  });
  const setItemAsync = jest.fn(async (key: string, value: string) => {
    assertValidSecureStoreKey(key);
    mockSecureStoreValues.set(key, value);
  });
  const deleteItemAsync = jest.fn(async (key: string) => {
    assertValidSecureStoreKey(key);
    mockSecureStoreValues.delete(key);
  });

  return {
    __esModule: true,
    WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY',
    getItemAsync,
    setItemAsync,
    deleteItemAsync,
    __INTERNAL_RESET: () => mockSecureStoreValues.clear(),
  };
});

jest.mock('react-native-mmkv', () => ({
  __esModule: true,
  createMMKV: jest.fn((options?: { id?: string }) => {
    const id = options?.id ?? 'default';
    let values = mockMmkvInstances.get(id);
    if (values == null) {
      values = new Map<string, string>();
      mockMmkvInstances.set(id, values);
    }

    return {
      contains: (key: string) => values.has(key),
      getString: (key: string) => values.get(key),
      set: (key: string, value: string) => {
        values.set(key, value);
      },
      remove: (key: string) => {
        values.delete(key);
      },
      clearAll: () => {
        values.clear();
      },
    };
  }),
  __INTERNAL_RESET: () => mockMmkvInstances.clear(),
}));

jest.mock('expo-file-system', () => {
  class Directory {
    uri: string;

    constructor(...uris: unknown[]) {
      this.uri = mockNormalizeFileSystemPath(...uris);
    }

    get exists(): boolean {
      return mockDirectories.has(this.uri);
    }

    create(): void {
      mockDirectories.add(this.uri);
    }

    delete(): void {
      for (const path of Array.from(mockFileSystemValues.keys())) {
        if (path === this.uri || path.startsWith(`${this.uri}/`)) {
          mockFileSystemValues.delete(path);
        }
      }
      for (const path of Array.from(mockDirectories.values())) {
        if (path === this.uri || path.startsWith(`${this.uri}/`)) {
          mockDirectories.delete(path);
        }
      }
    }
  }

  class File {
    uri: string;

    constructor(...uris: unknown[]) {
      this.uri = mockNormalizeFileSystemPath(...uris);
    }

    get exists(): boolean {
      return mockFileSystemValues.has(this.uri);
    }

    get size(): number {
      return new TextEncoder().encode(mockFileSystemValues.get(this.uri) ?? '').length;
    }

    create(): void {
      mockDirectories.add(mockGetParentDirectory(this.uri));
      if (!mockFileSystemValues.has(this.uri)) {
        mockFileSystemValues.set(this.uri, '');
      }
    }

    write(content: string | Uint8Array): void {
      mockDirectories.add(mockGetParentDirectory(this.uri));
      mockFileSystemValues.set(
        this.uri,
        typeof content === 'string' ? content : new TextDecoder().decode(content),
      );
    }

    async text(): Promise<string> {
      return mockFileSystemValues.get(this.uri) ?? '';
    }

    textSync(): string {
      return mockFileSystemValues.get(this.uri) ?? '';
    }

    delete(): void {
      mockFileSystemValues.delete(this.uri);
    }

    static downloadFileAsync = mockDownloadFileAsync;
  }

  return {
    __esModule: true,
    Directory,
    File,
    Paths: {
      cache: 'file:///cache',
      document: 'file:///document',
    },
    __INTERNAL_RESET: () => {
      mockFileSystemValues.clear();
      mockDirectories.clear();
      mockDirectories.add('file:///cache');
      mockDirectories.add('file:///document');
      mockDownloadFileAsync.mockClear();
    },
  };
});
