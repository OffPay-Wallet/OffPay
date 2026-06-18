export type Network = 'devnet' | 'mainnet';

export type R2ObjectBody = {
  uploaded: Date;
  text(): Promise<string>;
};

export type R2ObjectReference = {
  key: string;
  uploaded: Date;
};

export type R2ObjectList = {
  objects: R2ObjectReference[];
  truncated: boolean;
  cursor?: string;
};

export type R2Bucket = {
  delete(key: string): Promise<void>;
  get(key: string): Promise<R2ObjectBody | null>;
  list(options?: { prefix?: string; limit?: number; cursor?: string }): Promise<R2ObjectList>;
  put(
    key: string,
    value: string | ArrayBuffer | ArrayBufferView | ReadableStream,
    options?: { httpMetadata?: { contentType?: string } },
  ): Promise<unknown>;
};

export interface KVNamespace {
  get(key: string, type?: 'text'): Promise<string | null>;
  get<T = unknown>(key: string, type: 'json'): Promise<T | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
}

export type RequestTimingMetric = {
  name: string;
  durationMs: number;
};

export type RequestCacheStatus = 'bypass' | 'miss' | 'hit' | 'stale' | 'refresh';

export type Bindings = {
  NODE_ENV?: string;
  OFFPAY_ALLOWED_ORIGINS?: string;
  HELIUS_DEVNET_API_KEY?: string;
  HELIUS_MAINNET_API_KEY?: string;
  HELIUS_DEVNET_RPC_URL?: string;
  HELIUS_MAINNET_RPC_URL?: string;
  HELIUS_DEVNET_WS_URL?: string;
  HELIUS_MAINNET_WS_URL?: string;
  ALCHEMY_DEVNET_RPC_URL?: string;
  ALCHEMY_MAINNET_RPC_URL?: string;
  ALCHEMY_DEVNET_FALLBACK_RPC_URL?: string;
  ALCHEMY_MAINNET_FALLBACK_RPC_URL?: string;
  ALCHEMY_PRICE_API_KEY?: string;
  JUPITER_API_BASE_URL?: string;
  JUPITER_TRIGGER_API_BASE_URL?: string;
  JUPITER_API_KEY: string;
  UMBRA_API_KEY?: string;
  UMBRA_INDEXER_URL_DEVNET?: string;
  UMBRA_INDEXER_URL_MAINNET?: string;
  UMBRA_RELAYER_URL_DEVNET?: string;
  UMBRA_RELAYER_URL_MAINNET?: string;
  UMBRA_CIRCUIT_VERSION?: string;
  UMBRA_MIN_SDK_VERSION?: string;
  UMBRA_LOCAL_TEST_MODE?: string;
  OFFPAY_DEVNET_USDC_MINT?: string;
  OFFPAY_DEVNET_USDT_MINT?: string;
  OFFPAY_MAINNET_USDC_MINT?: string;
  OFFPAY_MAINNET_USDT_MINT?: string;
  OFFPAY_DEVNET_FAUCET_SECRET_KEY?: string;
  OFFPAY_IOS_TEAM_ID?: string;
  OFFPAY_IOS_BUNDLE_ID?: string;
  OFFPAY_ANDROID_PACKAGE_NAME?: string;
  OFFPAY_ANDROID_ATTESTATION_MODE?: string;
  OFFPAY_PROTOTYPE_MODE?: string;
  OFFPAY_INVITE_GATE_MODE?: string;
  OFFPAY_INVITE_CODE_PEPPER?: string;
  MONGODB_URI?: string;
  MONGODB_DATABASE?: string;
  GOOGLE_PLAY_SERVICE_ACCOUNT_EMAIL?: string;
  GOOGLE_PLAY_SERVICE_ACCOUNT_PRIVATE_KEY?: string;
  OFFPAY_BOOTSTRAP_SECRET: string;
  BOOTSTRAP_SECRET_VERSION: string;
  OFFPAY_BACKUP_HMAC_SECRET: string;
  KV_REST_API_URL: string;
  KV_REST_API_TOKEN: string;
  PRICE_CACHE?: KVNamespace;
  TOKEN_REGISTRY_CACHE?: KVNamespace;
  PENDING_BACKUP_BUCKET?: R2Bucket;
  MAGICBLOCK_DEVNET_VALIDATORS: string;
  MAGICBLOCK_MAINNET_VALIDATORS: string;
  MIN_APP_VERSION: string;
  AXIOM_DATASET?: string;
  AXIOM_TOKEN?: string;
};

export type Variables = {
  wallet?: string;
  network?: Network;
  deviceId?: string;
  requestId?: string;
  requestStartedAt?: number;
  requestTimings?: RequestTimingMetric[];
  requestCacheStatus?: RequestCacheStatus;
};

export type AppEnv = {
  Bindings: Bindings;
  Variables: Variables;
};
