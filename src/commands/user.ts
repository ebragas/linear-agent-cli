import { Command } from "commander";
import { readCredentials, getCredentialsDir } from "../credentials.js";
import { createClient } from "../client.js";
import { getFormat, printResult } from "../output.js";

export function registerUserCommands(program: Command): void {
  const user = program
    .command("user")
    .description("User and agent discovery");

  user
    .command("list")
    .description("List all users and agents in the workspace")
    .option("--type <type>", "Filter by entity type (user, app, bot)")
    .option("--team <team>", "Filter by team membership")
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

      let users;
      if (opts.team) {
        const teams = await client.teams({
          filter: { name: { eqCaseInsensitive: opts.team } },
        });
        const team = teams.nodes[0];
        if (!team) {
          console.error(`Error: Team "${opts.team}" not found`);
          process.exit(4);
        }
        const members = await team.members();
        users = members.nodes;
      } else {
        const result = await client.users();
        users = result.nodes;
      }

      let userData = users.map((u) => ({
        id: u.id,
        name: u.name,
        displayName: u.displayName,
        email: u.email ?? null,
        isMe: u.isMe ?? null,
        active: u.active,
      }));

      if (opts.type) {
        const type = opts.type.toLowerCase();
        userData = userData.filter((u) => {
          if (type === "app" || type === "bot") return !u.email;
          if (type === "user") return !!u.email;
          return true;
        });
      }

      const format = getFormat(globalOpts.format);
      printResult({ data: userData }, format);
    });

  user
    .command("search")
    .description("Search users/agents by name or email")
    .argument("<query>", "Search query")
    .action(async (query: string, _opts, cmd) => {
      const globalOpts = cmd.optsWithGlobals();
      const agent = globalOpts.agent;
      if (!agent) {
        console.error("Error: --agent is required (or set LINEAR_AGENT_ID env var)");
        process.exit(4);
      }
      const credentialsDir = getCredentialsDir(globalOpts);
      const credentials = readCredentials(agent, credentialsDir);
      const client = createClient(credentials);

      const result = await client.users();
      const queryLower = query.toLowerCase();
      const matches = result.nodes.filter(
        (u) =>
          u.name?.toLowerCase().includes(queryLower) ||
          u.email?.toLowerCase().includes(queryLower) ||
          u.displayName?.toLowerCase().includes(queryLower),
      );

      const userData = matches.map((u) => ({
        id: u.id,
        name: u.name,
        displayName: u.displayName,
        email: u.email ?? null,
      }));

      const format = getFormat(globalOpts.format);
      printResult({ data: userData }, format);
    });

  user
    .command("me")
    .description("Show this agent's identity")
    .action(async (_opts, cmd) => {
      const globalOpts = cmd.optsWithGlobals();
      const agent = globalOpts.agent;
      if (!agent) {
        console.error("Error: --agent is required (or set LINEAR_AGENT_ID env var)");
        process.exit(4);
      }
      const credentialsDir = getCredentialsDir(globalOpts);
      const credentials = readCredentials(agent, credentialsDir);

      const format = getFormat(globalOpts.format);
      printResult(
        {
          data: {
            agent,
            actorId: credentials.actorId,
            workspace: credentials.workspaceSlug,
            authMethod: credentials.authMethod,
            tokenExpiresAt: credentials.tokenExpiresAt,
          },
        },
        format,
      );
    });
}
