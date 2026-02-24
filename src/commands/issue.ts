import { Command } from "commander";
import { readFileSync } from "fs";
import { LinearClient } from "@linear/sdk";
import { resolveUser, resolveState, parseTeamKey } from "../resolvers.js";
import { getFormat, printResult } from "../output.js";
import { PartialSuccessError, ValidationError } from "../errors.js";
import { runWithClient } from "../context.js";

function parseDate(value: string): string {
  // Support ISO-8601 durations like -P7D (7 days ago)
  const durationMatch = value.match(/^-P(\d+)D$/);
  if (durationMatch) {
    const days = parseInt(durationMatch[1], 10);
    const date = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    return date.toISOString();
  }
  // Assume ISO-8601 date string
  return new Date(value).toISOString();
}

type RelationType = "blocks" | "related";

async function createRelations(
  client: LinearClient,
  issueId: string,
  blocks: string[],
  blockedBy: string[],
  relatedTo: string[]
): Promise<{ succeeded: string[]; failed: string[]; warnings: string[] }> {
  const succeeded: string[] = [];
  const failed: string[] = [];
  const warnings: string[] = [];

  const relations: Array<{
    relatedIssueId: string;
    type: RelationType;
    label: string;
  }> = [];

  for (const targetId of blocks) {
    relations.push({
      relatedIssueId: targetId,
      type: "blocks",
      label: `blocks ${targetId}`,
    });
  }
  for (const targetId of blockedBy) {
    // blocked-by creates a blocks relation with reversed direction:
    // the TARGET blocks THIS issue, so we create the relation from the target
    relations.push({
      relatedIssueId: targetId,
      type: "blocks",
      label: `blocked-by ${targetId}`,
    });
  }
  for (const targetId of relatedTo) {
    relations.push({
      relatedIssueId: targetId,
      type: "related",
      label: `related-to ${targetId}`,
    });
  }

  for (const rel of relations) {
    try {
      if (rel.label.startsWith("blocked-by")) {
        // For blocked-by: the target blocks the source
        // Create relation where target is the issue and source is relatedIssue
        await client.createIssueRelation({
          issueId: rel.relatedIssueId,
          relatedIssueId: issueId,
          type: rel.type,
        });
      } else {
        await client.createIssueRelation({
          issueId,
          relatedIssueId: rel.relatedIssueId,
          type: rel.type,
        });
      }
      succeeded.push(rel.label);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      failed.push(rel.label);
      warnings.push(`Failed to create relation "${rel.label}": ${msg}`);
    }
  }

  return { succeeded, failed, warnings };
}

function collectArray(value: string, previous: string[]): string[] {
  return previous.concat([value]);
}

async function resolveLabels(
  client: LinearClient,
  labels: string[]
): Promise<string[]> {
  const labelIds: string[] = [];
  for (const l of labels) {
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(l)) {
      labelIds.push(l);
      continue;
    }
    const result = await client.issueLabels({
      filter: { name: { eqIgnoreCase: l } },
    });
    if (!result.nodes[0]) {
      throw new ValidationError(`No label matching "${l}"`);
    }
    labelIds.push(result.nodes[0].id);
  }
  return labelIds;
}

async function resolveProject(
  client: LinearClient,
  project: string
): Promise<string> {
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(project)) {
    return project;
  }
  const projects = await client.projects({
    filter: { name: { eqIgnoreCase: project } },
  });
  if (!projects.nodes[0]) {
    throw new ValidationError(`No project matching "${project}"`);
  }
  return projects.nodes[0].id;
}

async function resolveTeam(
  client: LinearClient,
  team: string
): Promise<string> {
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(team)) {
    return team;
  }
  const teams = await client.teams({
    filter: { name: { eqIgnoreCase: team } },
  });
  if (!teams.nodes[0]) {
    throw new ValidationError(`No team matching "${team}"`);
  }
  return teams.nodes[0].id;
}

export function registerIssueCommands(program: Command): void {
  const issue = program
    .command("issue")
    .description("Create, read, update, and search issues");

  // issue list
  issue
    .command("list")
    .description("List issues with filters")
    .option("--assignee <user>", "Filter by assignee (name, email, ID, or 'me')")
    .option("--delegate <agent>", "Filter by delegated agent")
    .option("--state <state>", "Filter by workflow state name or type")
    .option("--label <label>", "Filter by label name")
    .option("--team <team>", "Filter by team name or ID")
    .option("--project <project>", "Filter by project name or ID")
    .option("--priority <priority>", "Filter by priority (0-4)")
    .option("--query <text>", "Search title/description")
    .option("--created-after <date>", "ISO-8601 date or duration (e.g., -P7D)")
    .option("--updated-after <date>", "ISO-8601 date or duration")
    .option("--limit <n>", "Max results (default: 50, max: 250)", "50")
    .option("--include-archived", "Include archived issues")
    .action(async (opts, cmd) => {
      const globalOpts = cmd.optsWithGlobals();
      await runWithClient(globalOpts, async (client, { credentials }) => {
        const format = getFormat(globalOpts.format);

        const filter: Record<string, unknown> = {};

        if (opts.assignee) {
          const userId = await resolveUser(opts.assignee, credentials, client);
          filter.assignee = { id: { eq: userId } };
        }
        if (opts.delegate) {
          const userId = await resolveUser(opts.delegate, credentials, client);
          filter.delegate = { id: { eq: userId } };
        }
        if (opts.state) {
          filter.state = { name: { eqIgnoreCase: opts.state } };
        }
        if (opts.label) {
          filter.labels = { name: { eqIgnoreCase: opts.label } };
        }
        if (opts.team) {
          filter.team = { name: { eqIgnoreCase: opts.team } };
        }
        if (opts.project) {
          filter.project = { name: { eqIgnoreCase: opts.project } };
        }
        if (opts.priority) {
          filter.priority = { eq: parseInt(opts.priority, 10) };
        }
        if (opts.createdAfter) {
          filter.createdAt = { gte: parseDate(opts.createdAfter) };
        }
        if (opts.updatedAfter) {
          filter.updatedAt = { gte: parseDate(opts.updatedAfter) };
        }

        const limit = Math.min(parseInt(opts.limit, 10) || 50, 250);

        const queryOpts: Record<string, unknown> = {
          filter,
          first: limit,
          includeArchived: opts.includeArchived ?? false,
        };

        if (opts.query) {
          filter.or = [
            { title: { containsIgnoreCase: opts.query } },
            { description: { containsIgnoreCase: opts.query } },
          ];
        }

        const issues = await client.issues(queryOpts);

        const results = await Promise.all(
          issues.nodes.map(async (i) => {
            const state = await i.state;
            return {
              id: i.identifier,
              title: i.title,
              state: state?.name ?? null,
              priority: i.priority,
              url: i.url,
            };
          })
        );

        printResult({ data: results }, format);
      });
    });

  // issue get
  issue
    .command("get")
    .description("Get full issue details")
    .argument("<ids...>", "Issue identifier(s) (e.g., MAIN-42 MAIN-43)")
    .action(async (ids: string[], _opts, cmd) => {
      const globalOpts = cmd.optsWithGlobals();
      await runWithClient(globalOpts, async (client) => {
        const format = getFormat(globalOpts.format);

        const fetchIssue = async (id: string) => {
          const issueObj = await client.issue(id);
          const [state, assignee, delegate, labels, parent, children, comments, relations] =
            await Promise.all([
              issueObj.state,
              issueObj.assignee,
              issueObj.delegate,
              issueObj.labels(),
              issueObj.parent,
              issueObj.children(),
              issueObj.comments(),
              issueObj.relations(),
            ]);
          return {
            id: issueObj.identifier,
            title: issueObj.title,
            description: issueObj.description ?? null,
            state: state?.name ?? null,
            stateType: state?.type ?? null,
            assignee: assignee ? { id: assignee.id, name: assignee.name } : null,
            delegate: delegate ? { id: delegate.id, name: delegate.name } : null,
            labels: labels.nodes.map((l: { id: string; name: string }) => ({ id: l.id, name: l.name })),
            priority: issueObj.priority,
            priorityLabel: issueObj.priorityLabel,
            parent: parent ? { id: parent.identifier, title: parent.title } : null,
            children: children.nodes.map((c: { identifier: string; title: string }) => ({
              id: c.identifier,
              title: c.title,
            })),
            relations: relations.nodes.map((r: Record<string, unknown>) => ({
              type: r.type,
              relatedIssueId: r.relatedIssueId ?? null,
            })),
            comments: comments.nodes.map((c: { id: string; body: string; createdAt: string }) => ({
              id: c.id,
              body: c.body,
              createdAt: c.createdAt,
            })),
            dueDate: issueObj.dueDate ?? null,
            estimate: issueObj.estimate ?? null,
            url: issueObj.url,
          };
        };

        if (ids.length === 1) {
          const result = await fetchIssue(ids[0]);
          printResult({ data: result }, format);
        } else {
          const settled = await Promise.allSettled(ids.map(fetchIssue));
          const results: Awaited<ReturnType<typeof fetchIssue>>[] = [];
          const warnings: string[] = [];
          for (let i = 0; i < settled.length; i++) {
            const outcome = settled[i];
            if (outcome.status === "fulfilled") {
              results.push(outcome.value);
            } else {
              const msg = outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason);
              warnings.push(`${ids[i]}: ${msg}`);
            }
          }
          printResult({ data: results, warnings: warnings.length ? warnings : undefined }, format);
        }
      });
    });

  // issue create
  issue
    .command("create")
    .description("Create a new issue")
    .requiredOption("--title <text>", "Issue title")
    .requiredOption("--team <team>", "Team name or ID")
    .option("--description <text>", "Markdown description")
    .option("--description-file <path>", "Read description from file")
    .option("--assignee <user>", "Assign to user")
    .option("--delegate <agent>", "Delegate to agent")
    .option("--state <state>", "Initial workflow state")
    .option("--label <label>", "Add label (repeatable)", collectArray, [])
    .option("--priority <priority>", "Priority level (0-4)")
    .option("--project <project>", "Add to project")
    .option("--parent <id>", "Set parent issue")
    .option("--blocks <id>", "This issue blocks <id> (repeatable)", collectArray, [])
    .option("--blocked-by <id>", "This issue is blocked by <id> (repeatable)", collectArray, [])
    .option("--related-to <id>", "Related issue (repeatable)", collectArray, [])
    .option("--due-date <date>", "Due date (ISO format)")
    .option("--estimate <n>", "Effort estimate")
    .action(async (opts, cmd) => {
      const globalOpts = cmd.optsWithGlobals();
      await runWithClient(globalOpts, async (client, { credentials, agentId, credentialsDir }) => {
        const format = getFormat(globalOpts.format);

        // Resolve team
        const teamId = await resolveTeam(client, opts.team);

        const input: Record<string, unknown> = {
          title: opts.title,
          teamId,
        };

        // Description
        if (opts.descriptionFile) {
          input.description = readFileSync(opts.descriptionFile, "utf-8");
        } else if (opts.description) {
          input.description = opts.description;
        } else if (!process.stdin.isTTY) {
          try {
            const stdinContent = readFileSync(0, "utf-8").trim();
            if (stdinContent) input.description = stdinContent;
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.error(`Error: Failed to read from stdin: ${message}`);
            process.exit(4);
          }
        }

        // Assignee
        if (opts.assignee) {
          input.assigneeId = await resolveUser(
            opts.assignee,
            credentials,
            client
          );
        }

        // Delegate
        if (opts.delegate) {
          input.delegateId = await resolveUser(
            opts.delegate,
            credentials,
            client
          );
        }

        // State
        if (opts.state) {
          const team = await client.team(teamId);
          input.stateId = await resolveState(
            opts.state,
            team.key,
            client,
            agentId,
            credentialsDir
          );
        }

        // Labels
        if (opts.label && opts.label.length > 0) {
          input.labelIds = await resolveLabels(client, opts.label);
        }

        // Priority
        if (opts.priority !== undefined) {
          input.priority = parseInt(opts.priority, 10);
        }

        // Project
        if (opts.project) {
          input.projectId = await resolveProject(client, opts.project);
        }

        // Parent
        if (opts.parent) {
          input.parentId = opts.parent;
        }

        // Due date
        if (opts.dueDate) {
          input.dueDate = opts.dueDate;
        }

        // Estimate
        if (opts.estimate !== undefined) {
          input.estimate = parseInt(opts.estimate, 10);
        }

        const payload = await client.createIssue(input);
        const created = await payload.issue;

        const result: Record<string, unknown> = {
          id: created?.identifier ?? null,
          title: created?.title ?? opts.title,
          url: created?.url ?? null,
        };

        // Handle relations
        const blocks: string[] = opts.blocks ?? [];
        const blockedBy: string[] = opts.blockedBy ?? [];
        const relatedTo: string[] = opts.relatedTo ?? [];
        const hasRelations =
          blocks.length > 0 || blockedBy.length > 0 || relatedTo.length > 0;

        if (hasRelations && created) {
          const { succeeded, failed, warnings } = await createRelations(
            client,
            created.id,
            blocks,
            blockedBy,
            relatedTo
          );

          if (failed.length > 0) {
            result.relations = { succeeded, failed };
            printResult({ data: result, warnings }, format);
            throw new PartialSuccessError(
              `Issue created but some relations failed`,
              succeeded,
              failed
            );
          }

          if (succeeded.length > 0) {
            result.relations = { succeeded };
          }
        }

        printResult({ data: result }, format);
      });
    });

  // issue update
  issue
    .command("update")
    .description("Update an existing issue")
    .argument("<id>", "Issue identifier")
    .option("--title <text>", "Issue title")
    .option("--description <text>", "Markdown description")
    .option("--description-file <path>", "Read description from file")
    .option("--assignee <user>", 'Assign to user (pass "null" to clear)')
    .option("--delegate <agent>", 'Delegate to agent (pass "null" to clear)')
    .option("--state <state>", "Workflow state")
    .option("--label <label>", "Add label (repeatable)", collectArray, [])
    .option("--priority <priority>", "Priority level (0-4)")
    .option("--project <project>", "Add to project")
    .option("--parent <id>", 'Set parent issue (pass "null" to clear)')
    .option("--blocks <id>", "This issue blocks <id> (repeatable)", collectArray, [])
    .option("--blocked-by <id>", "This issue is blocked by <id> (repeatable)", collectArray, [])
    .option("--related-to <id>", "Related issue (repeatable)", collectArray, [])
    .option("--due-date <date>", "Due date (ISO format)")
    .option("--estimate <n>", "Effort estimate")
    .action(async (id, opts, cmd) => {
      const globalOpts = cmd.optsWithGlobals();
      await runWithClient(globalOpts, async (client, { credentials, agentId, credentialsDir }) => {
        const format = getFormat(globalOpts.format);

        const input: Record<string, unknown> = {};

        if (opts.title) {
          input.title = opts.title;
        }

        // Description
        if (opts.descriptionFile) {
          input.description = readFileSync(opts.descriptionFile, "utf-8");
        } else if (opts.description) {
          input.description = opts.description;
        } else if (!process.stdin.isTTY) {
          try {
            const stdinContent = readFileSync(0, "utf-8").trim();
            if (stdinContent) input.description = stdinContent;
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.error(`Error: Failed to read from stdin: ${message}`);
            process.exit(4);
          }
        }

        // Assignee (nullable)
        if (opts.assignee !== undefined) {
          if (opts.assignee === "null") {
            input.assigneeId = null;
          } else {
            input.assigneeId = await resolveUser(
              opts.assignee,
              credentials,
              client
            );
          }
        }

        // Delegate (nullable)
        if (opts.delegate !== undefined) {
          if (opts.delegate === "null") {
            input.delegateId = null;
          } else {
            input.delegateId = await resolveUser(
              opts.delegate,
              credentials,
              client
            );
          }
        }

        // State
        if (opts.state) {
          const teamKey = parseTeamKey(id);
          input.stateId = await resolveState(
            opts.state,
            teamKey,
            client,
            agentId,
            credentialsDir
          );
        }

        // Labels
        if (opts.label && opts.label.length > 0) {
          input.labelIds = await resolveLabels(client, opts.label);
        }

        // Priority
        if (opts.priority !== undefined) {
          input.priority = parseInt(opts.priority, 10);
        }

        // Project
        if (opts.project) {
          input.projectId = await resolveProject(client, opts.project);
        }

        // Parent (nullable)
        if (opts.parent !== undefined) {
          if (opts.parent === "null") {
            input.parentId = null;
          } else {
            input.parentId = opts.parent;
          }
        }

        // Due date
        if (opts.dueDate) {
          input.dueDate = opts.dueDate;
        }

        // Estimate
        if (opts.estimate !== undefined) {
          input.estimate = parseInt(opts.estimate, 10);
        }

        const payload = await client.updateIssue(id, input);
        const updated = await payload.issue;

        const result: Record<string, unknown> = {
          id: updated?.identifier ?? id,
          title: updated?.title ?? null,
          url: updated?.url ?? null,
        };

        // Handle relations
        const blocks: string[] = opts.blocks ?? [];
        const blockedBy: string[] = opts.blockedBy ?? [];
        const relatedTo: string[] = opts.relatedTo ?? [];
        const hasRelations =
          blocks.length > 0 || blockedBy.length > 0 || relatedTo.length > 0;

        if (hasRelations && updated) {
          const { succeeded, failed, warnings } = await createRelations(
            client,
            updated.id,
            blocks,
            blockedBy,
            relatedTo
          );

          if (failed.length > 0) {
            result.relations = { succeeded, failed };
            printResult({ data: result, warnings }, format);
            throw new PartialSuccessError(
              `Issue updated but some relations failed`,
              succeeded,
              failed
            );
          }

          if (succeeded.length > 0) {
            result.relations = { succeeded };
          }
        }

        printResult({ data: result }, format);
      });
    });

  // issue transition
  issue
    .command("transition")
    .description("Move issue to a workflow state by name")
    .argument("<id>", "Issue identifier (e.g., MAIN-42)")
    .argument("<state>", "Target workflow state name")
    .action(async (id, state, _opts, cmd) => {
      const globalOpts = cmd.optsWithGlobals();
      await runWithClient(globalOpts, async (client, { agentId, credentialsDir }) => {
        const format = getFormat(globalOpts.format);

        const teamKey = parseTeamKey(id);
        const stateId = await resolveState(
          state,
          teamKey,
          client,
          agentId,
          credentialsDir
        );

        const payload = await client.updateIssue(id, { stateId });
        const updated = await payload.issue;

        printResult(
          {
            data: {
              id: updated?.identifier ?? id,
              state,
              url: updated?.url ?? null,
            },
          },
          format
        );
      });
    });

  // issue search
  issue
    .command("search")
    .description("Full-text search via searchIssues")
    .argument("<query>", "Search query")
    .option("--team <team>", "Boost results for a specific team")
    .option("--include-comments", "Search within comment content")
    .option("--include-archived", "Include archived issues in results")
    .action(async (query, opts, cmd) => {
      const globalOpts = cmd.optsWithGlobals();
      await runWithClient(globalOpts, async (client) => {
        const format = getFormat(globalOpts.format);

        const searchOpts: Record<string, unknown> = {};
        if (opts.team) {
          searchOpts.teamId = await resolveTeam(client, opts.team);
        }
        if (opts.includeComments) {
          searchOpts.includeComments = true;
        }
        if (opts.includeArchived) {
          searchOpts.includeArchived = true;
        }

        const results = await client.searchIssues(query, searchOpts);

        const items = results.nodes.map((i) => ({
          id: i.identifier,
          title: i.title,
          url: i.url,
        }));

        printResult({ data: items }, format);
      });
    });

  // issue archive
  issue
    .command("archive")
    .description("Archive an issue")
    .argument("<id>", "Issue identifier")
    .action(async (id, _opts, cmd) => {
      const globalOpts = cmd.optsWithGlobals();
      await runWithClient(globalOpts, async (client) => {
        const format = getFormat(globalOpts.format);

        await client.archiveIssue(id);

        printResult(
          {
            data: {
              id,
              status: "archived",
            },
          },
          format
        );
      });
    });

  // issue delete
  issue
    .command("delete")
    .description("Delete an issue")
    .argument("<id>", "Issue identifier")
    .action(async (id, _opts, cmd) => {
      const globalOpts = cmd.optsWithGlobals();
      await runWithClient(globalOpts, async (client) => {
        const format = getFormat(globalOpts.format);

        await client.deleteIssue(id);

        printResult(
          {
            data: {
              id,
              status: "deleted",
            },
          },
          format
        );
      });
    });
}
