# claude-token-tracker

Per-component token usage tracking for Claude Code ecosystems.

Track how many tokens each part of your Claude Code setup consumes — across repos, autonomous agents, interactive sessions, and subagents.

## Why this tool?

Claude Code stores per-turn token counts in session transcript files, but there's no built-in way to see usage broken down by project or component. Existing tools like [ccusage](https://github.com/ryoppippi/ccusage) provide session/daily reports but lack component-level attribution, subagent tracking, and hook-based real-time capture.

**claude-token-tracker** fills this gap:

- **Component-level attribution** — Map sessions to named components via configurable patterns. Answer "how much does my autonomous agent cost vs interactive work?"
- **Subagent breakdown** — Parse nested subagent transcripts with per-agent type and description
- **Hook-based capture** — Stop hook records usage as sessions end, not just retroactive analysis
- **Ecosystem-aware** — Designed for multi-agent setups with automated runners
- **Data portability** — JSONL storage, JSON/CSV export

## Install

```bash
npm install -g claude-token-tracker
```

Or run directly:
```bash
npx claude-token-tracker backfill
npx claude-token-tracker report
```

## Quick Start

### 1. Backfill existing sessions

Parse all your existing Claude Code transcripts:

```bash
claude-token-tracker backfill --verbose
```

### 2. View usage report

```bash
claude-token-tracker report
```

Output:
```
Component               Sessions     Turns       Input      Output     Cache-W         Total
--------------------------------------------------------------------------------------------
interactive                   66     11779      231.4K        2.4M       91.9M         94.5M
backend                      794     19425      404.5K        2.9M       49.0M         52.3M
webapp                        31      1437       71.3K      280.8K        3.7M          4.1M
--------------------------------------------------------------------------------------------
Total                        891     32641      707.3K        5.5M      144.6M        150.9M
```

### 3. Set up real-time tracking (optional)

Add a Stop hook to your Claude Code settings (`~/.claude/settings.json`):

```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node /path/to/claude-token-tracker/dist/hook.js",
            "timeout": 10000
          }
        ]
      }
    ]
  }
}
```

Now every session is automatically recorded when it ends.

## Configuration

Create `~/.claude-token-tracker/config.json` to map CWD paths to component names:

```json
{
  "components": {
    "myBot": {
      "patterns": ["**/my-discord-bot"],
      "description": "Discord bot"
    },
    "webApp": {
      "patterns": ["/home/user/repos/webapp"],
      "description": "Main web application"
    },
    "interactive": {
      "patterns": ["/home/user"],
      "description": "Interactive sessions"
    }
  },
  "defaultComponent": "other"
}
```

**Pattern matching (in priority order):**
1. Exact path match
2. Glob suffix: `**/name` matches any path containing `/name` as a segment
3. Prefix match: longest matching prefix wins (so `/home/user/repos/foo` beats `/home/user`)
4. Auto-detect: if a component name matches the CWD's last path segment
5. Falls back to `defaultComponent`

## CLI Commands

### `backfill`

Parse all existing Claude Code transcripts into the usage log.

```bash
claude-token-tracker backfill [--since <date>] [--project <name>] [--verbose]
```

- Idempotent — skips sessions already in the log
- `--since 2026-03-01` — only process sessions after this date
- `--project myProject` — only process one project

### `report`

Show usage breakdown.

```bash
claude-token-tracker report [--by component|day|session|model] [--since <date>] [--until <date>] [--component <name>] [--subagents]
```

- `--by day` — daily breakdown
- `--by model` — see Opus vs Haiku vs Sonnet usage
- `--subagents` — show subagent type breakdown
- `--component myBot` — filter to one component

### `export`

Export data as JSON or CSV.

```bash
claude-token-tracker export [--format json|csv] [--output file.csv] [--since <date>] [--component <name>]
```

### `record`

Record a single session (used by the Stop hook). Can also be called manually:

```bash
claude-token-tracker record --transcript-path ~/.claude/projects/-my-project/session-id.jsonl
```

### `config`

View or edit configuration.

```bash
claude-token-tracker config show
claude-token-tracker config set "/path/to/repo" myComponent
claude-token-tracker config paths
```

## Data Storage

- Usage log: `~/.claude-token-tracker/usage.jsonl`
- Config: `~/.claude-token-tracker/config.json`
- Override with `CLAUDE_TRACKER_DATA_DIR` env var

Each line in `usage.jsonl` is a JSON object with:
- `sessionId`, `component`, `cwd`, `repo`, `gitBranch`
- `startedAt`, `endedAt`, `durationMinutes`
- `inputTokens`, `outputTokens`, `cacheCreationTokens`, `cacheReadTokens`, `totalTokens`
- `model`, `claudeCodeVersion`, `turnCount`
- `subagents[]` — array with per-subagent token breakdown

**Note:** `totalTokens` = input + output + cacheCreation. Cache reads are tracked separately because they're free and don't count toward rate limits.

## How it works

Claude Code stores session transcripts as JSONL files in `~/.claude/projects/`. Each assistant turn includes a `usage` object with token counts. This tool:

1. Scans transcript files and sums token usage per session
2. Discovers subagent transcripts in `<session-id>/subagents/` directories
3. Maps the session's working directory to a named component via your config
4. Appends a summary record to the usage log
5. Provides reporting and export on the aggregated data

## License

MIT
