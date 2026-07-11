export interface GooglePlayRequestDetails {
  requestPackageName?: string;
  nonce?: string;
  requestHash?: string;
  timestampMillis?: string;
}

const ATTESTATION_FRESHNESS_WINDOW_MS = 5 * 60_000;

export function hasValidAndroidRequestBinding(params: {
  requestDetails: GooglePlayRequestDetails | undefined;
  packageName: string;
  expectedRequestHash: string;
  now?: number;
}): boolean {
  const requestTimestamp = Number(params.requestDetails?.timestampMillis ?? 0);
  const requestBinding =
    params.requestDetails?.requestHash ?? params.requestDetails?.nonce ?? '';

  return (
    params.requestDetails?.requestPackageName === params.packageName &&
    requestBinding === params.expectedRequestHash &&
    Number.isFinite(requestTimestamp) &&
    Math.abs((params.now ?? Date.now()) - requestTimestamp) <= ATTESTATION_FRESHNESS_WINDOW_MS
  );
}
