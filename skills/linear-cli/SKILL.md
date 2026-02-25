---
name: linear-cli
description: Manage Linear issues, comments, notifications, and agent workflows via the @ebragas/linear-cli CLI.
metadata:
  openclaw:
    requires:
      bins: ["linear"]
---

# Linear CLI Agent Skill

CLI for agents to interact with Linear as an `actor=app` entity — distinct identity, inbox, and credentials per agent.

## Critical Rules

1. **`--agent <id>` on every command** — required on every call
2. **`--format json` on every read** — list commands return `{ "results": [...] }`, single-item commands return a plain object; never parse text output
3. **`--body-file` for multi-line content** — write body to a temp file first; never pass markdown with newlines via `--body`

## Multi-line Content

```bash
cat > /tmp/body.md << 'EOF'
## Update

- Item one
- Item two
EOF

linear comment add MAIN-42 --body-file /tmp/body.md --agent <id>
```

## Heartbeat Workflow

1. **Check inbox** — note each notification ID; dismiss by ID after processing (not `dismiss-all`)
   ```bash
   linear inbox --agent <id> --format json   # → .results[].id, .results[].issue.identifier
   ```

2. **Check delegated work**
   ```bash
   linear delegate list --agent <id> --format json
   ```

3. **Pick up an issue**
   ```bash
   linear issue transition MAIN-42 "In Progress" --agent <id>
   linear comment add MAIN-42 --body "Starting work." --agent <id>
   ```

4. **Complete and hand off** — @mention the assignee if present (`.assignee.name` from `issue get`)
   ```bash
   linear issue transition MAIN-42 "Awaiting Review" --agent <id>
   linear comment add MAIN-42 --body "Completed. @AssigneeName ready for your review." --agent <id>
   # If no assignee, omit the @mention
   ```

5. **Dismiss the specific notification** (ID from step 1)
   ```bash
   linear inbox dismiss <notification-id> --agent <id>
   ```

## Error Handling

| Exit | Error | Action |
|------|-------|--------|
| 1 | Rate limited | Wait for reset timestamp in error, retry once |
| 2 | Auth | `linear auth refresh --agent <id>`, retry once; if that fails, re-run `auth setup` |
| 3 | Forbidden | Stop — agent may have lost team access, report to human |
| 4 | Validation | Read error message for field details |
| 5 | Network | Retry once after 2s |
| 6 | Partial success | Primary succeeded; check output for which relations failed |

## Command Reference

See [commands.md](commands.md) for the full command reference: issue, comment, inbox, delegate, user/team/project discovery, and attachment commands (add, list, remove, upload).
