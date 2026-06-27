import { normalizeError, ProviderError } from '../http';

describe('AI proxy error normalization', () => {
  it('keeps provider model 400s distinct from client request 400s', () => {
    expect(
      normalizeError(new ProviderError('gemini', 400, 'Gemini rejected the request.')),
    ).toEqual({
      kind: 'error',
      code: 'INVALID_REQUEST',
      message: 'The configured AI model rejected the request.',
      retryAfterMs: undefined,
    });
  });
});
