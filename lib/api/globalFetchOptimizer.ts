import { API_URL } from '../../constants/config';

type QueueItem = { run: () => Promise<Response>; resolve: (value: Response) => void; reject: (error: unknown) => void };
type CacheEntry = { at: number; response: Response };

const queue: QueueItem[] = [];
const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<Response>>();
let activeReads = 0;
let originalFetch: typeof globalThis.fetch | null = null;
const MAX_READS = 4;
const DEFAULT_TTL_MS = 15_000;

function drain() {
  while (activeReads < MAX_READS && queue.length) {
    const item = queue.shift();
    if (!item) return;
    activeReads += 1;
    item.run().then(item.resolve, item.reject).finally(() => {
      activeReads -= 1;
      drain();
    });
  }
}

function schedule(run: () => Promise<Response>) {
  return new Promise<Response>((resolve, reject) => {
    queue.push({ run, resolve, reject });
    drain();
  });
}

function requestUrl(input: RequestInfo | URL) {
  return typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
}

function abortError() {
  const error = new Error('Aborted');
  error.name = 'AbortError';
  return error;
}

export function installGlobalApiFetchOptimizer() {
  if (originalFetch || typeof globalThis.fetch !== 'function') return;
  originalFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const nativeFetch = originalFetch!;
    const url = requestUrl(input);
    const inputRequest = typeof Request !== 'undefined' && input instanceof Request ? input : null;
    const method = String(init.method || inputRequest?.method || 'GET').toUpperCase();
    const headers = new Headers(init.headers || inputRequest?.headers);
    if (!url.startsWith(API_URL) || headers.get('X-Vroom-Central-Request') === '1') {
      return nativeFetch(input, init);
    }
    if (method !== 'GET') {
      cache.clear();
      return nativeFetch(input, init);
    }
    const authScope = headers.has('Authorization') ? 'auth' : 'anon';
    const key = `${authScope}:${url}`;
    const noStore = /no-store/i.test(headers.get('Cache-Control') || '');
    const cached = cache.get(key);
    if (!noStore && cached && Date.now() - cached.at < DEFAULT_TTL_MS) return cached.response.clone();
    const existing = inflight.get(key);
    if (existing) return (await existing).clone();
    const request = schedule(async () => {
      if (init.signal?.aborted) throw abortError();
      const response = await nativeFetch(input, init);
      if (!noStore && response.ok) cache.set(key, { at: Date.now(), response: response.clone() });
      return response;
    }).finally(() => inflight.delete(key));
    inflight.set(key, request);
    return (await request).clone();
  }) as typeof globalThis.fetch;
}

export function invalidateGlobalApiFetchCache() {
  cache.clear();
}

export function uninstallGlobalApiFetchOptimizerForTests() {
  if (originalFetch) globalThis.fetch = originalFetch;
  originalFetch = null;
  queue.splice(0);
  cache.clear();
  inflight.clear();
  activeReads = 0;
}

export function getGlobalFetchOptimizerStats() {
  return { activeReads, queuedReads: queue.length, cachedReads: cache.size, inflightReads: inflight.size };
}
