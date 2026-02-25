import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { writeCredentials } from "../credentials.js";
import type { Credentials } from "../credentials.js";

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// Mock SDK methods
const mockIssueLabels = vi.fn();
const mockCreateIssueLabel = vi.fn();
const mockUsersResult = vi.fn();
const mockTeams = vi.fn();
const mockProjects = vi.fn();
const mockProject = vi.fn();
const mockCreateAttachment = vi.fn();
const mockIssue = vi.fn();
const mockDeleteAttachment = vi.fn();
const mockWorkflowStates = vi.fn();
const mockFileUpload = vi.fn();

vi.mock("@linear/sdk", () => ({
  LinearClient: vi.fn().mockImplementation(() => ({
    issueLabels: mockIssueLabels,
    createIssueLabel: mockCreateIssueLabel,
    users: mockUsersResult,
    teams: mockTeams,
    projects: mockProjects,
    project: mockProject,
    createAttachment: mockCreateAttachment,
    issue: mockIssue,
    deleteAttachment: mockDeleteAttachment,
    workflowStates: mockWorkflowStates,
    fileUpload: mockFileUpload,
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

function makeProgram() {
  // Inline require to ensure mocks are active
  const { Command } = require("commander");
  const program = new Command();
  program.option("--agent <id>").option("--credentials-dir <path>").option("--format <format>");
  return program;
}

function captureOutput(fn: () => Promise<void>): Promise<string[]> {
  return new Promise(async (resolve) => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => logs.push(args.join(" "));
    try {
      await fn();
    } finally {
      console.log = origLog;
    }
    resolve(logs);
  });
}

describe("discovery commands", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `linear-cli-discovery-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    writeCredentials("test-bot", testDir, validCredentials);

    mockIssueLabels.mockReset();
    mockCreateIssueLabel.mockReset();
    mockUsersResult.mockReset();
    mockTeams.mockReset();
    mockProjects.mockReset();
    mockProject.mockReset();
    mockCreateAttachment.mockReset();
    mockIssue.mockReset();
    mockDeleteAttachment.mockReset();
    mockWorkflowStates.mockReset();
    mockFileUpload.mockReset();
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

  // --- Label tests ---
  describe("label list", () => {
    it("returns labels", async () => {
      mockIssueLabels.mockResolvedValue({
        nodes: [
          { id: "lbl-1", name: "bug", color: "#ff0000", team: Promise.resolve(null) },
          { id: "lbl-2", name: "feature", color: "#00ff00", team: Promise.resolve({ name: "Main" }) },
        ],
      });

      vi.resetModules();
      const { registerLabelCommands } = await import("../commands/label.js");
      const program = makeProgram();
      registerLabelCommands(program);

      const logs = await captureOutput(() =>
        program.parseAsync([
          "node", "linear",
          "--agent", "test-bot",
          "--credentials-dir", testDir,
          "--format", "json",
          "label", "list",
        ]),
      );

      expect(mockIssueLabels).toHaveBeenCalled();
      const output = JSON.parse(logs[0]);
      expect(output.results).toHaveLength(2);
      expect(output.results[0].name).toBe("bug");
      expect(output.results[1].team).toBe("Main");
    });
  });

  // --- User tests ---
  describe("user list", () => {
    it("returns users with --type filter", async () => {
      mockUsersResult.mockResolvedValue({
        nodes: [
          { id: "u-1", name: "Alice", displayName: "Alice", email: "alice@example.com", isMe: false, active: true },
          { id: "u-2", name: "BotAgent", displayName: "BotAgent", email: null, isMe: false, active: true },
        ],
      });

      vi.resetModules();
      const { registerUserCommands } = await import("../commands/user.js");
      const program = makeProgram();
      registerUserCommands(program);

      const logs = await captureOutput(() =>
        program.parseAsync([
          "node", "linear",
          "--agent", "test-bot",
          "--credentials-dir", testDir,
          "--format", "json",
          "user", "list",
          "--type", "app",
        ]),
      );

      const output = JSON.parse(logs[0]);
      expect(output.results).toHaveLength(1);
      expect(output.results[0].name).toBe("BotAgent");
    });

    it("returns all users without filter", async () => {
      mockUsersResult.mockResolvedValue({
        nodes: [
          { id: "u-1", name: "Alice", displayName: "Alice", email: "alice@example.com", isMe: false, active: true },
          { id: "u-2", name: "BotAgent", displayName: "BotAgent", email: null, isMe: false, active: true },
        ],
      });

      vi.resetModules();
      const { registerUserCommands } = await import("../commands/user.js");
      const program = makeProgram();
      registerUserCommands(program);

      const logs = await captureOutput(() =>
        program.parseAsync([
          "node", "linear",
          "--agent", "test-bot",
          "--credentials-dir", testDir,
          "--format", "json",
          "user", "list",
        ]),
      );

      const output = JSON.parse(logs[0]);
      expect(output.results).toHaveLength(2);
    });
  });

  describe("user me", () => {
    it("prints agent identity from credentials", async () => {
      vi.resetModules();
      const { registerUserCommands } = await import("../commands/user.js");
      const program = makeProgram();
      registerUserCommands(program);

      const logs = await captureOutput(() =>
        program.parseAsync([
          "node", "linear",
          "--agent", "test-bot",
          "--credentials-dir", testDir,
          "--format", "json",
          "user", "me",
        ]),
      );

      const output = JSON.parse(logs[0]);
      expect(output.agent).toBe("test-bot");
      expect(output.actorId).toBe("actor-123");
      expect(output.workspace).toBe("test-workspace");
    });
  });

  // --- Team tests ---
  describe("team list", () => {
    it("returns teams", async () => {
      mockTeams.mockResolvedValue({
        nodes: [
          { id: "t-1", key: "MAIN", name: "Main", description: "Primary team" },
          { id: "t-2", key: "ENG", name: "Engineering", description: null },
        ],
      });

      vi.resetModules();
      const { registerTeamCommands } = await import("../commands/team.js");
      const program = makeProgram();
      registerTeamCommands(program);

      const logs = await captureOutput(() =>
        program.parseAsync([
          "node", "linear",
          "--agent", "test-bot",
          "--credentials-dir", testDir,
          "--format", "json",
          "team", "list",
        ]),
      );

      expect(mockTeams).toHaveBeenCalled();
      const output = JSON.parse(logs[0]);
      expect(output.results).toHaveLength(2);
      expect(output.results[0].key).toBe("MAIN");
    });
  });

  // --- Project tests ---
  describe("project list", () => {
    it("returns projects", async () => {
      mockProjects.mockResolvedValue({
        nodes: [
          { id: "p-1", name: "Q1 Release", state: "started", progress: 0.5, startDate: "2026-01-01", targetDate: "2026-03-31" },
        ],
      });

      vi.resetModules();
      const { registerProjectCommands } = await import("../commands/project.js");
      const program = makeProgram();
      registerProjectCommands(program);

      const logs = await captureOutput(() =>
        program.parseAsync([
          "node", "linear",
          "--agent", "test-bot",
          "--credentials-dir", testDir,
          "--format", "json",
          "project", "list",
        ]),
      );

      expect(mockProjects).toHaveBeenCalled();
      const output = JSON.parse(logs[0]);
      expect(output.results).toHaveLength(1);
      expect(output.results[0].name).toBe("Q1 Release");
    });
  });

  describe("project get", () => {
    it("returns project details", async () => {
      mockProject.mockResolvedValue({
        id: "p-1",
        name: "Q1 Release",
        description: "First quarter release",
        state: "started",
        progress: 0.5,
        startDate: "2026-01-01",
        targetDate: "2026-03-31",
      });

      vi.resetModules();
      const { registerProjectCommands } = await import("../commands/project.js");
      const program = makeProgram();
      registerProjectCommands(program);

      const logs = await captureOutput(() =>
        program.parseAsync([
          "node", "linear",
          "--agent", "test-bot",
          "--credentials-dir", testDir,
          "--format", "json",
          "project", "get", "p-1",
        ]),
      );

      expect(mockProject).toHaveBeenCalledWith("p-1");
      const output = JSON.parse(logs[0]);
      expect(output.name).toBe("Q1 Release");
      expect(output.description).toBe("First quarter release");
    });
  });

  // --- Attachment tests ---
  describe("attachment add", () => {
    it("creates attachment (idempotent per URL)", async () => {
      mockCreateAttachment.mockResolvedValue({
        attachment: Promise.resolve({ id: "att-1" }),
      });

      vi.resetModules();
      const { registerAttachmentCommands } = await import("../commands/attachment.js");
      const program = makeProgram();
      registerAttachmentCommands(program);

      const logs = await captureOutput(() =>
        program.parseAsync([
          "node", "linear",
          "--agent", "test-bot",
          "--credentials-dir", testDir,
          "--format", "json",
          "attachment", "add", "MAIN-42",
          "--url", "https://github.com/repo/pull/1",
          "--title", "PR #1",
        ]),
      );

      expect(mockCreateAttachment).toHaveBeenCalledWith({
        issueId: "MAIN-42",
        url: "https://github.com/repo/pull/1",
        title: "PR #1",
      });

      const output = JSON.parse(logs[0]);
      expect(output.id).toBe("att-1");
      expect(output.url).toBe("https://github.com/repo/pull/1");
    });

    it("calling add twice with same URL is idempotent (SDK handles it)", async () => {
      mockCreateAttachment.mockResolvedValue({
        attachment: Promise.resolve({ id: "att-1" }),
      });

      vi.resetModules();
      const { registerAttachmentCommands } = await import("../commands/attachment.js");

      // First call
      let program = makeProgram();
      registerAttachmentCommands(program);
      await captureOutput(() =>
        program.parseAsync([
          "node", "linear",
          "--agent", "test-bot",
          "--credentials-dir", testDir,
          "--format", "json",
          "attachment", "add", "MAIN-42",
          "--url", "https://github.com/repo/pull/1",
          "--title", "PR #1",
        ]),
      );

      // Second call with same URL
      program = makeProgram();
      registerAttachmentCommands(program);
      await captureOutput(() =>
        program.parseAsync([
          "node", "linear",
          "--agent", "test-bot",
          "--credentials-dir", testDir,
          "--format", "json",
          "attachment", "add", "MAIN-42",
          "--url", "https://github.com/repo/pull/1",
          "--title", "PR #1",
        ]),
      );

      // SDK createAttachment is called both times (idempotency is server-side)
      expect(mockCreateAttachment).toHaveBeenCalledTimes(2);
    });
  });

  describe("attachment list", () => {
    it("lists attachments on an issue", async () => {
      mockIssue.mockResolvedValue({
        attachments: vi.fn().mockResolvedValue({
          nodes: [
            { id: "att-1", url: "https://github.com/repo/pull/1", title: "PR #1" },
            { id: "att-2", url: "https://example.com/doc", title: null },
          ],
        }),
      });

      vi.resetModules();
      const { registerAttachmentCommands } = await import("../commands/attachment.js");
      const program = makeProgram();
      registerAttachmentCommands(program);

      const logs = await captureOutput(() =>
        program.parseAsync([
          "node", "linear",
          "--agent", "test-bot",
          "--credentials-dir", testDir,
          "--format", "json",
          "attachment", "list", "MAIN-42",
        ]),
      );

      const output = JSON.parse(logs[0]);
      expect(output.results).toHaveLength(2);
      expect(output.results[0].url).toBe("https://github.com/repo/pull/1");
    });
  });

  describe("attachment upload", () => {
    it("uploads a local file and creates issue attachment", async () => {
      const localFile = join(testDir, "image.png");
      writeFileSync(localFile, "file-content");

      mockFileUpload.mockResolvedValue({
        success: true,
        uploadFile: {
          uploadUrl: "https://uploads.linear.app/upload-1",
          assetUrl: "https://assets.linear.app/file-1.png",
          headers: [{ key: "x-test", value: "abc" }],
        },
      });
      mockCreateAttachment.mockResolvedValue({
        attachment: Promise.resolve({ id: "att-upload-1" }),
      });
      mockFetch.mockResolvedValue({ ok: true, status: 200 });

      vi.resetModules();
      const { registerAttachmentCommands } = await import("../commands/attachment.js");
      const program = makeProgram();
      registerAttachmentCommands(program);

      const logs = await captureOutput(() =>
        program.parseAsync([
          "node", "linear",
          "--agent", "test-bot",
          "--credentials-dir", testDir,
          "--format", "json",
          "attachment", "upload", localFile,
          "--issue", "MAIN-42",
        ]),
      );

      expect(mockFileUpload).toHaveBeenCalledWith("image/png", "image.png", 12);
      expect(mockFetch).toHaveBeenCalledWith("https://uploads.linear.app/upload-1", {
        method: "PUT",
        headers: {
          "Content-Type": "image/png",
          "x-test": "abc",
        },
        body: Buffer.from("file-content"),
      });
      expect(mockCreateAttachment).toHaveBeenCalledWith({
        issueId: "MAIN-42",
        url: "https://assets.linear.app/file-1.png",
        title: "image.png",
      });

      const output = JSON.parse(logs[0]);
      expect(output.id).toBe("att-upload-1");
      expect(output.issueId).toBe("MAIN-42");
      expect(output.projectId).toBeNull();
    });

    it("fails when target is missing", async () => {
      const localFile = join(testDir, "spec.pdf");
      writeFileSync(localFile, "pdf");

      vi.resetModules();
      const { registerAttachmentCommands } = await import("../commands/attachment.js");
      const program = makeProgram();
      registerAttachmentCommands(program);

      const errors: string[] = [];
      const origError = console.error;
      console.error = (...args: unknown[]) => errors.push(args.join(" "));

      await expect(
        program.parseAsync([
          "node", "linear",
          "--agent", "test-bot",
          "--credentials-dir", testDir,
          "attachment", "upload", localFile,
        ]),
      ).rejects.toThrow('process.exit unexpectedly called with "4"');

      console.error = origError;
      expect(errors[0]).toContain("exactly one of --issue or --project");
      expect(mockFileUpload).not.toHaveBeenCalled();
    });
  });

  describe("attachment remove", () => {
    it("deletes an attachment", async () => {
      mockDeleteAttachment.mockResolvedValue({ success: true });

      vi.resetModules();
      const { registerAttachmentCommands } = await import("../commands/attachment.js");
      const program = makeProgram();
      registerAttachmentCommands(program);

      const logs = await captureOutput(() =>
        program.parseAsync([
          "node", "linear",
          "--agent", "test-bot",
          "--credentials-dir", testDir,
          "--format", "json",
          "attachment", "remove", "att-1",
        ]),
      );

      expect(mockDeleteAttachment).toHaveBeenCalledWith("att-1");
      const output = JSON.parse(logs[0]);
      expect(output.status).toBe("removed");
    });
  });

  // --- State tests ---
  describe("state list", () => {
    it("lists states and populates cache", async () => {
      const mockStatesNodes = [
        { id: "s-1", name: "Backlog", type: "backlog", color: "#bbb", position: 0 },
        { id: "s-2", name: "In Progress", type: "started", color: "#f9a825", position: 1 },
        { id: "s-3", name: "Done", type: "completed", color: "#4caf50", position: 2 },
      ];

      mockTeams.mockResolvedValue({
        nodes: [
          {
            id: "t-1",
            key: "MAIN",
            name: "Main",
            states: vi.fn().mockResolvedValue({ nodes: mockStatesNodes }),
          },
        ],
      });

      vi.resetModules();
      const { registerStateCommands } = await import("../commands/state.js");
      const program = makeProgram();
      registerStateCommands(program);

      const logs = await captureOutput(() =>
        program.parseAsync([
          "node", "linear",
          "--agent", "test-bot",
          "--credentials-dir", testDir,
          "--format", "json",
          "state", "list",
        ]),
      );

      const output = JSON.parse(logs[0]);
      expect(output.results).toHaveLength(3);
      expect(output.results[0].name).toBe("Backlog");
      expect(output.results[1].name).toBe("In Progress");

      // Verify cache was written
      const cachePath = join(testDir, "test-bot.cache.json");
      const cache = JSON.parse(readFileSync(cachePath, "utf-8"));
      expect(cache.teams.MAIN.states).toEqual({
        Backlog: "s-1",
        "In Progress": "s-2",
        Done: "s-3",
      });
    });

    it("lists states filtered by team", async () => {
      const mockStatesNodes = [
        { id: "s-1", name: "Todo", type: "unstarted", color: "#999", position: 0 },
      ];

      mockTeams.mockResolvedValue({
        nodes: [
          {
            id: "t-1",
            key: "ENG",
            name: "Engineering",
            states: vi.fn().mockResolvedValue({ nodes: mockStatesNodes }),
          },
        ],
      });

      vi.resetModules();
      const { registerStateCommands } = await import("../commands/state.js");
      const program = makeProgram();
      registerStateCommands(program);

      const logs = await captureOutput(() =>
        program.parseAsync([
          "node", "linear",
          "--agent", "test-bot",
          "--credentials-dir", testDir,
          "--format", "json",
          "state", "list",
          "--team", "Engineering",
        ]),
      );

      const output = JSON.parse(logs[0]);
      expect(output.results).toHaveLength(1);
      expect(output.results[0].name).toBe("Todo");

      // Verify cache was written for the correct team
      const cachePath = join(testDir, "test-bot.cache.json");
      const cache = JSON.parse(readFileSync(cachePath, "utf-8"));
      expect(cache.teams.ENG.states).toEqual({ Todo: "s-1" });
    });
  });
});
