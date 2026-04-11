# Pull Request

## Summary

This template is for a narrow maintenance change: security, install/runtime compatibility, packaging, documentation correctness, or regressions in the published MCP/CLI contract.

<!-- What changed, and why? Keep this focused on the user-facing outcome. -->

## Release Safety

- [ ] I ran `npm run release:check`, or I explained below why a narrower check is appropriate.
- [ ] I updated public docs when behavior, commands, schema, or release workflow changed.
- [ ] I considered whether this changes the MCP action schema, continuity contract, database schema, import/export format, or package metadata.
- [ ] I did not include private local memory data, secrets, transcripts, or local-only planning notes.

## Compatibility Notes

<!-- Note any migration, schema, CLI, MCP, or package manager impact. Write "None" if not applicable. -->

## Verification

<!-- Paste the commands you ran and summarize the relevant result. -->
