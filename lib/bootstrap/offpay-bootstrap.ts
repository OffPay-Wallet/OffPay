import {
  provisionBootstrap,
  requestBootstrapNonce,
} from '@/lib/api/offpay-api-client';
import {
  getOffpayBootstrapVersion,
  getOffpayRequestSecret,
  getOffpayRequestWalletAddress,
} from '@/lib/api/offpay-api-storage';
import {
  buildAndroidIntegrityNonceHash,
  getBootstrapPlatform,
  unsupportedOffpayAttestationAdapter,
} from '@/lib/bootstrap/attestation';

import type {
  OffpayAttestationAdapter,
  OffpayBootstrapAttestation,
} from '@/lib/bootstrap/attestation';
import type { BootstrapProvisionInput } from '@/types/offpay-api';

export type OffpayBootstrapResult =
  | {
      status: 'already_provisioned';
      bootstrapVersion: number;
      issuedAt: null;
    }
  | {
      status: 'provisioned';
      bootstrapVersion: number;
      issuedAt: number;
    };

export interface OffpayBootstrapParams {
  walletAddress: string;
  walletId?: string;
  force?: boolean;
  attestationAdapter?: OffpayAttestationAdapter;
}

const inFlightBootstrapRequests = new Map<string, Promise<OffpayBootstrapResult>>();

function buildBootstrapRequestKey(params: OffpayBootstrapParams): string {
  return [params.walletAddress, params.walletId ?? 'active-wallet'].join(':');
}

function buildProvisionBody(
  walletAddress: string,
  nonce: string,
  attestation: OffpayBootstrapAttestation,
): BootstrapProvisionInput {
  if ('prototypeBypass' in attestation) {
    return {
      walletAddress,
      nonce,
      platform: attestation.platform,
    };
  }

  return {
    walletAddress,
    nonce,
    platform: attestation.platform,
    attestationToken: attestation.attestationToken,
    ...('attestationKeyId' in attestation
      ? { attestationKeyId: attestation.attestationKeyId }
      : {}),
  };
}

export async function hasOffpayBootstrapCredentials(walletAddress?: string): Promise<boolean> {
  const [requestSecret, bootstrapVersion, requestWalletAddress] = await Promise.all([
    getOffpayRequestSecret(),
    getOffpayBootstrapVersion(),
    getOffpayRequestWalletAddress(),
  ]);

  return (
    requestSecret != null &&
    bootstrapVersion != null &&
    (walletAddress == null || requestWalletAddress === walletAddress)
  );
}

export async function bootstrapOffpayRequestSecret(
  params: OffpayBootstrapParams,
): Promise<OffpayBootstrapResult> {
  const requestKey = buildBootstrapRequestKey(params);
  const inFlightRequest = inFlightBootstrapRequests.get(requestKey);
  if (inFlightRequest != null) {
    if (params.force === true) {
      return inFlightRequest.then((result) => {
        if (result.status === 'provisioned') return result;
        return bootstrapOffpayRequestSecret(params);
      });
    }

    return inFlightRequest;
  }

  const bootstrapPromise = bootstrapOffpayRequestSecretOnce(params).finally(() => {
    inFlightBootstrapRequests.delete(requestKey);
  });
  inFlightBootstrapRequests.set(requestKey, bootstrapPromise);
  return bootstrapPromise;
}

async function bootstrapOffpayRequestSecretOnce(
  params: OffpayBootstrapParams,
): Promise<OffpayBootstrapResult> {
  if (params.force !== true) {
    const [requestSecret, bootstrapVersion, requestWalletAddress] = await Promise.all([
      getOffpayRequestSecret(),
      getOffpayBootstrapVersion(),
      getOffpayRequestWalletAddress(),
    ]);

    if (
      requestSecret != null &&
      bootstrapVersion != null &&
      requestWalletAddress === params.walletAddress
    ) {
      return {
        status: 'already_provisioned',
        bootstrapVersion,
        issuedAt: null,
      };
    }
  }

  const platform = getBootstrapPlatform();
  const nonceResponse = await requestBootstrapNonce(params.walletAddress);
  const adapter = params.attestationAdapter ?? unsupportedOffpayAttestationAdapter;
  const attestation = await adapter.collectAttestation({
    nonce: nonceResponse.nonce,
    nonceHashBase64Url: buildAndroidIntegrityNonceHash(nonceResponse.nonce),
    platform,
  });

  const response = await provisionBootstrap(
    buildProvisionBody(params.walletAddress, nonceResponse.nonce, attestation),
    params.walletId,
  );

  return {
    status: 'provisioned',
    bootstrapVersion: response.bootstrapVersion,
    issuedAt: response.issuedAt,
  };
}
