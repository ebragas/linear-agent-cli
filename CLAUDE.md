# CLAUDE.md

> Think carefully and implement the most concise solution that changes as little code as possible.

## Linear Integration

This project uses Linear for issue tracking. Your Linear agent ID is `claude-code-l1near-cli`.

### Starting work on an issue

1. Get issue details:
   ```bash
   linear issue get <identifier> --agent claude-code-l1near-cli --format json
   ```
2. Create a branch named after the issue identifier:
   ```bash
   git checkout -b main-<number>-<short-description>
   # e.g., git checkout -b main-26-fix-inbox-issue-reference
   ```
   Linear auto-links branches and PRs that contain the issue identifier.

3. Transition to In Progress:
   ```bash
   linear issue transition <identifier> "In Progress" --agent claude-code-l1near-cli
   ```

### Opening a pull request

Reference the issue identifier in the PR title or body so Linear links them automatically:

```bash
gh pr create \
  --title "MAIN-XX: short description" \
  --body "Fixes MAIN-XX\n\n## Summary\n..."
```

After opening the PR, post the URL as a comment on the Linear issue:
```bash
linear comment add <identifier> --body "PR opened: <pr-url>" --agent claude-code-l1near-cli
```

### Completing work

Transition to **In Review** when a PR is open and ready for review — do not mark Done until the PR is merged.

## Testing

Always run tests before committing:
```bash
npm test
```

## Code Style

Follow existing patterns in the codebase.
