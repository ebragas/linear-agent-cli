import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdirSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { writeCredentials } from "../credentials.js";
import type { Credentials } from "../credentials.js";

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// Mock LinearClient
vi.mock("@linear/sdk", () => ({
  LinearClient: vi.fn().mockImplementation(() => ({
    viewer: Promise.resolve({ id: "actor-123", name: "TestBot", email: null }),
    organization: Promise.resolve({ id: "org-456", urlKey: "test-workspace" }),
  })),
}));

const validCredentials: Credentials = {
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

describe("auth commands", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `linear-cli-auth-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    mockFetch.mockReset();
  });

  afterEach(() => {
    try {
      const { rmSync } = require("fs");
      rmSync(testDir, { recursive: true, force: true });
    } catch {
      // cleanup best effort
    }
  });

  describe("setup --client-credentials", () => {
    it("fetches token and writes credentials", async () => {
      // Import after mocks are set up
      const { registerAuthCommands } = await import("../commands/auth.js");
      const { Command } = await import("commander");

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: "new-token",
          token_type: "Bearer",
          expires_in: 2592000, // 30 days
        }),
      });

      const program = new Command();
      program.option("--agent <id>").option("--credentials-dir <path>").option("--format <format>");
      registerAuthCommands(program);

      // Capture console output
      const logs: string[] = [];
      const origLog = console.log;
      console.log = (...args: unknown[]) => logs.push(args.join(" "));

      try {
        await program.parseAsync([
          "node",
          "linear",
          "--agent",
          "test-bot",
          "--credentials-dir",
          testDir,
          "--format",
          "json",
          "auth",
          "setup",
          "--client-id",
          "cid",
          "--client-secret",
          "csecret",
          "--client-credentials",
        ]);
      } finally {
        console.log = origLog;
      }

      // Verify token was requested
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.linear.app/oauth/token",
        expect.objectContaining({ method: "POST" })
      );

      // Verify credentials were written
      const credPath = join(testDir, "test-bot.json");
      const creds = JSON.parse(readFileSync(credPath, "utf-8"));
      expect(creds.accessToken).toBe("new-token");
      expect(creds.authMethod).toBe("client_credentials");
      expect(creds.actorId).toBe("actor-123");
      expect(creds.workspaceSlug).toBe("test-workspace");

      // Verify output
      expect(logs.length).toBeGreaterThan(0);
      const output = JSON.parse(logs[0]);
      expect(output.status).toBe("authenticated");
    });

    it("throws on token request failure", async () => {
      const { registerAuthCommands } = await import("../commands/auth.js");
      const { Command } = await import("commander");

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: "Unauthorized",
        text: async () => "Invalid credentials",
      });

      const program = new Command();
      program.option("--agent <id>").option("--credentials-dir <path>").option("--format <format>");
      program.exitOverride();
      registerAuthCommands(program);

      await expect(
        program.parseAsync([
          "node",
          "linear",
          "--agent",
          "test-bot",
          "--credentials-dir",
          testDir,
          "--format",
          "json",
          "auth",
          "setup",
          "--client-id",
          "bad-id",
          "--client-secret",
          "bad-secret",
        ])
      ).rejects.toThrow(/Token request failed/);
    });
  });

  describe("whoami", () => {
    it("reads credentials and prints identity", async () => {
      const { registerAuthCommands } = await import("../commands/auth.js");
      const { Command } = await import("commander");

      writeCredentials("test-bot", testDir, validCredentials);

      const program = new Command();
      program.option("--agent <id>").option("--credentials-dir <path>").option("--format <format>");
      registerAuthCommands(program);

      const logs: string[] = [];
      const origLog = console.log;
      console.log = (...args: unknown[]) => logs.push(args.join(" "));

      try {
        await program.parseAsync([
          "node",
          "linear",
          "--agent",
          "test-bot",
          "--credentials-dir",
          testDir,
          "--format",
          "json",
          "auth",
          "whoami",
        ]);
      } finally {
        console.log = origLog;
      }

      expect(logs.length).toBeGreaterThan(0);
      const output = JSON.parse(logs[0]);
      expect(output.agent).toBe("test-bot");
      expect(output.actorId).toBe("actor-123");
      expect(output.workspace).toBe("test-workspace");
    });
  });

  describe("refresh", () => {
    it("refreshes client_credentials token", async () => {
      const { registerAuthCommands } = await import("../commands/auth.js");
      const { Command } = await import("commander");

      writeCredentials("test-bot", testDir, validCredentials);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: "refreshed-token",
          token_type: "Bearer",
          expires_in: 2592000,
        }),
      });

      const program = new Command();
      program.option("--agent <id>").option("--credentials-dir <path>").option("--format <format>");
      registerAuthCommands(program);

      const logs: string[] = [];
      const origLog = console.log;
      console.log = (...args: unknown[]) => logs.push(args.join(" "));

      try {
        await program.parseAsync([
          "node",
          "linear",
          "--agent",
          "test-bot",
          "--credentials-dir",
          testDir,
          "--format",
          "json",
          "auth",
          "refresh",
        ]);
      } finally {
        console.log = origLog;
      }

      // Verify credentials file was updated
      const creds = JSON.parse(
        readFileSync(join(testDir, "test-bot.json"), "utf-8")
      );
      expect(creds.accessToken).toBe("refreshed-token");

      const output = JSON.parse(logs[0]);
      expect(output.status).toBe("refreshed");
    });
  });

  describe("revoke", () => {
    it("revokes token and deletes credentials", async () => {
      const { registerAuthCommands } = await import("../commands/auth.js");
      const { Command } = await import("commander");
      const { existsSync } = await import("fs");

      writeCredentials("test-bot", testDir, validCredentials);

      mockFetch.mockResolvedValueOnce({ ok: true });

      const program = new Command();
      program.option("--agent <id>").option("--credentials-dir <path>").option("--format <format>");
      registerAuthCommands(program);

      const logs: string[] = [];
      const origLog = console.log;
      console.log = (...args: unknown[]) => logs.push(args.join(" "));

      try {
        await program.parseAsync([
          "node",
          "linear",
          "--agent",
          "test-bot",
          "--credentials-dir",
          testDir,
          "--format",
          "json",
          "auth",
          "revoke",
        ]);
      } finally {
        console.log = origLog;
      }

      // Credentials file should be deleted
      expect(existsSync(join(testDir, "test-bot.json"))).toBe(false);

      const output = JSON.parse(logs[0]);
      expect(output.status).toBe("revoked");
    });
  });
});
