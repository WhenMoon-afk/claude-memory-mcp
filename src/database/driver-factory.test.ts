/**
 * Tests for driver factory and DbDriver interface
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createDriver,
  getDriverTypeFromEnv,
  createDriverFromEnv,
  type DriverType,
} from './driver-factory.js';
import type { DbDriver } from './db-driver.js';

describe('Driver Factory', () => {
  // Store original env
  const originalEnv = process.env['MEMORY_DB_DRIVER'];

  afterEach(() => {
    // Restore original env
    if (originalEnv !== undefined) {
      process.env['MEMORY_DB_DRIVER'] = originalEnv;
    } else {
      delete process.env['MEMORY_DB_DRIVER'];
    }
  });

  describe('getDriverTypeFromEnv', () => {
    it('should return better-sqlite3 as default when env var is not set', () => {
      delete process.env['MEMORY_DB_DRIVER'];
      expect(getDriverTypeFromEnv()).toBe('better-sqlite3');
    });

    it('should return better-sqlite3 when env var is set to better-sqlite3', () => {
      process.env['MEMORY_DB_DRIVER'] = 'better-sqlite3';
      expect(getDriverTypeFromEnv()).toBe('better-sqlite3');
    });

    it('should return sqljs when env var is set to sqljs', () => {
      process.env['MEMORY_DB_DRIVER'] = 'sqljs';
      expect(getDriverTypeFromEnv()).toBe('sqljs');
    });

    it('should normalize case-insensitive values', () => {
      process.env['MEMORY_DB_DRIVER'] = 'BETTER-SQLITE3';
      expect(getDriverTypeFromEnv()).toBe('better-sqlite3');

      process.env['MEMORY_DB_DRIVER'] = 'SqlJs';
      expect(getDriverTypeFromEnv()).toBe('sqljs');
    });

    it('should trim whitespace', () => {
      process.env['MEMORY_DB_DRIVER'] = '  better-sqlite3  ';
      expect(getDriverTypeFromEnv()).toBe('better-sqlite3');
    });

    it('should default to better-sqlite3 for unknown values', () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      process.env['MEMORY_DB_DRIVER'] = 'unknown-driver';
      expect(getDriverTypeFromEnv()).toBe('better-sqlite3');
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Unknown MEMORY_DB_DRIVER value')
      );

      consoleErrorSpy.mockRestore();
    });
  });

  describe('createDriver', () => {
    it('should create BetterSqlite3Driver for better-sqlite3 type', () => {
      const driver = createDriver('better-sqlite3', {
        path: ':memory:',
      });

      expect(driver).toBeDefined();
      expect(typeof driver.prepare).toBe('function');
      expect(typeof driver.exec).toBe('function');
      expect(typeof driver.pragma).toBe('function');
      expect(typeof driver.transaction).toBe('function');
      expect(typeof driver.close).toBe('function');

      // Clean up
      driver.close();
    });

    it('should throw for sqljs type (not implemented)', () => {
      expect(() =>
        createDriver('sqljs', {
          path: ':memory:',
        })
      ).toThrow('createSqlJsDriver() not implemented');
    });

    it('should throw for unsupported driver type', () => {
      expect(() =>
        createDriver('invalid' as DriverType, {
          path: ':memory:',
        })
      ).toThrow('Unsupported driver type');
    });
  });

  describe('createDriverFromEnv', () => {
    it('should create driver based on env var', () => {
      process.env['MEMORY_DB_DRIVER'] = 'better-sqlite3';

      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const driver = createDriverFromEnv({
        path: ':memory:',
      });

      expect(driver).toBeDefined();
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '[INFO] Using database driver: better-sqlite3'
      );

      driver.close();
      consoleErrorSpy.mockRestore();
    });
  });

  describe('DbDriver Interface Contract', () => {
    let driver: DbDriver;

    beforeEach(() => {
      driver = createDriver('better-sqlite3', {
        path: ':memory:',
      });
    });

    afterEach(() => {
      driver.close();
    });

    it('should support prepare() returning PreparedStatement', () => {
      const stmt = driver.prepare('SELECT 1 as value');
      expect(stmt).toBeDefined();
      expect(typeof stmt.run).toBe('function');
      expect(typeof stmt.get).toBe('function');
      expect(typeof stmt.all).toBe('function');
      expect(typeof stmt.pluck).toBe('function');
    });

    it('should support exec() for multi-statement SQL', () => {
      expect(() => {
        driver.exec('CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT)');
      }).not.toThrow();
    });

    it('should support pragma()', () => {
      const result = driver.pragma('journal_mode = WAL');
      // pragma() can return different formats depending on SQLite mode
      // In-memory databases may return [{ journal_mode: 'memory' }]
      // File-based databases return 'wal' string
      expect(result).toBeDefined();
    });

    it('should support transaction()', () => {
      driver.exec('CREATE TABLE test (id INTEGER PRIMARY KEY, value INTEGER)');

      const insertTransaction = driver.transaction(() => {
        driver.prepare('INSERT INTO test (id, value) VALUES (?, ?)').run(1, 100);
        driver.prepare('INSERT INTO test (id, value) VALUES (?, ?)').run(2, 200);
      });

      // Execute transaction
      insertTransaction();

      // Verify data
      const result = driver.prepare<{ value: number }>('SELECT value FROM test WHERE id = 1').get();
      expect(result?.value).toBe(100);
    });

    it('should support PreparedStatement.run() returning RunResult', () => {
      driver.exec('CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT)');
      const stmt = driver.prepare('INSERT INTO test (id, name) VALUES (?, ?)');
      const result = stmt.run(1, 'test');

      expect(result).toHaveProperty('changes');
      expect(result.changes).toBe(1);
    });

    it('should support PreparedStatement.get() returning single row or undefined', () => {
      driver.exec('CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT)');
      driver.prepare('INSERT INTO test (id, name) VALUES (?, ?)').run(1, 'Alice');

      const stmt = driver.prepare<{ id: number; name: string }>('SELECT * FROM test WHERE id = ?');

      const found = stmt.get(1);
      expect(found).toEqual({ id: 1, name: 'Alice' });

      const notFound = stmt.get(999);
      expect(notFound).toBeUndefined();
    });

    it('should support PreparedStatement.all() returning array', () => {
      driver.exec('CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT)');
      driver.prepare('INSERT INTO test (id, name) VALUES (?, ?)').run(1, 'Alice');
      driver.prepare('INSERT INTO test (id, name) VALUES (?, ?)').run(2, 'Bob');

      const stmt = driver.prepare<{ id: number; name: string }>('SELECT * FROM test ORDER BY id');
      const results = stmt.all();

      expect(results).toHaveLength(2);
      expect(results[0]).toEqual({ id: 1, name: 'Alice' });
      expect(results[1]).toEqual({ id: 2, name: 'Bob' });
    });

    it('should support PreparedStatement.pluck() for scalar values', () => {
      driver.exec('CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT)');
      driver.prepare('INSERT INTO test (id, name) VALUES (?, ?)').run(1, 'Alice');
      driver.prepare('INSERT INTO test (id, name) VALUES (?, ?)').run(2, 'Bob');

      const stmt = driver.prepare<number>('SELECT id FROM test ORDER BY id').pluck();
      const ids = stmt.all();

      expect(ids).toEqual([1, 2]);
    });
  });
});
