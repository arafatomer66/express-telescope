import { Telescope } from '../telescope';

interface PrismaQueryEvent {
  query: string;
  params: string;
  duration: number;
  target?: string;
  timestamp?: Date;
}

interface PrismaClientLike {
  $on: (event: 'query', cb: (e: PrismaQueryEvent) => void) => void;
}

/**
 * Forward Prisma query events to Telescope.
 *
 * Prisma must be constructed with query event logging:
 *
 *   const prisma = new PrismaClient({
 *     log: [{ emit: 'event', level: 'query' }],
 *   });
 *   installPrismaWatcher(t, prisma);
 */
export function installPrismaWatcher(
  t: Telescope,
  prisma: PrismaClientLike,
  connection = 'prisma'
): void {
  prisma.$on('query', (e) => {
    if (!t.isEnabled()) return;
    let bindings: unknown[] | undefined;
    try {
      const parsed = JSON.parse(e.params);
      if (Array.isArray(parsed)) bindings = parsed;
    } catch {
      // params not JSON — keep undefined
    }
    t.recordQuery({
      connection,
      sql: e.query,
      bindings,
      duration: e.duration,
    });
  });
}

interface TypeOrmConnectionLike {
  driver?: { logQuery?: unknown };
  options?: { logger?: unknown };
}

/**
 * Drop-in TypeORM logger that forwards queries to Telescope.
 *
 *   import { DataSource } from 'typeorm';
 *   const ds = new DataSource({ ..., logger: new TelescopeTypeOrmLogger(t) });
 */
export class TelescopeTypeOrmLogger {
  constructor(private t: Telescope, private connection = 'typeorm') {}
  logQuery(query: string, parameters?: unknown[]) {
    if (!this.t.isEnabled()) return;
    this.t.recordQuery({
      connection: this.connection,
      sql: query,
      bindings: parameters,
      duration: 0, // TypeORM logger doesn't pass duration here
    });
  }
  logQueryError(error: string | Error, query: string, parameters?: unknown[]) {
    this.logQuery(query, parameters);
    const msg = error instanceof Error ? error.message : error;
    this.t.recordException({
      class: 'TypeORMQueryError',
      message: msg,
      trace: [],
      context: { query, parameters },
    });
  }
  logQuerySlow() {}
  logSchemaBuild() {}
  logMigration() {}
  log() {}
}

/* Mark imports satisfied even if unused — keeps tree-shaking honest */
export type { TypeOrmConnectionLike };
