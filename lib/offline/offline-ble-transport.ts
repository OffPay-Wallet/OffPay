import { Buffer } from 'buffer';
import { PermissionsAndroid, Platform } from 'react-native';

import {
  OFFPAY_BLE_IDENTITY_CHARACTERISTIC_UUID,
  OFFPAY_BLE_PAYLOAD_CHARACTERISTIC_UUID,
  OFFPAY_BLE_SERVICE_UUID,
  createOfflineBleDeviceName,
  createOfflineBleFrames,
  parseOfflineBleFrame,
  reassembleOfflineBlePayload,
  serializeOfflineBleFrameToBytes,
  utf8ToHex,
} from '@/lib/offline/offline-ble-protocol';
import { sanitizeBleDisplayName } from '@/lib/api/offpay-username';

import type {
  OfflineBleFrame,
  OfflineBlePaymentPayload,
} from '@/lib/offline/offline-ble-protocol';

const OFFPAY_BLE_SCAN_SECONDS = 8;
const OFFPAY_BLE_FAST_SCAN_SECONDS = 4;
const OFFPAY_BLE_WRITE_CHUNK_SIZE = 180;
const OFFPAY_BLE_WRITE_DELAY_MS = 18;
const OFFPAY_BLE_SESSION_TTL_MS = 2 * 60 * 1000;
const OFFPAY_BLE_ADVERTISING_SERVICE_UUID = '0000FD6F-0000-1000-8000-00805F9B34FB';
const OFFPAY_BLE_MANUFACTURER_ID = 0x0000;
const OFFPAY_BLE_MANUFACTURER_MARKER_HEX = '4f50';
const OFFPAY_BLE_MANUFACTURER_MARKER_BYTES = [0x4f, 0x50];
const OFFPAY_BLE_MANUFACTURER_MARKER_MASK = [0xff, 0xff];
const OFFPAY_BLE_MAX_PENDING_FRAME_HEX_CHARS = 32_768;
const OFFPAY_BLE_NAME_PREFIX = 'OffPay-';

interface BleManagerModule {
  start(options?: { showAlert?: boolean }): Promise<void>;
  scan(options?: {
    serviceUUIDs?: string[];
    seconds?: number;
    allowDuplicates?: boolean;
    scanMode?: number;
    exactAdvertisingName?: string | string[];
    legacy?: boolean;
    manufacturerData?: {
      manufacturerId: number;
      manufacturerData?: number[];
      manufacturerDataMask?: number[];
    };
  }): Promise<void>;
  stopScan(): Promise<void>;
  connect(peripheralId: string, options?: unknown): Promise<void>;
  disconnect(peripheralId: string, force?: boolean): Promise<void>;
  retrieveServices(peripheralId: string, serviceUUIDs?: string[]): Promise<unknown>;
  read(peripheralId: string, serviceUUID: string, characteristicUUID: string): Promise<number[]>;
  write(
    peripheralId: string,
    serviceUUID: string,
    characteristicUUID: string,
    data: number[],
    maxByteSize?: number,
  ): Promise<void>;
  requestMTU?(peripheralId: string, mtu: number): Promise<number>;
  getBondedPeripherals?(): Promise<DiscoveredPeripheral[]>;
  getDiscoveredPeripherals?(): Promise<DiscoveredPeripheral[]>;
  onDiscoverPeripheral(callback: (peripheral: DiscoveredPeripheral) => void): { remove: () => void };
}

interface PeripheralBleModule {
  requestBluetoothPermission(): Promise<boolean>;
  isBluetoothEnabled(): Promise<boolean>;
  setServices(services: Array<{ uuid: string; characteristics: Array<{ uuid: string; properties: string[]; value?: string }> }>): void;
  startAdvertising(options: {
    serviceUUIDs: string[];
    localName?: string;
    manufacturerData?: string;
    advertisingData?: {
      completeLocalName?: string;
      completeServiceUUIDs16?: string[];
      completeServiceUUIDs128?: string[];
      serviceData128?: Array<{ uuid: string; data: string }>;
    };
  }): void;
  stopAdvertising(): void;
  addEventListener(eventName: string, callback: (data: unknown) => void): () => void;
}

export interface OfflineBleReceiverSession {
  stop: () => void;
}

export interface OfflineBleReceivedPayment {
  payload: OfflineBlePaymentPayload;
}

export interface OfflineBleDiscoveredReceiver {
  id: string;
  walletAddress: string;
  bleName: string | null;
  displayName: string;
  username: string | null;
  rssi: number | null;
}

interface DiscoveredPeripheral {
  id: string;
  name?: string | null;
  rssi?: number | null;
  advertising?: {
    localName?: string | null;
    serviceUUIDs?: string[] | null;
    isConnectable?: boolean | null;
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });

  return Promise.race([promise, timeout]).finally(() => {
    if (timer != null) clearTimeout(timer);
  });
}

function normalizeUuid(value: string): string {
  return value.trim().toLowerCase();
}

function bytesToUtf8(bytes: number[]): string {
  return Buffer.from(bytes).toString('utf8').replace(/\0+$/g, '').trim();
}

function createReceiverBleName(walletAddress: string, displayName?: string | null): string {
  const username = sanitizeBleDisplayName(displayName);
  return username == null ? createOfflineBleDeviceName(walletAddress) : `${OFFPAY_BLE_NAME_PREFIX}${username}`;
}

function getPeripheralName(peripheral: DiscoveredPeripheral): string | null {
  return peripheral.advertising?.localName?.trim() || peripheral.name?.trim() || null;
}

function getDiscoveredUsername(peripheralName: string | null): string | null {
  if (peripheralName == null) return null;
  if (!peripheralName.startsWith(OFFPAY_BLE_NAME_PREFIX)) {
    return sanitizeBleDisplayName(peripheralName);
  }

  const suffix = peripheralName.slice(OFFPAY_BLE_NAME_PREFIX.length);
  if (suffix.includes('-')) return null;
  const username = sanitizeBleDisplayName(suffix);
  return username === suffix ? username : null;
}

function getDiscoveredDisplayName(walletAddress: string, peripheralName: string | null): string {
  return getDiscoveredUsername(peripheralName) ?? createOfflineBleDeviceName(walletAddress);
}

function peripheralNameMatches(peripheral: DiscoveredPeripheral, expectedName: string): boolean {
  return getPeripheralName(peripheral) === expectedName;
}

function peripheralLooksLikeOffpay(peripheral: DiscoveredPeripheral): boolean {
  const name = getPeripheralName(peripheral);
  if (name?.startsWith('OffPay-')) return true;

  return (peripheral.advertising?.serviceUUIDs ?? []).some((uuid) => {
    const normalized = normalizeUuid(uuid);
    return (
      normalized === normalizeUuid(OFFPAY_BLE_ADVERTISING_SERVICE_UUID) ||
      normalized === normalizeUuid(OFFPAY_BLE_SERVICE_UUID)
    );
  });
}

function mergePeripheral(
  peripherals: Map<string, DiscoveredPeripheral>,
  peripheral: DiscoveredPeripheral,
): void {
  const current = peripherals.get(peripheral.id);
  peripherals.set(peripheral.id, {
    ...current,
    ...peripheral,
    name: peripheral.name ?? current?.name,
    rssi: peripheral.rssi ?? current?.rssi,
    advertising: {
      ...current?.advertising,
      ...peripheral.advertising,
      serviceUUIDs:
        peripheral.advertising?.serviceUUIDs ?? current?.advertising?.serviceUUIDs,
    },
  });
}

function sortPeripheralsForConnection(
  peripherals: DiscoveredPeripheral[],
  expectedName?: string | null,
): DiscoveredPeripheral[] {
  return [...peripherals].sort((left, right) => {
    if (expectedName != null) {
      const leftMatches = peripheralNameMatches(left, expectedName);
      const rightMatches = peripheralNameMatches(right, expectedName);
      if (leftMatches !== rightMatches) return leftMatches ? -1 : 1;
    }

    return (right.rssi ?? Number.NEGATIVE_INFINITY) - (left.rssi ?? Number.NEGATIVE_INFINITY);
  });
}

async function requestAndroidBlePermissions(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  if (Platform.Version < 23) return true;

  const permissions =
    Platform.Version >= 31
      ? [
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_ADVERTISE,
        ]
      : [PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION];

  const results = await PermissionsAndroid.requestMultiple(permissions);
  return permissions.every(
    (permission) => results[permission] === PermissionsAndroid.RESULTS.GRANTED,
  );
}

async function loadPeripheralBleModule(): Promise<PeripheralBleModule> {
  const mod = require('munim-bluetooth') as unknown;
  return mod as unknown as PeripheralBleModule;
}

async function loadCentralBleManager(): Promise<BleManagerModule> {
  const mod = require('react-native-ble-manager') as { default: BleManagerModule };
  return mod.default;
}

async function connectAndReadReceiverIdentity(params: {
  ble: BleManagerModule;
  peripheralId: string;
}): Promise<string> {
  await createTimeout(params.ble.connect(params.peripheralId), 4500, 'Bluetooth connection timed out.');
  await params.ble.requestMTU?.(params.peripheralId, 512).catch(() => 0);
  await params.ble.retrieveServices(params.peripheralId, [OFFPAY_BLE_SERVICE_UUID]);
  const identityBytes = await params.ble.read(
    params.peripheralId,
    OFFPAY_BLE_SERVICE_UUID,
    OFFPAY_BLE_IDENTITY_CHARACTERISTIC_UUID,
  );
  return bytesToUtf8(identityBytes);
}

function isWriteRequestEvent(value: unknown): value is {
  deviceId?: string;
  serviceUUID?: string;
  characteristicUUID?: string;
  value?: string;
} {
  return typeof value === 'object' && value !== null;
}

function getWriteRequestKey(event: { deviceId?: string }): string {
  return event.deviceId?.trim() || 'default';
}

function looksLikeJsonStart(hexValue: string): boolean {
  return Buffer.from(hexValue, 'hex').toString('utf8').trimStart().startsWith('{');
}

function getSessionFrames(
  sessions: Map<string, { updatedAt: number; frames: Map<number, OfflineBleFrame> }>,
  frame: OfflineBleFrame,
): OfflineBleFrame[] | null {
  const now = Date.now();
  for (const [sessionId, session] of sessions) {
    if (now - session.updatedAt > OFFPAY_BLE_SESSION_TTL_MS) {
      sessions.delete(sessionId);
    }
  }

  const session = sessions.get(frame.sessionId) ?? {
    updatedAt: now,
    frames: new Map<number, OfflineBleFrame>(),
  };
  session.updatedAt = now;
  session.frames.set(frame.index, frame);
  sessions.set(frame.sessionId, session);

  if (session.frames.size !== frame.total) return null;
  const frames = Array.from(session.frames.values());
  sessions.delete(frame.sessionId);
  return frames;
}

export async function startOfflineBleReceiver(params: {
  walletAddress: string;
  displayName?: string | null;
  onPayment: (event: OfflineBleReceivedPayment) => void | Promise<void>;
  onError?: (error: Error) => void;
}): Promise<OfflineBleReceiverSession> {
  const permissionsGranted = await requestAndroidBlePermissions();
  if (!permissionsGranted) throw new Error('Bluetooth permission is required for offline receive.');

  const ble = await loadPeripheralBleModule();
  const nativePermission = await ble.requestBluetoothPermission();
  if (!nativePermission) throw new Error('Bluetooth permission is required for offline receive.');
  const enabled = await ble.isBluetoothEnabled();
  if (!enabled) throw new Error('Turn on Bluetooth to receive offline payments.');

  const sessions = new Map<string, { updatedAt: number; frames: Map<number, OfflineBleFrame> }>();
  const pendingFrameWrites = new Map<string, { hexValue: string; updatedAt: number }>();
  const unsubscribe = ble.addEventListener('characteristicWriteRequest', (event) => {
    if (!isWriteRequestEvent(event)) return;
    if (
      normalizeUuid(event.serviceUUID ?? '') !== normalizeUuid(OFFPAY_BLE_SERVICE_UUID) ||
      normalizeUuid(event.characteristicUUID ?? '') !==
        normalizeUuid(OFFPAY_BLE_PAYLOAD_CHARACTERISTIC_UUID) ||
      typeof event.value !== 'string'
    ) {
      return;
    }

    try {
      const now = Date.now();
      for (const [pendingKey, pendingWrite] of pendingFrameWrites) {
        if (now - pendingWrite.updatedAt > OFFPAY_BLE_SESSION_TTL_MS) {
          pendingFrameWrites.delete(pendingKey);
        }
      }

      const key = getWriteRequestKey(event);
      const pending = pendingFrameWrites.get(key);
      const frameHex = pending == null ? event.value : `${pending.hexValue}${event.value}`;
      if (frameHex.length > OFFPAY_BLE_MAX_PENDING_FRAME_HEX_CHARS) {
        pendingFrameWrites.delete(key);
        throw new Error('Offline BLE frame is too large.');
      }

      let frame: OfflineBleFrame;
      try {
        frame = parseOfflineBleFrame(frameHex);
        pendingFrameWrites.delete(key);
      } catch (parseError) {
        if (parseError instanceof SyntaxError && (pending != null || looksLikeJsonStart(frameHex))) {
          pendingFrameWrites.set(key, {
            hexValue: frameHex,
            updatedAt: Date.now(),
          });
          return;
        }

        pendingFrameWrites.delete(key);
        throw parseError;
      }

      const frames = getSessionFrames(sessions, frame);
      if (frames == null) return;
      const payload = reassembleOfflineBlePayload(frames);
      void Promise.resolve(params.onPayment({ payload })).catch((error: unknown) => {
        params.onError?.(error instanceof Error ? error : new Error('Offline BLE receive failed.'));
      });
    } catch (error) {
      params.onError?.(error instanceof Error ? error : new Error('Offline BLE frame failed.'));
    }
  });

  ble.setServices([
    {
      uuid: OFFPAY_BLE_SERVICE_UUID,
      characteristics: [
        {
          uuid: OFFPAY_BLE_IDENTITY_CHARACTERISTIC_UUID,
          properties: ['read'],
          value: utf8ToHex(params.walletAddress),
        },
        {
          uuid: OFFPAY_BLE_PAYLOAD_CHARACTERISTIC_UUID,
          properties: ['write', 'writeWithoutResponse'],
        },
      ],
    },
  ]);

  const localName = createReceiverBleName(params.walletAddress, params.displayName);
  ble.startAdvertising({
    serviceUUIDs: [OFFPAY_BLE_ADVERTISING_SERVICE_UUID],
    localName,
    manufacturerData: OFFPAY_BLE_MANUFACTURER_MARKER_HEX,
  });

  return {
    stop: () => {
      unsubscribe();
      try {
        ble.stopAdvertising();
      } catch {
        // Native teardown is best-effort during app navigation/background changes.
      }
    },
  };
}

export async function discoverOfflineBleReceivers(options?: {
  seconds?: number;
  maxDurationMs?: number;
  onUpdate?: (receivers: OfflineBleDiscoveredReceiver[]) => void;
}): Promise<OfflineBleDiscoveredReceiver[]> {
  const permissionsGranted = await requestAndroidBlePermissions();
  if (!permissionsGranted) throw new Error('Bluetooth permission is required for nearby discovery.');

  const ble = await loadCentralBleManager();
  await ble.start({ showAlert: false });

  const discovered = new Map<string, DiscoveredPeripheral>();
  const candidateIds = new Set<string>();
  const attemptedIds = new Set<string>();
  const receiversByWallet = new Map<string, OfflineBleDiscoveredReceiver>();
  const scanSeconds = Math.max(2, Math.min(options?.seconds ?? OFFPAY_BLE_FAST_SCAN_SECONDS, 8));
  const deadlineAt =
    options?.maxDurationMs == null
      ? Number.POSITIVE_INFINITY
      : Date.now() + Math.max(2_000, options.maxDurationMs);
  const hasTimeRemaining = (): boolean => Date.now() < deadlineAt;

  const addCandidate = (peripheral: DiscoveredPeripheral): void => {
    mergePeripheral(discovered, peripheral);
    candidateIds.add(peripheral.id);
  };

  const addIfLooksLikeOffpay = (peripheral: DiscoveredPeripheral): void => {
    mergePeripheral(discovered, peripheral);
    if (peripheralLooksLikeOffpay(peripheral)) {
      candidateIds.add(peripheral.id);
    }
  };

  const bonded = await ble.getBondedPeripherals?.().catch(() => []);
  for (const peripheral of bonded ?? []) {
    if (peripheralLooksLikeOffpay(peripheral)) {
      addCandidate(peripheral);
    }
  }

  const verifyCandidates = async (): Promise<OfflineBleDiscoveredReceiver[]> => {
    const candidates = sortPeripheralsForConnection(
      Array.from(candidateIds).flatMap((id) => {
        if (attemptedIds.has(id)) return [];
        const peripheral = discovered.get(id);
        return peripheral == null ? [] : [peripheral];
      }),
    ).slice(0, 8);

    for (const peripheral of candidates) {
      attemptedIds.add(peripheral.id);
      try {
        const walletAddress = await connectAndReadReceiverIdentity({
          ble,
          peripheralId: peripheral.id,
        });
        if (walletAddress.length > 0) {
          const bleName = getPeripheralName(peripheral);
          receiversByWallet.set(walletAddress, {
            id: peripheral.id,
            walletAddress,
            bleName,
            displayName: getDiscoveredDisplayName(walletAddress, bleName),
            username: getDiscoveredUsername(bleName),
            rssi: peripheral.rssi ?? null,
          });
        }
      } catch {
        // Discovery should skip stale bonded devices and keep scanning results usable.
      } finally {
        await ble.disconnect(peripheral.id).catch(() => undefined);
      }
    }

    const receivers = Array.from(receiversByWallet.values()).sort(
      (left, right) => (right.rssi ?? Number.NEGATIVE_INFINITY) - (left.rssi ?? Number.NEGATIVE_INFINITY),
    );
    options?.onUpdate?.(receivers);
    return receivers;
  };

  const bondedReceivers = await verifyCandidates();
  if (bondedReceivers.length > 0) return bondedReceivers;

  async function collectScan(options: Parameters<BleManagerModule['scan']>[0], trusted: boolean): Promise<void> {
    if (!hasTimeRemaining()) return;

    const requestedSeconds = options?.seconds ?? scanSeconds;
    const remainingSeconds = Number.isFinite(deadlineAt)
      ? Math.max(1, Math.ceil((deadlineAt - Date.now()) / 1000))
      : requestedSeconds;
    const limitedSeconds = Math.max(1, Math.min(requestedSeconds, remainingSeconds));
    const scanOptions = {
      ...options,
      seconds: limitedSeconds,
    };
    const subscription = ble.onDiscoverPeripheral((peripheral) => {
      if (trusted) {
        addCandidate(peripheral);
        return;
      }
      addIfLooksLikeOffpay(peripheral);
    });

    try {
      await ble.scan(scanOptions);
      await delay((limitedSeconds * 1000) + 350);
      const listed = await ble.getDiscoveredPeripherals?.().catch(() => []);
      for (const peripheral of listed ?? []) {
        if (trusted) {
          addCandidate(peripheral);
        } else {
          addIfLooksLikeOffpay(peripheral);
        }
      }
    } finally {
      subscription.remove();
      await ble.stopScan().catch(() => undefined);
    }
  }

  await collectScan(
    {
      serviceUUIDs: [OFFPAY_BLE_ADVERTISING_SERVICE_UUID],
      seconds: scanSeconds,
      allowDuplicates: true,
      scanMode: 2,
      legacy: Platform.OS === 'android' ? true : undefined,
    },
    true,
  );
  const advertisingReceivers = await verifyCandidates();
  if (advertisingReceivers.length > 0) return advertisingReceivers;
  if (!hasTimeRemaining()) return advertisingReceivers;

  await collectScan(
    {
      serviceUUIDs: [OFFPAY_BLE_SERVICE_UUID],
      seconds: OFFPAY_BLE_FAST_SCAN_SECONDS,
      allowDuplicates: true,
      scanMode: 2,
    },
    true,
  );
  const legacyReceivers = await verifyCandidates();
  if (legacyReceivers.length > 0) return legacyReceivers;
  if (!hasTimeRemaining()) return legacyReceivers;

  if (Platform.OS === 'android') {
    await collectScan(
      {
        seconds: OFFPAY_BLE_FAST_SCAN_SECONDS,
        allowDuplicates: true,
        scanMode: 2,
        manufacturerData: {
          manufacturerId: OFFPAY_BLE_MANUFACTURER_ID,
          manufacturerData: OFFPAY_BLE_MANUFACTURER_MARKER_BYTES,
          manufacturerDataMask: OFFPAY_BLE_MANUFACTURER_MARKER_MASK,
        },
      },
      true,
    );
    const manufacturerReceivers = await verifyCandidates();
    if (manufacturerReceivers.length > 0) return manufacturerReceivers;
    if (!hasTimeRemaining()) return manufacturerReceivers;
  }

  await collectScan(
    {
      seconds: OFFPAY_BLE_FAST_SCAN_SECONDS,
      allowDuplicates: true,
      scanMode: 2,
    },
    true,
  );
  return verifyCandidates();
}

async function findRecipientPeripheral(params: {
  ble: BleManagerModule;
  recipient: string;
  recipientBleName?: string | null;
}): Promise<string> {
  const expectedName = params.recipientBleName?.trim() || createReceiverBleName(params.recipient);
  const discovered = new Map<string, DiscoveredPeripheral>();
  const candidateIds = new Set<string>();
  const attemptedIds = new Set<string>();

  const addCandidate = (peripheral: DiscoveredPeripheral): void => {
    mergePeripheral(discovered, peripheral);
    candidateIds.add(peripheral.id);
  };

  const addIfLooksLikeOffpay = (peripheral: DiscoveredPeripheral): void => {
    mergePeripheral(discovered, peripheral);
    if (peripheralNameMatches(peripheral, expectedName) || peripheralLooksLikeOffpay(peripheral)) {
      candidateIds.add(peripheral.id);
    }
  };

  const bonded = await params.ble.getBondedPeripherals?.().catch(() => []);
  for (const peripheral of bonded ?? []) {
    if (peripheralNameMatches(peripheral, expectedName) || peripheralLooksLikeOffpay(peripheral)) {
      addCandidate(peripheral);
    }
  }

  const tryConnectCandidates = async (): Promise<string | null> => {
    const peripherals = sortPeripheralsForConnection(
      Array.from(candidateIds).flatMap((id) => {
        if (attemptedIds.has(id)) return [];
        const peripheral = discovered.get(id);
        return peripheral == null ? [] : [peripheral];
      }),
      expectedName,
    );

    for (const peripheral of peripherals) {
      attemptedIds.add(peripheral.id);
      try {
        const identity = await connectAndReadReceiverIdentity({
          ble: params.ble,
          peripheralId: peripheral.id,
        });
        if (identity === params.recipient) {
          return peripheral.id;
        }
        await params.ble.disconnect(peripheral.id).catch(() => undefined);
      } catch {
        await params.ble.disconnect(peripheral.id).catch(() => undefined);
      }
    }

    return null;
  };

  const bondedMatch = await tryConnectCandidates();
  if (bondedMatch != null) return bondedMatch;

  async function collectScan(options: Parameters<BleManagerModule['scan']>[0], trusted: boolean): Promise<void> {
    const subscription = params.ble.onDiscoverPeripheral((peripheral) => {
      if (trusted) {
        addCandidate(peripheral);
        return;
      }
      addIfLooksLikeOffpay(peripheral);
    });

    try {
      await params.ble.scan(options);
      await delay(((options?.seconds ?? OFFPAY_BLE_FAST_SCAN_SECONDS) * 1000) + 350);
      const listed = await params.ble.getDiscoveredPeripherals?.().catch(() => []);
      for (const peripheral of listed ?? []) {
        if (trusted) {
          addCandidate(peripheral);
        } else {
          addIfLooksLikeOffpay(peripheral);
        }
      }
    } finally {
      subscription.remove();
      await params.ble.stopScan().catch(() => undefined);
    }
  }

  await collectScan(
    {
      exactAdvertisingName: expectedName,
      seconds: OFFPAY_BLE_FAST_SCAN_SECONDS,
      allowDuplicates: true,
      scanMode: 2,
    },
    true,
  );
  const nameMatch = await tryConnectCandidates();
  if (nameMatch != null) return nameMatch;

  await collectScan(
    {
      serviceUUIDs: [OFFPAY_BLE_ADVERTISING_SERVICE_UUID],
      seconds: OFFPAY_BLE_SCAN_SECONDS,
      allowDuplicates: true,
      scanMode: 2,
      legacy: Platform.OS === 'android' ? true : undefined,
    },
    true,
  );
  const advertisingServiceMatch = await tryConnectCandidates();
  if (advertisingServiceMatch != null) return advertisingServiceMatch;

  await collectScan(
    {
      serviceUUIDs: [OFFPAY_BLE_SERVICE_UUID],
      seconds: OFFPAY_BLE_FAST_SCAN_SECONDS,
      allowDuplicates: true,
      scanMode: 2,
    },
    true,
  );
  const legacyServiceMatch = await tryConnectCandidates();
  if (legacyServiceMatch != null) return legacyServiceMatch;

  if (Platform.OS === 'android') {
    await collectScan(
      {
        seconds: OFFPAY_BLE_FAST_SCAN_SECONDS,
        allowDuplicates: true,
        scanMode: 2,
        manufacturerData: {
          manufacturerId: OFFPAY_BLE_MANUFACTURER_ID,
          manufacturerData: OFFPAY_BLE_MANUFACTURER_MARKER_BYTES,
          manufacturerDataMask: OFFPAY_BLE_MANUFACTURER_MARKER_MASK,
        },
      },
      true,
    );
    const manufacturerMatch = await tryConnectCandidates();
    if (manufacturerMatch != null) return manufacturerMatch;
  }

  await collectScan(
    {
      seconds: OFFPAY_BLE_FAST_SCAN_SECONDS,
      allowDuplicates: true,
      scanMode: 2,
    },
    false,
  );
  const broadMatch = await tryConnectCandidates();
  if (broadMatch != null) return broadMatch;

  throw new Error(
    candidateIds.size > 0
      ? 'Nearby OffPay devices were found, but none matched this recipient wallet.'
      : 'Recipient is not advertising nearby. Open Receive on their device and keep Bluetooth on.',
  );
}

export async function sendOfflineBlePaymentPayload(
  payload: OfflineBlePaymentPayload,
  options?: { recipientBleName?: string | null },
): Promise<void> {
  const permissionsGranted = await requestAndroidBlePermissions();
  if (!permissionsGranted) throw new Error('Bluetooth permission is required for offline send.');

  const ble = await loadCentralBleManager();
  await ble.start({ showAlert: false });
  const peripheralId = await findRecipientPeripheral({
    ble,
    recipient: payload.recipient,
    recipientBleName: options?.recipientBleName,
  });
  const frames = createOfflineBleFrames(payload);

  try {
    for (const frame of frames) {
      await ble.write(
        peripheralId,
        OFFPAY_BLE_SERVICE_UUID,
        OFFPAY_BLE_PAYLOAD_CHARACTERISTIC_UUID,
        serializeOfflineBleFrameToBytes(frame),
        OFFPAY_BLE_WRITE_CHUNK_SIZE,
      );
      await delay(OFFPAY_BLE_WRITE_DELAY_MS);
    }
  } finally {
    await ble.disconnect(peripheralId).catch(() => undefined);
  }
}
