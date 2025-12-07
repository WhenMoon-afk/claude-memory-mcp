/**
 * Driver Factory - Selects database driver based on environment configuration
 *
 * Supports pluggable database drivers through the DbDriver interface.
 * Selection is controlled by MEMORY_DB_DRIVER environment variable.
 */

import type { DbDriver } from './db-driver.js';
import { createBetterSqlite3Driver } from './better-sqlite3-driver.js';
import { createSqlJsDriver } from './sqljs-driver.js';
import type Database from 'better-sqlite3';

/**
 * Supported database driver types
 */
export type DriverType = 'better-sqlite3' | 'sqljs';

/**
 * Driver configuration options
 */
export interface DriverConfig {
  /**
   * Database file path (for file-based drivers like better-sqlite3)
   */
  path: string;

  /**
   * Driver-specific options (e.g., better-sqlite3 Database.Options)
   */
  options?: Database.Options;
}

/**
 * Create database driver based on type
 *
 * @param type - Driver type ('better-sqlite3' or 'sqljs')
 * @param config - Driver configuration
 * @returns DbDriver instance
 * @throws Error if driver type is unsupported or driver initialization fails
 */
export function createDriver(type: DriverType, config: DriverConfig): DbDriver {
  switch (type) {
    case 'better-sqlite3':
      return createBetterSqlite3Driver(config.path, config.options);

    case 'sqljs':
      // SqlJsDriver is a stub - throws informative error
      return createSqlJsDriver();

    default:
      throw new Error(
        `Unsupported driver type: ${type}\n` +
          'Supported drivers: better-sqlite3, sqljs\n' +
          'Set MEMORY_DB_DRIVER environment variable to select driver.'
      );
  }
}

/**
 * Get driver type from environment variable
 *
 * @returns Driver type from MEMORY_DB_DRIVER env var, defaults to 'better-sqlite3'
 */
export function getDriverTypeFromEnv(): DriverType {
  const envDriver = process.env['MEMORY_DB_DRIVER'];

  if (!envDriver) {
    return 'better-sqlite3'; // Default
  }

  const normalized = envDriver.toLowerCase().trim();

  if (normalized === 'better-sqlite3' || normalized === 'sqljs') {
    return normalized as DriverType;
  }

  console.error(
    `[WARN] Unknown MEMORY_DB_DRIVER value: "${envDriver}". ` +
      'Using default: better-sqlite3. ' +
      'Valid options: better-sqlite3, sqljs'
  );

  return 'better-sqlite3';
}

/**
 * Create database driver from environment configuration
 *
 * Convenience function that reads MEMORY_DB_DRIVER from environment
 * and creates the appropriate driver instance.
 *
 * @param config - Driver configuration
 * @returns DbDriver instance
 */
export function createDriverFromEnv(config: DriverConfig): DbDriver {
  const driverType = getDriverTypeFromEnv();

  console.error(`[INFO] Using database driver: ${driverType}`);

  return createDriver(driverType, config);
}
