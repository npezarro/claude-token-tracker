# claude-token-tracker

Per-component token usage tracking for Claude Code ecosystems. Parses session transcripts, maps sessions to components (repos/tasks), calculates API-equivalent costs, and reports usage.

## Architecture

- **CLI:** `src/cli.ts` → `dist/cli.js` (bin: `claude-token-tracker`)
- **Hook:** `src/hook.ts` — Claude Code stop hook, reads JSON from stdin, parses transcript, records usage (<15s timeout)
- **Parser:** `src/parser/transcript.ts` — reads `.jsonl` transcript files, extracts token counts, model, session metadata
- **Storage:** `src/storage/usage-log.ts` — JSONL append-only log at `~/.claude-token-tracker/usage.jsonl`
- **Config:** `src/config/config.ts` — JSON config at `~/.claude-token-tracker/config.json`, maps repos to components
- **Pricing:** `src/pricing.ts` — API-equivalent rates per model (input/output/cache read/write)

## CLI Commands

| Command | Description |
|---------|-------------|
| `record` | Parse a transcript and record token usage |
| `backfill` | Re-parse historical transcripts (--since flag) |
| `report` | Usage report grouped by component/day/session/model |
| `export` | Export data as JSON or CSV |
| `config show/set/paths` | View or modify component mappings |
| `discord-report` | Generate and post usage summary to Discord webhook |
| `publish-logs` | Publish usage logs to remote storage |

## Testing

```bash
npm test          # vitest run (239 tests, 15 files)
npm run lint      # eslint
npm run build     # tsc
```

## Key Design Decisions

- JSONL storage (no database) — simple, append-only, greppable
- Component mapping via config (repo path → component name)
- API-equivalent pricing (not actual billing) — shows what usage would cost at API rates
- Stop hook must complete in <15s (Claude Code constraint)
- Subagent detection: `src/parser/subagent.ts` — identifies spawned agent sessions
