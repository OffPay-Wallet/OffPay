type ExpoFileSystemMock = typeof import('expo-file-system') & {
  __INTERNAL_RESET?: () => void;
  __INTERNAL_UPLOAD_MOCK: jest.Mock;
};

const originalProxyUrl = process.env.EXPO_PUBLIC_OFFPAY_AI_PROXY_URL;
const originalAllowedOrigins = process.env.EXPO_PUBLIC_OFFPAY_AI_PROXY_ALLOWED_ORIGINS;

function restoreEnv(name: string, value: string | undefined): void {
  if (value == null) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
}

function loadVoiceClient(): {
  fileSystem: ExpoFileSystemMock;
  transcribeAgentVoice: typeof import('@/lib/agentic-payments/ai-proxy-client').transcribeAgentVoice;
  AgenticPaymentsProxyError: typeof import('@/lib/agentic-payments/ai-proxy-client').AgenticPaymentsProxyError;
} {
  jest.resetModules();
  process.env.EXPO_PUBLIC_OFFPAY_AI_PROXY_URL = 'https://ai.offpay.test';
  process.env.EXPO_PUBLIC_OFFPAY_AI_PROXY_ALLOWED_ORIGINS = 'https://ai.offpay.test';

  const fileSystem = require('expo-file-system') as ExpoFileSystemMock;
  fileSystem.__INTERNAL_RESET?.();

  const client = require('@/lib/agentic-payments/ai-proxy-client') as typeof import('@/lib/agentic-payments/ai-proxy-client');
  return {
    fileSystem,
    transcribeAgentVoice: client.transcribeAgentVoice,
    AgenticPaymentsProxyError: client.AgenticPaymentsProxyError,
  };
}

afterAll(() => {
  restoreEnv('EXPO_PUBLIC_OFFPAY_AI_PROXY_URL', originalProxyUrl);
  restoreEnv('EXPO_PUBLIC_OFFPAY_AI_PROXY_ALLOWED_ORIGINS', originalAllowedOrigins);
});

describe('transcribeAgentVoice native file uploads', () => {
  it('streams recorded file URIs with Expo File.upload', async () => {
    const { fileSystem, transcribeAgentVoice } = loadVoiceClient();
    fileSystem.__INTERNAL_UPLOAD_MOCK.mockResolvedValueOnce({
      status: 200,
      body: JSON.stringify({
        kind: 'voice_transcript',
        transcript: 'send 1 SOL',
        language: 'en',
      }),
      headers: { 'content-type': 'application/json' },
    });

    const result = await transcribeAgentVoice(
      { uri: 'file:///cache/recording.m4a', contentType: 'audio/mp4' },
      { languageHint: 'en', timeoutMs: 5_000 },
    );

    expect(result).toMatchObject({
      kind: 'voice_transcript',
      transcript: 'send 1 SOL',
      language: 'en',
    });
    expect(fileSystem.__INTERNAL_UPLOAD_MOCK).toHaveBeenCalledWith(
      expect.objectContaining({ uri: 'file:///cache/recording.m4a' }),
      'https://ai.offpay.test/api/ai/voice/transcribe',
      expect.objectContaining({
        httpMethod: 'POST',
        uploadType: 0,
        headers: expect.objectContaining({
          accept: 'application/json',
          'content-type': 'audio/mp4',
          'x-offpay-language-hint': 'en',
        }),
      }),
    );
  });

  it('normalizes native upload error responses', async () => {
    const { fileSystem, transcribeAgentVoice, AgenticPaymentsProxyError } = loadVoiceClient();
    fileSystem.__INTERNAL_UPLOAD_MOCK.mockResolvedValueOnce({
      status: 429,
      body: JSON.stringify({
        kind: 'error',
        code: 'RATE_LIMITED',
        message: 'Slow down.',
        retryAfterMs: 2500,
      }),
      headers: {},
    });

    await expect(
      transcribeAgentVoice({ uri: 'file:///cache/recording.m4a', contentType: 'audio/mp4' }),
    ).rejects.toMatchObject({
      name: AgenticPaymentsProxyError.name,
      code: 'RATE_LIMITED',
      message: 'Slow down.',
      status: 429,
      retryAfterMs: 2500,
    });
  });
});
