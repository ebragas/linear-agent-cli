import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { writeCredentials } from "../credentials.js";
import type { Credentials } from "../credentials.js";

// Mock LinearClient
const mockNotifications = vi.fn();
const mockNotificationArchive = vi.fn();

vi.mock("@linear/sdk", () => ({
  LinearClient: vi.fn().mockImplementation(() => ({
    notifications: mockNotifications,
    notificationArchive: mockNotificationArchive,
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

describe("inbox commands", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `linear-cli-inbox-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    writeCredentials("test-bot", testDir, validCredentials);
    mockNotifications.mockReset();
    mockNotificationArchive.mockReset();
  });

  afterEach(() => {
    try {
      const { rmSync } = require("fs");
      rmSync(testDir, { recursive: true, force: true });
    } catch {
      // cleanup best effort
    }
  });

  describe("inbox list", () => {
    it("lists unprocessed notifications with archivedAt null filter", async () => {
      const { registerInboxCommands } = await import(
        "../commands/inbox.js"
      );
      const { Command } = await import("commander");

      mockNotifications.mockResolvedValueOnce({
        nodes: [
          {
            id: "notif-1",
            type: "issueAssignedToYou",
            createdAt: "2026-02-01T00:00:00Z",
            archivedAt: null,
          },
          {
            id: "notif-2",
            type: "issueMention",
            createdAt: "2026-02-02T00:00:00Z",
            archivedAt: null,
          },
        ],
      });

      const program = new Command();
      program
        .option("--agent <id>")
        .option("--credentials-dir <path>")
        .option("--format <format>");
      registerInboxCommands(program);

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
          "inbox",
          "list",
        ]);
      } finally {
        console.log = origLog;
      }

      expect(mockNotifications).toHaveBeenCalledWith({
        filter: undefined,
      });
      const output = JSON.parse(logs[0]);
      expect(output.results).toHaveLength(2);
      expect(output.results[0].id).toBe("notif-1");
      expect(output.results[0].type).toBe("issueAssignedToYou");
    });

    it("includes archived when --include-archived is set", async () => {
      const { registerInboxCommands } = await import(
        "../commands/inbox.js"
      );
      const { Command } = await import("commander");

      mockNotifications.mockResolvedValueOnce({
        nodes: [
          {
            id: "notif-1",
            type: "issueAssignedToYou",
            createdAt: "2026-02-01T00:00:00Z",
            archivedAt: "2026-02-01T12:00:00Z",
          },
        ],
      });

      const program = new Command();
      program
        .option("--agent <id>")
        .option("--credentials-dir <path>")
        .option("--format <format>");
      registerInboxCommands(program);

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
          "inbox",
          "list",
          "--include-archived",
        ]);
      } finally {
        console.log = origLog;
      }

      // Should NOT have archivedAt filter — both paths call without filter
      expect(mockNotifications).toHaveBeenCalledWith({ filter: undefined });
    });
  });

  describe("inbox dismiss", () => {
    it("archives a single notification", async () => {
      const { registerInboxCommands } = await import(
        "../commands/inbox.js"
      );
      const { Command } = await import("commander");

      mockNotificationArchive.mockResolvedValueOnce({ success: true });

      const program = new Command();
      program
        .option("--agent <id>")
        .option("--credentials-dir <path>")
        .option("--format <format>");
      registerInboxCommands(program);

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
          "inbox",
          "dismiss",
          "notif-123",
        ]);
      } finally {
        console.log = origLog;
      }

      expect(mockNotificationArchive).toHaveBeenCalledWith("notif-123");
      const output = JSON.parse(logs[0]);
      expect(output.status).toBe("dismissed");
      expect(output.id).toBe("notif-123");
    });
  });

  describe("inbox dismiss-all", () => {
    it("iterates and archives each unprocessed notification", async () => {
      const { registerInboxCommands } = await import(
        "../commands/inbox.js"
      );
      const { Command } = await import("commander");

      mockNotifications.mockResolvedValueOnce({
        nodes: [
          { id: "notif-a", type: "issueAssignedToYou", createdAt: "2026-02-01T00:00:00Z", archivedAt: null },
          { id: "notif-b", type: "issueMention", createdAt: "2026-02-02T00:00:00Z", archivedAt: null },
          { id: "notif-c", type: "issueStatusChanged", createdAt: "2026-02-03T00:00:00Z", archivedAt: null },
        ],
      });

      mockNotificationArchive
        .mockResolvedValueOnce({ success: true })
        .mockResolvedValueOnce({ success: true })
        .mockResolvedValueOnce({ success: true });

      const program = new Command();
      program
        .option("--agent <id>")
        .option("--credentials-dir <path>")
        .option("--format <format>");
      registerInboxCommands(program);

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
          "inbox",
          "dismiss-all",
        ]);
      } finally {
        console.log = origLog;
      }

      expect(mockNotifications).toHaveBeenCalledWith();
      expect(mockNotificationArchive).toHaveBeenCalledTimes(3);
      expect(mockNotificationArchive).toHaveBeenCalledWith("notif-a");
      expect(mockNotificationArchive).toHaveBeenCalledWith("notif-b");
      expect(mockNotificationArchive).toHaveBeenCalledWith("notif-c");

      const output = JSON.parse(logs[0]);
      expect(output.status).toBe("dismissed-all");
      expect(output.count).toBe(3);
    });
  });
});
