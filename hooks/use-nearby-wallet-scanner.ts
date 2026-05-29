import { useCallback, useEffect, useRef, useState } from 'react';

import { discoverOfflineBleReceivers } from '@/lib/offline/offline-ble-transport';

import type { OfflineBleDiscoveredReceiver } from '@/lib/offline/offline-ble-transport';

interface NearbyWalletScannerState {
  receivers: OfflineBleDiscoveredReceiver[];
  scanning: boolean;
  error: string | null;
  scan: () => Promise<void>;
}

export function useNearbyWalletScanner(options?: {
  autoStart?: boolean;
  seconds?: number;
  timeoutMs?: number;
}): NearbyWalletScannerState {
  const [receivers, setReceivers] = useState<OfflineBleDiscoveredReceiver[]>([]);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const runIdRef = useRef(0);
  const scanningRef = useRef(false);

  const scan = useCallback(async (): Promise<void> => {
    if (scanningRef.current) return;

    const runId = runIdRef.current + 1;
    runIdRef.current = runId;
    scanningRef.current = true;
    setScanning(true);
    setError(null);

    try {
      const discovered = await discoverOfflineBleReceivers({
        seconds: options?.seconds ?? 5,
        maxDurationMs: options?.timeoutMs ?? 9_000,
        onUpdate: (nextReceivers) => {
          if (runIdRef.current === runId) setReceivers(nextReceivers);
        },
      });
      if (runIdRef.current !== runId) return;
      setReceivers(discovered);
      if (discovered.length === 0) {
        setError('No nearby OffPay wallets found. Keep Receive open on the other device.');
      }
    } catch (scanError) {
      if (runIdRef.current !== runId) return;
      setReceivers([]);
      setError(scanError instanceof Error ? scanError.message : 'Nearby wallet scan failed.');
    } finally {
      if (runIdRef.current === runId) {
        scanningRef.current = false;
        setScanning(false);
      }
    }
  }, [options?.seconds, options?.timeoutMs]);

  useEffect(() => {
    if (options?.autoStart === false) return undefined;

    void scan();
    return () => {
      runIdRef.current += 1;
      scanningRef.current = false;
    };
  }, [options?.autoStart, scan]);

  return {
    receivers,
    scanning,
    error,
    scan,
  };
}
