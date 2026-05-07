import type { Express } from 'express';
import { Telescope, telescope, resetTelescope } from './telescope';
import { TelescopeOptions } from './types';
import { requestWatcher } from './watchers/request-watcher';
import { exceptionWatcher, installProcessHandlers } from './watchers/exception-watcher';
import { installConsoleCapture, uninstallConsoleCapture } from './watchers/log-watcher';
import { trackQuery, patchBetterSqlite } from './watchers/query-watcher';
import { installFetchWatcher, attachAxiosInterceptor } from './watchers/http-client-watcher';
import { installPrismaWatcher, TelescopeTypeOrmLogger } from './watchers/prisma-watcher';
import { dashboardRouter } from './dashboard/routes';
import type { DumpEntry } from './types';

export interface InstallOptions extends TelescopeOptions {
  /** Capture console.log / .info / .warn / .error to the log watcher. Default: true. */
  captureConsole?: boolean;
  /** Install process-level uncaughtException / unhandledRejection handlers. Default: true. */
  captureProcessErrors?: boolean;
  /** Patch globalThis.fetch to record outbound HTTP. Default: true. */
  captureFetch?: boolean;
}

/**
 * One-shot installer. Mounts the request middleware, error handler, and dashboard.
 *
 *   import express from 'express';
 *   import { installTelescope } from 'express-telescope';
 *   const app = express();
 *   app.use(express.json());
 *   const t = installTelescope(app, { path: '/telescope' });
 *
 * The error handler is registered immediately. Mount your routes BEFORE calling install,
 * or call `attachErrorHandler(t, app)` yourself after your routes.
 */
export function installTelescope(app: Express, opts: InstallOptions = {}): Telescope {
  const t = telescope(opts);

  // Request capture must come first
  app.use(requestWatcher(t));

  // Dashboard
  app.use(t.options.path, dashboardRouter(t));

  if (opts.captureConsole !== false) installConsoleCapture(t);
  if (opts.captureProcessErrors !== false) installProcessHandlers(t);
  if (opts.captureFetch !== false) installFetchWatcher(t);

  // Caller still has to mount routes. Provide a helper for the error handler:
  (app as Express & { attachTelescopeErrorHandler?: () => void }).attachTelescopeErrorHandler = () =>
    attachErrorHandler(t, app);

  return t;
}

/** Attach the exception watcher. Must be called AFTER your route handlers. */
export function attachErrorHandler(t: Telescope, app: Express): void {
  app.use(exceptionWatcher(t));
}

/**
 * Record an arbitrary value to the dashboard. Like Laravel's `dump()`.
 *
 *   dump(t, 'user', currentUser);
 *   dump(t, { someState }); // unlabeled
 */
export function dump(t: Telescope, ...values: unknown[]): void {
  let label: string | undefined;
  let payload = values;
  if (values.length >= 2 && typeof values[0] === 'string') {
    label = values[0];
    payload = values.slice(1);
  }
  const entry: DumpEntry = { label, values: payload };
  t.recordDump(entry);
}

export {
  Telescope,
  telescope,
  resetTelescope,
  requestWatcher,
  exceptionWatcher,
  installProcessHandlers,
  installConsoleCapture,
  uninstallConsoleCapture,
  trackQuery,
  patchBetterSqlite,
  installFetchWatcher,
  attachAxiosInterceptor,
  installPrismaWatcher,
  TelescopeTypeOrmLogger,
  dashboardRouter,
};
export * from './types';
