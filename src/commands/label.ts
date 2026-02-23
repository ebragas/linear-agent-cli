import { Command } from "commander";
import { readCredentials, getCredentialsDir } from "../credentials.js";
import { createClient } from "../client.js";
import { getFormat, printResult } from "../output.js";

export function registerLabelCommands(program: Command): void {
  const label = program
    .command("label")
    .description("Manage labels");

  label
    .command("list")
    .description("List all labels in the workspace")
    .option("--team <team>", "Filter by team name or ID")
    .action(async (opts, cmd) => {
      const globalOpts = cmd.optsWithGlobals();
      const agent = globalOpts.agent;
      if (!agent) {
        console.error("Error: --agent is required (or set LINEAR_AGENT_ID env var)");
        process.exit(4);
      }
      const credentialsDir = getCredentialsDir(globalOpts);
      const credentials = readCredentials(agent, credentialsDir);
      const client = createClient(credentials);

      const filter: Record<string, unknown> = {};
      if (opts.team) {
        filter.team = { name: { eqIgnoreCase: opts.team } };
      }

      const result = await client.issueLabels({
        filter: Object.keys(filter).length > 0 ? filter : undefined,
      });

      const labels = await Promise.all(
        result.nodes.map(async (l) => {
          const team = await l.team;
          return {
            id: l.id,
            name: l.name,
            color: l.color,
            team: team?.name ?? null,
          };
        }),
      );

      const format = getFormat(globalOpts.format);
      printResult({ data: labels }, format);
    });

  label
    .command("create")
    .description("Create a new label")
    .requiredOption("--name <text>", "Label name")
    .option("--color <hex>", "Label color as hex")
    .option("--team <team>", "Team for team-scoped label")
    .action(async (opts, cmd) => {
      const globalOpts = cmd.optsWithGlobals();
      const agent = globalOpts.agent;
      if (!agent) {
        console.error("Error: --agent is required (or set LINEAR_AGENT_ID env var)");
        process.exit(4);
      }
      const credentialsDir = getCredentialsDir(globalOpts);
      const credentials = readCredentials(agent, credentialsDir);
      const client = createClient(credentials);

      const input: Record<string, unknown> = { name: opts.name };
      if (opts.color) input.color = opts.color;

      if (opts.team) {
        const teams = await client.teams({
          filter: { name: { eqIgnoreCase: opts.team } },
        });
        const team = teams.nodes[0];
        if (!team) {
          console.error(`Error: Team "${opts.team}" not found`);
          process.exit(4);
        }
        input.teamId = team.id;
      }

      const result = await client.createIssueLabel(input as { name: string; color?: string; teamId?: string });

      const created = await result.issueLabel;
      const format = getFormat(globalOpts.format);
      printResult(
        {
          data: {
            id: created?.id,
            name: created?.name,
            color: created?.color,
          },
        },
        format,
      );
    });
}
