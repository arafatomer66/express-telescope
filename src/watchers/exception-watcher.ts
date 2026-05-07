import type { ErrorRequestHandler } from 'express';
import { Telescope } from '../telescope';

function parseStack(err: Error): { trace: string[]; file?: string; line?: number } {
  const trace = (err.stack ?? '').split('\n').slice(1).map((l) => l.trim());
  const first = trace[0]?.match(/\((.+?):(\d+):\d+\)/) || trace[0]?.match(/at (.+?):(\d+):\d+/);
  return {
    trace,
    file: first?.[1],
    line: first?.[2] ? parseInt(first[2], 10) : undefined,
  };
}

export function exceptionWatcher(t: Telescope): ErrorRequestHandler {
  return (err, _req, _res, next) => {
    if (t.isEnabled() && err instanceof Error) {
      const { trace, file, line } = parseStack(err);
      t.recordException(
        {
          class: err.name || 'Error',
          message: err.message,
          file,
          line,
          trace,
        },
        ['unhandled']
      );
    }
    next(err);
  };
}

/** Capture uncaught process errors. Call once at startup. */
export function installProcessHandlers(t: Telescope) {
  process.on('uncaughtException', (err: Error) => {
    if (!t.isEnabled()) return;
    const { trace, file, line } = parseStack(err);
    t.recordException(
      { class: err.name || 'Error', message: err.message, file, line, trace },
      ['uncaught']
    );
  });
  process.on('unhandledRejection', (reason: unknown) => {
    if (!t.isEnabled()) return;
    const err = reason instanceof Error ? reason : new Error(String(reason));
    const { trace, file, line } = parseStack(err);
    t.recordException(
      { class: err.name || 'UnhandledRejection', message: err.message, file, line, trace },
      ['unhandled-rejection']
    );
  });
}
