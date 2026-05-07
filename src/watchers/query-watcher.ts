import { Telescope } from '../telescope';

/**
 * Wrap a function so that its DB query is recorded to Telescope.
 *
 * Use this from your data-access layer:
 *   const rows = await trackQuery(t, 'main', sql, params, () => db.all(sql, params));
 */
export async function trackQuery<T>(
  t: Telescope,
  connection: string,
  sql: string,
  bindings: unknown[] | undefined,
  exec: () => Promise<T> | T
): Promise<T> {
  if (!t.isEnabled()) return exec();
  const start = process.hrtime.bigint();
  try {
    return await exec();
  } finally {
    const duration = Number(process.hrtime.bigint() - start) / 1e6;
    t.recordQuery({
      connection,
      sql,
      bindings,
      duration: Math.round(duration * 100) / 100,
    });
  }
}

/**
 * Patch a better-sqlite3 Database instance so prepare/exec calls are tracked.
 * Returns an unpatch function.
 */
export function patchBetterSqlite(t: Telescope, db: BetterSqliteLike, connection = 'sqlite') {
  const origPrepare = db.prepare.bind(db);
  const origExec = db.exec.bind(db);

  db.prepare = (sql: string) => {
    const stmt = origPrepare(sql);
    return wrapStmt(t, connection, sql, stmt);
  };
  db.exec = (sql: string) => {
    const start = process.hrtime.bigint();
    try {
      return origExec(sql);
    } finally {
      const duration = Number(process.hrtime.bigint() - start) / 1e6;
      t.recordQuery({ connection, sql, duration: Math.round(duration * 100) / 100 });
    }
  };

  return () => {
    db.prepare = origPrepare;
    db.exec = origExec;
  };
}

function wrapStmt(t: Telescope, connection: string, sql: string, stmt: BetterSqliteStmt) {
  const wrap = <K extends 'run' | 'get' | 'all'>(fn: K) => {
    const orig = stmt[fn].bind(stmt) as (...a: unknown[]) => unknown;
    (stmt[fn] as unknown) = (...args: unknown[]) => {
      const start = process.hrtime.bigint();
      try {
        return orig(...args);
      } finally {
        const duration = Number(process.hrtime.bigint() - start) / 1e6;
        t.recordQuery({
          connection,
          sql,
          bindings: args,
          duration: Math.round(duration * 100) / 100,
        });
      }
    };
  };
  wrap('run');
  wrap('get');
  wrap('all');
  return stmt;
}

interface BetterSqliteStmt {
  run: (...a: unknown[]) => unknown;
  get: (...a: unknown[]) => unknown;
  all: (...a: unknown[]) => unknown;
}
interface BetterSqliteLike {
  prepare: (sql: string) => BetterSqliteStmt;
  exec: (sql: string) => unknown;
}
