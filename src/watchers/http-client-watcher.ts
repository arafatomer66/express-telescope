import { Telescope } from '../telescope';

const SENSITIVE_HEADERS = ['authorization', 'cookie', 'set-cookie', 'x-api-key', 'proxy-authorization'];

function sanitizeHeaders(h: Headers | Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  const setOne = (k: string, v: string) => {
    out[k] = SENSITIVE_HEADERS.includes(k.toLowerCase()) ? '[REDACTED]' : v;
  };
  if (h instanceof Headers) {
    h.forEach((v, k) => setOne(k, v));
  } else {
    for (const [k, v] of Object.entries(h)) setOne(k, String(v));
  }
  return out;
}

type FetchInput = Parameters<typeof globalThis.fetch>[0];

function getMethod(input: FetchInput, init?: RequestInit): string {
  if (init?.method) return init.method.toUpperCase();
  if (input instanceof Request) return input.method.toUpperCase();
  return 'GET';
}

function getUrl(input: FetchInput): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  if (input instanceof Request) return input.url;
  return String(input);
}

/**
 * Patch global `fetch` so outbound HTTP calls are recorded.
 * Returns an unpatch function. Safe to call multiple times (idempotent).
 */
export function installFetchWatcher(t: Telescope): () => void {
  const orig = globalThis.fetch;
  if (!orig || (orig as { __telescopePatched?: boolean }).__telescopePatched) return () => {};

  const patched = async function telescopeFetch(
    input: FetchInput,
    init?: RequestInit
  ): Promise<Response> {
    if (!t.isEnabled()) return orig(input, init);

    const start = process.hrtime.bigint();
    const method = getMethod(input, init);
    const uri = getUrl(input);
    const requestHeaders = init?.headers
      ? sanitizeHeaders(init.headers as Record<string, string>)
      : input instanceof Request
        ? sanitizeHeaders(input.headers)
        : undefined;

    let resp: Response;
    try {
      resp = await orig(input, init);
    } catch (err) {
      const duration = Number(process.hrtime.bigint() - start) / 1e6;
      t.recordHttpClient({
        method,
        uri,
        status: 0,
        duration: Math.round(duration * 100) / 100,
        requestHeaders,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }

    const duration = Number(process.hrtime.bigint() - start) / 1e6;
    const cloned = resp.clone();
    void captureResponseBody(cloned)
      .then((body) => {
        t.recordHttpClient({
          method,
          uri,
          status: resp.status,
          duration: Math.round(duration * 100) / 100,
          requestHeaders,
          responseHeaders: sanitizeHeaders(resp.headers),
          responseBody: body,
        });
      })
      .catch(() => {
        // never break the caller
      });
    return resp;
  };

  (patched as { __telescopePatched?: boolean }).__telescopePatched = true;
  globalThis.fetch = patched as typeof fetch;
  return () => {
    globalThis.fetch = orig;
  };
}

async function captureResponseBody(resp: Response): Promise<unknown> {
  const ct = resp.headers.get('content-type') || '';
  try {
    if (ct.includes('json')) return await resp.json();
    if (ct.startsWith('text/') || ct.includes('xml')) {
      const txt = await resp.text();
      return txt.length > 10_000 ? txt.slice(0, 10_000) + '…' : txt;
    }
    return `[${ct || 'binary'}]`;
  } catch {
    return undefined;
  }
}

/**
 * Wire up axios so requests/responses are recorded.
 *
 *   import axios from 'axios';
 *   attachAxiosInterceptor(t, axios);
 */
export function attachAxiosInterceptor(t: Telescope, axios: AxiosLike): void {
  axios.interceptors.request.use((config) => {
    (config as { __telescopeStart?: bigint }).__telescopeStart = process.hrtime.bigint();
    return config;
  });
  axios.interceptors.response.use(
    (resp) => {
      record(t, resp.config, resp.status, resp.headers, resp.data);
      return resp;
    },
    (err: { config?: AxiosLikeConfig; response?: AxiosLikeResponse; message?: string }) => {
      if (err.config) {
        record(
          t,
          err.config,
          err.response?.status ?? 0,
          err.response?.headers,
          err.response?.data,
          err.message
        );
      }
      return Promise.reject(err);
    }
  );
}

function record(
  t: Telescope,
  config: AxiosLikeConfig,
  status: number,
  responseHeaders: Record<string, string> | undefined,
  responseBody: unknown,
  error?: string
) {
  const start = (config as { __telescopeStart?: bigint }).__telescopeStart;
  const duration = start ? Number(process.hrtime.bigint() - start) / 1e6 : 0;
  t.recordHttpClient({
    method: (config.method ?? 'GET').toUpperCase(),
    uri: config.url ?? '',
    status,
    duration: Math.round(duration * 100) / 100,
    requestHeaders: config.headers ? sanitizeHeaders(config.headers) : undefined,
    requestBody: config.data,
    responseHeaders: responseHeaders ? sanitizeHeaders(responseHeaders) : undefined,
    responseBody,
    error,
  });
}

interface AxiosLikeConfig {
  method?: string;
  url?: string;
  headers?: Record<string, string>;
  data?: unknown;
}
interface AxiosLikeResponse {
  status: number;
  headers: Record<string, string>;
  data: unknown;
  config: AxiosLikeConfig;
}
interface AxiosLike {
  interceptors: {
    request: { use: (fn: (c: AxiosLikeConfig) => AxiosLikeConfig) => void };
    response: {
      use: (
        onOk: (r: AxiosLikeResponse) => AxiosLikeResponse,
        onErr: (e: { config?: AxiosLikeConfig; response?: AxiosLikeResponse; message?: string }) => unknown
      ) => void;
    };
  };
}
