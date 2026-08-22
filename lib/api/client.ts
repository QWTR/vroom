import { API_URL, REQUEST_TIMEOUT_MS } from '../../constants/config';
import { getAuthTokenCached } from './authTokenMemory';

export type ApiPriority = 'mutation' | 'critical' | 'visible' | 'background' | 'prefetch';

export class ApiRequestError extends Error {
  status: number;
  code: string;
  retryable: boolean;
  requestId: string | null;

  constructor(message: string, options: { status: number; code?: string; retryable?: boolean; requestId?: string | null }) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = options.status;
    this.code = options.code || `HTTP_${options.status}`;
    this.retryable = Boolean(options.retryable);
    this.requestId = options.requestId || null;
  }
}

type QueueItem<T> = {
  priority: ApiPriority;
  run: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
};

const readQueue: QueueItem<unknown>[] = [];
const inFlightReads = new Map<string, Promise<unknown>>();
let activeReads = 0;
let activePrefetch = 0;
const MAX_READS = 4;
const MAX_PREFETCH = 1;
const PRIORITY_WEIGHT: Record<ApiPriority, number> = {
  mutation: 0,
  critical: 1,
  visible: 2,
  background: 3,
  prefetch: 4,
};

function drainReads(): void {
  if (activeReads >= MAX_READS || readQueue.length === 0) return;
  readQueue.sort((left, right) => PRIORITY_WEIGHT[left.priority] - PRIORITY_WEIGHT[right.priority]);
  const index = readQueue.findIndex((item) => item.priority !== 'prefetch' || activePrefetch < MAX_PREFETCH);
  if (index < 0) return;
  const [item] = readQueue.splice(index, 1);
  activeReads += 1;
  if (item.priority === 'prefetch') activePrefetch += 1;
  item.run().then(item.resolve, item.reject).finally(() => {
    activeReads -= 1;
    if (item.priority === 'prefetch') activePrefetch -= 1;
    drainReads();
  });
  drainReads();
}

function scheduleRead<T>(priority: ApiPriority, run: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    readQueue.push({ priority, run, resolve: resolve as (value: unknown) => void, reject });
    drainReads();
  });
}

function requestId(): string {
  return `mobile-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type ApiRequestOptions = Omit<RequestInit, 'body' | 'priority'> & {
  body?: unknown;
  priority?: ApiPriority;
  auth?: boolean | 'optional';
  timeoutMs?: number;
  idempotencyKey?: string;
};

async function executeRequest<T>(path: string, options: ApiRequestOptions): Promise<T> {
  const method = String(options.method || 'GET').toUpperCase();
  const token = options.auth === false ? null : await getAuthTokenCached();
  if (options.auth !== false && options.auth !== 'optional' && !token) {
    throw new ApiRequestError('Brak aktywnej sesji', { status: 401, code: 'AUTH_TOKEN_MISSING', retryable: false });
  }
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  options.signal?.addEventListener?.('abort', onAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), options.timeoutMs || REQUEST_TIMEOUT_MS);
  const headers = new Headers(options.headers);
  headers.set('Accept', 'application/json');
  headers.set('X-Request-Id', requestId());
  headers.set('X-Vroom-Central-Request', '1');
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (options.idempotencyKey) headers.set('Idempotency-Key', options.idempotencyKey);
  let body: BodyInit | undefined;
  if (options.body != null) {
    if (options.body instanceof FormData || typeof options.body === 'string') body = options.body;
    else {
      headers.set('Content-Type', 'application/json');
      body = JSON.stringify(options.body);
    }
  }

  try {
    const apiPath = path.startsWith('/api/') || path === '/api'
      ? path
      : `/api${path.startsWith('/') ? path : `/${path}`}`;
    const { priority: _priority, auth: _auth, timeoutMs: _timeoutMs, idempotencyKey: _idempotencyKey, body: _inputBody, ...requestInit } = options;
    const response = await fetch(path.startsWith('http') ? path : `${API_URL}${apiPath}`, {
      ...requestInit,
      method,
      headers,
      body,
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new ApiRequestError(payload?.message || payload?.error || `HTTP ${response.status}`, {
        status: response.status,
        code: payload?.code || payload?.errorCode,
        retryable: payload?.retryable ?? (response.status === 408 || response.status === 429 || response.status >= 500),
        requestId: payload?.requestId || response.headers.get('X-Request-Id'),
      });
    }
    return payload as T;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener?.('abort', onAbort);
  }
}

async function executeWithRetry<T>(path: string, options: ApiRequestOptions): Promise<T> {
  const safe = String(options.method || 'GET').toUpperCase() === 'GET';
  const attempts = safe ? 2 : 1;
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await executeRequest<T>(path, options);
    } catch (error) {
      lastError = error;
      if (options.signal?.aborted || !(error instanceof ApiRequestError) || !error.retryable || attempt === attempts - 1) throw error;
      await sleep(250 * 2 ** attempt);
    }
  }
  throw lastError;
}

export function apiRequest<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const method = String(options.method || 'GET').toUpperCase();
  const priority = options.priority || (method === 'GET' ? 'visible' : 'mutation');
  if (method !== 'GET') return executeWithRetry<T>(path, { ...options, method, priority: 'mutation' });
  const authMode = options.auth === false ? 'public' : options.auth === 'optional' ? 'optional' : 'auth';
  const key = `${method}:${path}:${authMode}`;
  const existing = inFlightReads.get(key) as Promise<T> | undefined;
  if (existing) return existing;
  const request = scheduleRead(priority, () => executeWithRetry<T>(path, { ...options, method, priority }))
    .finally(() => inFlightReads.delete(key));
  inFlightReads.set(key, request);
  return request;
}

export function getApiSchedulerStats() {
  return { activeReads, activePrefetch, queuedReads: readQueue.length, deduplicatedKeys: inFlightReads.size };
}
