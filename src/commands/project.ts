import { Command } from "commander";
import { readFileSync } from "fs";
import { runWithClient } from "../context.js";
import { getFormat, printResult } from "../output.js";
import { resolveUser } from "../resolvers.js";

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
      await runWithClient(globalOpts, async (client) => {
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
    });

  project
    .command("get")
    .description("Get project details")
    .argument("<id>", "Project ID")
    .action(async (id: string, _opts, cmd) => {
      const globalOpts = cmd.optsWithGlobals();
      await runWithClient(globalOpts, async (client) => {
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
    });

  project
    .command("update")
    .description("Update project metadata")
    .argument("<id>", "Project ID")
    .option("--name <text>", "New project name")
    .option("--description <text>", "Project description (markdown)")
    .option("--description-file <path>", "Read description from file")
    .option("--start-date <date>", 'Start date (YYYY-MM-DD, or "null" to clear)')
    .option("--target-date <date>", 'Target date (YYYY-MM-DD, or "null" to clear)')
    .option("--lead <user>", 'Project lead (name, email, or "null" to clear)')
    .option("--priority <n>", "Priority (0=none, 1=urgent, 2=high, 3=normal, 4=low)")
    .action(async (id: string, opts, cmd) => {
      const globalOpts = cmd.optsWithGlobals();
      await runWithClient(globalOpts, async (client, { credentials }) => {
        const input: Record<string, unknown> = {};

        if (opts.name) {
          input.name = opts.name;
        }

        if (opts.descriptionFile) {
          input.description = readFileSync(opts.descriptionFile, "utf-8");
        } else if (opts.description) {
          input.description = opts.description;
        }

        if (opts.startDate !== undefined) {
          input.startDate = opts.startDate === "null" ? null : opts.startDate;
        }

        if (opts.targetDate !== undefined) {
          input.targetDate = opts.targetDate === "null" ? null : opts.targetDate;
        }

        if (opts.lead !== undefined) {
          if (opts.lead === "null") {
            input.leadId = null;
          } else {
            input.leadId = await resolveUser(opts.lead, credentials, client);
          }
        }

        if (opts.priority !== undefined) {
          const priority = parseInt(opts.priority, 10);
          if (isNaN(priority) || priority < 0 || priority > 4) {
            console.error(`Invalid value for --priority: "${opts.priority}". Expected an integer between 0 and 4.`);
            process.exit(1);
          }
          input.priority = priority;
        }

        const payload = await client.updateProject(id, input);
        const updated = await payload.project;

        const format = getFormat(globalOpts.format);
        printResult(
          {
            data: {
              id: updated?.id ?? id,
              name: updated?.name ?? null,
              url: updated?.url ?? null,
              success: payload.success,
            },
          },
          format,
        );
      });
    });
}
