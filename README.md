# @ebragas/linear-cli

CLI tool for AI agents to interact with Linear using per-agent OAuth identity. Each agent authenticates as its own Linear application entity (`actor=app`), making it assignable, mentionable, and independently trackable.

## Quick Start

```bash
# Install globally
npm install -g https://github.com/ebragas/linear-agent-cli/releases/latest/download/ebragas-linear-cli.tgz

# Authenticate an agent (client credentials — recommended)
linear auth setup --client-credentials \
  --agent eve \
  --client-id <your-client-id> \
  --client-secret <your-client-secret>

# Verify authentication
linear auth whoami --agent eve
```

### Prerequisites

1. Register an OAuth application per agent at [linear.app/settings/api/applications/new](https://linear.app/settings/api/applications/new)
2. Note the **Client ID** and **Client Secret**
3. Node.js v22+

## Command Reference

### `auth` — Authentication Management

```bash
linear auth setup --client-credentials --agent <id> --client-id <id> --client-secret <secret>
linear auth setup --oauth --agent <id> --client-id <id> --client-secret <secret> [--port 9876]
linear auth whoami --agent <id>
linear auth refresh --agent <id>
linear auth revoke --agent <id>
```

### `issue` — Issue Management

```bash
linear issue list [--assignee <user>] [--state <state>] [--team <team>] [--label <label>] [--limit <n>]
linear issue get <id>
linear issue create --title <text> --team <team> [--description <text>] [--assignee <user>] [--state <state>] [--label <label>...] [--blocks <id>...] [--blocked-by <id>...]
linear issue update <id> [--title <text>] [--assignee <user>] [--state <state>]
linear issue transition <id> <state>
linear issue search <query> [--team <team>]
linear issue archive <id>
linear issue delete <id>
```

### `comment` — Comments

```bash
linear comment list <issue-id>
linear comment add <issue-id> --body <text> [--reply-to <comment-id>]
linear comment add <issue-id> --body-file <path>
linear comment update <comment-id> --body <text>
```

### `inbox` — Notifications

```bash
linear inbox [--include-archived] [--type <type>] [--category <cat>] [--since <date>]
linear inbox dismiss <id>
linear inbox dismiss-all
```

### `delegate` — Delegation Shortcuts

```bash
linear delegate <issue-id> --to <agent>
linear delegate list
linear delegate remove <issue-id>
```

### `label` — Label Management

```bash
linear label list [--team <team>]
linear label create --name <text> [--color <hex>] [--team <team>]
```

### `user` — User Discovery

```bash
linear user list [--type <user|app|bot>] [--team <team>]
linear user search <query>
linear user me
```

### `team` / `project` / `state` — Workspace Discovery

```bash
linear team list
linear team members <team>
linear project create --name <text> --team <team> [--description <text>] [--content <text>] [--start-date <date>] [--target-date <date>] [--lead <user>] [--priority <n>]
linear project list [--team <team>]
linear project get <id>
linear state list [--team <team>]
```

### `attachment` — URL + Local File Attachments

```bash
linear attachment add <issue-id> --url <url> [--title <text>]
linear attachment list <issue-id>
linear attachment upload <file-path> (--issue <id> | --project <id>) [--title <text>]
linear attachment remove <attachment-id>
```

## Global Options

| Flag | Env Var | Description |
|------|---------|-------------|
| `--agent <id>` | `LINEAR_AGENT_ID` | Agent identifier (required) |
| `--credentials-dir <path>` | `LINEAR_AGENT_CREDENTIALS_DIR` | Credentials directory (default: `~/.linear/credentials/`) |
| `--format <json\|text>` | — | Output format (default: auto-detect TTY) |

## Configuration

### Credentials

Stored at `<credentials-dir>/<agent-id>.json` with `600` permissions:

```json
{
  "authMethod": "client_credentials",
  "clientId": "...",
  "clientSecret": "...",
  "accessToken": "...",
  "refreshToken": null,
  "tokenExpiresAt": "2026-03-24T10:00:00Z",
  "actorId": "...",
  "workspaceId": "...",
  "workspaceSlug": "..."
}
```

### Workflow State Cache

States are cached per-team at `<credentials-dir>/<agent-id>.cache.json` with a 24-hour TTL. Automatically populated on first use of `--state` or `issue transition`.

## Error Codes

| Code | Error | Behavior |
|------|-------|----------|
| 1 | Rate limited | Wait for reset, retry once |
| 2 | Authentication | Refresh token, retry once |
| 3 | Forbidden | Fail immediately |
| 4 | Validation | Fail with helpful message |
| 5 | Network | Retry once after 2s |
| 6 | Partial success | Report failures alongside result |

## Example: Agent Heartbeat Workflow

```bash
#!/bin/bash
AGENT="eve"

# 1. Check inbox for new work
linear inbox --agent $AGENT --format json

# 2. Check delegated issues
linear delegate list --agent $AGENT --format json

# 3. Work on an issue
linear issue transition MAIN-42 "In Progress" --agent $AGENT
linear comment add MAIN-42 --body "Starting work." --agent $AGENT

# 4. Complete and hand off
linear issue transition MAIN-42 "Awaiting Review" --agent $AGENT
linear comment add MAIN-42 --body "Done. Ready for review." --agent $AGENT

# 5. Dismiss processed notifications
linear inbox dismiss-all --agent $AGENT
```

## OpenClaw Skill

An [OpenClaw](https://openclaw.dev) skill for using this CLI with AI agents lives at [`skills/linear-cli/SKILL.md`](skills/linear-cli/SKILL.md). The skill teaches agents the command patterns, JSON output format, multi-line content handling, and error recovery for this CLI.

### Installation

Install via symlink so skill updates apply automatically whenever you pull new versions of this repo:

```bash
# From your OpenClaw workspace root
ln -s /path/to/linear-agent-cli/skills/linear-cli workspace/skills/linear-cli
```

Or using an absolute path from the repo directory:

```bash
ln -s "$(pwd)/skills/linear-cli" /path/to/your-workspace/workspace/skills/linear-cli
```

The skill requires the `linear` binary to be in `$PATH`. OpenClaw will not load it if the binary is missing.

## Development

```bash
npm install
npm run build
npm test
```

Integration tests (requires Linear credentials):

```bash
LINEAR_TEST_AGENT_ID=... LINEAR_TEST_CLIENT_ID=... LINEAR_TEST_CLIENT_SECRET=... npm run test:integration
```
