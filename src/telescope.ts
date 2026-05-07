import { nanoid } from 'nanoid';
import path from 'path';
import { SqliteStorage } from './storage/sqlite-storage';
import {
  CacheEntry,
  Entry,
  EntryType,
  ExceptionEntry,
  JobEntry,
  LogEntry,
  MailEntry,
  QueryEntry,
  RequestEntry,
  TelescopeOptions,
} from './types';

const DEFAULTS: Required<Omit<TelescopeOptions, 'authorize' | 'ignoreRoutes'>> & {
  authorize: TelescopeOptions['authorize'];
  ignoreRoutes: NonNullable<TelescopeOptions['ignoreRoutes']>;
} = {
  enabled: true,
  storagePath: path.join(process.cwd(), '.telescope.sqlite'),
  path: '/telescope',
  maxEntries: 10_000,
  recordRequestBody: true,
  recordResponseBody: true,
  ignoreRoutes: [],
  slowQueryThreshold: 100,
  authorize: undefined,
};

export class Telescope {
  readonly storage: SqliteStorage;
  readonly options: typeof DEFAULTS;
  private currentBatchId: string | null = null;

  constructor(opts: TelescopeOptions = {}) {
    this.options = { ...DEFAULTS, ...opts };
    this.storage = new SqliteStorage(this.options.storagePath, this.options.maxEntries);
  }

  isEnabled(): boolean {
    return this.options.enabled;
  }

  startBatch(): string {
    this.currentBatchId = nanoid();
    return this.currentBatchId;
  }

  endBatch(): void {
    this.currentBatchId = null;
  }

  getBatchId(): string | null {
    return this.currentBatchId;
  }

  /** Record a generic entry. Most callers should use the typed helpers below. */
  record<T>(
    type: EntryType,
    content: T,
    opts: {
      tags?: string[];
      familyHash?: string | null;
      batchId?: string | null;
      shouldDisplayOnIndex?: boolean;
    } = {}
  ): Entry<T> {
    if (!this.options.enabled) {
      return {
        id: '',
        batchId: null,
        type,
        familyHash: null,
        shouldDisplayOnIndex: true,
        content,
        tags: [],
        createdAt: Date.now(),
      };
    }

    const entry: Entry<T> = {
      id: nanoid(),
      batchId: opts.batchId ?? this.currentBatchId,
      type,
      familyHash: opts.familyHash ?? null,
      shouldDisplayOnIndex: opts.shouldDisplayOnIndex ?? true,
      content,
      tags: opts.tags ?? [],
      createdAt: Date.now(),
    };
    this.storage.insert(entry);
    return entry;
  }

  recordRequest(content: RequestEntry, tags: string[] = []) {
    const family = `${content.method} ${content.uri}`;
    return this.record('request', content, { tags, familyHash: family });
  }

  recordException(content: ExceptionEntry, tags: string[] = []) {
    return this.record('exception', content, {
      tags,
      familyHash: `${content.class}:${content.message}`,
    });
  }

  recordQuery(content: QueryEntry, tags: string[] = []) {
    const slow = content.duration >= this.options.slowQueryThreshold;
    return this.record(
      'query',
      { ...content, slow },
      { tags: slow ? [...tags, 'slow'] : tags }
    );
  }

  recordLog(content: LogEntry, tags: string[] = []) {
    return this.record('log', content, { tags: [...tags, content.level] });
  }

  recordCache(content: CacheEntry, tags: string[] = []) {
    return this.record('cache', content, { tags: [...tags, content.type] });
  }

  recordMail(content: MailEntry, tags: string[] = []) {
    return this.record('mail', content, { tags });
  }

  recordJob(content: JobEntry, tags: string[] = []) {
    return this.record('job', content, { tags: [...tags, content.status] });
  }

  close() {
    this.storage.close();
  }
}

let singleton: Telescope | null = null;

/** Get the global Telescope instance. Created on first call. */
export function telescope(opts?: TelescopeOptions): Telescope {
  if (!singleton) singleton = new Telescope(opts);
  return singleton;
}

/** Reset the singleton (useful for tests). */
export function resetTelescope() {
  if (singleton) singleton.close();
  singleton = null;
}
