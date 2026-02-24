---
name: linear_cli
description: Manage Linear issues, comments, notifications, and agent workflows via the @ebragas/linear-cli CLI.
metadata:
  openclaw:
    requires:
      bins: ["linear"]
---

# Linear CLI Agent Skill

This skill teaches you to use the `linear` CLI to interact with Linear as an authenticated agent entity (`actor=app`). Each agent is a distinct OAuth application with its own identity, credentials, and inbox.

## Critical Rules

1. **Always pass `--agent <id>`** on every command. You must know your agent ID before using this skill.
2. **Always use `--format json`** for commands that return data. Never parse text output.
3. **Use `--body-file` for multi-line content** — write to a temp file first; never pass markdown with bullets or code blocks via `--body`.

## Multi-line Content Pattern

For comments or issue descriptions containing markdown (bullets, code blocks, quotes):

```bash
# Write body to a temp file first
cat > /tmp/linear-body.md << 'EOF'
## Progress Update

- Completed authentication flow
- Tests passing

Next: deploy to staging.
EOF

# Use --body-file instead of --body
linear comment add MAIN-42 --body-file /tmp/linear-body.md --agent <id>
```

## Heartbeat Workflow

Run on each cycle to discover and process work:

```bash
AGENT="your-agent-id"

# 1. Check inbox for assignments, mentions, and delegations
linear inbox --agent $AGENT --format json

# 2. Check issues delegated to you
linear delegate list --agent $AGENT --format json

# 3. Pick up work
linear issue transition MAIN-42 "In Progress" --agent $AGENT
linear comment add MAIN-42 --body "Starting work on this." --agent $AGENT

# 4. Complete and hand off
linear issue transition MAIN-42 "Awaiting Review" --agent $AGENT
linear comment add MAIN-42 --body "Completed. Ready for review." --agent $AGENT

# 5. Dismiss processed notifications
linear inbox dismiss-all --agent $AGENT
```

## Command Reference

### Issue Commands

```bash
# Get full issue details (title, description, state, assignee, comments)
linear issue get <id> --agent <id> --format json

# List issues with filters
linear issue list --agent <id> --format json
linear issue list --assignee me --agent <id> --format json
linear issue list --state "In Progress" --agent <id> --format json
linear issue list --team Main --label bug --limit 20 --agent <id> --format json
linear issue list --delegate me --agent <id> --format json

# Create an issue
linear issue create \
  --title "Fix authentication timeout" \
  --team Main \
  --description "Short description" \
  --agent <id>

# Create with file description (preferred for long content)
linear issue create \
  --title "Fix authentication timeout" \
  --team Main \
  --description-file /tmp/issue-desc.md \
  --agent <id>

# Create with relations
linear issue create \
  --title "Subtask" \
  --team Main \
  --parent MAIN-42 \
  --blocks MAIN-50 \
  --agent <id>

# Transition state (parses team key from identifier automatically)
linear issue transition MAIN-42 "In Progress" --agent <id>
linear issue transition MAIN-42 "Awaiting Review" --agent <id>
linear issue transition MAIN-42 "Done" --agent <id>

# Update an issue
linear issue update MAIN-42 --assignee me --agent <id>
linear issue update MAIN-42 --delegate null --agent <id>  # clear delegation

# Full-text search across workspace
linear issue search "authentication timeout" --agent <id> --format json

# Archive / delete
linear issue archive MAIN-42 --agent <id>
linear issue delete MAIN-42 --agent <id>
```

### Comment Commands

```bash
# List comments on an issue
linear comment list MAIN-42 --agent <id> --format json

# Add a comment (short inline body — no special characters or newlines)
linear comment add MAIN-42 --body "PR opened: https://github.com/org/repo/pull/12" --agent <id>

# Add a comment from file (for any markdown content)
linear comment add MAIN-42 --body-file /tmp/comment.md --agent <id>

# Reply to a specific comment
linear comment add MAIN-42 --body "Addressed." --reply-to <comment-id> --agent <id>

# Update a comment
linear comment update <comment-id> --body-file /tmp/updated.md --agent <id>
```

### Inbox Commands

```bash
# List unprocessed notifications
linear inbox --agent <id> --format json

# Filter by category: assignments, mentions, statusChanges, commentsAndReplies
linear inbox --category assignments --agent <id> --format json
linear inbox --category mentions --agent <id> --format json

# Dismiss a single notification after processing
linear inbox dismiss <notification-id> --agent <id>

# Dismiss all unprocessed (run after processing all inbox items)
linear inbox dismiss-all --agent <id>
```

### Delegation Commands

```bash
# Delegate an issue to another agent
linear delegate MAIN-42 --to analyst --agent <id>

# List issues delegated to you (shortcut for issue list --delegate me)
linear delegate list --agent <id> --format json

# Remove delegation
linear delegate remove MAIN-42 --agent <id>
```

### Discovery Commands

```bash
# List all users and agents in workspace
linear user list --agent <id> --format json
linear user list --type app --agent <id> --format json  # agents only

# Find a user or agent by name/email
linear user search "eve" --agent <id> --format json

# List teams
linear team list --agent <id> --format json
linear team members Main --agent <id> --format json

# List projects
linear project list --agent <id> --format json
linear project list --team Main --agent <id> --format json

# List workflow states (check valid state names before transitioning)
linear state list --agent <id> --format json
linear state list --team Main --agent <id> --format json
```

### Attachment Commands

```bash
# Link a PR or external URL to an issue
linear attachment add MAIN-42 \
  --url "https://github.com/org/repo/pull/12" \
  --title "PR #12: Fix auth timeout" \
  --agent <id>

# List attachments on an issue
linear attachment list MAIN-42 --agent <id> --format json

# Remove an attachment
linear attachment remove <attachment-id> --agent <id>
```

## Output Format

List commands return a `results` array:

```json
{ "results": [{ "id": "MAIN-42", "title": "..." }] }
```

Single-item commands (get, create, transition) return a single object:

```json
{ "id": "MAIN-42", "state": "In Progress", "url": "https://linear.app/..." }
```

## Error Handling

| Exit Code | Error | Action |
|-----------|-------|--------|
| 0 | Success | Continue |
| 1 | Rate limited | Wait for reset timestamp in error, retry once |
| 2 | Authentication | Run `linear auth refresh --agent <id>`, retry once |
| 3 | Forbidden | Agent may have lost team access — stop and report to human |
| 4 | Validation | Check error message for the specific field issue |
| 5 | Network | Retry once after 2s |
| 6 | Partial success | Primary operation succeeded; read output for which relations failed |

If `auth refresh` fails, re-authenticate:

```bash
linear auth setup --client-credentials \
  --agent <id> \
  --client-id <client-id> \
  --client-secret <client-secret>
```
