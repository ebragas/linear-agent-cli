import { Command } from "commander";
import { runWithClient } from "../context.js";
import { getFormat, printResult } from "../output.js";
import { readCache, writeCache, setTeamStates } from "../cache.js";

export function registerStateCommands(program: Command): void {
  const state = program
    .command("state")
    .description("Workflow state queries");

  state
    .command("list")
    .description("List workflow states")
    .option("--team <team>", "Filter by team name or key")
    .action(async (opts, cmd) => {
      const globalOpts = cmd.optsWithGlobals();
      await runWithClient(globalOpts, async (client, { agentId, credentialsDir }) => {
        let cache = readCache(agentId, credentialsDir);

        if (opts.team) {
          // Filter by specific team
          const teams = await client.teams({
            filter: { name: { eqIgnoreCase: opts.team } },
          });
          let team = teams.nodes[0];
          if (!team) {
            const byKey = await client.teams({
              filter: { key: { eq: opts.team.toUpperCase() } },
            });
            team = byKey.nodes[0];
          }
          if (!team) {
            console.error(`Error: Team "${opts.team}" not found`);
            process.exit(4);
          }

          const states = await team.states();
          const stateData = states.nodes.map((s) => ({
            id: s.id,
            name: s.name,
            type: s.type,
            color: s.color,
            position: s.position,
            team: team!.name,
          }));

          // Update cache for this team
          const stateMap: Record<string, string> = {};
          for (const s of states.nodes) {
            stateMap[s.name] = s.id;
          }
          cache = setTeamStates(cache, team.key, stateMap);
          writeCache(agentId, credentialsDir, cache);

          const format = getFormat(globalOpts.format);
          printResult({ data: stateData }, format);
        } else {
          // List all workflow states across teams
          const teamsResult = await client.teams();
          const allStates: Array<Record<string, unknown>> = [];

          for (const t of teamsResult.nodes) {
            const states = await t.states();
            const stateMap: Record<string, string> = {};

            for (const s of states.nodes) {
              stateMap[s.name] = s.id;
              allStates.push({
                id: s.id,
                name: s.name,
                type: s.type,
                color: s.color,
                position: s.position,
                team: t.name,
              });
            }

            // Update cache for each team
            cache = setTeamStates(cache, t.key, stateMap);
          }

          writeCache(agentId, credentialsDir, cache);

          const format = getFormat(globalOpts.format);
          printResult({ data: allStates }, format);
        }
      });
    });
}
