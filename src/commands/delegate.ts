import { Command } from "commander";
import { runWithClient } from "../context.js";
import { getFormat, printResult } from "../output.js";
import { resolveUser } from "../resolvers.js";

export function registerDelegateCommands(program: Command): void {
  const delegate = program
    .command("delegate")
    .description("Delegation shortcuts for assigning agents to issues");

  delegate
    .command("assign")
    .description("Delegate an issue to an agent")
    .argument("<issue-id>", "Issue identifier (e.g., TEAM-123)")
    .requiredOption("--to <agent>", "Agent name, email, ID, or 'me'")
    .action(async (issueId: string, opts, cmd) => {
      const globalOpts = cmd.optsWithGlobals();
      await runWithClient(globalOpts, async (client, { credentials }) => {
        const delegateId = await resolveUser(opts.to, credentials, client);
        await client.updateIssue(issueId, { delegateId });

        const format = getFormat(globalOpts.format);
        printResult(
          { data: { status: "delegated", issueId, delegateId } },
          format,
        );
      });
    });

  delegate
    .command("list")
    .description("List issues delegated to this agent")
    .action(async (_opts, cmd) => {
      const globalOpts = cmd.optsWithGlobals();
      await runWithClient(globalOpts, async (client, { credentials }) => {
        const result = await client.issues({
          filter: { delegate: { id: { eq: credentials.actorId } } },
        });

        const issueData = await Promise.all(
          result.nodes.map(async (issue) => {
            const state = await issue.state;
            const assignee = await issue.assignee;
            return {
              id: issue.identifier,
              title: issue.title,
              state: state?.name ?? null,
              assignee: assignee?.name ?? null,
              priority: issue.priority,
            };
          }),
        );

        const format = getFormat(globalOpts.format);
        printResult({ data: issueData }, format);
      });
    });

  delegate
    .command("remove")
    .description("Remove delegation from an issue")
    .argument("<issue-id>", "Issue identifier (e.g., TEAM-123)")
    .action(async (issueId: string, _opts, cmd) => {
      const globalOpts = cmd.optsWithGlobals();
      await runWithClient(globalOpts, async (client) => {
        await client.updateIssue(issueId, { delegateId: null });

        const format = getFormat(globalOpts.format);
        printResult(
          { data: { status: "delegation_removed", issueId } },
          format,
        );
      });
    });
}
