# Linear CLI Command Reference

All commands require `--agent <id>` and `--format json` for data output.

## Issue

```bash
linear issue get <id> --agent <id> --format json
linear issue get MAIN-42 MAIN-43 MAIN-44 --agent <id> --format json  # batch: returns array; per-ID errors reported as warnings, not failures
linear issue list --agent <id> --format json
linear issue list --assignee me --agent <id> --format json
linear issue list --state "In Progress" --agent <id> --format json
linear issue list --team Main --label bug --limit 20 --agent <id> --format json
linear issue list --delegate me --agent <id> --format json

linear issue create \
  --title "Fix authentication timeout" \
  --team Main \
  --description-file /tmp/desc.md \
  --agent <id>

# With relations (blocks/blocked-by create separate issueRelationCreate calls; partial failure possible — exit 6)
linear issue create --title "Subtask" --team Main --parent MAIN-42 --blocks MAIN-50 --agent <id>

linear issue transition MAIN-42 "In Progress" --agent <id>   # parses team key automatically
linear issue update MAIN-42 --assignee me --agent <id>
linear issue update MAIN-42 --delegate null --agent <id>      # pass "null" to clear nullable fields
linear issue search "authentication timeout" --agent <id> --format json
linear issue archive MAIN-42 --agent <id>
linear issue delete MAIN-42 --agent <id>
```

## Comment

```bash
linear comment list MAIN-42 --agent <id> --format json
linear comment add MAIN-42 --body "PR: https://github.com/org/repo/pull/12" --agent <id>
linear comment add MAIN-42 --body-file /tmp/comment.md --agent <id>
linear comment add MAIN-42 --body "Addressed." --reply-to <comment-id> --agent <id>
linear comment update <comment-id> --body-file /tmp/updated.md --agent <id>
```

## Inbox

```bash
linear inbox --agent <id> --format json
linear inbox --category assignments --agent <id> --format json
# categories: assignments, mentions, statusChanges, commentsAndReplies, reactions, reviews, appsAndIntegrations, triage, system
linear inbox dismiss <notification-id> --agent <id>
linear inbox dismiss-all --agent <id>
```

## Delegation

```bash
linear delegate assign MAIN-42 --to analyst --agent <id>
linear delegate list --agent <id> --format json      # issues delegated to you
linear delegate remove MAIN-42 --agent <id>
```

## Discovery

To @mention someone, use `@DisplayName` in comment body text. Find display names with:

```bash
linear user list --agent <id> --format json
linear user list --type app --agent <id> --format json   # agents only
linear user search "eve" --agent <id> --format json
linear team list --agent <id> --format json
linear team members Main --agent <id> --format json
linear project list --team Main --agent <id> --format json
linear state list --team Main --agent <id> --format json  # check valid state names before transitioning
```

## Attachment

```bash
linear attachment add MAIN-42 --url "https://github.com/org/repo/pull/12" --title "PR #12" --agent <id>
linear attachment list MAIN-42 --agent <id> --format json
linear attachment remove <attachment-id> --agent <id>
```
