# Security and data handling

Mooncite authorizes only regular `.jsonl` files below the configured Pi sessions root. Directory and file symbolic links are excluded. Index and inspect reads verify file identity and coherent byte ranges; inspect rechecks source record digests before returning text.

The index is derived local state with owner-only directory/file modes. Corrupt SQLite state is disposable and rebuilt from source. Refresh keeps a last-good generation rather than publishing incomplete replacement state.

Recall excerpts and inspect windows are deliberately bounded. Control characters are rejected in rendered identifiers and query inputs. Status contains counts and safe source labels, not transcript text or full physical source paths.

Installation and deletion are conservative: Mooncite refuses unrecognized install roots, conflicting client registrations, symbolic-link state paths, and unknown purge entries. Disable and uninstall preserve both Pi sessions and the evidence index; purge is separate and confirmed.

When a client calls Mooncite, returned text enters that client's model context. Review the model provider's privacy policy. Mooncite itself uses no network transport for history and performs no telemetry or upload.
