/**
 * Plugin system for extensibility
 */

import type { Plugin, PluginHook, PluginHookType } from '../types/index.js';

/**
 * Plugin manager for registering and executing hooks
 */
export class PluginManager {
  private plugins: Map<string, Plugin>;
  private hooks: Map<PluginHookType, PluginHook[]>;

  constructor() {
    this.plugins = new Map();
    this.hooks = new Map();
  }

  /**
   * Register a plugin
   */
  async registerPlugin(plugin: Plugin): Promise<void> {
    if (this.plugins.has(plugin.name)) {
      throw new Error(`Plugin ${plugin.name} is already registered`);
    }

    // Initialize plugin if it has an initialize method
    if (plugin.initialize) {
      await plugin.initialize();
    }

    // Register plugin hooks
    for (const hook of plugin.hooks) {
      this.registerHook(hook);
    }

    this.plugins.set(plugin.name, plugin);
  }

  /**
   * Unregister a plugin
   */
  async unregisterPlugin(name: string): Promise<void> {
    const plugin = this.plugins.get(name);
    if (!plugin) {
      throw new Error(`Plugin ${name} is not registered`);
    }

    // Remove hooks
    for (const hookType of this.hooks.keys()) {
      const hooks = this.hooks.get(hookType) || [];
      this.hooks.set(
        hookType,
        hooks.filter((h) => !plugin.hooks.includes(h))
      );
    }

    // Cleanup plugin if it has a cleanup method
    if (plugin.cleanup) {
      await plugin.cleanup();
    }

    this.plugins.delete(name);
  }

  /**
   * Register a hook
   */
  private registerHook(hook: PluginHook): void {
    const hooks = this.hooks.get(hook.type) || [];
    hooks.push(hook);

    // Sort by priority (higher = earlier execution)
    hooks.sort((a, b) => b.priority - a.priority);

    this.hooks.set(hook.type, hooks);
  }

  /**
   * Execute hooks for a specific type
   */
  async executeHooks<T>(type: PluginHookType, data: T): Promise<T> {
    const hooks = this.hooks.get(type) || [];

    let result = data;

    for (const hook of hooks) {
      try {
        result = (await hook.handler(result)) as T;
      } catch (error) {
        console.error(`Error executing hook ${type}:`, error);
        // Continue with other hooks even if one fails
      }
    }

    return result;
  }

  /**
   * Check if there are hooks for a type
   */
  hasHooks(type: PluginHookType): boolean {
    const hooks = this.hooks.get(type);
    return hooks !== undefined && hooks.length > 0;
  }

  /**
   * Get all registered plugins
   */
  getPlugins(): Plugin[] {
    return Array.from(this.plugins.values());
  }

  /**
   * Get plugin by name
   */
  getPlugin(name: string): Plugin | undefined {
    return this.plugins.get(name);
  }

  /**
   * Get hooks for a type
   */
  getHooks(type: PluginHookType): PluginHook[] {
    return this.hooks.get(type) || [];
  }

  /**
   * Clear all plugins and hooks
   */
  async clearAll(): Promise<void> {
    for (const plugin of this.plugins.values()) {
      if (plugin.cleanup) {
        await plugin.cleanup();
      }
    }

    this.plugins.clear();
    this.hooks.clear();
  }
}

/**
 * Singleton instance
 */
let globalPluginManager: PluginManager | null = null;

/**
 * Get or create global plugin manager
 */
export function getPluginManager(): PluginManager {
  if (!globalPluginManager) {
    globalPluginManager = new PluginManager();
  }
  return globalPluginManager;
}
