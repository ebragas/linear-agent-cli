import { Command } from "commander";
import { readCredentials, getCredentialsDir } from "../credentials.js";
import { createClient } from "../client.js";
import { getFormat, printResult } from "../output.js";

export function registerTeamCommands(program: Command): void {
  const team = program
    .command("team")
    .description("Team queries");

  team
    .command("list")
    .description("List all teams")
    .action(async (_opts, cmd) => {
      const globalOpts = cmd.optsWithGlobals();
      const agent = globalOpts.agent;
      if (!agent) {
        console.error("Error: --agent is required (or set LINEAR_AGENT_ID env var)");
        process.exit(4);
      }
      const credentialsDir = getCredentialsDir(globalOpts);
      const credentials = readCredentials(agent, credentialsDir);
      const client = createClient(credentials);

      const result = await client.teams();
      const teams = result.nodes.map((t) => ({
        id: t.id,
        key: t.key,
        name: t.name,
        description: t.description ?? null,
      }));

      const format = getFormat(globalOpts.format);
      printResult({ data: teams }, format);
    });

  team
    .command("members")
    .description("List members of a team")
    .argument("<team>", "Team name or key")
    .action(async (teamName: string, _opts, cmd) => {
      const globalOpts = cmd.optsWithGlobals();
      const agent = globalOpts.agent;
      if (!agent) {
        console.error("Error: --agent is required (or set LINEAR_AGENT_ID env var)");
        process.exit(4);
      }
      const credentialsDir = getCredentialsDir(globalOpts);
      const credentials = readCredentials(agent, credentialsDir);
      const client = createClient(credentials);

      const teams = await client.teams({
        filter: { name: { eqCaseInsensitive: teamName } },
      });
      let team = teams.nodes[0];
      if (!team) {
        // Try by key
        const byKey = await client.teams({
          filter: { key: { eq: teamName.toUpperCase() } },
        });
        team = byKey.nodes[0];
      }
      if (!team) {
        console.error(`Error: Team "${teamName}" not found`);
        process.exit(4);
      }

      const members = await team.members();
      const memberData = members.nodes.map((m) => ({
        id: m.id,
        name: m.name,
        displayName: m.displayName,
        email: m.email ?? null,
        active: m.active,
      }));

      const format = getFormat(globalOpts.format);
      printResult({ data: memberData }, format);
    });
}
