import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";

export interface TeamStateCache {
  states: Record<string, string>; // name → ID
  updatedAt: string; // ISO-8601
}

export interface CacheData {
  teams: Record<string, TeamStateCache>;
}

const TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

function cachePath(agentId: string, credentialsDir: string): string {
  return join(credentialsDir, `${agentId}.cache.json`);
}

export function readCache(
  agentId: string,
  credentialsDir: string
): CacheData {
  const path = cachePath(agentId, credentialsDir);
  try {
    const raw = readFileSync(path, "utf-8");
    return JSON.parse(raw) as CacheData;
  } catch {
    return { teams: {} };
  }
}

export function writeCache(
  agentId: string,
  credentialsDir: string,
  cache: CacheData
): void {
  mkdirSync(credentialsDir, { recursive: true });
  const path = cachePath(agentId, credentialsDir);
  writeFileSync(path, JSON.stringify(cache, null, 2) + "\n");
}

export function getTeamStates(
  cache: CacheData,
  teamKey: string
): Record<string, string> | null {
  const team = cache.teams[teamKey];
  if (!team) return null;

  const age = Date.now() - new Date(team.updatedAt).getTime();
  if (age > TTL_MS) return null;

  return team.states;
}

export function setTeamStates(
  cache: CacheData,
  teamKey: string,
  states: Record<string, string>
): CacheData {
  return {
    ...cache,
    teams: {
      ...cache.teams,
      [teamKey]: {
        states,
        updatedAt: new Date().toISOString(),
      },
    },
  };
}

export function invalidateTeamStates(
  cache: CacheData,
  teamKey: string
): CacheData {
  const { [teamKey]: _, ...rest } = cache.teams;
  return { ...cache, teams: rest };
}
