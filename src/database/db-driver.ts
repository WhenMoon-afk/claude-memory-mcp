/**
 * Database driver interface - Abstraction layer for SQLite operations
 *
 * This interface decouples the application from better-sqlite3's concrete types,
 * allowing for alternative implementations (e.g., libsql, better-sqlite3-multiple-ciphers)
 * without changing business logic.
 */

/**
 * Result returned by .run() operations (INSERT/UPDATE/DELETE)
 */
export interface RunResult {
  /**
   * Number of rows affected by the operation
   */
  changes: number;
}

/**
 * Prepared statement interface - mirrors better-sqlite3's Statement API
 */
export interface PreparedStatement<T = unknown> {
  /**
   * Execute statement and return run result
   */
  run(...params: unknown[]): RunResult;

  /**
   * Execute statement and return single row (or undefined if no match)
   */
  get(...params: unknown[]): T | undefined;

  /**
   * Execute statement and return all matching rows
   */
  all(...params: unknown[]): T[];

  /**
   * Return a statement that extracts only the first column of each row
   * Used for COUNT queries and scalar selects
   */
  pluck(): PreparedStatement<T>;
}

/**
 * Main database driver interface
 */
export interface DbDriver {
  /**
   * Prepare a SQL statement for execution
   *
   * @param sql SQL statement with ? placeholders
   * @returns Prepared statement object
   */
  prepare<T = unknown>(sql: string): PreparedStatement<T>;

  /**
   * Execute multi-statement SQL (no parameter binding)
   * Used for schema creation, migrations, and DDL operations
   *
   * @param sql Multi-statement SQL string
   */
  exec(sql: string): void;

  /**
   * Set a SQLite PRAGMA
   *
   * @param pragma PRAGMA statement (e.g., "journal_mode = WAL")
   * @returns Pragma value if query pragma, undefined if setting pragma
   */
  pragma(pragma: string): unknown;

  /**
   * Create a transaction function wrapper
   *
   * @param fn Function to execute in transaction
   * @returns Callable transaction function
   */
  transaction<T>(fn: () => T): () => T;

  /**
   * Close the database connection
   */
  close(): void;
}
