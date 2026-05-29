import { useOfflinePaymentStore } from '@/store/offlinePaymentStore';

describe('offlinePaymentStore', () => {
  beforeEach(() => {
    useOfflinePaymentStore.setState({
      lastParsedPayload: null,
      receipts: [],
    });
  });

  it('updates send and receive receipts for the same tx without collapsing direction labels', () => {
    const createdAt = Date.now();

    useOfflinePaymentStore.getState().addReceipt({
      id: 'offline-send-devnet-tx-1',
      direction: 'send',
      status: 'queued',
      title: 'Payment queued',
      subtitle: 'To self',
      amountLabel: '-0.2 USDC',
      tokenSymbol: 'USDC',
      network: 'devnet',
      createdAt,
      txId: 'tx-1',
      recipient: 'wallet',
    });
    useOfflinePaymentStore.getState().addReceipt({
      id: 'offline-receive-devnet-tx-1',
      direction: 'receive',
      status: 'received',
      title: 'Payment received',
      subtitle: 'From this wallet',
      amountLabel: '+0.2 USDC',
      tokenSymbol: 'USDC',
      network: 'devnet',
      createdAt,
      txId: 'tx-1',
      recipient: 'wallet',
    });

    useOfflinePaymentStore.getState().updateReceipts('tx-1', (receipt) => ({
      status: 'settled',
      title: receipt.direction === 'receive' ? 'Payment received' : 'Payment settled',
      subtitle: 'Tx abcd...1234',
      signature: 'abcd1234',
    }));

    expect(useOfflinePaymentStore.getState().receipts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'offline-send-devnet-tx-1',
          direction: 'send',
          status: 'settled',
          title: 'Payment settled',
          amountLabel: '-0.2 USDC',
        }),
        expect.objectContaining({
          id: 'offline-receive-devnet-tx-1',
          direction: 'receive',
          status: 'settled',
          title: 'Payment received',
          amountLabel: '+0.2 USDC',
        }),
      ]),
    );
  });
});
