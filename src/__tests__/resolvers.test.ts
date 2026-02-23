import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  parseTeamKey,
  resolveUser,
  resolveState,
  _resetUserCache,
} from "../resolvers.js";
import { writeCache, readCache } from "../cache.js";
import { ValidationError } from "../errors.js";
import type { Credentials } from "../credentials.js";
import type { CacheData } from "../cache.js";

const testCredentials: Credentials = {
  authMethod: "client_credentials",
  clientId: "test-client-id",
  clientSecret: "test-client-secret",
  accessToken: "test-access-token",
  refreshToken: null,
  tokenExpiresAt: "2026-03-24T10:00:00Z",
  actorId: "actor-123",
  workspaceId: "org-456",
  workspaceSlug: "test-workspace",
};

function makeMockClient(opts?: {
  users?: Array<{ id: string; name: string; email?: string; displayName?: string }>;
  teams?: Array<{
    nodes: Array<{
      states: () => Promise<{ nodes: Array<{ name: string; id: string }> }>;
    }>;
  }>;
}) {
  return {
    users: vi.fn().mockResolvedValue({
      nodes: opts?.users ?? [
        { id: "user-1", name: "Alice", email: "alice@test.com", displayName: "Alice A" },
        { id: "user-2", name: "Bob", email: "bob@test.com", displayName: "Bob B" },
        { id: "agent-1", name: "Eve", email: null, displayName: "Eve Agent" },
      ],
    }),
    teams: vi.fn().mockResolvedValue(
      opts?.teams ?? {
        nodes: [
          {
            states: vi.fn().mockResolvedValue({
              nodes: [
                { name: "Todo", id: "state-todo" },
                { name: "In Progress", id: "state-ip" },
                { name: "Done", id: "state-done" },
              ],
            }),
          },
        ],
      }
    ),
  } as any;
}

describe("resolvers", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `linear-cli-resolver-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    _resetUserCache();
  });

  afterEach(() => {
    try {
      const { rmSync } = require("fs");
      rmSync(testDir, { recursive: true, force: true });
    } catch {
      // cleanup
    }
  });

  describe("parseTeamKey", () => {
    it("extracts team key from identifier", () => {
      expect(parseTeamKey("MAIN-42")).toBe("MAIN");
      expect(parseTeamKey("ENG-1")).toBe("ENG");
      expect(parseTeamKey("A1-999")).toBe("A1");
    });

    it("throws on invalid format", () => {
      expect(() => parseTeamKey("main-42")).toThrow(ValidationError);
      expect(() => parseTeamKey("MAIN")).toThrow(ValidationError);
      expect(() => parseTeamKey("42")).toThrow(ValidationError);
      expect(() => parseTeamKey("")).toThrow(ValidationError);
    });
  });

  describe("resolveUser", () => {
    it("resolves 'me' to actorId", async () => {
      const client = makeMockClient();
      const result = await resolveUser("me", testCredentials, client);
      expect(result).toBe("actor-123");
      // Should not call the API
      expect(client.users).not.toHaveBeenCalled();
    });

    it("resolves 'Me' case-insensitively", async () => {
      const client = makeMockClient();
      const result = await resolveUser("Me", testCredentials, client);
      expect(result).toBe("actor-123");
    });

    it("passes through UUID directly", async () => {
      const uuid = "12345678-1234-1234-1234-123456789abc";
      const client = makeMockClient();
      const result = await resolveUser(uuid, testCredentials, client);
      expect(result).toBe(uuid);
      expect(client.users).not.toHaveBeenCalled();
    });

    it("resolves user by name", async () => {
      const client = makeMockClient();
      const result = await resolveUser("Alice", testCredentials, client);
      expect(result).toBe("user-1");
      expect(client.users).toHaveBeenCalledTimes(1);
    });

    it("resolves user by email", async () => {
      const client = makeMockClient();
      const result = await resolveUser("bob@test.com", testCredentials, client);
      expect(result).toBe("user-2");
    });

    it("resolves case-insensitively", async () => {
      const client = makeMockClient();
      const result = await resolveUser("alice", testCredentials, client);
      expect(result).toBe("user-1");
    });

    it("caches user list across calls", async () => {
      const client = makeMockClient();
      await resolveUser("Alice", testCredentials, client);
      await resolveUser("Bob", testCredentials, client);
      // Only one API call
      expect(client.users).toHaveBeenCalledTimes(1);
    });

    it("throws with suggestions on unknown user", async () => {
      const client = makeMockClient();
      try {
        await resolveUser("nonexistent", testCredentials, client);
        expect.fail("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(ValidationError);
        const ve = err as ValidationError;
        expect(ve.message).toContain("nonexistent");
        expect(ve.validOptions).toBeDefined();
        expect(ve.validOptions!.length).toBeGreaterThan(0);
      }
    });
  });

  describe("resolveState", () => {
    it("passes through UUID directly", async () => {
      const uuid = "12345678-1234-1234-1234-123456789abc";
      const client = makeMockClient();
      const result = await resolveState(uuid, "MAIN", client, "agent-1", testDir);
      expect(result).toBe(uuid);
    });

    it("resolves state by name (fetches from API)", async () => {
      const client = makeMockClient();
      const result = await resolveState(
        "In Progress",
        "MAIN",
        client,
        "agent-1",
        testDir
      );
      expect(result).toBe("state-ip");
      expect(client.teams).toHaveBeenCalledWith({
        filter: { key: { eq: "MAIN" } },
      });
    });

    it("resolves state case-insensitively", async () => {
      const client = makeMockClient();
      const result = await resolveState(
        "in progress",
        "MAIN",
        client,
        "agent-1",
        testDir
      );
      expect(result).toBe("state-ip");
    });

    it("caches states after first fetch", async () => {
      const client = makeMockClient();
      await resolveState("Todo", "MAIN", client, "agent-1", testDir);

      // Verify cache was written
      const cache = readCache("agent-1", testDir);
      expect(cache.teams.MAIN).toBeDefined();
      expect(cache.teams.MAIN.states["Todo"]).toBe("state-todo");

      // Second call should use cache (no API call)
      client.teams.mockClear();
      await resolveState("Done", "MAIN", client, "agent-1", testDir);
      expect(client.teams).not.toHaveBeenCalled();
    });

    it("throws with valid options on unknown state", async () => {
      const client = makeMockClient();
      try {
        await resolveState(
          "Nonexistent",
          "MAIN",
          client,
          "agent-1",
          testDir
        );
        expect.fail("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(ValidationError);
        const ve = err as ValidationError;
        expect(ve.message).toContain("Nonexistent");
        expect(ve.validOptions).toContain("Todo");
        expect(ve.validOptions).toContain("In Progress");
        expect(ve.validOptions).toContain("Done");
      }
    });

    it("throws on unknown team", async () => {
      const client = makeMockClient({
        teams: { nodes: [] } as any,
      });
      await expect(
        resolveState("Todo", "NOPE", client, "agent-1", testDir)
      ).rejects.toThrow(ValidationError);
    });
  });
});
