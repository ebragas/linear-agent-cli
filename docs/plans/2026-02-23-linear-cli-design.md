# Linear Agent CLI — Design Document

**Date:** 2026-02-23
**Status:** Approved
**Spec:** [LINEAR_CLI.md](../../LINEAR_CLI.md)

## Overview

A Node.js CLI for AI agents to interact with Linear using per-agent OAuth identity. Each agent authenticates as its own Linear application entity (`actor=app`), making it assignable, mentionable, and independently trackable.

## Stack

| Component | Choice | Rationale |
|-----------|--------|-----------|
| Runtime | Node.js v22+ | Spec requirement, @linear/sdk is Node-native |
| Language | TypeScript (strict) | Leverages @linear/sdk types, catches errors at compile time |
| CLI framework | Commander.js | Most popular, good subcommand support, maps to spec's structure |
| Linear SDK | @linear/sdk | Official TypeScript SDK, auto-generated from GraphQL schema |
| Test framework | Vitest | Fast, TypeScript-native, good mocking support |
| Bundler | tsup | Fast, produces clean CJS output for CLI distribution |

## Architecture

Flat module structure — one file per command group, mapping 1:1 to the spec.

```
src/
  cli.ts              # Entry point, Commander program, global flags
  client.ts           # LinearClient factory with 401 auto-refresh
  credentials.ts      # Read/write/validate credential files (JSON, 600 perms)
  cache.ts            # Workflow state cache (per-team, 24hr TTL)
  errors.ts           # Error types, exit codes 1-6, helpful resolution messages
  output.ts           # Format switching (text/json), TTY detection
  resolvers.ts        # "me" resolution, user/state name→ID lookups
  commands/
    auth.ts           # setup, whoami, refresh, revoke
    issue.ts          # list, get, create, update, transition, search, archive, delete
    comment.ts        # list, add, update
    inbox.ts          # list, dismiss, dismiss-all
    delegate.ts       # delegate, list, remove (shortcuts to issue commands)
    label.ts          # list, create
    user.ts           # list, search, me
    team.ts           # list, members
    project.ts        # list, get
    attachment.ts     # add, list, remove
    state.ts          # list (also populates cache)
test/
  unit/               # Mocked SDK tests per command
  integration/        # Real API tests (INTEGRATION=true)
```

## Key Patterns

### Command Registration

Each `commands/*.ts` exports a registration function:

```typescript
export function registerIssueCommands(program: Command, getClient: ClientFactory) {
  const issue = program.command('issue');
  issue.command('list')
    .option('--assignee <user>')
    .option('--state <state>')
    .action(async (opts) => { /* ... */ });
}
```

### Result Contract

Every command handler returns a typed result:

```typescript
type CommandResult<T> = {
  data: T;
  warnings?: string[];  // For partial success (exit code 6)
};
```

`output.ts` takes the result and formats it based on `--format` flag and TTY detection.

### Client Lifecycle

`client.ts` wraps LinearClient with transparent error handling:

1. Create client with stored access token
2. On `AUTHENTICATION_ERROR`: refresh token, update credentials file, retry once
3. On `RATELIMITED` (HTTP 400): read `X-RateLimit-Requests-Reset` header, wait, retry once
4. On network error: retry once after 2s
5. All other errors: fail immediately with appropriate exit code

### Resolver Pattern

Commands accepting `--assignee`, `--delegate`, or `--state`:
- "me" resolves to `actorId` from credentials file
- Names resolve via cached lookups (users on first use, states per-team with 24hr TTL)
- On failure: error message includes list of valid options (no extra round-trip for the caller)

### Relation Handling

Issue create/update with `--blocks`, `--blocked-by`, `--related-to`:
1. Primary `issueCreate`/`issueUpdate` call
2. Separate `issueRelationCreate` calls for each relation
3. On partial failure: output primary result, report which relations failed, exit code 6

## Error Handling

Per the spec's error table:

| Error | Behavior | Exit Code |
|-------|----------|-----------|
| `RATELIMITED` | Wait for reset, retry once | 1 |
| `AUTHENTICATION_ERROR` | Refresh token, retry once | 2 |
| `FORBIDDEN` | Fail immediately | 3 |
| `InvalidInputLinearError` | Fail immediately | 4 |
| Network error | Retry once after 2s | 5 |
| Partial success | Report failures alongside primary result | 6 |

Design principle: one retry per error, then fail fast. The calling agent decides what to do next.

## Testing Strategy

### Unit Tests (Vitest, mocked @linear/sdk)
- Argument parsing and validation per command
- Error handling paths (401 retry, rate limit, partial success)
- Output formatting (text and JSON modes)
- Credential read/write, cache TTL logic
- Resolver behavior ("me", name lookups, failure suggestions)

### Integration Tests (real Linear workspace)
- Guarded behind `INTEGRATION=true` env flag
- Full auth setup flow (client credentials)
- Issue CRUD lifecycle: create → get → update → transition → archive
- Comment add/list/reply
- Inbox: list → dismiss
- Delegation: delegate → list → remove

## Distribution

- Build: `tsup` → `dist/cli.js`
- Binary: `{ "linear": "./dist/cli.js" }` in package.json
- Registry: npm as `@ebragas/linear-cli`
- Install: `npm install -g @ebragas/linear-cli`
