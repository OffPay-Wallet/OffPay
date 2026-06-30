import { Buffer } from 'buffer';
import { PermissionsAndroid, Platform } from 'react-native';

import {
  createOfflineBleFrames,
  serializeOfflineBleFrameToBytes,
  type OfflineBlePaymentPayload,
} from '@/lib/offline/offline-ble-protocol';
import {
  discoverOfflineBleReceivers,
  sendOfflineBlePaymentPayload,
  startOfflineBleReceiver,
} from '@/lib/offline/offline-ble-transport';
import { getAppLockSuppressionRemainingMs } from '@/lib/wallet/app-lock-suppression';

const mockDiscoverCallbacks: Array<(peripheral: {
  id: string;
  name?: string | null;
  advertising?: {
    serviceUUIDs?: string[] | null;
  };
  rssi?: number | null;
}) => void> = [];
const mockPeripheralWriteCallbacks: Array<(event: unknown) => void> = [];

const mockPeripheral = {
  id: 'AA:BB:CC:DD:EE:FF',
  name: 'OffPay-254N-FdXP',
  rssi: -42,
};

function emitDefaultMockPeripheralDuringScan(): void {
  mockDiscoverCallbacks.forEach((callback) => callback(mockPeripheral));
}

const mockBleManager = {
  start: jest.fn(async () => undefined),
  scan: jest.fn(async () => {
    emitDefaultMockPeripheralDuringScan();
  }),
  stopScan: jest.fn(async () => undefined),
  connect: jest.fn(async () => undefined),
  disconnect: jest.fn(async () => undefined),
  retrieveServices: jest.fn(async () => undefined),
  read: jest.fn(async () => Array.from(Buffer.from('254NRecipientWalletFdXP', 'utf8'))),
  write: jest.fn(async () => undefined),
  requestMTU: jest.fn(async () => 512),
  getBondedPeripherals: jest.fn(async () => []),
  getDiscoveredPeripherals: jest.fn(async () => []),
  onDiscoverPeripheral: jest.fn((callback) => {
    mockDiscoverCallbacks.push(callback);
    return {
      remove: () => {
        const index = mockDiscoverCallbacks.indexOf(callback);
        if (index >= 0) mockDiscoverCallbacks.splice(index, 1);
      },
    };
  }),
};

const mockMunimBluetooth = {
  requestBluetoothPermission: jest.fn(async () => true),
  isBluetoothEnabled: jest.fn(async () => true),
  setServices: jest.fn(),
  startAdvertising: jest.fn(),
  stopAdvertising: jest.fn(),
  addEventListener: jest.fn((eventName: string, callback: (event: unknown) => void) => {
    if (eventName === 'characteristicWriteRequest') {
      mockPeripheralWriteCallbacks.push(callback);
    }

    return () => {
      const index = mockPeripheralWriteCallbacks.indexOf(callback);
      if (index >= 0) mockPeripheralWriteCallbacks.splice(index, 1);
    };
  }),
};

jest.mock('react-native-ble-manager', () => ({
  __esModule: true,
  default: mockBleManager,
}));

jest.mock('munim-bluetooth', () => ({
  __esModule: true,
  ...mockMunimBluetooth,
}));

function buildPayload(): OfflineBlePaymentPayload {
  return {
    version: 1,
    protocol: 'offpay-offline-ble',
    type: 'offline-payment',
    txId: 'offline-tx-1',
    signedBlob: 'signed-transaction',
    network: 'devnet',
    sender: 'sender-wallet',
    recipient: '254NRecipientWalletFdXP',
    recipientTokenAccount: 'recipient-token-account',
    amount: '0.1',
    rawAmount: '100000',
    tokenMint: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
    tokenSymbol: 'USDC',
    tokenDecimals: 6,
    createdAt: 1_713_996_000,
    sessionId: 'offline-session-1',
  };
}

function setPlatform(os: typeof Platform.OS, version: typeof Platform.Version): void {
  Object.defineProperty(Platform, 'OS', {
    configurable: true,
    get: () => os,
  });
  Object.defineProperty(Platform, 'Version', {
    configurable: true,
    get: () => version,
  });
}

type AndroidPermissionResults = Awaited<ReturnType<typeof PermissionsAndroid.requestMultiple>>;

describe('offline-ble-transport', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    mockDiscoverCallbacks.length = 0;
    mockPeripheralWriteCallbacks.length = 0;
    mockBleManager.scan.mockImplementation(async () => {
      emitDefaultMockPeripheralDuringScan();
    });
    setPlatform('ios', '16.0');
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('advertises a compact discovery payload separate from the GATT service', async () => {
    const session = await startOfflineBleReceiver({
      walletAddress: '254NRecipientWalletFdXP',
      displayName: 'karan',
      onPayment: jest.fn(),
    });

    expect(mockMunimBluetooth.startAdvertising).toHaveBeenCalledWith({
      serviceUUIDs: ['0000FD6F-0000-1000-8000-00805F9B34FB'],
      localName: 'OffPay-karan',
      manufacturerData: '4f50',
    });

    session.stop();
  });

  it('uses a compact Android advertisement after runtime permissions are granted', async () => {
    setPlatform('android', 35);
    jest.spyOn(PermissionsAndroid, 'requestMultiple').mockResolvedValueOnce({
      [PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN]: PermissionsAndroid.RESULTS.GRANTED,
      [PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT]: PermissionsAndroid.RESULTS.GRANTED,
      [PermissionsAndroid.PERMISSIONS.BLUETOOTH_ADVERTISE]: PermissionsAndroid.RESULTS.GRANTED,
    } as AndroidPermissionResults);

    const session = await startOfflineBleReceiver({
      walletAddress: '254NRecipientWalletFdXP',
      displayName: 'karan',
      onPayment: jest.fn(),
    });

    expect(mockMunimBluetooth.startAdvertising).toHaveBeenCalledWith({
      serviceUUIDs: ['0000FD6F-0000-1000-8000-00805F9B34FB'],
      manufacturerData: '4f50',
    });

    session.stop();
  });

  it('stops before native BLE startup when Android runtime permission is denied', async () => {
    setPlatform('android', 35);
    jest.spyOn(PermissionsAndroid, 'requestMultiple').mockResolvedValueOnce({
      [PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN]: PermissionsAndroid.RESULTS.DENIED,
      [PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT]: PermissionsAndroid.RESULTS.GRANTED,
      [PermissionsAndroid.PERMISSIONS.BLUETOOTH_ADVERTISE]: PermissionsAndroid.RESULTS.GRANTED,
    } as AndroidPermissionResults);

    await expect(
      startOfflineBleReceiver({
        walletAddress: '254NRecipientWalletFdXP',
        displayName: 'karan',
        onPayment: jest.fn(),
      }),
    ).rejects.toThrow('Bluetooth permission is required for offline receive.');

    expect(mockMunimBluetooth.requestBluetoothPermission).not.toHaveBeenCalled();
    expect(mockMunimBluetooth.startAdvertising).not.toHaveBeenCalled();
  });

  it('cleans up receiver startup when native advertising throws', async () => {
    mockMunimBluetooth.startAdvertising.mockImplementationOnce(() => {
      throw new Error('Native advertiser failed.');
    });

    await expect(
      startOfflineBleReceiver({
        walletAddress: '254NRecipientWalletFdXP',
        displayName: 'karan',
        onPayment: jest.fn(),
      }),
    ).rejects.toThrow('Native advertiser failed.');

    expect(mockMunimBluetooth.setServices).toHaveBeenCalled();
    expect(mockMunimBluetooth.stopAdvertising).toHaveBeenCalled();
    expect(mockPeripheralWriteCallbacks).toHaveLength(0);
  });

  it('keeps app-lock suppressed while receiver startup waits on native Bluetooth state', async () => {
    let resolveBluetoothEnabled!: (enabled: boolean) => void;
    mockMunimBluetooth.isBluetoothEnabled.mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          resolveBluetoothEnabled = resolve;
        }),
    );

    const startupPromise = startOfflineBleReceiver({
      walletAddress: '254NRecipientWalletFdXP',
      displayName: 'karan',
      onPayment: jest.fn(),
    });

    await Promise.resolve();
    await jest.advanceTimersByTimeAsync(1_500);

    expect(getAppLockSuppressionRemainingMs()).toBeGreaterThan(0);

    expect(resolveBluetoothEnabled).toEqual(expect.any(Function));
    resolveBluetoothEnabled(true);
    const session = await startupPromise;

    session.stop();
  });

  it('delivers to a name-discovered receiver after verifying wallet identity', async () => {
    const sendPromise = sendOfflineBlePaymentPayload(buildPayload(), {
      recipientBleName: 'OffPay-254N-FdXP',
    });

    await jest.advanceTimersByTimeAsync(5_000);
    await jest.advanceTimersByTimeAsync(1_000);
    await sendPromise;

    expect(mockBleManager.scan).toHaveBeenCalledWith(
      expect.objectContaining({
        exactAdvertisingName: 'OffPay-254N-FdXP',
      }),
    );
    expect(mockBleManager.read).toHaveBeenCalled();
    expect(mockBleManager.write).toHaveBeenCalled();
  });

  it('delivers to a receiver found by a compact Android service UUID advertisement', async () => {
    setPlatform('android', 35);
    jest.spyOn(PermissionsAndroid, 'requestMultiple').mockResolvedValueOnce({
      [PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN]: PermissionsAndroid.RESULTS.GRANTED,
      [PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT]: PermissionsAndroid.RESULTS.GRANTED,
      [PermissionsAndroid.PERMISSIONS.BLUETOOTH_ADVERTISE]: PermissionsAndroid.RESULTS.GRANTED,
    } as AndroidPermissionResults);
    let scanCalls = 0;
    mockBleManager.scan.mockImplementation(async () => {
      scanCalls += 1;
      if (scanCalls !== 5) return;
      mockDiscoverCallbacks.forEach((callback) =>
        callback({
          id: 'AA:BB:CC:DD:EE:22',
          name: null,
          rssi: -44,
          advertising: {
            serviceUUIDs: ['FD6F'],
          },
        }),
      );
    });

    const sendPromise = sendOfflineBlePaymentPayload(buildPayload());

    await jest.advanceTimersByTimeAsync(30_000);
    await sendPromise;

    expect(mockBleManager.connect).toHaveBeenCalledWith('AA:BB:CC:DD:EE:22');
    expect(mockBleManager.write).toHaveBeenCalled();
  });

  it('discovers nearby receivers by verifying their wallet identity', async () => {
    const discoveryPromise = discoverOfflineBleReceivers({ seconds: 2 });

    await jest.advanceTimersByTimeAsync(16_000);
    const receivers = await discoveryPromise;

    expect(mockBleManager.scan).toHaveBeenCalledWith(
      expect.objectContaining({
        serviceUUIDs: ['0000FD6F-0000-1000-8000-00805F9B34FB'],
      }),
    );
    expect(receivers).toEqual([
      {
        id: 'AA:BB:CC:DD:EE:FF',
        walletAddress: '254NRecipientWalletFdXP',
        bleName: 'OffPay-254N-FdXP',
        displayName: 'OffPay-254N-FdXP',
        username: null,
        rssi: -42,
      },
    ]);
    expect(mockBleManager.disconnect).toHaveBeenCalledWith('AA:BB:CC:DD:EE:FF');
  });

  it('shows usernames from OffPay-prefixed receiver advertisements', async () => {
    mockBleManager.scan.mockImplementationOnce(async () => {
      mockDiscoverCallbacks.forEach((callback) =>
        callback({
          id: 'AA:BB:CC:DD:EE:11',
          name: 'OffPay-karan',
          rssi: -39,
        }),
      );
    });

    const discoveryPromise = discoverOfflineBleReceivers({ seconds: 2 });

    await jest.advanceTimersByTimeAsync(3_000);
    const receivers = await discoveryPromise;

    expect(receivers).toEqual([
      {
        id: 'AA:BB:CC:DD:EE:11',
        walletAddress: '254NRecipientWalletFdXP',
        bleName: 'OffPay-karan',
        displayName: 'karan',
        username: 'karan',
        rssi: -39,
      },
    ]);
  });

  it('reassembles split characteristic write chunks without reporting parse errors', async () => {
    const payload = buildPayload();
    const onPayment = jest.fn();
    const onError = jest.fn();
    const session = await startOfflineBleReceiver({
      walletAddress: '254NRecipientWalletFdXP',
      onPayment,
      onError,
    });
    const [callback] = mockPeripheralWriteCallbacks;
    expect(callback).toBeDefined();

    const writeEvent = {
      deviceId: 'sender-device',
      serviceUUID: '6E400001-B5A3-F393-E0A9-E50E24DCCA9E',
      characteristicUUID: '6E400003-B5A3-F393-E0A9-E50E24DCCA9E',
    };

    for (const frame of createOfflineBleFrames(payload)) {
      const frameHex = Buffer.from(serializeOfflineBleFrameToBytes(frame)).toString('hex');
      const splitAt = Math.max(2, Math.floor(frameHex.length / 4) * 2);
      callback?.({
        ...writeEvent,
        value: frameHex.slice(0, splitAt),
      });
      callback?.({
        ...writeEvent,
        value: frameHex.slice(splitAt),
      });
    }
    await Promise.resolve();

    expect(onError).not.toHaveBeenCalled();
    expect(onPayment).toHaveBeenCalledWith({ payload });

    session.stop();
  });
});
