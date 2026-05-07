import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { Entry, EntryType, ListQuery } from '../types';

export class SqliteStorage {
  private db: Database.Database;
  private maxEntries: number;

  constructor(storagePath: string, maxEntries = 10_000) {
    const dir = path.dirname(storagePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    this.db = new Database(storagePath);
    this.db.pragma('journal_mode = WAL');
    this.maxEntries = maxEntries;
    this.migrate();
  }

  private migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS entries (
        id TEXT PRIMARY KEY,
        batch_id TEXT,
        type TEXT NOT NULL,
        family_hash TEXT,
        should_display_on_index INTEGER NOT NULL DEFAULT 1,
        content TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_entries_type ON entries(type);
      CREATE INDEX IF NOT EXISTS idx_entries_batch ON entries(batch_id);
      CREATE INDEX IF NOT EXISTS idx_entries_family ON entries(family_hash);
      CREATE INDEX IF NOT EXISTS idx_entries_created ON entries(created_at DESC);

      CREATE TABLE IF NOT EXISTS entry_tags (
        entry_id TEXT NOT NULL,
        tag TEXT NOT NULL,
        PRIMARY KEY (entry_id, tag),
        FOREIGN KEY (entry_id) REFERENCES entries(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_tags_tag ON entry_tags(tag);
    `);
  }

  insert(entry: Entry): void {
    const insertEntry = this.db.prepare(`
      INSERT INTO entries (id, batch_id, type, family_hash, should_display_on_index, content, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const insertTag = this.db.prepare(`
      INSERT OR IGNORE INTO entry_tags (entry_id, tag) VALUES (?, ?)
    `);

    const tx = this.db.transaction(() => {
      insertEntry.run(
        entry.id,
        entry.batchId,
        entry.type,
        entry.familyHash,
        entry.shouldDisplayOnIndex ? 1 : 0,
        JSON.stringify(entry.content),
        entry.createdAt
      );
      for (const tag of entry.tags) insertTag.run(entry.id, tag);
    });
    tx();

    this.maybeTrim();
  }

  private maybeTrim() {
    const { count } = this.db.prepare('SELECT COUNT(*) as count FROM entries').get() as {
      count: number;
    };
    if (count <= this.maxEntries) return;

    const toDelete = count - this.maxEntries;
    this.db
      .prepare(
        `DELETE FROM entries WHERE id IN (
           SELECT id FROM entries ORDER BY created_at ASC LIMIT ?
         )`
      )
      .run(toDelete);
  }

  list(q: ListQuery = {}): Entry[] {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (q.type) {
      conditions.push('e.type = ?');
      params.push(q.type);
    }
    if (q.batchId) {
      conditions.push('e.batch_id = ?');
      params.push(q.batchId);
    }
    if (q.familyHash) {
      conditions.push('e.family_hash = ?');
      params.push(q.familyHash);
    }
    if (q.tag) {
      conditions.push('EXISTS (SELECT 1 FROM entry_tags t WHERE t.entry_id = e.id AND t.tag = ?)');
      params.push(q.tag);
    }
    if (q.before) {
      conditions.push('e.created_at < (SELECT created_at FROM entries WHERE id = ?)');
      params.push(q.before);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = Math.min(q.limit ?? 50, 200);

    const rows = this.db
      .prepare(
        `SELECT e.* FROM entries e
         ${where}
         ORDER BY e.created_at DESC
         LIMIT ?`
      )
      .all(...params, limit) as RawRow[];

    return rows.map((r) => this.hydrate(r));
  }

  get(id: string): Entry | null {
    const row = this.db.prepare('SELECT * FROM entries WHERE id = ?').get(id) as
      | RawRow
      | undefined;
    if (!row) return null;
    return this.hydrate(row);
  }

  getBatch(batchId: string): Entry[] {
    const rows = this.db
      .prepare('SELECT * FROM entries WHERE batch_id = ? ORDER BY created_at ASC')
      .all(batchId) as RawRow[];
    return rows.map((r) => this.hydrate(r));
  }

  stats(): Record<EntryType, number> & { total: number } {
    const rows = this.db.prepare('SELECT type, COUNT(*) as c FROM entries GROUP BY type').all() as {
      type: EntryType;
      c: number;
    }[];
    const out = {
      total: 0,
      request: 0,
      exception: 0,
      query: 0,
      log: 0,
      cache: 0,
      mail: 0,
      job: 0,
    } as Record<EntryType, number> & { total: number };
    for (const r of rows) {
      out[r.type] = r.c;
      out.total += r.c;
    }
    return out;
  }

  clear(type?: EntryType): number {
    const stmt = type
      ? this.db.prepare('DELETE FROM entries WHERE type = ?')
      : this.db.prepare('DELETE FROM entries');
    const info = type ? stmt.run(type) : stmt.run();
    return info.changes;
  }

  private hydrate(row: RawRow): Entry {
    const tags = this.db
      .prepare('SELECT tag FROM entry_tags WHERE entry_id = ?')
      .all(row.id) as { tag: string }[];
    return {
      id: row.id,
      batchId: row.batch_id,
      type: row.type as EntryType,
      familyHash: row.family_hash,
      shouldDisplayOnIndex: !!row.should_display_on_index,
      content: JSON.parse(row.content),
      tags: tags.map((t) => t.tag),
      createdAt: row.created_at,
    };
  }

  close() {
    this.db.close();
  }
}

interface RawRow {
  id: string;
  batch_id: string | null;
  type: string;
  family_hash: string | null;
  should_display_on_index: number;
  content: string;
  created_at: number;
}
