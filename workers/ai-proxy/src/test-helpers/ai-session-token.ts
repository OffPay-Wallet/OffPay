export const TEST_AI_SESSION_SECRET = 'shared-secret-for-test-at-least-32-characters';
export const TEST_AI_SESSION_WALLET = 'Arbj11u1RHjfUwnBsg2zTWFP82EdCAxirxGvLrvsfwiw';

export async function buildTestAiSessionToken(params: {
  issuedAt?: number;
  expiresAt?: number;
  sharedSecret?: string;
} = {}): Promise<string> {
  const issuedAt = params.issuedAt ?? Date.now();
  const expiresAt = params.expiresAt ?? issuedAt + 60_000;
  const claims = {
    aud: 'offpay-ai',
    iss: 'offpay-api',
    sub: TEST_AI_SESSION_WALLET,
    dev: 'device-test',
    net: 'mainnet',
    iat: issuedAt,
    exp: expiresAt,
    jti: '00000000-0000-4000-8000-000000000000',
  };
  const payload = base64Url(new TextEncoder().encode(JSON.stringify(claims)));
  const signingInput = `v2.${payload}`;
  const signature = await hmacBase64Url(
    params.sharedSecret ?? TEST_AI_SESSION_SECRET,
    signingInput,
  );
  return `${signingInput}.${signature}`;
}

async function hmacBase64Url(secret: string, message: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
  return base64Url(new Uint8Array(signature));
}

function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
