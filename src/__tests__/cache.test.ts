import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  readCache,
  writeCache,
  getTeamStates,
  setTeamStates,
  invalidateTeamStates,
} from "../cache.js";
import type { CacheData } from "../cache.js";

describe("cache", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `linear-cli-cache-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    try {
      const { rmSync } = require("fs");
      rmSync(testDir, { recursive: true, force: true });
    } catch {
      // cleanup best effort
    }
  });

  describe("readCache / writeCache", () => {
    it("returns empty cache when file does not exist", () => {
      const cache = readCache("agent-1", testDir);
      expect(cache.teams).toEqual({});
    });

    it("round-trips cache data", () => {
      const cache: CacheData = {
        teams: {
          MAIN: {
            states: { "In Progress": "state-1", Done: "state-2" },
            updatedAt: new Date().toISOString(),
          },
        },
      };
      writeCache("agent-1", testDir, cache);
      const result = readCache("agent-1", testDir);
      expect(result.teams.MAIN.states["In Progress"]).toBe("state-1");
      expect(result.teams.MAIN.states["Done"]).toBe("state-2");
    });
  });

  describe("getTeamStates", () => {
    it("returns states within TTL", () => {
      const cache: CacheData = {
        teams: {
          MAIN: {
            states: { Todo: "s1", Done: "s2" },
            updatedAt: new Date().toISOString(),
          },
        },
      };
      const result = getTeamStates(cache, "MAIN");
      expect(result).toEqual({ Todo: "s1", Done: "s2" });
    });

    it("returns null for missing team", () => {
      const cache: CacheData = { teams: {} };
      expect(getTeamStates(cache, "MAIN")).toBeNull();
    });

    it("returns null for expired TTL", () => {
      const oldDate = new Date(Date.now() - 25 * 60 * 60 * 1000); // 25 hours ago
      const cache: CacheData = {
        teams: {
          MAIN: {
            states: { Todo: "s1" },
            updatedAt: oldDate.toISOString(),
          },
        },
      };
      expect(getTeamStates(cache, "MAIN")).toBeNull();
    });
  });

  describe("setTeamStates", () => {
    it("adds team states to cache", () => {
      const cache: CacheData = { teams: {} };
      const updated = setTeamStates(cache, "MAIN", {
        Todo: "s1",
        Done: "s2",
      });
      expect(updated.teams.MAIN.states).toEqual({ Todo: "s1", Done: "s2" });
      expect(updated.teams.MAIN.updatedAt).toBeTruthy();
    });

    it("preserves other teams", () => {
      const cache: CacheData = {
        teams: {
          OTHER: {
            states: { Todo: "x1" },
            updatedAt: new Date().toISOString(),
          },
        },
      };
      const updated = setTeamStates(cache, "MAIN", { Done: "s2" });
      expect(updated.teams.OTHER.states.Todo).toBe("x1");
      expect(updated.teams.MAIN.states.Done).toBe("s2");
    });
  });

  describe("invalidateTeamStates", () => {
    it("removes team from cache", () => {
      const cache: CacheData = {
        teams: {
          MAIN: {
            states: { Todo: "s1" },
            updatedAt: new Date().toISOString(),
          },
          OTHER: {
            states: { Todo: "x1" },
            updatedAt: new Date().toISOString(),
          },
        },
      };
      const updated = invalidateTeamStates(cache, "MAIN");
      expect(updated.teams.MAIN).toBeUndefined();
      expect(updated.teams.OTHER.states.Todo).toBe("x1");
    });
  });
});
