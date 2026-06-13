export { FlashTradeClient, FlashTradeApiError, FlashTradeConnectionError, getFlashTradeClient, resetFlashTradeClient } from './client';
export { FlashAnalyticsClient } from './analytics-client';
export * from './types';
export * from './constants';

import { FlashTradeClient, getFlashTradeClient } from './client';
import { FlashAnalyticsClient } from './analytics-client';

let analyticsClient: FlashAnalyticsClient | null = null;

export function getAnalyticsClient(): FlashAnalyticsClient {
  if (!analyticsClient) {
    analyticsClient = new FlashAnalyticsClient(getFlashTradeClient());
  }
  return analyticsClient;
}

export function resetAnalyticsClient(): void {
  analyticsClient = null;
}
