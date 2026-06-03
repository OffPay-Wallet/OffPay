import 'reflect-metadata';
import { decode as decodeCbor } from 'cbor-x';
import { X509Certificate, X509ChainBuilder } from '@peculiar/x509';
import { AppError } from './errors.js';
import type { Bindings } from './types.js';

type BootstrapPlatform = 'ios' | 'android';
type AttestationEnvironment = 'production' | 'development';
type AndroidAttestationMode = 'play_integrity' | 'prototype_bypass';

interface AttestationVerificationInput {
  platform: BootstrapPlatform;
  attestationToken: string;
  challengeNonce: string;
  attestationKeyId?: string;
}

interface AttestationVerificationResult {
  platform: BootstrapPlatform;
  environment: AttestationEnvironment;
}

interface GoogleAccessToken {
  token: string;
  expiresAt: number;
}

interface GooglePlayIntegrityPayload {
  requestDetails?: {
    requestPackageName?: string;
    nonce?: string;
    timestampMillis?: string;
  };
  appIntegrity?: {
    appRecognitionVerdict?: string;
    packageName?: string;
  };
  deviceIntegrity?: {
    deviceRecognitionVerdict?: string[];
  };
}

interface AppleAttestationObject {
  fmt?: unknown;
  attStmt?: {
    x5c?: unknown;
    receipt?: unknown;
  };
  authData?: unknown;
}

type AttestationVerifier = (
  bindings: Bindings,
  input: AttestationVerificationInput,
) => Promise<AttestationVerificationResult>;

const APPLE_APP_ATTEST_ROOT_CA_PEM = `-----BEGIN CERTIFICATE-----
MIICITCCAaegAwIBAgIQC/O+DvHN0uD7jG5yH2IXmDAKBggqhkjOPQQDAzBSMSYw
JAYDVQQDDB1BcHBsZSBBcHAgQXR0ZXN0YXRpb24gUm9vdCBDQTETMBEGA1UECgwK
QXBwbGUgSW5jLjETMBEGA1UECAwKQ2FsaWZvcm5pYTAeFw0yMDAzMTgxODMyNTNa
Fw00NTAzMTUwMDAwMDBaMFIxJjAkBgNVBAMMHUFwcGxlIEFwcCBBdHRlc3RhdGlv
biBSb290IENBMRMwEQYDVQQKDApBcHBsZSBJbmMuMRMwEQYDVQQIDApDYWxpZm9y
bmlhMHYwEAYHKoZIzj0CAQYFK4EEACIDYgAERTHhmLW07ATaFQIEVwTtT4dyctdh
NbJhFs/Ii2FdCgAHGbpphY3+d8qjuDngIN3WVhQUBHAoMeQ/cLiP1sOUtgjqK9au
Yen1mMEvRq9Sk3Jm5X8U62H+xTD3FE9TgS41o0IwQDAPBgNVHRMBAf8EBTADAQH/
MB0GA1UdDgQWBBSskRBTM72+aEH/pwyp5frq5eWKoTAOBgNVHQ8BAf8EBAMCAQYw
CgYIKoZIzj0EAwMDaAAwZQIwQgFGnByvsiVbpTKwSga0kP0e8EeDS4+sQmTvb7vn
53O5+FRXgeLhpJ06ysC5PrOyAjEAp5U4xDgEgllF7En3VcE3iexZZtKeYnpqtijV
oyFraWVIyd/dganmrduC1bmTBGwD
-----END CERTIFICATE-----`;

const APPLE_NONCE_EXTENSION_OID = '1.2.840.113635.100.8.2';
const DEFAULT_ANDROID_ATTESTATION_MODE: AndroidAttestationMode = 'play_integrity';
const GOOGLE_PLAY_INTEGRITY_SCOPE = 'https://www.googleapis.com/auth/playintegrity';
const GOOGLE_OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_PLAY_INTEGRITY_API_BASE = 'https://playintegrity.googleapis.com/v1';
const ATTESTATION_FRESHNESS_WINDOW_MS = 5 * 60_000;
const APP_ATTEST_AAGUID_PRODUCTION = 'appattest\0\0\0\0\0\0\0';
const APP_ATTEST_AAGUID_SANDBOX = 'appattestsandbox';
const APP_ATTEST_AAGUID_DEVELOP = 'appattestdevelop';

let googleAccessTokenCache: GoogleAccessToken | null = null;
let attestationVerifier: AttestationVerifier = verifyAttestation;

function getRequiredBinding(bindings: Bindings, key: keyof Bindings): string {
  const rawValue = bindings[key];
  const value = typeof rawValue === 'string' ? rawValue.trim() : '';
  if (value.length === 0) {
    throw new AppError({
      status: 503,
      code: 'UPSTREAM_UNAVAILABLE',
      message: 'Required backend configuration is unavailable.',
      retryable: true,
    });
  }

  return value;
}

function throwAttestationFailed(): never {
  throw new AppError({
    status: 403,
    code: 'ATTESTATION_FAILED',
    message: 'Device attestation could not be verified.',
  });
}

function getAndroidAttestationMode(bindings: Bindings): AndroidAttestationMode {
  const configuredValue = bindings.OFFPAY_ANDROID_ATTESTATION_MODE?.trim().toLowerCase();
  if (!configuredValue) {
    return DEFAULT_ANDROID_ATTESTATION_MODE;
  }

  if (configuredValue === 'play_integrity' || configuredValue === 'prototype_bypass') {
    return configuredValue;
  }

  throw new AppError({
    status: 503,
    code: 'UPSTREAM_UNAVAILABLE',
    message: 'Required backend configuration is unavailable.',
    retryable: true,
  });
}

function isProductionEnvironment(bindings: Bindings): boolean {
  return bindings.NODE_ENV?.trim().toLowerCase() === 'production';
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function base64UrlEncodeText(value: string): string {
  return base64UrlEncodeBytes(new TextEncoder().encode(value));
}

function base64UrlEncodeBytes(value: Uint8Array): string {
  let binary = '';

  value.forEach((entry) => {
    binary += String.fromCharCode(entry);
  });

  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function normalizeBase64(value: string): string {
  const normalized = value.trim().replace(/-/g, '+').replace(/_/g, '/');
  const paddingLength = (4 - (normalized.length % 4)) % 4;
  return normalized + '='.repeat(paddingLength);
}

function decodeBase64ToBytes(value: string): Uint8Array {
  let binary: string;

  try {
    binary = atob(normalizeBase64(value));
  } catch (error) {
    throw new AppError({
      status: 400,
      code: 'INVALID_REQUEST',
      message: 'Malformed attestation payload.',
      cause: error,
    });
  }

  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function bytesToText(value: Uint8Array): string {
  return new TextDecoder().decode(value);
}

function toArrayBuffer(value: Uint8Array): ArrayBuffer {
  return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer;
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) {
    return false;
  }

  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left[index]! ^ right[index]!;
  }

  return mismatch === 0;
}

async function sha256Bytes(value: Uint8Array): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest('SHA-256', toArrayBuffer(value));
  return new Uint8Array(digest);
}

async function sha256Text(value: string): Promise<Uint8Array> {
  return sha256Bytes(new TextEncoder().encode(value));
}

function decodePemPrivateKey(pemValue: string): ArrayBuffer {
  const base64 = pemValue
    .replace(/\\n/g, '\n')
    .replace(/-----BEGIN PRIVATE KEY-----/g, '')
    .replace(/-----END PRIVATE KEY-----/g, '')
    .replace(/\s+/g, '');

  return toArrayBuffer(decodeBase64ToBytes(base64));
}

async function importServiceAccountPrivateKey(pkcs8: ArrayBuffer): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'pkcs8',
    pkcs8,
    {
      name: 'RSASSA-PKCS1-v1_5',
      hash: 'SHA-256',
    },
    false,
    ['sign'],
  );
}

async function createGoogleServiceAccountJwt(bindings: Bindings): Promise<string> {
  const email = getRequiredBinding(bindings, 'GOOGLE_PLAY_SERVICE_ACCOUNT_EMAIL');
  const privateKeyPem = getRequiredBinding(bindings, 'GOOGLE_PLAY_SERVICE_ACCOUNT_PRIVATE_KEY');
  const nowSec = Math.floor(Date.now() / 1000);
  const header = base64UrlEncodeText(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64UrlEncodeText(
    JSON.stringify({
      iss: email,
      scope: GOOGLE_PLAY_INTEGRITY_SCOPE,
      aud: GOOGLE_OAUTH_TOKEN_URL,
      iat: nowSec,
      exp: nowSec + 3600,
    }),
  );
  const unsignedJwt = `${header}.${payload}`;
  const signingKey = await importServiceAccountPrivateKey(decodePemPrivateKey(privateKeyPem));
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    signingKey,
    new TextEncoder().encode(unsignedJwt),
  );

  return `${unsignedJwt}.${base64UrlEncodeBytes(new Uint8Array(signature))}`;
}

async function getGoogleAccessToken(bindings: Bindings): Promise<string> {
  const cachedToken = googleAccessTokenCache;
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.token;
  }

  const assertion = await createGoogleServiceAccountJwt(bindings);
  const response = await fetch(GOOGLE_OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }).toString(),
  });

  if (!response.ok) {
    throw new AppError({
      status: 503,
      code: 'UPSTREAM_UNAVAILABLE',
      message: 'Required backend configuration is unavailable.',
      retryable: true,
    });
  }

  const payload = (await response.json()) as { access_token?: string; expires_in?: number };
  if (!payload.access_token || typeof payload.expires_in !== 'number') {
    throw new AppError({
      status: 503,
      code: 'UPSTREAM_UNAVAILABLE',
      message: 'Required backend configuration is unavailable.',
      retryable: true,
    });
  }

  googleAccessTokenCache = {
    token: payload.access_token,
    expiresAt: Date.now() + payload.expires_in * 1000,
  };

  return payload.access_token;
}

async function decodeGoogleIntegrityToken(
  bindings: Bindings,
  integrityToken: string,
): Promise<GooglePlayIntegrityPayload> {
  const accessToken = await getGoogleAccessToken(bindings);
  const packageName = getRequiredBinding(bindings, 'OFFPAY_ANDROID_PACKAGE_NAME');
  const response = await fetch(
    `${GOOGLE_PLAY_INTEGRITY_API_BASE}/${encodeURIComponent(packageName)}:decodeIntegrityToken`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        integrity_token: integrityToken,
      }),
    },
  );

  if (response.status >= 500) {
    throw new AppError({
      status: 503,
      code: 'UPSTREAM_UNAVAILABLE',
      message: 'Required backend configuration is unavailable.',
      retryable: true,
    });
  }

  if (response.status === 400) {
    throwAttestationFailed();
  }

  if (response.status === 401 || response.status === 403) {
    googleAccessTokenCache = null;
  }

  if (!response.ok) {
    throw new AppError({
      status: 503,
      code: 'UPSTREAM_UNAVAILABLE',
      message: 'Required backend configuration is unavailable.',
      retryable: true,
    });
  }

  const payload = (await response.json()) as { tokenPayloadExternal?: GooglePlayIntegrityPayload };
  return payload.tokenPayloadExternal ?? {};
}

async function verifyAndroidIntegrity(
  bindings: Bindings,
  input: AttestationVerificationInput,
): Promise<AttestationVerificationResult> {
  const attestationMode = getAndroidAttestationMode(bindings);
  if (attestationMode === 'prototype_bypass') {
    return {
      platform: 'android',
      environment: 'development',
    };
  }

  if (!input.attestationToken.trim()) {
    throw new AppError({
      status: 400,
      code: 'INVALID_REQUEST',
      message: 'Android attestation token is required.',
    });
  }

  const packageName = getRequiredBinding(bindings, 'OFFPAY_ANDROID_PACKAGE_NAME');
  const verdict = await decodeGoogleIntegrityToken(bindings, input.attestationToken);
  const expectedNonce = base64UrlEncodeBytes(await sha256Text(input.challengeNonce));
  const requestDetails = verdict.requestDetails;
  const appIntegrity = verdict.appIntegrity;
  const deviceIntegrity = verdict.deviceIntegrity;

  const requestTimestamp = Number(requestDetails?.timestampMillis ?? 0);
  if (
    requestDetails?.requestPackageName !== packageName ||
    requestDetails?.nonce !== expectedNonce ||
    !Number.isFinite(requestTimestamp) ||
    Math.abs(Date.now() - requestTimestamp) > ATTESTATION_FRESHNESS_WINDOW_MS
  ) {
    throwAttestationFailed();
  }

  const appVerdict = appIntegrity?.appRecognitionVerdict ?? '';
  const allowDevelopmentVerdict =
    !isProductionEnvironment(bindings) && appVerdict === 'UNRECOGNIZED_VERSION';
  if (
    (appVerdict !== 'PLAY_RECOGNIZED' && !allowDevelopmentVerdict) ||
    (appIntegrity?.packageName && appIntegrity.packageName !== packageName)
  ) {
    throwAttestationFailed();
  }

  const deviceVerdicts = deviceIntegrity?.deviceRecognitionVerdict ?? [];
  if (!deviceVerdicts.includes('MEETS_DEVICE_INTEGRITY')) {
    throwAttestationFailed();
  }

  return {
    platform: 'android',
    environment: allowDevelopmentVerdict ? 'development' : 'production',
  };
}

function readDerLength(
  bytes: Uint8Array,
  offset: number,
): { length: number; bytesRead: number } {
  const firstByte = bytes[offset];
  if (firstByte === undefined) {
    throwAttestationFailed();
  }

  if ((firstByte & 0x80) === 0) {
    return {
      length: firstByte,
      bytesRead: 1,
    };
  }

  const lengthBytes = firstByte & 0x7f;
  if (lengthBytes === 0 || lengthBytes > 4) {
    throwAttestationFailed();
  }

  let length = 0;
  for (let index = 0; index < lengthBytes; index += 1) {
    const nextByte = bytes[offset + 1 + index];
    if (nextByte === undefined) {
      throwAttestationFailed();
    }
    length = (length << 8) | nextByte;
  }

  return {
    length,
    bytesRead: 1 + lengthBytes,
  };
}

function extractSingleOctetString(derValue: Uint8Array): Uint8Array {
  if (derValue[0] !== 0x30) {
    throwAttestationFailed();
  }

  const sequenceLength = readDerLength(derValue, 1);
  let cursor = 1 + sequenceLength.bytesRead;
  const sequenceEnd = cursor + sequenceLength.length;

  if (sequenceEnd !== derValue.length || derValue[cursor] !== 0x04) {
    throwAttestationFailed();
  }

  const octetStringLength = readDerLength(derValue, cursor + 1);
  cursor += 1 + octetStringLength.bytesRead;
  const octetStringEnd = cursor + octetStringLength.length;

  if (octetStringEnd !== sequenceEnd) {
    throwAttestationFailed();
  }

  return derValue.slice(cursor, octetStringEnd);
}

function parseAppleAttestationEnvelope(
  attestationToken: string,
  explicitKeyId?: string,
): { attestation: string; keyId: string } {
  if (explicitKeyId) {
    return {
      attestation: attestationToken,
      keyId: explicitKeyId,
    };
  }

  try {
    const parsed = JSON.parse(attestationToken) as unknown;
    if (isObject(parsed)) {
      const attestation =
        typeof parsed.attestation === 'string'
          ? parsed.attestation
          : typeof parsed.attestationToken === 'string'
            ? parsed.attestationToken
            : null;
      const keyId =
        typeof parsed.keyId === 'string'
          ? parsed.keyId
          : typeof parsed.attestationKeyId === 'string'
            ? parsed.attestationKeyId
            : null;

      if (attestation && keyId) {
        return { attestation, keyId };
      }
    }
  } catch {
    // Ignore parse failure and fall through to explicit validation below.
  }

  throw new AppError({
    status: 400,
    code: 'INVALID_REQUEST',
    message: 'iOS bootstrap requests must include an attestation key identifier.',
  });
}

function ensureCertificateValidity(certificate: X509Certificate): void {
  const now = Date.now();
  if (certificate.notBefore.getTime() > now || certificate.notAfter.getTime() < now) {
    throwAttestationFailed();
  }
}

async function exportLeafRawPublicKey(certificate: X509Certificate): Promise<Uint8Array> {
  const cryptoKey = await certificate.publicKey.export();
  const rawKey = await crypto.subtle.exportKey('raw', cryptoKey);
  return new Uint8Array(rawKey);
}

function toUint8Array(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) {
    return value;
  }

  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }

  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }

  throwAttestationFailed();
}

async function verifyAppleAttestation(
  bindings: Bindings,
  input: AttestationVerificationInput,
): Promise<AttestationVerificationResult> {
  const teamId = getRequiredBinding(bindings, 'OFFPAY_IOS_TEAM_ID');
  const bundleId = getRequiredBinding(bindings, 'OFFPAY_IOS_BUNDLE_ID');
  const envelope = parseAppleAttestationEnvelope(input.attestationToken, input.attestationKeyId);
  const attestationBytes = decodeBase64ToBytes(envelope.attestation);
  const keyIdBytes = decodeBase64ToBytes(envelope.keyId);
  const decoded = decodeCbor(attestationBytes) as AppleAttestationObject;

  if (!isObject(decoded) || decoded.fmt !== 'apple-appattest' || !isObject(decoded.attStmt)) {
    throwAttestationFailed();
  }

  const certificateChain = Array.isArray(decoded.attStmt.x5c) ? decoded.attStmt.x5c : [];
  if (certificateChain.length < 2 || decoded.authData === undefined) {
    throwAttestationFailed();
  }

  const leafCertificate = new X509Certificate(toArrayBuffer(toUint8Array(certificateChain[0])));
  const intermediateCertificate = new X509Certificate(
    toArrayBuffer(toUint8Array(certificateChain[1])),
  );
  const rootCertificate = new X509Certificate(APPLE_APP_ATTEST_ROOT_CA_PEM);
  const chainBuilder = new X509ChainBuilder({
    certificates: [intermediateCertificate, rootCertificate],
  });
  const builtChain = await chainBuilder.build(leafCertificate);
  if (builtChain.length < 3) {
    throwAttestationFailed();
  }

  const builtRoot = builtChain[builtChain.length - 1];
  if (!builtRoot) {
    throwAttestationFailed();
  }

  const [expectedRootThumbprint, actualRootThumbprint] = await Promise.all([
    rootCertificate.getThumbprint('SHA-256'),
    builtRoot.getThumbprint('SHA-256'),
  ]);
  if (!bytesEqual(new Uint8Array(expectedRootThumbprint), new Uint8Array(actualRootThumbprint))) {
    throwAttestationFailed();
  }

  ensureCertificateValidity(leafCertificate);
  ensureCertificateValidity(intermediateCertificate);
  ensureCertificateValidity(rootCertificate);

  const authData = toUint8Array(decoded.authData);
  if (authData.length < 55) {
    throwAttestationFailed();
  }

  const flags = authData[32];
  if (flags === undefined || (flags & 0x40) === 0) {
    throwAttestationFailed();
  }

  const signCount =
    ((authData[33] ?? 0) << 24) |
    ((authData[34] ?? 0) << 16) |
    ((authData[35] ?? 0) << 8) |
    (authData[36] ?? 0);
  if (signCount !== 0) {
    throwAttestationFailed();
  }

  const aaguid = bytesToText(authData.slice(37, 53));
  const allowDevelopmentEnvironment = !isProductionEnvironment(bindings);
  const validAaguid =
    aaguid === APP_ATTEST_AAGUID_PRODUCTION ||
    (allowDevelopmentEnvironment &&
      (aaguid === APP_ATTEST_AAGUID_SANDBOX || aaguid === APP_ATTEST_AAGUID_DEVELOP));
  if (!validAaguid) {
    throwAttestationFailed();
  }

  const credentialIdLength = ((authData[53] ?? 0) << 8) | (authData[54] ?? 0);
  const credentialIdStart = 55;
  const credentialIdEnd = credentialIdStart + credentialIdLength;
  if (credentialIdEnd > authData.length) {
    throwAttestationFailed();
  }

  const credentialId = authData.slice(credentialIdStart, credentialIdEnd);
  if (!bytesEqual(credentialId, keyIdBytes)) {
    throwAttestationFailed();
  }

  const clientDataHash = await sha256Text(input.challengeNonce);
  const nonceMaterial = new Uint8Array(authData.length + clientDataHash.length);
  nonceMaterial.set(authData, 0);
  nonceMaterial.set(clientDataHash, authData.length);
  const expectedNonce = await sha256Bytes(nonceMaterial);

  const nonceExtension = leafCertificate.getExtension(APPLE_NONCE_EXTENSION_OID);
  if (!nonceExtension) {
    throwAttestationFailed();
  }

  const certificateNonce = extractSingleOctetString(new Uint8Array(nonceExtension.value));
  if (!bytesEqual(certificateNonce, expectedNonce)) {
    throwAttestationFailed();
  }

  const publicKeyHash = await sha256Bytes(await exportLeafRawPublicKey(leafCertificate));
  if (!bytesEqual(publicKeyHash, keyIdBytes)) {
    throwAttestationFailed();
  }

  const expectedRpIdHash = await sha256Text(`${teamId}.${bundleId}`);
  const rpIdHash = authData.slice(0, 32);
  if (!bytesEqual(rpIdHash, expectedRpIdHash)) {
    throwAttestationFailed();
  }

  return {
    platform: 'ios',
    environment:
      aaguid === APP_ATTEST_AAGUID_PRODUCTION ? 'production' : 'development',
  };
}

async function verifyAttestation(
  bindings: Bindings,
  input: AttestationVerificationInput,
): Promise<AttestationVerificationResult> {
  if (input.platform === 'android') {
    return verifyAndroidIntegrity(bindings, input);
  }

  return verifyAppleAttestation(bindings, input);
}

async function verifyBootstrapAttestation(
  bindings: Bindings,
  input: AttestationVerificationInput,
): Promise<AttestationVerificationResult> {
  return attestationVerifier(bindings, input);
}

function setAttestationVerifier(verifier: AttestationVerifier): void {
  attestationVerifier = verifier;
}

function resetAttestationVerifier(): void {
  attestationVerifier = verifyAttestation;
}

export {
  resetAttestationVerifier,
  setAttestationVerifier,
  verifyBootstrapAttestation,
  type AttestationVerificationInput,
  type AttestationVerificationResult,
  type AttestationVerifier,
  type AttestationEnvironment,
  type BootstrapPlatform,
};
