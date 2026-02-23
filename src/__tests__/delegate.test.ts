import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdirSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { writeCredentials } from "../credentials.js";
import type { Credentials } from "../credentials.js";

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// Mock SDK
const mockUpdateIssue = vi.fn().mockResolvedValue({ success: true });
const mockIssues = vi.fn();
const mockUsers = vi.fn().mockResolvedValue({
  nodes: [
    { id: "agent-abc", name: "AnalystBot", displayName: "AnalystBot", email: null },
    { id: "user-xyz", name: "Alice", displayName: "Alice", email: "alice@example.com" },
  ],
});

vi.mock("@linear/sdk", () => ({
  LinearClient: vi.fn().mockImplementation(() => ({
    updateIssue: mockUpdateIssue,
    issues: mockIssues,
    users: mockUsers,
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

describe("delegate commands", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `linear-cli-delegate-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    writeCredentials("test-bot", testDir, validCredentials);
    mockUpdateIssue.mockClear();
    mockIssues.mockClear();
    mockUsers.mockClear();
    // Reset user cache between tests
    mockUsers.mockResolvedValue({
      nodes: [
        { id: "agent-abc", name: "AnalystBot", displayName: "AnalystBot", email: null },
        { id: "user-xyz", name: "Alice", displayName: "Alice", email: "alice@example.com" },
      ],
    });
  });

  afterEach(() => {
    try {
      const { rmSync } = require("fs");
      rmSync(testDir, { recursive: true, force: true });
    } catch {
      // cleanup best effort
    }
  });

  describe("assign", () => {
    it("calls updateIssue with delegate", async () => {
      // Reset module to clear user cache
      vi.resetModules();
      const { registerDelegateCommands } = await import("../commands/delegate.js");
      const { Command } = await import("commander");

      const program = new Command();
      program.option("--agent <id>").option("--credentials-dir <path>").option("--format <format>");
      registerDelegateCommands(program);

      const logs: string[] = [];
      const origLog = console.log;
      console.log = (...args: unknown[]) => logs.push(args.join(" "));

      try {
        await program.parseAsync([
          "node", "linear",
          "--agent", "test-bot",
          "--credentials-dir", testDir,
          "--format", "json",
          "delegate", "assign", "MAIN-42",
          "--to", "AnalystBot",
        ]);
      } finally {
        console.log = origLog;
      }

      expect(mockUpdateIssue).toHaveBeenCalledWith("MAIN-42", {
        delegateId: "agent-abc",
      });

      const output = JSON.parse(logs[0]);
      expect(output.status).toBe("delegated");
      expect(output.issueId).toBe("MAIN-42");
    });

    it("resolves 'me' to actorId", async () => {
      vi.resetModules();
      const { registerDelegateCommands } = await import("../commands/delegate.js");
      const { Command } = await import("commander");

      const program = new Command();
      program.option("--agent <id>").option("--credentials-dir <path>").option("--format <format>");
      registerDelegateCommands(program);

      const logs: string[] = [];
      const origLog = console.log;
      console.log = (...args: unknown[]) => logs.push(args.join(" "));

      try {
        await program.parseAsync([
          "node", "linear",
          "--agent", "test-bot",
          "--credentials-dir", testDir,
          "--format", "json",
          "delegate", "assign", "MAIN-42",
          "--to", "me",
        ]);
      } finally {
        console.log = origLog;
      }

      expect(mockUpdateIssue).toHaveBeenCalledWith("MAIN-42", {
        delegateId: "actor-123",
      });
    });
  });

  describe("list", () => {
    it("filters by delegate = actorId", async () => {
      mockIssues.mockResolvedValue({
        nodes: [
          {
            identifier: "MAIN-10",
            title: "Test issue",
            priority: 2,
            state: Promise.resolve({ name: "In Progress" }),
            assignee: Promise.resolve({ name: "Alice" }),
          },
        ],
      });

      vi.resetModules();
      const { registerDelegateCommands } = await import("../commands/delegate.js");
      const { Command } = await import("commander");

      const program = new Command();
      program.option("--agent <id>").option("--credentials-dir <path>").option("--format <format>");
      registerDelegateCommands(program);

      const logs: string[] = [];
      const origLog = console.log;
      console.log = (...args: unknown[]) => logs.push(args.join(" "));

      try {
        await program.parseAsync([
          "node", "linear",
          "--agent", "test-bot",
          "--credentials-dir", testDir,
          "--format", "json",
          "delegate", "list",
        ]);
      } finally {
        console.log = origLog;
      }

      expect(mockIssues).toHaveBeenCalledWith({
        filter: { delegate: { id: { eq: "actor-123" } } },
      });

      const output = JSON.parse(logs[0]);
      expect(output.results).toHaveLength(1);
      expect(output.results[0].id).toBe("MAIN-10");
    });
  });

  describe("remove", () => {
    it("sets delegate to null", async () => {
      vi.resetModules();
      const { registerDelegateCommands } = await import("../commands/delegate.js");
      const { Command } = await import("commander");

      const program = new Command();
      program.option("--agent <id>").option("--credentials-dir <path>").option("--format <format>");
      registerDelegateCommands(program);

      const logs: string[] = [];
      const origLog = console.log;
      console.log = (...args: unknown[]) => logs.push(args.join(" "));

      try {
        await program.parseAsync([
          "node", "linear",
          "--agent", "test-bot",
          "--credentials-dir", testDir,
          "--format", "json",
          "delegate", "remove", "MAIN-42",
        ]);
      } finally {
        console.log = origLog;
      }

      expect(mockUpdateIssue).toHaveBeenCalledWith("MAIN-42", {
        delegateId: null,
      });

      const output = JSON.parse(logs[0]);
      expect(output.status).toBe("delegation_removed");
    });
  });
});
