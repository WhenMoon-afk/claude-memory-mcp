# MCP protocol

The local stdio server exposes exactly three evidence tools by default:

- `mooncite_recall`
- `mooncite_inspect`
- `mooncite_status`


## Normal flow

1. Call `mooncite_recall` without a scope and use a distinctive lexical query.
2. Read `outcome`, `conclusive`, `meaning`, `warnings`, and `next`.
3. Call `mooncite_inspect` on the best candidate's exact locator.
4. Call `mooncite_status` only when recall reports a coverage or freshness problem.

## `mooncite_recall`

| Field | Required | Accepted value |
| --- | --- | --- |
| `query` | Yes | Lexical query |
| `limit` | No | 1 to 20 |
| `project` | No | Exact value copied from a candidate |
| `session_id` | No | Exact source-qualified value copied from a candidate |
| `after`, `before` | No | Inclusive ISO 8601 event time with explicit UTC offset |
| `role` | No | `user`, `assistant`, `system`, `developer`, `tool`, `toolResult`, `summary`, or `unknown` |
| `source_origin` | No | `pi`, `omp`, `claude-code`, `codex`, or `chatgpt` |
| `order` | No | `relevance`, `newest`, or `oldest`. Default is `relevance` |
| `debug_timing` | No | `true` to return server-side timing and a short-lived workflow ID |

A source-qualified session ID has the form `<origin>:<64-hex-source-root-digest>:<source-session-id>`. Mooncite accepts a bare session ID only when it is unique. Malformed, ambiguous, or deauthorized scopes return `invalid_scope`. Time bounds exclude untimestamped evidence.

| Outcome | Meaning |
| --- | --- |
| `matches` | Strong lexical result |
| `weak_leads` | Possible result that needs refinement or inspection |
| `no_match` | Absence result only when `conclusive` is `true` |
| `inconclusive` | Freshness or coverage prevents an absence claim |
| `invalid_scope` | Retry with no scope or an exact copied scope |
| `unavailable` | No usable generation could be searched |

Candidates include exact project and session identities. They include `evidence_id`, `evidence_uri`, a bounded excerpt, and match reasons. For long records, the excerpt starts near the exact query or the longest matched term instead of returning the record prefix; `omittedBytes` counts text omitted before and after that window. Candidates also show matched and missing terms, duplicate spans, and suppressed recursive output.

`full_verified` means the projection came from a full source read or a transactional mutable-source replacement. `append_trusted` means Mooncite admitted coherent Pi same-inode growth, or OMP same-inode growth after physically verifying the last indexed evidence record, without rereading the indexed prefix.

Results larger than 8 KiB keep a useful slice inline and may link a `mooncite-result://artifact/<uuid>` resource. The complete result may remain in that server process for up to ten minutes. The server keeps at most 12 large-result artifacts and evicts the oldest when full. Pi receives the complete result inline because its native extension cannot read MCP resources.

## `mooncite_inspect`

| Field | Required | Accepted value |
| --- | --- | --- |
| `evidence_id` | Yes | Either rendered `mooncite:` or `mooncite://` locator |
| `window` | No | 0 to 10 |
| `debug_timing` | No | `true` to report inspection timing |
| `workflow_id` | No | Nonexpired ID from a debug-timed recall |

Inspection resolves a locator only in the active generation. It rereads bounded physical source bytes. It then checks record and entry identity. Its outcome is `verified`, `stale`, `missing`, `excluded`, `corrupt`, or `unavailable`.

Only `verified` returns a window checked against the current source. It proves byte and identity provenance, not truth or current authority. A nonverified result may include indexed `target` text, but that text has not passed the current-source check.

## `mooncite_status`

No input. Status returns `ready`, `degraded`, or `unavailable`. It also reports freshness, search usability, coverage, counts, state size, client registrations, and errors grouped by safe source origin and failure reason. Status returns no transcript text, internal exception text, or full physical source path.

| Reason | Meaning | Group origin |
| --- | --- | --- |
| `source_configuration_failure` | Source configuration became unavailable or invalid during refresh. | `unknown` |
| `source_root_unavailable` | An authorized root that backed indexed state is missing or fails the directory and symlink safety checks. | Configured source origin |
| `source_discovery_failure` | Mooncite cannot enumerate a directory inside an otherwise valid root. | Configured source origin |
| `source_limit_exceeded` | Discovery exceeds the supported depth, entry count, file count, or admitted source-byte limit. | Configured source origin |
| `source_metadata_failure` | A discovered path fails the immediate containment, regular-file, or safe-size metadata check. | Configured source origin |
| `source_changed_during_refresh` | An indexed Pi source no longer qualifies as same-file monotonic growth. | Configured source origin |
| `source_read_or_parse_failure` | Mooncite cannot safely capture or parse a source, or cannot attribute an internal refresh failure more narrowly. | Configured source origin when attributable, otherwise `unknown` |

`source_metadata_failure` is an internal race-safety fallback. Discovery only reaches it when a path changes between enumeration and metadata capture. Ordinary missing roots use `source_root_unavailable`. Unreadable directories use `source_discovery_failure`.

`unknown/source_read_or_parse_failure` is the conservative internal fallback for an unattributable refresh failure. It also replaces persisted diagnostic groups when their validated totals do not match the persisted aggregate counters. Neither fallback returns the internal error or source value.

`count` is the number of grouped failures. `fatalCount` is the subset that prevented source admission or refresh. Repeated status calls recompute transient failures and reuse persisted per-source parse counts, so counts do not accumulate. After reopen, Mooncite reloads the last-good generation and rediscovers any continuing transient failure.

A degraded index may remain searchable, but its empty recall results are inconclusive. A source-limit group means rebuilding alone will repeat the refusal until the authorized source set or supported limit changes.

