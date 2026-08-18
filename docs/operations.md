# Operations

## Install
Mooncite 4.0.0 is distributed from GitHub rather than the npm registry:

```bash
npx --yes github:WhenMoon-afk/claude-memory-mcp#v4.0.0 install
```


`mooncite install` is fresh-install only. It stages the current package, verifies exact name/version/layout, atomically places it under `$XDG_DATA_HOME/mooncite`, refreshes the index, and adds missing registrations for supported clients that are available. A conflicting registration or different package at the owned path is refused. Repeating 4.0.0 is idempotent.

## Status and rebuild

`mooncite status` incrementally refreshes derived state and reports health. `mooncite rebuild` performs a complete verified read. Neither command changes source history or registrations.

## Disable, uninstall, purge

`mooncite disable` removes only exact Mooncite client registrations. `mooncite uninstall` also verifies and deletes the stable package. Both retain `$XDG_STATE_HOME/mooncite` and all Pi sessions.

`mooncite purge` lists recognized derived files and requires `--yes`. Purge accepts only the SQLite database and its SQLite sidecars; unknown files, directories, or symbolic links cause refusal. Source history lives outside the state root and is never a purge target.

Mooncite has no updater, migration, or cross-version recovery process. Use the executable matching an installed version to uninstall it, then install 4.0.0 fresh.
