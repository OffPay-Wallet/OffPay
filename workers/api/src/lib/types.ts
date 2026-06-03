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

export type Bindings = {
  NODE_ENV?: string;
  HELIUS_DEVNET_RPC_URL?: string;
  HELIUS_MAINNET_RPC_URL?: string;
  QUICKNODE_DEVNET_RPC_URL?: string;
  QUICKNODE_MAINNET_RPC_URL?: string;
  JUPITER_API_KEY: string;
  MAGICBLOCK_DEVNET_API_KEY: string;
  MAGICBLOCK_MAINNET_API_KEY: string;
  OFFPAY_IOS_TEAM_ID?: string;
  OFFPAY_IOS_BUNDLE_ID?: string;
  OFFPAY_ANDROID_PACKAGE_NAME?: string;
  OFFPAY_ANDROID_ATTESTATION_MODE?: string;
  GOOGLE_PLAY_SERVICE_ACCOUNT_EMAIL?: string;
  GOOGLE_PLAY_SERVICE_ACCOUNT_PRIVATE_KEY?: string;
  OFFPAY_BOOTSTRAP_SECRET: string;
  BOOTSTRAP_SECRET_VERSION: string;
  OFFPAY_BACKUP_HMAC_SECRET: string;
  KV_REST_API_URL: string;
  KV_REST_API_TOKEN: string;
  PENDING_BACKUP_BUCKET?: R2Bucket;
  MAGICBLOCK_DEVNET_VALIDATORS: string;
  MAGICBLOCK_MAINNET_VALIDATORS: string;
  MIN_APP_VERSION: string;
};

export type Variables = {
  wallet?: string;
  network?: Network;
  deviceId?: string;
  requestId?: string;
  requestStartedAt?: number;
};

export type AppEnv = {
  Bindings: Bindings;
  Variables: Variables;
};
