import type { LinearClient } from "@linear/sdk";
import type { Credentials } from "./credentials.js";
import type { CacheData } from "./cache.js";
import {
  readCache,
  writeCache,
  getTeamStates,
  setTeamStates,
} from "./cache.js";
import { ValidationError } from "./errors.js";

// In-memory user cache (populated on first lookup per session)
let userCache: Map<string, string> | null = null; // displayName|email → id

export function parseTeamKey(issueIdentifier: string): string {
  const match = issueIdentifier.match(/^([A-Z][A-Z0-9]*)-\d+$/);
  if (!match) {
    throw new ValidationError(
      `Cannot parse team key from identifier "${issueIdentifier}". Expected format: TEAM-123`
    );
  }
  return match[1];
}

export async function resolveUser(
  value: string,
  credentials: Credentials,
  client: LinearClient
): Promise<string> {
  if (value.toLowerCase() === "me") {
    return credentials.actorId;
  }

  // Try as UUID directly
  if (
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value
    )
  ) {
    return value;
  }

  // Populate user cache on first use
  if (!userCache) {
    userCache = new Map();
    const users = await client.users();
    for (const u of users.nodes) {
      if (u.name) userCache.set(u.name.toLowerCase(), u.id);
      if (u.email) userCache.set(u.email.toLowerCase(), u.id);
      if (u.displayName) userCache.set(u.displayName.toLowerCase(), u.id);
    }
  }

  const id = userCache.get(value.toLowerCase());
  if (id) return id;

  const validOptions = Array.from(userCache.keys());
  throw new ValidationError(
    `No user matching "${value}"`,
    validOptions.slice(0, 20)
  );
}

export async function resolveState(
  name: string,
  teamKey: string,
  client: LinearClient,
  agentId: string,
  credentialsDir: string
): Promise<string> {
  // Try as UUID directly
  if (
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      name
    )
  ) {
    return name;
  }

  let cache = readCache(agentId, credentialsDir);
  let states = getTeamStates(cache, teamKey);

  if (!states) {
    // Fetch and cache states for this team
    states = await fetchTeamStates(teamKey, client);
    cache = setTeamStates(cache, teamKey, states);
    writeCache(agentId, credentialsDir, cache);
  }

  // Case-insensitive lookup
  const nameLower = name.toLowerCase();
  for (const [stateName, stateId] of Object.entries(states)) {
    if (stateName.toLowerCase() === nameLower) return stateId;
  }

  throw new ValidationError(
    `No workflow state "${name}" found for team ${teamKey}`,
    Object.keys(states)
  );
}

async function fetchTeamStates(
  teamKey: string,
  client: LinearClient
): Promise<Record<string, string>> {
  const teams = await client.teams({ filter: { key: { eq: teamKey } } });
  const team = teams.nodes[0];
  if (!team) {
    throw new ValidationError(`Team "${teamKey}" not found`);
  }

  const workflowStates = await team.states();
  const states: Record<string, string> = {};
  for (const s of workflowStates.nodes) {
    states[s.name] = s.id;
  }
  return states;
}

/** Reset in-memory user cache (for testing) */
export function _resetUserCache(): void {
  userCache = null;
}
