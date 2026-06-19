export const DEFAULT_RETRY_BACKOFF_MS = [250, 750, 1500] as const;

const TRANSIENT_CODES: Record<string, true> = {
  ECONNRESET: true,
  ETIMEDOUT: true,
  ECONNREFUSED: true,
  EPIPE: true,
  ECONNABORTED: true,
  EAI_AGAIN: true,
};
const TRANSIENT_MESSAGE_PATTERNS = [
  'econnreset',
  'etimedout',
  'econnrefused',
  'socket hang up',
  'network error',
  'connection error',
  'connection reset',
  'fetch failed',
  'timed out',
];

export function isTransientProviderError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const e = error as { status?: unknown; statusCode?: unknown; code?: unknown; name?: unknown; message?: unknown };
  const status = typeof e.status === 'number' ? e.status : typeof e.statusCode === 'number' ? e.statusCode : undefined;
  if (status !== undefined) return status === 408 || status === 409 || status === 425 || status === 429 || (status >= 500 && status <= 599);
  const code = typeof e.code === 'string' ? e.code : '';
  if (TRANSIENT_CODES[code]) return true;
  const name = typeof e.name === 'string' ? e.name : '';
  if (name === 'APIConnectionError' || name === 'APIConnectionTimeoutError') return true;
  const message = typeof e.message === 'string' ? e.message.toLowerCase() : '';
  return TRANSIENT_MESSAGE_PATTERNS.some((pattern) => message.includes(pattern));
}
