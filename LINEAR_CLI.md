# Linear Agent CLI — Specification

A CLI tool for AI agents to interact with Linear using per-agent OAuth identity. Each agent authenticates as its own Linear application entity (`actor=app`), making it assignable, mentionable, and independently trackable.

**Repo:** `github.com/ebragas/linear-cli` (private)
**Runtime:** Node.js (v22+)
**SDK:** `@linear/sdk`
**Distribution:** npm global install (`npm install -g @ebragas/linear-cli`)

## Authentication Model

Each agent is a separate Linear OAuth application installed with `actor=app`. This means:
- Each agent appears as a distinct entity in Linear's assignee and mention menus
- Actions (issue creation, comments, status changes) are attributed to the agent, not a human user
- Agents do not consume billable seats
- Each agent has its own independent token (tokens are per-app, so agents never interfere with each other)

### Prerequisites (All Auth Methods)

1. Register an OAuth application per agent at `linear.app/settings/api/applications/new`:
   - Set the application name and icon (this is how the agent appears in mention/filter menus)
   - Enable webhooks and select "Agent session events" (required for future session support)
   - Optionally select "Permission changes" to receive notifications if admin revokes agent access
   - Note: The `admin` scope is not needed and should not be requested (no technical restriction exists, but it grants unnecessary privileges)

### Client Credentials Grant (Primary — Recommended)

The simplest auth method for batch agents running on a trusted machine. A single POST request, no browser or redirect server needed.

1. Run `linear auth setup --client-credentials` which:
   - POSTs to `https://api.linear.app/oauth/token` with `grant_type=client_credentials`, `client_id`, `client_secret`, and `scope` (comma-separated, required)
   - Receives an `actor=app` access token with **30-day lifetime**
   - Queries `viewer { id }` and `organization { id, urlKey }` to retrieve the agent's `actorId`, `workspaceId`, and `workspaceSlug`
   - Writes the credentials file to the configured path (all fields populated automatically — only `client_id` and `client_secret` are provided by the user)
2. **Token renewal:** No refresh token is issued. The primary renewal mechanism is handling 401 responses — on 401, the CLI requests a new token automatically (per Linear docs: "your server is expected to fetch a new token if it receives a 401 error"). Proactive renewal before expiry (~25 days) via `linear auth refresh` is a secondary optimization. The old token is invalidated when a new one is issued.
3. **Limitation:** Only one active client credentials token per OAuth app. Requesting a new token invalidates the previous one. This is not a concern for our architecture — each agent is a separate OAuth app, and agents don't run concurrently (staggered heartbeats).
- Ref: [Linear OAuth 2.0 — Client credentials grant](https://linear.app/developers/oauth-2-0-authentication)

### OAuth Authorization Code Flow (Alternative)

The full browser-based OAuth flow. Use this if client credentials grant is insufficient (e.g., if Linear changes scoping rules, or for interactive setup on a machine with a browser).

1. Run `linear auth setup --oauth` which:
   - Starts a temporary local HTTP server on a configurable port
   - Opens the Linear OAuth authorization URL with `actor=app` and scopes `read,write,app:assignable,app:mentionable`
   - Captures the authorization code callback
   - Exchanges the code for access token (**24hr lifetime**) + refresh token
   - Queries `viewer { id }` and `organization { id, urlKey }` to retrieve `actorId`, `workspaceId`, and `workspaceSlug`
   - Writes the credentials file and shuts down the server
2. **Token refresh:** The `LinearClient` from `@linear/sdk` accepts a static `accessToken` — **it does not refresh tokens automatically**. The CLI must manage refresh explicitly (see Operational Considerations).
- Ref: [Linear OAuth 2.0 — Authorization code flow](https://linear.app/developers/oauth-2-0-authentication)

### Auth Method Comparison

| | Client Credentials (primary) | OAuth Code Flow (alternative) |
|---|---|---|
| Setup | Single POST, no browser | Browser redirect + callback server |
| Token lifetime | 30 days | 24 hours |
| Refresh mechanism | Request new token before expiry | Refresh token grant |
| Tokens per app | 1 active at a time | Multiple allowed |
| Scopes | Configurable (required `scope` parameter); grants access to all public workspace teams | Configurable per authorization |
| Best for | Batch agents on trusted machines | Interactive setup, fine-grained scoping |

### Token Storage

Tokens stored as JSON files at a configurable path (default: `~/.linear/credentials/<agent-id>.json`). File permissions `600`. The path is configurable via `--credentials-dir` flag or `LINEAR_AGENT_CREDENTIALS_DIR` env var.

**For the OpenClaw deployment**, tokens live at `/Users/eric/agents/credentials/linear/` (gitignored).

### Agent Identity on Mutations

When authenticated via `actor=app`, all mutations are attributed to the agent's application identity. Each agent is its own OAuth app with a distinct name and icon in Linear.

## CLI Structure

Global flags available on all commands:
- `--agent <id>` — select which agent's credentials to use (required unless `LINEAR_AGENT_ID` is set)
- `--credentials-dir <path>` — override credentials directory
- `--format <json|text>` — output format (default: `text` for interactive, `json` when stdout is not a TTY)

### `auth` — Authentication Management

```
linear auth setup         Authenticate an agent with Linear
  --agent <id>                  Agent identifier (used for token filename)
  --client-id <id>              OAuth application client ID
  --client-secret <secret>      OAuth application client secret
  --client-credentials          Use client credentials grant (default, recommended)
  --oauth                       Use OAuth authorization code flow instead
  --port <port>                 Local callback server port (OAuth flow only, default: 9876)
  --scopes <scopes>             OAuth scopes (default: read,write,app:assignable,app:mentionable)

linear auth whoami        Verify token validity, print agent identity
  --agent <id>

linear auth refresh       Request a new token (client credentials) or refresh (OAuth)
  --agent <id>

linear auth revoke        Revoke token and delete credentials
  --agent <id>
```

### `issue` — Issue Management

```
linear issue list         List issues with filters
  --assignee <user>             Filter by assignee (name, email, ID, or "me")
  --delegate <agent>            Filter by delegated agent
  --state <state>               Filter by workflow state name or type
  --label <label>               Filter by label name
  --team <team>                 Filter by team name or ID
  --project <project>           Filter by project name or ID
  --priority <0-4>              Filter by priority
  --query <text>                Search title/description
  --created-after <date>        ISO-8601 date or duration (e.g., -P7D)
  --updated-after <date>        ISO-8601 date or duration
  --limit <n>                   Max results (default: 50, max: 250)
  --include-archived            Include archived issues

linear issue get <id>     Get full issue details
                                Returns: title, description, state, assignee,
                                delegate, labels, priority, dependencies,
                                parent/children, comments, links

linear issue create       Create a new issue
  --title <text>                Issue title (required)
  --team <team>                 Team name or ID (required)
  --description <text>          Markdown description
  --description-file <path>     Read description from file (preferred for long content)
  --assignee <user>             Assign to user
  --delegate <agent>            Delegate to agent
  --state <state>               Initial workflow state
  --label <label>               Add label (repeatable)
  --priority <0-4>              Priority level
  --project <project>           Add to project
  --parent <id>                 Set parent issue (for subtasks)
  --blocks <id>                 This issue blocks <id> (repeatable)
  --blocked-by <id>             This issue is blocked by <id> (repeatable)
  --related-to <id>             Related issue (repeatable)
  --due-date <date>             Due date (ISO format)
  --estimate <n>                Effort estimate

                                Note: --blocks, --blocked-by, and --related-to
                                create issue relations via separate
                                `issueRelationCreate` calls after the issue is
                                created. There is no `blockedBy` relation type —
                                --blocked-by creates a `blocks` relation with
                                reversed direction. Partial failure is possible
                                (issue created, relation failed) — the CLI
                                always outputs the created issue ID and reports
                                which relations succeeded/failed (exit code 6
                                for partial success).

linear issue update <id>  Update an existing issue
                                Accepts all create flags except --team
                                Null-able fields (pass "null" to clear):
                                  --assignee, --delegate, --parent
                                Note: --blocks, --blocked-by, --related-to
                                use separate `issueRelationCreate` calls
                                (same behavior as issue create)

linear issue transition <id> <state>
                                Move issue to a workflow state by name
                                Parses the team key from the issue identifier
                                (e.g., MAIN from MAIN-42) to resolve the state
                                name using the team-scoped local cache
                                (see Workflow State Cache below)
                                Shortcut for: issue update <id> --state <state>

linear issue search <query>
                                Full-text search via `searchIssues` GraphQL query
                                (SDK: linearClient.searchIssues())
                                Returns relevance-ranked results across workspace
                                (Distinct from --query on issue list, which filters
                                the issues connection and combines with other flags)
  --team <team>                 Boost results for a specific team
  --include-comments            Search within comment content
  --include-archived            Include archived issues in results

linear issue archive <id> Archive an issue

linear issue delete <id>  Delete an issue
```

### `comment` — Comments and Mentions

```
linear comment list <issue-id>
                                List all comments on an issue
                                Returns: author, body, created date, replies

linear comment add <issue-id>
  --body <text>                 Comment body as markdown
  --body-file <path>            Read body from file (preferred for long content)
  --reply-to <comment-id>       Reply to a specific comment

linear comment update <comment-id>
  --body <text>                 Updated comment body
  --body-file <path>            Read body from file
```

**Mentioning agents in comments:** Use `@AgentName` in the comment body. Linear resolves mentions for installed OAuth applications with `app:mentionable` scope. The CLI does not need special handling — pass the `@` syntax in the body text.

**Referencing issues in comments:** Use full Linear URLs (e.g., `https://linear.app/eric-bragas/issue/MAIN-123/`) in markdown for automatic link conversion. More reliable than plain identifiers.

### `inbox` — Notification and Mention Tracking

This is the critical "heartbeat check-in" command. Agents call this on their heartbeat to discover work.

The inbox uses **archive-based processing**: unprocessed notifications are those with `archivedAt: null`. When an agent finishes processing a notification, it dismisses (archives) it. This approach is used because `NotificationFilter` supports `archivedAt` but does **not** support `readAt` — there is no way to filter for unread notifications server-side.

> **Implementation note:** During implementation, verify the user-facing UX impact of archiving notifications in the Linear web UI. Archived notifications may be hidden from the human's inbox. If this disrupts the human's workflow, fall back to fetching recent notifications and filtering `readAt === null` client-side.

```
linear inbox              List unprocessed notifications for this agent
                                Filters: archivedAt is null (server-side)
                                Includes: issue assignments, @mentions,
                                delegation events, status changes
  --include-archived            Show all notifications (not just unprocessed)
  --type <type>                 Filter by notification type string
  --category <cat>              Filter by notification category enum:
                                  assignments, mentions, statusChanges,
                                  commentsAndReplies, reactions, reviews,
                                  appsAndIntegrations, triage, system
  --since <date>                Only notifications after this date/duration

linear inbox dismiss <id>
                                Dismiss (archive) a processed notification

linear inbox dismiss-all
                                Dismiss all unprocessed notifications
                                (iterates and archives each — no bulk mutation)
```

**Implementation:** Uses the `notifications` connection on the Linear SDK with archive-based filtering:

```typescript
// Fetch unprocessed notifications for this agent (server-side filter)
const notifications = await linearClient.notifications({
  filter: { archivedAt: { null: true } }
});

for (const n of notifications.nodes) {
  // n.type: string (e.g., "issueAssignedToYou", "issueMention", etc.)
  // n.category: NotificationCategory enum (e.g., "assignments", "mentions",
  //             "statusChanges", "commentsAndReplies")
  // n.issue: linked issue (fetch full details as needed)
}

// Dismiss (archive) a processed notification
await linearClient.notificationArchive(notificationId);
```

Each notification has a `type` string (what happened), a `category` enum (grouping), and an `issue` field (which issue). The authenticated actor (`actor=app`) receives notifications for assignments, @mentions, delegations, and status changes on involved issues.

**Note:** `NotificationFilter` does NOT support `readAt`. The `readAt` field exists on the `Notification` model and can be set via `notificationUpdate`, but it cannot be used for server-side filtering. This is why the CLI uses `archivedAt` (which IS filterable) for the archive-based processing approach.

### `delegate` — Delegation Shortcuts

In Linear, **delegation** is distinct from **assignment**. The assignee is the human owner accountable for the issue; the delegate is the agent that works on it. An issue can have both. Delegation is agent-specific — only OAuth apps can be delegates.

```
linear delegate <issue-id> --to <agent>
                                Delegate an issue to another agent
                                Shortcut for: issue update <id> --delegate <agent>

linear delegate list      List issues delegated to this agent
                                Shortcut for: issue list --delegate me

linear delegate remove <issue-id>
                                Remove delegation from an issue
                                Shortcut for: issue update <id> --delegate null
```

### `label` — Label Management

```
linear label list         List all labels in the workspace
  --team <team>                 Filter by team

linear label create       Create a new label
  --name <text>                 Label name (required)
  --color <hex>                 Label color
  --team <team>                 Team-scoped label (omit for workspace-level)
```

### `user` — User and Agent Discovery

```
linear user list          List all users and agents in the workspace
  --type <user|app|bot>         Filter by entity type (app = OAuth agents)
  --team <team>                 Filter by team membership

linear user search <query>
                                Search users/agents by name or email

linear user me            Show this agent's identity (alias for auth whoami)
```

**"me" resolution:** Commands that accept `--assignee me` or `--delegate me` resolve "me" to the `actorId` stored in the agent's credentials file (captured during `auth setup`).

**Agent discovery:** `user list --type app` returns all installed OAuth agents in the workspace. This allows agents to discover teammates — when a new agent is added to Linear, existing agents can find it via this command and assign/delegate/mention it without needing explicit configuration updates.

### `team` — Team Queries

```
linear team list          List all teams
linear team members <team>
                                List members of a team (includes users and agents)
```

### `project` — Project Queries

```
linear project create
  --name <text>                 Project name (required)
  --team <team>                 Associate project with team by name or ID (required)
  --description <text>          Set description (markdown)
  --description-file <path>     Read description from file
  --content <text>              Set long-form project overview content
  --content-file <path>         Read long-form content from file
  --start-date <date>           Start date (YYYY-MM-DD)
  --target-date <date>          Target date (YYYY-MM-DD)
  --lead <user>                 Project lead by name or email
  --priority <0-4>              Priority (0=none, 1=urgent, 2=high, 3=normal, 4=low)

linear project list       List projects
  --team <team>                 Filter by team

linear project get <id>   Get project details

linear project update <id>
  --name <text>                 Rename the project
  --description <text>          Set description (markdown)
  --description-file <path>     Read description from file
  --start-date <date>           Start date (YYYY-MM-DD, or "null" to clear)
  --target-date <date>          Target date (YYYY-MM-DD, or "null" to clear)
  --lead <user>                 Project lead by name, email, or UUID ("null" to clear)
  --priority <0-4>              Priority (0=none, 1=urgent, 2=high, 3=normal, 4=low)
```

### `attachment` — External URL Attachments

```
linear attachment add <issue-id>
  --url <url>                   URL to attach (required)
  --title <text>                Display title for the link

linear attachment list <issue-id>
                                List attachments on an issue

linear attachment remove <attachment-id>
                                Remove an attachment
```

**Implementation:** Uses the `createAttachment` mutation. Attachment URLs are idempotent per issue — attaching the same URL twice updates rather than duplicates.

### `state` — Workflow State Queries

```
linear state list         List workflow states
  --team <team>                 Filter by team
```

### Workflow State Cache

Commands that accept `--state` or a `<state>` argument resolve human-readable state names (e.g., "In Progress") to Linear workflow state IDs. This requires a `workflowStates` query, adding a round-trip on every call.

To avoid this, the CLI caches state name → ID mappings locally:
- **Location:** `<credentials-dir>/<agent-id>.cache.json`
- **Populated:** On first use and via `linear state list`
- **Refreshed:** Automatically when the cache is older than 24 hours
- **Invalidated:** On `INVALID_INPUT` errors referencing state IDs (workflow states may have changed)

The cache stores mappings per team, since workflow states are team-scoped.

**Team resolution from issue identifiers:** Commands like `issue transition MAIN-42 "In Progress"` parse the team key from the identifier prefix (`MAIN` from `MAIN-42`) to look up states in the correct team's cache — no extra API fetch needed. A fetch fallback is only required if a raw UUID is passed instead of an identifier (uncommon in agent usage).

## Agent Workflow: Heartbeat Check-in

The primary agent workflow pattern. Run on each heartbeat cycle:

```bash
# 1. Check inbox for new assignments, mentions, and delegation events
linear inbox --agent eve --format json

# 2. Check issues delegated to me
linear delegate list --agent eve --format json

# 3. Process each item, update status
linear issue transition MAIN-42 "In Progress" --agent eve
linear comment add MAIN-42 --body "Starting work on this." --agent eve

# 4. When done, transition and comment
linear issue transition MAIN-42 "Awaiting Review" --agent eve
linear comment add MAIN-42 --body "Completed. Ready for review." --agent eve

# 5. Dismiss processed notifications
linear inbox dismiss-all --agent eve
```

## Agent Workflow: Code-Related Tasks

Agents may work on code tasks. The CLI supports linking git work to Linear issues:

```bash
# Create an issue for a code task
linear issue create --agent eve \
  --title "Fix authentication timeout" \
  --team Main \
  --label bug \
  --description-file /tmp/issue-description.md

# Link a PR to an issue
linear attachment add MAIN-50 --agent eve \
  --url "https://github.com/ebragas/project/pull/12" \
  --title "PR #12: Fix auth timeout"

# Create subtasks for code review
linear issue create --agent eve \
  --title "Review: Fix auth timeout" \
  --team Main \
  --parent MAIN-50 \
  --delegate analyst \
  --description "Review PR #12 for security implications"
```

**Branch naming convention:** When an agent starts work on an issue, it can use the issue identifier as a branch prefix (e.g., `main-50-fix-auth-timeout`). The CLI does not manage git branches directly — that is the agent runtime's responsibility.

## Design Decision: Agent Interaction SDK

Linear's Agent Interaction SDK (sessions, activities, webhooks) is **intentionally excluded** from this CLI. That SDK is designed for always-on agents with webhook-driven event loops that respond within 10 seconds of a mention. Our agents are batch workers on an hourly heartbeat — a fundamentally different architecture.

**How we achieve AIG compliance without the SDK:**
- **Identity disclosure (AIG 1):** Each agent is a distinct OAuth app entity — clearly not a human user.
- **Immediate feedback (AIG 3):** Agents post a comment when they pick up a task on their heartbeat. Not instant, but appropriate for batch workers. Users see "picked up by Eve" within the heartbeat window.
- **State transparency (AIG 4):** Agents post checkpoint comments at meaningful points (plan, progress, completion) via `comment add`. This is more useful than streaming raw model reasoning.
- **Human accountability (AIG 6):** Assignment (human owner) is separate from delegation (agent worker). "Awaiting Review" and "Awaiting Approval" states create explicit handoff points.

If real-time agent responsiveness becomes a requirement, the SDK's session/activity mutations are available in `@linear/sdk` and can be added to this CLI without architectural changes. The webhook receiver would be a separate service.

Reference: [Linear Agent Interface Guidelines](https://linear.app/developers/aig)

## Output Formats

- **`text`** (default when TTY): Human-readable table/list format
- **`json`** (default when piped): Single JSON object with a `results` array for list commands, or a single object for get commands. Parseable with `JSON.parse()`.

JSON output enables agents to parse responses programmatically. All commands that return data support `--format json`.

## Configuration

### Environment Variables

| Variable | Description |
|----------|-------------|
| `LINEAR_AGENT_ID` | Default agent ID (avoids `--agent` on every call) |
| `LINEAR_AGENT_CREDENTIALS_DIR` | Credentials directory path |

### Per-Agent Configuration

Each agent's credentials file (`<credentials-dir>/<agent-id>.json`) contains:

```json
{
  "authMethod": "client_credentials | oauth",
  "clientId": "...",
  "clientSecret": "...",
  "accessToken": "...",
  "refreshToken": "...",          // null for client_credentials
  "tokenExpiresAt": "2026-03-24T10:00:00Z",
  "actorId": "...",
  "workspaceId": "...",
  "workspaceSlug": "eric-bragas"  // needed for constructing Linear URLs in comments
}
```

## Operational Considerations

- **Token refresh:** The `LinearClient` from `@linear/sdk` accepts a static `accessToken` — **it does not refresh tokens automatically**. The CLI handles renewal in two ways:
  - **Primary (401-triggered):** On `AUTHENTICATION_ERROR`, the CLI attempts a token refresh before retrying. This is Linear's recommended approach: "your server is expected to fetch a new token if it receives a 401 error."
  - **Secondary (proactive):** The CLI can check `tokenExpiresAt` before API calls and refresh preemptively via `linear auth refresh`.
  - **Client credentials:** POST to `https://api.linear.app/oauth/token` with `grant_type=client_credentials`. New 30-day token issued; old token invalidated.
  - **OAuth code flow:** POST with `grant_type=refresh_token` and the stored `refreshToken`. New 24hr access token + new refresh token issued.
  - In both cases: update the credentials file and create a new `LinearClient` instance.
  - Ref: [Linear OAuth 2.0 — Token refresh](https://linear.app/developers/oauth-2-0-authentication)
- **Rate limits:** Two limits apply per authenticated user, shared across all tokens for that user:
  - **5,000 requests/hour** — ample for heartbeat agents (~5-10 calls per heartbeat cycle)
  - **250,000 complexity points/hour** — each GraphQL property costs 0.1 points, each object 1 point, and connections multiply by pagination size (default 50). A typical `issues(first: 50)` query with 10 fields per issue costs 50 × (10 × 0.1 + 1) = 100 points. The SDK's generated types help by requesting only declared fields. OAuth apps with Actor Authorization may receive dynamically increased limits based on workspace paid users.
  - **Response headers** for monitoring: `X-RateLimit-Requests-Remaining`, `X-RateLimit-Requests-Reset` (UTC epoch **milliseconds**), `X-Complexity`, `X-RateLimit-Complexity-Remaining`, `X-RateLimit-Complexity-Reset`. Endpoint-specific headers are prefixed with `X-RateLimit-Endpoint-*`.
  - **Important:** Rate-limited responses return HTTP **400** (not 429) with `RATELIMITED` in GraphQL error extensions. The CLI must check the error code in the response body, not rely on HTTP status codes.
  - Ref: [Linear Rate Limiting](https://linear.app/developers/rate-limiting)
- **Permission revocation:** Workspace admins can modify or revoke an agent's team access at any time. If this happens, API calls will return authorization errors. The CLI should surface these clearly (not silently fail).
- **Workspace ID:** Retrieved via `viewer { id }` after OAuth setup and stored in the credentials file. Used to identify the agent's installation across API calls.

### Error Handling Strategy

The CLI should **fail fast** rather than retry indefinitely. Agents run on hourly heartbeats — if a command fails, the agent can retry on its next cycle. Long retry loops risk hitting OpenClaw's shell execution timeouts (auto-backgrounds after 10s, kills after 30min).

**GraphQL partial success:** Linear GraphQL can return HTTP 200 with partial data and an `errors` array. The CLI must check for errors on every response, even on 200.

**Error behavior by type:**

| Error | CLI Behavior | Exit Code |
|---|---|---|
| `RATELIMITED` (HTTP 400) | Wait for reset timestamp from `X-RateLimit-Requests-Reset` header (UTC epoch ms), retry **once**. If still limited, exit with error. | 1 |
| `AUTHENTICATION_ERROR` | Attempt token refresh, retry **once**. If refresh fails, exit with error suggesting `auth setup`. | 2 |
| `FORBIDDEN` | Exit immediately with clear message (agent may have lost team access). | 3 |
| `InvalidInputLinearError` | Exit immediately, display the validation failure message. | 4 |
| Network error | Retry **once** after 2 seconds. If still failing, exit with error. | 5 |
| Partial success | Primary operation succeeded but follow-up failed (e.g., issue created but relation creation failed). Output the primary result and report failures. | 6 |

**Helpful resolution errors:** When `--assignee` or `--delegate` references a user or agent that doesn't exist, the CLI should include the list of valid assignable users/agents in the error message. This lets the calling agent self-correct without a separate `user list` round-trip. Example:

```
Error: No assignable user matching "market-analyst"
Available users and agents:
  eve            (app)   Eve — Orchestrator
  eric           (user)  Eric Bragas
```

**Design principle:** One retry per error, then fail with a clear exit code and message. The calling agent (not the CLI) decides whether to skip the task, try a different approach, or wait for the next heartbeat.

## API Capabilities Verification

Confirmed via the Linear MCP tool schemas (which reflect the GraphQL API):

| Capability | API Support | Field/Parameter |
|---|---|---|
| Create issue with delegation | Yes | `delegate` on `issueCreate` |
| Create issue with dependencies | Yes (separate call) | `issueRelationCreate` mutation after `issueCreate` |
| Update delegation | Yes | `delegate` on `issueUpdate` (nullable) |
| Update dependencies | Yes (separate call) | `issueRelationCreate` / `issueRelationDelete` mutations |
| Filter issues by delegate | Yes | `delegate` filter on `issues` query |
| Filter issues by assignee | Yes | `assignee` filter on `issues` query |
| Filter issues by state | Yes | `state` filter on `issues` query |
| Filter issues by label | Yes | `label` filter on `issues` query |
| Comment with @mentions | Yes | `@AgentName` in comment body text |
| Comment replies | Yes | `parentId` on `commentCreate` |
| `createAsUser` override | Yes | On `issueCreate`, `commentCreate` (actor=app only) |
| `displayIconUrl` override | Yes | On `issueCreate`, `commentCreate` (actor=app only) |

### Requires Verification During Implementation

| Capability | Expected API | Notes |
|---|---|---|
| Delegate filter on issues | `filter: { delegate: { id: { eq: "..." } } }` | Confirmed in MCP schema; verify with `actor=app` token |

Notification APIs confirmed in SDK types: `notifications` query (with `NotificationFilter`), `notificationArchive` mutation, `notificationUpdate` mutation. **Note:** `NotificationFilter` supports `archivedAt` but does NOT support `readAt` — the CLI uses archive-based processing (see `inbox` command section).

## References

- **Linear SDK (official):** [@linear/sdk on npm](https://www.npmjs.com/package/@linear/sdk) — TypeScript SDK, auto-generated from GraphQL schema. Only official SDK (no Python SDK).
- **Linear GraphQL API:** [linear.app/developers/graphql](https://linear.app/developers/graphql) — Schema explorable via [Apollo Studio](https://studio.apollographql.com/public/Linear-API/variant/current/schema/reference)
- **Linear OAuth 2.0:** [linear.app/developers/oauth-2-0-authentication](https://linear.app/developers/oauth-2-0-authentication) — OAuth flow, scopes, token expiry, client credentials grant. Our agents use `read,write,app:assignable,app:mentionable` (`write` covers issue/comment creation; narrower scopes like `issues:create` exist for restricted-access apps but are not needed here).
- **Linear OAuth Actor Authorization:** [linear.app/developers/oauth-actor-authorization](https://linear.app/developers/oauth-actor-authorization) — `actor=app` mode, `createAsUser`, `displayIconUrl`
- **Linear Agent Interaction SDK:** [linear.app/developers/agent-interaction](https://linear.app/developers/agent-interaction) — Agent sessions, activities, webhooks (future enhancement, not in initial CLI scope)
- **Linear Agent Demo (reference implementation):** [github.com/linear/linear-agent-demo](https://github.com/linear/linear-agent-demo)
- **schpet/linear-cli (reference CLI):** [github.com/schpet/linear-cli](https://github.com/schpet/linear-cli) — Deno-based Linear CLI for developers. Personal API key auth only. Useful reference for UX patterns but lacks agent identity, delegation, dependency, and notification features.
- **schpet/linear-cli AI skill (reference skill):** [skills.sh/schpet/linear-cli/linear-cli](https://skills.sh/schpet/linear-cli/linear-cli) — Skill file teaching AI agents to use the schpet CLI. Starting point for building our own agent skill for this CLI.
- **Linear MCP Server:** [linear.app/docs/mcp](https://linear.app/docs/mcp) — Hosted MCP server. Useful for interactive Claude Code sessions but does not support per-agent config in OpenClaw today.
