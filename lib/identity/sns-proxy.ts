const SNS_PROXY_BASE_URL = 'https://sdk-proxy.sns.id';

interface SnsProxyResponse {
  s?: unknown;
  result?: unknown;
}

function isSnsProxyResponse(value: unknown): value is SnsProxyResponse {
  return typeof value === 'object' && value != null;
}

/**
 * Reads public Solana Name Service data through the official SNS SDK proxy.
 * The hard-coded HTTPS origin avoids accepting an app-configured RPC or
 * arbitrary lookup endpoint for recipient resolution.
 */
export async function fetchSnsProxyResult(params: {
  path: string;
  timeoutMs: number;
  timeoutMessage: string;
}): Promise<string | null> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), params.timeoutMs);

  try {
    const response = await fetch(`${SNS_PROXY_BASE_URL}/${params.path}`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`SNS lookup failed with HTTP ${response.status}.`);
    }

    const payload: unknown = await response.json();
    if (!isSnsProxyResponse(payload)) {
      throw new Error('SNS returned an invalid response.');
    }
    if (payload.s === 'error') return null;
    if (payload.s !== 'ok' || typeof payload.result !== 'string') {
      throw new Error('SNS returned an invalid response.');
    }

    return payload.result;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(params.timeoutMessage);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}
