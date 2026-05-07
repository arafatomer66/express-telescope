export type EntryType =
  | 'request'
  | 'exception'
  | 'query'
  | 'log'
  | 'cache'
  | 'mail'
  | 'job';

export interface Entry<T = unknown> {
  id: string;
  batchId: string | null;
  type: EntryType;
  familyHash: string | null;
  shouldDisplayOnIndex: boolean;
  content: T;
  tags: string[];
  createdAt: number;
}

export interface RequestEntry {
  method: string;
  uri: string;
  controllerAction?: string | null;
  status: number;
  duration: number;
  ip?: string;
  memory?: number;
  payload?: Record<string, unknown>;
  headers?: Record<string, string | string[] | undefined>;
  response?: unknown;
  responseHeaders?: Record<string, string | string[] | undefined>;
  hostname?: string;
  userAgent?: string;
}

export interface ExceptionEntry {
  class: string;
  message: string;
  file?: string;
  line?: number;
  trace: string[];
  context?: Record<string, unknown>;
}

export interface QueryEntry {
  connection: string;
  sql: string;
  bindings?: unknown[];
  duration: number;
  slow?: boolean;
}

export interface LogEntry {
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  context?: Record<string, unknown>;
}

export interface CacheEntry {
  type: 'hit' | 'miss' | 'set' | 'forget';
  key: string;
  value?: unknown;
  expiration?: number;
}

export interface MailEntry {
  from: string;
  to: string[];
  subject: string;
  body?: string;
  cc?: string[];
  bcc?: string[];
}

export interface JobEntry {
  name: string;
  queue?: string;
  status: 'pending' | 'processed' | 'failed';
  duration?: number;
  data?: unknown;
  error?: string;
}

export interface ListQuery {
  type?: EntryType;
  tag?: string;
  batchId?: string;
  familyHash?: string;
  before?: string;
  limit?: number;
}

export interface TelescopeOptions {
  enabled?: boolean;
  storagePath?: string;
  path?: string;
  maxEntries?: number;
  recordRequestBody?: boolean;
  recordResponseBody?: boolean;
  ignoreRoutes?: (RegExp | string)[];
  slowQueryThreshold?: number;
  authorize?: (req: import('express').Request) => boolean;
}
