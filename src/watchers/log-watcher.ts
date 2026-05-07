import { Telescope } from '../telescope';
import { LogEntry } from '../types';

type ConsoleMethod = 'log' | 'info' | 'warn' | 'error' | 'debug';
type LogFn = (...args: unknown[]) => void;

const ORIGINAL: Partial<Record<ConsoleMethod, LogFn>> = {};

function format(args: unknown[]): string {
  return args
    .map((a) => {
      if (a instanceof Error) return `${a.name}: ${a.message}`;
      if (typeof a === 'object') {
        try {
          return JSON.stringify(a);
        } catch {
          return String(a);
        }
      }
      return String(a);
    })
    .join(' ');
}

const LEVEL_MAP: Record<ConsoleMethod, LogEntry['level']> = {
  log: 'info',
  info: 'info',
  debug: 'debug',
  warn: 'warn',
  error: 'error',
};

/** Patch console.* to also forward to Telescope. Call once at startup. */
export function installConsoleCapture(t: Telescope) {
  (Object.keys(LEVEL_MAP) as ConsoleMethod[]).forEach((m) => {
    if (ORIGINAL[m]) return;
    const orig = console[m].bind(console) as LogFn;
    ORIGINAL[m] = orig;
    (console[m] as LogFn) = (...args: unknown[]) => {
      orig(...args);
      if (t.isEnabled()) {
        try {
          t.recordLog({ level: LEVEL_MAP[m], message: format(args) });
        } catch {
          // never let logging break the app
        }
      }
    };
  });
}

export function uninstallConsoleCapture() {
  (Object.keys(ORIGINAL) as ConsoleMethod[]).forEach((m) => {
    const orig = ORIGINAL[m];
    if (orig) {
      (console[m] as LogFn) = orig;
      delete ORIGINAL[m];
    }
  });
}
