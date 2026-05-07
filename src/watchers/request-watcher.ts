import type { NextFunction, Request, Response } from 'express';
import { Telescope } from '../telescope';

const SENSITIVE_HEADERS = ['authorization', 'cookie', 'set-cookie', 'x-api-key'];
const SENSITIVE_BODY_KEYS = ['password', 'password_confirmation', 'token', 'secret', 'api_key'];

function sanitizeHeaders(h: Record<string, unknown>): Record<string, string | string[] | undefined> {
  const out: Record<string, string | string[] | undefined> = {};
  for (const [k, v] of Object.entries(h)) {
    out[k] = SENSITIVE_HEADERS.includes(k.toLowerCase()) ? '[REDACTED]' : (v as never);
  }
  return out;
}

function sanitizeBody(body: unknown): unknown {
  if (!body || typeof body !== 'object') return body;
  if (Array.isArray(body)) return body.map(sanitizeBody);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body as Record<string, unknown>)) {
    out[k] = SENSITIVE_BODY_KEYS.includes(k.toLowerCase()) ? '[REDACTED]' : sanitizeBody(v);
  }
  return out;
}

function shouldIgnore(uri: string, telescopePath: string, ignoreRoutes: (RegExp | string)[]) {
  if (uri.startsWith(telescopePath)) return true;
  return ignoreRoutes.some((p) => (typeof p === 'string' ? uri.startsWith(p) : p.test(uri)));
}

export function requestWatcher(t: Telescope) {
  return function telescopeRequestMiddleware(req: Request, res: Response, next: NextFunction) {
    if (!t.isEnabled() || shouldIgnore(req.originalUrl, t.options.path, t.options.ignoreRoutes)) {
      return next();
    }

    const startedAt = process.hrtime.bigint();
    const memBefore = process.memoryUsage().heapUsed;
    t.startBatch();
    const batchId = t.getBatchId();

    let captured: Buffer[] = [];
    if (t.options.recordResponseBody) {
      const origWrite = res.write.bind(res);
      const origEnd = res.end.bind(res);
      res.write = ((chunk: never, ...rest: never[]) => {
        if (chunk) captured.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        return (origWrite as (...a: never[]) => boolean)(chunk, ...rest);
      }) as typeof res.write;
      res.end = ((chunk?: never, ...rest: never[]) => {
        if (chunk) captured.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        return (origEnd as (...a: unknown[]) => Response)(chunk, ...rest);
      }) as typeof res.end;
    }

    res.on('finish', () => {
      const duration = Number(process.hrtime.bigint() - startedAt) / 1e6;
      const memory = process.memoryUsage().heapUsed - memBefore;

      let response: unknown;
      if (t.options.recordResponseBody && captured.length) {
        const buf = Buffer.concat(captured).toString('utf8');
        const ct = String(res.getHeader('content-type') || '');
        if (ct.includes('json')) {
          try {
            response = JSON.parse(buf);
          } catch {
            response = buf.slice(0, 10_000);
          }
        } else if (ct.startsWith('text/') || ct.includes('xml')) {
          response = buf.slice(0, 10_000);
        } else {
          response = `[binary ${buf.length} bytes]`;
        }
      }

      const status = res.statusCode;
      const tags: string[] = [`status:${status}`];
      if (status >= 500) tags.push('server-error');
      else if (status >= 400) tags.push('client-error');

      t.recordRequest(
        {
          method: req.method,
          uri: req.originalUrl,
          status,
          duration: Math.round(duration * 100) / 100,
          ip: req.ip,
          memory,
          payload: t.options.recordRequestBody
            ? (sanitizeBody(req.body) as Record<string, unknown>)
            : undefined,
          headers: sanitizeHeaders(req.headers as Record<string, unknown>),
          response,
          responseHeaders: sanitizeHeaders(res.getHeaders() as Record<string, unknown>),
          hostname: req.hostname,
          userAgent: req.headers['user-agent'],
        },
        tags
      );
      t.endBatch();
      // expose batch id so handlers can correlate (already set on res.locals below)
    });

    // expose helper for handlers / other watchers
    (res.locals as { telescopeBatchId?: string | null }).telescopeBatchId = batchId;
    next();
  };
}
