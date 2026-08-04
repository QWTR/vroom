const API_GET_TIMEOUT_MS = Math.max(
  4_000,
  Number(process.env.EXPO_PUBLIC_API_GET_TIMEOUT_MS) || 12_000,
);
const API_MUTATION_TIMEOUT_MS = Math.max(
  5_000,
  Number(process.env.EXPO_PUBLIC_API_MUTATION_TIMEOUT_MS) || 20_000,
);
const API_UPLOAD_TIMEOUT_MS = Math.max(
  30_000,
  Number(process.env.EXPO_PUBLIC_API_UPLOAD_TIMEOUT_MS) || 180_000,
);
const SLOW_REQUEST_MS = 2_000;

declare global {
  // eslint-disable-next-line no-var
  var __vroomNetworkDiagnosticsInstalled: boolean | undefined;
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (typeof URL !== 'undefined' && input instanceof URL) return input.toString();
  return typeof (input as Request)?.url === 'string' ? (input as Request).url : String(input);
}

function safeRequestLabel(raw: string): string {
  try {
    const parsed = new URL(raw);
    const keys = [...parsed.searchParams.keys()];
    return `${parsed.pathname}${keys.length ? `?${[...new Set(keys)].join('&')}` : ''}`;
  } catch {
    return raw.split('?')[0].slice(0, 180);
  }
}

function requestMethod(input: RequestInfo | URL, init?: RequestInit): string {
  return String(init?.method || (typeof input === 'object' && 'method' in input ? input.method : 'GET')).toUpperCase();
}

function isVroomApiRequest(url: string): boolean {
  return /^https?:\/\//i.test(url) && /\/api\//i.test(url);
}

if (!globalThis.__vroomNetworkDiagnosticsInstalled && typeof globalThis.fetch === 'function') {
  globalThis.__vroomNetworkDiagnosticsInstalled = true;
  const nativeFetch = globalThis.fetch.bind(globalThis);
  let sequence = 0;

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = requestUrl(input);
    const method = requestMethod(input, init);
    const monitored = isVroomApiRequest(url);
    const canRetry = monitored && (method === 'GET' || method === 'HEAD');
    const isUpload = typeof FormData !== 'undefined' && init?.body instanceof FormData;
    const label = safeRequestLabel(url);
    const requestId = ++sequence;
    const maxAttempts = canRetry ? 2 : 1;
    let lastError: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const startedAt = Date.now();
      const controller = monitored ? new AbortController() : null;
      const outerSignal = init?.signal
        ?? (typeof input === 'object' && 'signal' in input ? input.signal : undefined);
      const abortFromOuter = () => controller?.abort();
      if (controller && outerSignal) {
        if (outerSignal.aborted) controller.abort();
        else outerSignal.addEventListener('abort', abortFromOuter, { once: true });
      }
      const timeoutMs = canRetry
        ? API_GET_TIMEOUT_MS
        : (isUpload ? API_UPLOAD_TIMEOUT_MS : API_MUTATION_TIMEOUT_MS);
      const timeout = controller
        ? setTimeout(() => controller.abort(), timeoutMs)
        : null;

      if (__DEV__) console.log(`[NET ${requestId}] -> ${method} ${label} attempt=${attempt}`);
      try {
        const response = await nativeFetch(input, controller ? { ...init, signal: controller.signal } : init);
        const elapsedMs = Date.now() - startedAt;
        const serverTiming = response.headers?.get?.('x-response-time');
        const message = `[NET ${requestId}] <- ${response.status} ${method} ${label} ${elapsedMs}ms${serverTiming ? ` server=${serverTiming}` : ''}`;
        if (__DEV__ || elapsedMs >= SLOW_REQUEST_MS) {
          (elapsedMs >= SLOW_REQUEST_MS ? console.warn : console.log)(message);
        }
        if (canRetry && attempt < maxAttempts && [502, 503, 504].includes(response.status)) {
          await new Promise((resolve) => setTimeout(resolve, 250));
          continue;
        }
        return response;
      } catch (error) {
        lastError = error;
        const elapsedMs = Date.now() - startedAt;
        const outerAborted = !!outerSignal?.aborted;
        console.warn(`[NET ${requestId}] !! ${method} ${label} ${elapsedMs}ms attempt=${attempt}`, error);
        if (!canRetry || attempt >= maxAttempts || outerAborted) throw error;
        await new Promise((resolve) => setTimeout(resolve, 250));
      } finally {
        if (timeout) clearTimeout(timeout);
        if (outerSignal) outerSignal.removeEventListener('abort', abortFromOuter);
      }
    }
    throw lastError;
  }) as typeof globalThis.fetch;
}

export {};
