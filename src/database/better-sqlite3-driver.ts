/**
 * BetterSqlite3Driver - Adapter for better-sqlite3
 *
 * Wraps better-sqlite3's Database to implement the DbDriver interface.
 * This adapter allows the codebase to depend on the interface rather than
 * the concrete better-sqlite3 types, enabling future database driver swaps.
 */

import Database from 'better-sqlite3';
import type { DbDriver, PreparedStatement, RunResult } from './db-driver.js';

/**
 * Wrapper for better-sqlite3's Statement
 * Implements PreparedStatement interface
 */
class StatementWrapper<T = unknown> implements PreparedStatement<T> {
  constructor(private stmt: Database.Statement) {}

  run(...params: unknown[]): RunResult {
    const result = this.stmt.run(...params);
    return {
      changes: result.changes,
    };
  }

  get(...params: unknown[]): T | undefined {
    return this.stmt.get(...params) as T | undefined;
  }

  all(...params: unknown[]): T[] {
    return this.stmt.all(...params) as T[];
  }

  pluck(): PreparedStatement<T> {
    // better-sqlite3's pluck() returns a modified Statement
    const pluckedStmt = this.stmt.pluck();
    return new StatementWrapper<T>(pluckedStmt);
  }
}

/**
 * Adapter for better-sqlite3 Database
 * Implements DbDriver interface
 */
export class BetterSqlite3Driver implements DbDriver {
  constructor(private db: Database.Database) {}

  prepare<T = unknown>(sql: string): PreparedStatement<T> {
    const stmt = this.db.prepare(sql);
    return new StatementWrapper<T>(stmt);
  }

  exec(sql: string): void {
    this.db.exec(sql);
  }

  pragma(pragma: string): unknown {
    return this.db.pragma(pragma);
  }

  transaction<T>(fn: () => T): () => T {
    return this.db.transaction(fn);
  }

  close(): void {
    this.db.close();
  }

  /**
   * Get the underlying better-sqlite3 Database instance
   * Only exposed for migration purposes - avoid using in business logic
   *
   * @internal
   */
  getUnderlying(): Database.Database {
    return this.db;
  }
}

/**
 * Create a BetterSqlite3Driver from a file path
 *
 * @param path Database file path
 * @param options better-sqlite3 options
 * @returns Driver instance
 */
export function createBetterSqlite3Driver(
  path: string,
  options?: Database.Options
): BetterSqlite3Driver {
  const db = new Database(path, options);
  return new BetterSqlite3Driver(db);
}
