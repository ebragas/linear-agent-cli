---
name: linear-cli
description: CLI tool for AI agents to interact with Linear using per-agent OAuth identity
status: backlog
created: 2026-02-23T05:15:10Z
---

# PRD: linear-cli

## Executive Summary

A Node.js CLI tool that enables AI agents to interact with Linear as independent OAuth application entities. Each agent authenticates with its own credentials, appears as a distinct assignee/mentionable in Linear, and can manage issues, comments, notifications, and delegations programmatically. The CLI is the primary interface for agents running on heartbeat schedules to discover work, execute tasks, and report results.

## Problem Statement

AI agents in the OpenClaw system need to interact with Linear for task management — checking for assignments, updating issue status, posting comments, and managing delegations. Linear's web UI and MCP server are designed for interactive human use and don't support per-agent configuration needed for multi-agent batch workflows. Agents need a CLI tool that:

- Authenticates each agent as a distinct Linear entity (not a shared human account)
- Provides structured output (JSON) for programmatic consumption
- Handles token lifecycle automatically (refresh, retry on 401)
- Fails fast with clear exit codes so agent runtimes can make informed decisions
- Works in non-interactive environments (no browser required for auth)

## User Stories

### US-1: Agent Authentication
**As** an agent operator, **I want** to authenticate an agent with Linear using client credentials, **so that** the agent has its own identity and token without requiring a browser.

**Acceptance Criteria:**
- `linear auth setup --client-credentials --agent <id> --client-id <id> --client-secret <secret>` obtains a 30-day token
- Credentials file is written with 600 permissions to the configured directory
- `actorId`, `workspaceId`, and `workspaceSlug` are captured automatically
- `linear auth whoami --agent <id>` verifies the token and prints agent identity

### US-2: Agent Heartbeat Check-in
**As** an agent on a heartbeat schedule, **I want** to check my Linear inbox for new work, **so that** I can discover assignments, mentions, and delegation events.

**Acceptance Criteria:**
- `linear inbox --agent <id> --format json` returns unprocessed notifications (archivedAt: null)
- Notifications include type, category, and linked issue details
- `linear inbox dismiss <id>` archives a processed notification
- `linear inbox dismiss-all` archives all unprocessed notifications

### US-3: Issue Lifecycle Management
**As** an agent working on a task, **I want** to read, create, update, and transition issues, **so that** I can manage my work in Linear.

**Acceptance Criteria:**
- `linear issue get <id>` returns full issue details (title, description, state, assignee, delegate, labels, priority, dependencies, comments)
- `linear issue create` creates an issue with title, team, description, labels, assignee, delegate, priority, parent, and relations
- `linear issue update <id>` modifies any issue field; nullable fields accept "null" to clear
- `linear issue transition <id> <state>` changes workflow state by name
- `linear issue list` supports filtering by assignee, delegate, state, label, team, project, priority, and date ranges
- `linear issue search <query>` performs full-text search across the workspace

### US-4: Communication via Comments
**As** an agent, **I want** to post and read comments on issues, **so that** I can communicate progress and results.

**Acceptance Criteria:**
- `linear comment add <issue-id> --body <text>` posts a comment attributed to the agent
- `linear comment add <issue-id> --body-file <path>` reads body from file
- `linear comment add <issue-id> --reply-to <comment-id>` creates a threaded reply
- `linear comment list <issue-id>` returns all comments with author and timestamps
- @mentions in comment body text work naturally (Linear resolves them)

### US-5: Delegation Management
**As** an agent or operator, **I want** to delegate issues to specific agents, **so that** work is routed to the right agent.

**Acceptance Criteria:**
- `linear delegate <issue-id> --to <agent>` sets the delegate on an issue
- `linear delegate list` returns issues delegated to the current agent
- `linear delegate remove <issue-id>` clears the delegate field

### US-6: Token Auto-Refresh
**As** an agent, **I want** token refresh to happen automatically on 401 errors, **so that** expired tokens don't break my heartbeat cycle.

**Acceptance Criteria:**
- On `AUTHENTICATION_ERROR`, the CLI requests a new token, updates the credentials file, and retries the failed request once
- If refresh fails, the CLI exits with code 2 and a message suggesting `auth setup`
- Client credentials flow: new 30-day token via POST to token endpoint
- OAuth flow: new token via refresh token grant

### US-7: Error Handling with Clear Exit Codes
**As** an agent runtime, **I want** the CLI to fail fast with specific exit codes, **so that** I can decide whether to retry, skip, or alert.

**Acceptance Criteria:**
- Exit code 1: rate limited (after one retry)
- Exit code 2: authentication error (after one refresh attempt)
- Exit code 3: forbidden (immediate, agent may have lost access)
- Exit code 4: invalid input (immediate, with validation message)
- Exit code 5: network error (after one retry with 2s delay)
- Exit code 6: partial success (primary operation succeeded, follow-up failed)
- All errors include human-readable messages
- Resolution errors (bad assignee/delegate name) include list of valid options

### US-8: Structured Output
**As** an agent parsing CLI output, **I want** JSON output when piped and human-readable output when interactive, **so that** the CLI works for both agents and humans.

**Acceptance Criteria:**
- `--format json` forces JSON output
- `--format text` forces human-readable output
- Default: JSON when stdout is not a TTY, text when it is
- JSON structure: `{ results: [...] }` for list commands, single object for get commands

### US-9: Issue Relations and Dependencies
**As** an agent creating tasks, **I want** to set blocking/blocked-by/related-to relations, **so that** work dependencies are tracked in Linear.

**Acceptance Criteria:**
- `--blocks <id>`, `--blocked-by <id>`, `--related-to <id>` flags on issue create/update
- Relations are created via separate `issueRelationCreate` calls after the primary operation
- On partial failure: issue ID is always output, failed relations are reported, exit code 6

### US-10: Workspace Discovery
**As** an agent, **I want** to discover users, agents, teams, projects, labels, and workflow states, **so that** I can reference them correctly in commands.

**Acceptance Criteria:**
- `linear user list --type app` discovers all installed OAuth agents
- `linear team list` and `linear team members <team>` show team structure
- `linear project list` and `linear project get <id>` show projects
- `linear label list` shows workspace and team-scoped labels
- `linear state list --team <team>` shows workflow states and populates cache

## Requirements

### Functional Requirements

**Authentication (auth command group):**
- Client credentials grant (primary): single POST, no browser, 30-day tokens
- OAuth authorization code flow (alternative): browser-based, 24-hour tokens with refresh
- Token storage as JSON files with 600 permissions at configurable path
- Token auto-refresh on 401 (primary) and proactive refresh via `auth refresh` (secondary)
- `auth whoami` for token verification, `auth revoke` for cleanup

**Issue management (issue command group):**
- Full CRUD: list, get, create, update, archive, delete
- Transition by workflow state name (with team-scoped state cache)
- Full-text search via `searchIssues` GraphQL query
- Rich filtering: assignee, delegate, state, label, team, project, priority, date ranges, query
- Relation management: blocks, blocked-by, related-to (via separate API calls)
- Description from file (`--description-file`) for long content

**Comments (comment command group):**
- List, add, update comments on issues
- Threaded replies via `--reply-to`
- Body from file (`--body-file`) for long content
- @mention support (pass-through to Linear)

**Notifications (inbox command group):**
- Archive-based processing: unprocessed = archivedAt is null
- Filter by type, category, and date
- Individual and bulk dismiss (archive)

**Delegation (delegate command group):**
- Delegate/undelegate issues to agents
- List issues delegated to current agent
- Shortcuts to `issue update --delegate`

**Discovery (label, user, team, project, state command groups):**
- List labels (workspace and team-scoped), create labels
- List/search users and agents, filter by type
- List teams, list team members
- List/get projects
- List workflow states (populates cache)

**Attachments (attachment command group):**
- Add URL attachments to issues (idempotent)
- List and remove attachments

**Global capabilities:**
- `--agent <id>` flag or `LINEAR_AGENT_ID` env var
- `--credentials-dir <path>` or `LINEAR_AGENT_CREDENTIALS_DIR` env var
- `--format json|text` with TTY auto-detection
- Workflow state cache: per-team, 24hr TTL, auto-invalidated on state ID errors

### Non-Functional Requirements

**Performance:**
- Fail fast: one retry per error, then exit
- Workflow state cache eliminates a round-trip per state-name resolution
- No long retry loops (agents run on hourly heartbeats; retry on next cycle)

**Security:**
- Credentials files stored with 600 permissions
- Client secrets never logged or output
- No `admin` scope requested
- Token stored locally, never transmitted except to Linear API

**Reliability:**
- Transparent 401 token refresh with one retry
- Rate limit awareness: respect `X-RateLimit-Requests-Reset` header
- Partial success handling: always output primary result even if follow-up fails
- GraphQL partial success: check `errors` array on every 200 response

**Compatibility:**
- Node.js v22+
- macOS (primary), Linux (secondary)
- npm global install distribution

## Success Criteria

1. **Eve completes an end-to-end heartbeat cycle:** authenticate → check inbox → pick up issue → update status → post comment → dismiss notification
2. **All command groups functional against real Linear workspace:** every command in the spec can be exercised manually with correct results
3. **Published to npm:** `npm install -g @ebragas/linear-cli` works, README documents all commands
4. **Unit test coverage for all command groups:** argument parsing, error handling, output formatting
5. **Integration tests pass:** CRUD lifecycle, auth flow, inbox processing against real Linear

## Constraints & Assumptions

**Constraints:**
- Must use `@linear/sdk` (only official SDK; no Python/Go alternatives)
- Client credentials grant: one active token per OAuth app (not a concern — each agent is a separate app)
- Rate limits: 5,000 requests/hour, 250,000 complexity points/hour (shared per authenticated user)
- Rate limit responses return HTTP 400 (not 429) with `RATELIMITED` in GraphQL error extensions
- Linear free tier: 250 active issues
- No interactive/browser-dependent flows for primary auth path

**Assumptions:**
- Each agent is registered as a separate OAuth application in Linear
- Agents run on staggered heartbeats (no concurrent token conflicts)
- OpenClaw injects agent identity via workspace files (TOOLS.md), not env vars
- The CLI is a tool used within agent sessions, not the agent runtime itself

## Out of Scope

- **Linear Agent Interaction SDK** (sessions, activities, webhooks): designed for always-on agents, not batch heartbeat workers. Can be added later without architectural changes.
- **Webhook receiver service:** would require a separate always-on process; not needed for polling-based heartbeat architecture
- **Git branch management:** agents manage branches via their own tools; the CLI handles Linear only
- **Multi-workspace support:** single workspace per agent credentials file
- **Agent scheduling/orchestration:** handled by OpenClaw gateway, not this CLI
- **Knowledge management integration:** handled by separate systems (Obsidian, qmd)

## Dependencies

**External:**
- `@linear/sdk` — Linear's official TypeScript SDK
- `commander` — CLI framework
- Linear OAuth application registration (manual prerequisite per agent)
- Linear workspace with appropriate plan (free tier: 250 issues)

**Internal:**
- LINEAR_CLI.md spec — source of truth for command definitions and behavior
- OpenClaw agent workspace conventions (TOOLS.md for agent identity)

## Technical Design Reference

See [Design Document](../../docs/plans/2026-02-23-linear-cli-design.md) for:
- Codebase architecture and module structure
- Command registration patterns
- Client lifecycle and token refresh implementation
- Testing strategy details
- Distribution and packaging
