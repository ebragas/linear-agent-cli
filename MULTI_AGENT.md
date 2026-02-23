# Multi-Agent Collaboration System Design

This document tracks the design and requirements for the OpenClaw multi-agent collaboration system running on this Mac mini.

## Vision

A collaborative multi-agent system where specialized agents work semi-autonomously on tasks, coordinated through a shared task management system with human oversight. Agents wake up on a heartbeat, check for work, execute, and report back.

## Requirements

### Core Components

1. **Individual agent workspaces** — each agent has its own workspace directory with identity, personality, tools, and memory
2. **Heartbeat loop** — OpenClaw's native heartbeat triggers agent sessions on a schedule; agents read `HEARTBEAT.md` for instructions, check Linear for work, execute, and update task state
3. **Task management system** — central coordination layer (external SaaS tool)
4. **Knowledge management** — persistent, curated information that agents produce and consume
5. **Human oversight** — web UI for visibility, task management, comments, and approvals

### Task Management Requirements

- Task creation, assignment, dependencies (blocking/blocked-by)
- Comments and @mentions (agent-to-agent, human-to-agent)
- CLI or API access (agents interact programmatically)
- Web UI (human can see state, comment, create, approve)
- Agent identity (each agent has a distinct presence)
- Approval workflows for major decisions

### Assignment vs. Delegation (Linear Model)

Linear separates **ownership** from **work**:
- **Assignee** — the human who owns the issue and is accountable for its completion. One person at a time.
- **Delegate** — an agent (OAuth app) that works on the issue on the assignee's behalf. Agent-specific; you can't delegate to human teammates.

An issue can have both simultaneously. When a human "assigns" an agent via the Linear UI, it sets the agent as the **delegate**, not the assignee — the human retains ownership. Both appear in "My Issues" views.

This maps cleanly to our semi-autonomous model: humans own the outcomes, agents do the work.

Ref: [Assign and delegate issues – Linear Docs](https://linear.app/docs/assigning-issues)

### Agent Identity Convention

Each agent uses a single lowercase identifier across all systems:

| System | Field | Example |
|--------|-------|---------|
| Linear OAuth app | Display name | "Eve" |
| CLI `--agent` flag | Credentials filename | `eve` |
| Git | `GIT_AUTHOR_NAME` | `eve` |
| Git | `GIT_AUTHOR_EMAIL` | `eve@openclaw.local` |
| OpenClaw | `agents.list[*].id` | `eve` |
| Workspace | `TOOLS.md` Linear section | `eve` |

**How agents know their Linear ID:** Each agent's `TOOLS.md` (injected into every session, including heartbeats) declares the agent's Linear identity. This keeps `HEARTBEAT.md` generic across all agents — the agent reads its identity from `TOOLS.md` and passes `--agent <id>` when running CLI commands.

```markdown
<!-- In each agent's TOOLS.md -->
## Linear
Your Linear agent ID is `eve`. Use `--agent eve` when running `linear` commands.
```

OpenClaw does not support per-agent environment variables in non-Docker mode, so workspace files are the mechanism for per-agent configuration.

**Commit messages for Linear tasks** should reference the issue ID:
```
MAIN-42: market analysis for competitor X
```

This links git history to Linear issues and makes it easy to trace what work an agent did and why.

### Autonomy Model: Semi-Autonomous

- Agents can create tasks and suggest assignments
- Agents can execute routine work independently
- **Major decisions require human approval**: strategy changes, significant content creation, anything affecting other agents' priorities
- Human creates high-level objectives; agents decompose into subtasks

### Information Architecture

Three distinct layers of stored information:

#### 1. Memory (Short-term, per-agent)
- What an agent was working on, past requests, session context
- Per-agent, not shared across the organization
- Lives in each agent's workspace (`workspace/memory/`)
- **Two complementary layers, both built into OpenClaw:**
  - **Session memory** (already enabled) — the `session-memory` hook saves conversation summaries to `workspace/memory/YYYY-MM-DD-slug.md` on `/new` or `/reset`. Creates the memory files.
  - **Memory search** (needs embedding provider) — OpenClaw's native `memorySearch` indexes all memory files and exposes a `memory_search` tool to the agent during sessions. Supports hybrid BM25 + vector semantic search, MMR re-ranking, and temporal decay. Stored in per-agent SQLite databases.
- **Embedding provider options** (configured via `agents.defaults.memorySearch` in `openclaw.json`):
  - `"provider": "gemini"` — use existing Google API key (simplest, already have credentials)
  - `"provider": "local"` — EmbeddingGemma 300M GGUF (~0.6GB, auto-downloaded, no API key needed)
  - `"provider": "openai"` with custom `baseUrl` — Ollama or any OpenAI-compatible endpoint
- **memsearch/mem0 are not needed** — OpenClaw's built-in system covers vector embeddings, hybrid search, embedding caching, file watching with auto-reindex, and per-agent isolation

#### 2. Knowledge (Long-term, organizational)
- Institutional knowledge built by the team: market research, competitive analysis, R&D findings, strategic insights
- Shared across all agents — the organizational "brain"
- Agents produce and consume knowledge collaboratively
- Markdown files with YAML frontmatter, browsed via Obsidian.md (knowledge graph, backlinks, tags)
- Git-native for disaster recovery
- **Location TBD** — may be a separate git repo outside agent workspaces (shared location with subdirectories mirroring workspace structure), or a directory within this repo. Decision pending.

#### 3. Documentation (Declarative, human-maintained)
- Outputs of larger processes: brand guidelines, supplement formulas, SOPs, product specs
- Primarily created and maintained by humans; consumed by agents as reference material
- More static than knowledge; changes less frequently
- Storage TBD — markdown may be sufficient initially; Notion or similar if richer editing is needed later

### Heartbeat

OpenClaw's gateway has a **native heartbeat mechanism**. The gateway periodically sends a message to the agent, starting a new session. The agent reads `HEARTBEAT.md` from its workspace, executes the checklist, and either reports findings or responds `HEARTBEAT_OK`. The `session-memory` hook saves a summary when the session ends.

The Linear CLI is a **tool available during heartbeat sessions** — not the heartbeat itself. `HEARTBEAT.md` contains the instructions; the CLI executes them.

- Default frequency: every hour (configurable per agent)
- **Staggering:** Each agent is assigned a fixed minute offset in increments of 10 when created. Offsets never change — new agents pick the next unused slot. This avoids concurrent LLM sessions on the gateway (the real bottleneck, not Linear rate limits).

| Agent | Offset | Notes |
|-------|--------|-------|
| Eve | :00 | |
| Market Analyst | :10 | |
| R&D | :20 | |
| Content Analyst | :30 | |
| Video Animator | :40 | |

10-minute spacing supports 6 agents/hour. Drop to 5-minute spacing if more are needed.

#### End-to-End Heartbeat Flow (with Linear)

```
1. OpenClaw gateway triggers heartbeat on schedule
2. New agent session starts; workspace files injected into system prompt
     (AGENTS.md, SOUL.md, IDENTITY.md, TOOLS.md, HEARTBEAT.md, etc.)
3. Agent reads HEARTBEAT.md — instructions say "Check Linear for work"
4. Agent reads TOOLS.md for its Linear agent ID (e.g., "eve")
5. Agent runs: linear inbox --agent eve --format json
5. Agent picks the highest-priority item from inbox
6. Agent processes that single item:
   a. Read the issue:     linear issue get MAIN-XX --format json
   b. Do the work         (research, writing, code, knowledge artifacts, etc.)
   c. Update status:      linear issue transition MAIN-XX "Done"
   d. Post results:       linear comment add MAIN-XX --body "..."
7. Dismiss processed notification:  linear inbox dismiss <id>
8. Agent responds to OpenClaw with summary or HEARTBEAT_OK
9. Session ends → session-memory hook saves summary to workspace/memory/
10. Remaining inbox items are picked up on subsequent heartbeats
```

**Open question: single-task vs. multi-task per heartbeat.** Agent sessions have a limited context window. Processing multiple inbox items in one session risks exhausting context or degrading quality on later items. The safer default is **one task per heartbeat** — the agent picks the most important item, does it well, and leaves the rest for the next cycle. With hourly heartbeats this may be too slow for a busy inbox; if so, we can experiment with:
- Processing 2-3 small items per session (e.g., quick comment replies) while limiting deep work to one item
- Increasing heartbeat frequency for busy agents
- Letting the agent judge based on item complexity

This needs experimentation once the system is running.

#### HEARTBEAT.md Template (Linear-Integrated Agent)

```markdown
## Heartbeat Checklist

1. Check Linear inbox for new assignments, mentions, and delegation events
2. Pick the highest-priority actionable item (prefer in-progress work over new assignments)
3. Process that item fully — do the work, update status, post results
4. If time and context allow, handle one more small item (e.g., a quick comment reply)
5. Post checkpoint comments on active issues at meaningful points
6. If nothing needs attention: HEARTBEAT_OK
```

#### Failure During Heartbeat

If Linear is unreachable during a heartbeat:
1. Log the failure (network error, rate limit, auth error)
2. Proceed with other heartbeat tasks (if any)
3. On next heartbeat, retry automatically
4. If auth errors persist across multiple heartbeats, alert the human via the OpenClaw channel

## Decisions Made

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Task management | Linear | Best agent-native features (Agent Interaction SDK, approval workflow via awaitingInput) |
| Autonomy level | Semi-autonomous | Agents work independently but major decisions need approval |
| Heartbeat frequency | Hourly (default) | Balance between responsiveness and API cost |
| Initial agent | Eve first | Prove task management + heartbeat end-to-end with small tasks; Dragon Labs agents migrate from Claude Code later |
| Knowledge (organizational) | Obsidian.md + markdown in git | Location TBD (may be separate repo); agents write markdown, Obsidian provides graph view |
| Memory (per-agent) | OpenClaw native (session-memory hook + memorySearch) | Session memory already enabled; semantic search needs embedding provider configured in `openclaw.json` |
| Documentation (declarative) | TBD (markdown initially, Notion if needed later) | Deferred — no concrete need yet |

## Decisions Pending

| Decision | Options | Notes |
|----------|---------|-------|
| Dragon Labs agent migration | Market Analyst and R&D already running via Claude Code + Obsidian | Migrate into OpenClaw once core system is proven |
| Linear plan/pricing | Free (250 issues) vs. Basic ($8/user/month) | Agents don't consume seats (`actor=app`); 250-issue limit is the real constraint |
| Knowledge directory organization | By domain, by agent, or flat with tags | Conventions TBD |
| Documentation storage | Markdown initially; revisit when a concrete need arises | Notion or similar if richer editing required |

---

## Research: Task Management

### Options Evaluated

#### Linear
- **Best SaaS option.** Native Agent Interaction SDK with lifecycle states (pending, active, error, awaitingInput, complete). OAuth Actor authorization lets agents have their own identity. Official MCP server (32+ tools). 5,000 req/hr rate limit.
- **Concerns:** No self-hosting (data in Linear's cloud). Free tier limited to 250 active issues. No git-native disaster recovery. (Note: agents using `actor=app` OAuth do not consume billable seats — the 250-issue limit is the real constraint on the free tier.)
- **Approval workflow:** Agent sessions support `awaitingInput` state — maps directly to approval gates.

#### GitHub Projects / Issues
- **Zero-cost, zero-setup.** Already on GitHub (ebragas), gh CLI installed. Full issue CRUD from CLI. Issue dependencies now GA (blocking/blocked-by). 5,000 req/hr.
- **Concerns:** No native agent identity (would need GitHub App or conventions). Projects v2 API is GraphQL-heavy. Dependency API still maturing. Web UI not as polished for pure task management.
- **Approval workflow:** Could use PR review patterns or labels.

#### Plane (Self-Hosted)
- **Best self-hosted option.** Open-source Linear alternative. Native MCP server (76 tools). Agent framework with @mention support. Full data sovereignty. Rate limits configurable (you own the server).
- **Concerns:** Requires Docker. Minimum 4GB RAM (Postgres + Redis + MinIO + RabbitMQ). On 16GB Mac mini with gateway + agents, resources get tight. More maintenance overhead.
- **Approval workflow:** Custom states/labels.

#### TICK.md
- **Most architecturally aligned.** Zero-infrastructure, git-native markdown protocol for multi-agent task coordination. Claim-execute-release pattern prevents duplicate work. MCP server included. MIT license.
- **Concerns:** Very new/immature. No comments/discussion threads. Limited UI polish. Single markdown file has scaling limits. Small community.
- **Approval workflow:** Would need custom implementation.

#### Not Recommended
- **Notion** — 3 req/sec rate limit shared across all agents; no task dependencies; no agent identity
- **Todoist** — no task dependencies
- **Vikunja** — too simple; lacks agent identity and @mentions

### Design Considerations

1. **Stagger heartbeats** — agents checking in simultaneously will spike API usage
2. **Task claiming** — Linear's assignee/delegate model prevents conflicts naturally. Delegation is explicit and agent-specific: each issue is delegated to exactly one agent. Staggered heartbeats make collision on undelegated tasks extremely unlikely.
3. **Cost at scale** — agents don't consume seats (`actor=app`), but free tier is limited to 250 active issues
4. **Task decomposition** — agents will break tasks into subtasks; system must support this via API
5. **Graceful degradation** — if SaaS is down, agents can't check in; if self-hosted crashes, everything stops; git-native degrades most gracefully
6. **Memory vs. tasks** — keep separate; tasks are "what needs to be done," memory is "what has been done and learned"
7. **Notification routing** — heartbeat polling is simplest and most reliable for this setup

---

## Research: Knowledge Management

### Options Evaluated

#### Structured Markdown in Git (Recommended Foundation)
- **Zero infrastructure.** Agents write markdown files with YAML frontmatter (title, author, tags, status, related). Full-text search via ripgrep. Git-native DR.
- **Pattern:** Knowledge directory with subdirectories by domain. Each agent writes its own files. `_index.md` as a manifest.
- **Concurrent writes:** Safe — agents write separate files by convention. Git merges trivially.
- **Discovery:** Frontmatter queries, full-text search, index file.
- **Limitation:** No semantic search, no knowledge graph visualization, no rich UI.

#### Obsidian as a Viewer Layer
- **Not the primary write path — a human-facing viewer.** Point a vault at the knowledge directory. Knowledge graph, backlinks, tags for human browsing. Sync to personal devices via git or iCloud.
- **Critical detail:** Obsidian has no headless mode. Requires the desktop app running for its REST API. But since this is a desktop macOS machine, it can run as a background app.
- **MCP servers exist** (cyanheads/obsidian-mcp-server, Claudesidian) but depend on the Local REST API plugin.
- **Key insight:** Agents don't need Obsidian — they write directly to the filesystem. Obsidian is purely for human consumption.

#### Semantic Search: qmd
- **[qmd](https://github.com/tobi/qmd):** Local search engine for markdown knowledge bases. Hybrid BM25 + vector semantic + LLM re-ranking. SQLite-backed, no heavy infrastructure. MCP server built in for direct agent access. HTTP transport allows a shared server across all agents. ~2GB of local GGUF models (auto-downloaded).
- Indexes markdown into 900-token chunks with overlap. Supports keyword, semantic, and hybrid search modes.
- Output formats: CLI, JSON, CSV, Markdown, XML — suitable for agent consumption.

#### Blackboard Architecture Pattern
- The most relevant multi-agent pattern. A shared knowledge base that all agents read/write. No direct agent-to-agent communication needed — the knowledge base mediates.
- Maps to: `the knowledge directory` IS the blackboard. Agents contribute partial solutions based on expertise.

#### Not Recommended (For Now)
- **Notion** — 180 req/min shared, not git-native, vendor lock-in
- **Mem0 / memsearch** — unnecessary; OpenClaw's native memorySearch covers vector embeddings, hybrid search, and per-agent isolation
- **Neo4j / Knowledge Graph DB** — overkill, resource-heavy

### Chosen Architecture

```
Knowledge:      Markdown in git + Obsidian.md as viewer (location TBD — may be separate repo)
Memory:         OpenClaw native — session-memory hook (writes) + memorySearch (semantic recall)
Documentation:  TBD (markdown initially; Notion or similar if richer editing needed later)
Search:         qmd for knowledge (hybrid BM25 + vector + LLM re-ranking, local, MCP server)
                OpenClaw memorySearch for per-agent memory (hybrid BM25 + vector, built-in)
```

### Knowledge File Schema

```yaml
---
title: "Document Title"
created: 2026-02-22
updated: 2026-02-22
author: agent-name
tags: [domain, topic, subtopic]
status: draft | review | final
related:
  - path/to/related-doc.md
task_ref: "TASK-123"  # link to originating task
---
```

---

## Agent Roster

| Agent | Role | Status |
|-------|------|--------|
| Eve | Orchestrator, creative partner, life manager | Bootstrapped — proving Linear + heartbeat integration first |
| Market Analyst | Market trends, competitor analysis, consumer insights | Existing Claude Code + Obsidian system; migrate to OpenClaw later |
| R&D | Formulation research, ingredient analysis, product development | Existing Claude Code + Obsidian system; migrate to OpenClaw later |
| Content Analyst | Content strategy, brand voice, content calendar | Planned |
| Video Animator | Video content creation and animation | Planned |

**Rollout plan:** Eve proves the task management + heartbeat loop end-to-end with small personal tasks. Dragon Labs agents (Market Analyst, R&D, etc.) already operate via Claude Code with skills and an Obsidian knowledge base — they'll migrate into the OpenClaw architecture once the core system is proven.

---

## Open Questions

1. ~~Which 1-2 agents to start with beyond Eve?~~ → Eve first; Dragon Labs agents migrate later
2. ~~Should agents communicate directly?~~ → No; Linear comments/@mentions are sufficient for batch workers
3. How to model "major decision" approval gates in Linear (awaitingInput agent state vs. custom labels)?
4. qmd setup — index `the knowledge directory`, configure MCP server for agents
5. How to handle agent failures (heartbeat runs but task fails)?
6. ~~How many Linear seats are needed?~~ → Agents don't consume seats (`actor=app`); each agent is a separate OAuth app
7. Knowledge directory organization conventions?

---

## References

- [Linear Agent Interaction SDK](https://linear.app/developers/agent-interaction)
- [Linear MCP Server](https://linear.app/docs/mcp)
- [GitHub Issue Dependencies](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/creating-issue-dependencies)
- [GitHub Agentic Workflows](https://github.github.io/gh-aw/)
- [Plane Self-Hosted](https://plane.so/self-hosted)
- [Plane MCP Server](https://github.com/makeplane/plane-mcp-server)
- [TICK.md Protocol](https://www.tick.md/)
- [qmd - Query Markup Documents](https://github.com/tobi/qmd)
- [memsearch by Zilliz](https://github.com/zilliztech/memsearch)
- [Obsidian MCP Server (cyanheads)](https://github.com/cyanheads/obsidian-mcp-server)
- [Blackboard Architecture for Multi-Agent AI](https://www.doairight.org/posts/pat-blackboard-ai/)
- [A2A Protocol](https://a2a-protocol.org/latest/)
- [CrewAI Memory System](https://docs.crewai.com/en/concepts/memory)
