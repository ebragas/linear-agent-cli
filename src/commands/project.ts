import { Command } from "commander";
import { readCredentials, getCredentialsDir } from "../credentials.js";
import { createClient } from "../client.js";
import { getFormat, printResult } from "../output.js";

export function registerProjectCommands(program: Command): void {
  const project = program
    .command("project")
    .description("Project queries");

  project
    .command("list")
    .description("List projects")
    .option("--team <team>", "Filter by team")
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
        filter.accessibleTeams = { name: { eqIgnoreCase: opts.team } };
      }

      const result = await client.projects({
        filter: Object.keys(filter).length > 0 ? filter : undefined,
      });

      const projects = result.nodes.map((p) => ({
        id: p.id,
        name: p.name,
        state: p.state,
        progress: p.progress,
        startDate: p.startDate ?? null,
        targetDate: p.targetDate ?? null,
      }));

      const format = getFormat(globalOpts.format);
      printResult({ data: projects }, format);
    });

  project
    .command("get")
    .description("Get project details")
    .argument("<id>", "Project ID")
    .action(async (id: string, _opts, cmd) => {
      const globalOpts = cmd.optsWithGlobals();
      const agent = globalOpts.agent;
      if (!agent) {
        console.error("Error: --agent is required (or set LINEAR_AGENT_ID env var)");
        process.exit(4);
      }
      const credentialsDir = getCredentialsDir(globalOpts);
      const credentials = readCredentials(agent, credentialsDir);
      const client = createClient(credentials);

      const p = await client.project(id);

      const format = getFormat(globalOpts.format);
      printResult(
        {
          data: {
            id: p.id,
            name: p.name,
            description: p.description ?? null,
            state: p.state,
            progress: p.progress,
            startDate: p.startDate ?? null,
            targetDate: p.targetDate ?? null,
          },
        },
        format,
      );
    });
}
