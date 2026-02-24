import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { writeCredentials } from "../credentials.js";
import type { Credentials } from "../credentials.js";

// Mock LinearClient
const mockComments = vi.fn();
const mockCreateComment = vi.fn();
const mockUpdateComment = vi.fn();
const mockIssue = vi.fn();

vi.mock("@linear/sdk", () => ({
  LinearClient: vi.fn().mockImplementation(() => ({
    issue: mockIssue,
    createComment: mockCreateComment,
    updateComment: mockUpdateComment,
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

describe("comment commands", () => {
  let testDir: string;
  let origStdinIsTTY: boolean | undefined;

  beforeEach(() => {
    testDir = join(tmpdir(), `linear-cli-comment-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    writeCredentials("test-bot", testDir, validCredentials);
    mockIssue.mockReset();
    mockCreateComment.mockReset();
    mockUpdateComment.mockReset();
    mockComments.mockReset();

    // Ensure stdin is treated as a TTY so tests don't accidentally read from stdin
    origStdinIsTTY = process.stdin.isTTY;
    (process.stdin as { isTTY: boolean | undefined }).isTTY = true;
  });

  afterEach(() => {
    (process.stdin as { isTTY: boolean | undefined }).isTTY = origStdinIsTTY;
    try {
      const { rmSync } = require("fs");
      rmSync(testDir, { recursive: true, force: true });
    } catch {
      // cleanup best effort
    }
  });

  describe("comment list", () => {
    it("fetches comments from an issue", async () => {
      const { registerCommentCommands } = await import(
        "../commands/comment.js"
      );
      const { Command } = await import("commander");

      mockIssue.mockResolvedValueOnce({
        comments: () =>
          Promise.resolve({
            nodes: [
              {
                id: "comment-1",
                body: "First comment",
                createdAt: "2026-01-01T00:00:00Z",
                parentId: null,
                user: Promise.resolve({ id: "user-1", name: "Alice" }),
              },
              {
                id: "comment-2",
                body: "Reply",
                createdAt: "2026-01-02T00:00:00Z",
                parentId: "comment-1",
                user: Promise.resolve({ id: "user-2", name: "Bob" }),
              },
            ],
          }),
      });

      const program = new Command();
      program
        .option("--agent <id>")
        .option("--credentials-dir <path>")
        .option("--format <format>");
      registerCommentCommands(program);

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
          "comment",
          "list",
          "MAIN-42",
        ]);
      } finally {
        console.log = origLog;
      }

      expect(mockIssue).toHaveBeenCalledWith("MAIN-42");
      expect(logs.length).toBeGreaterThan(0);
      const output = JSON.parse(logs[0]);
      expect(output.results).toHaveLength(2);
      expect(output.results[0].author).toBe("Alice");
      expect(output.results[0].body).toBe("First comment");
      expect(output.results[1].parentId).toBe("comment-1");
    });
  });

  describe("comment add", () => {
    it("creates a comment with --body", async () => {
      const { registerCommentCommands } = await import(
        "../commands/comment.js"
      );
      const { Command } = await import("commander");

      mockCreateComment.mockResolvedValueOnce({
        success: true,
        comment: Promise.resolve({ id: "new-comment-1" }),
      });

      const program = new Command();
      program
        .option("--agent <id>")
        .option("--credentials-dir <path>")
        .option("--format <format>");
      registerCommentCommands(program);

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
          "comment",
          "add",
          "MAIN-42",
          "--body",
          "Hello world",
        ]);
      } finally {
        console.log = origLog;
      }

      expect(mockCreateComment).toHaveBeenCalledWith({
        issueId: "MAIN-42",
        body: "Hello world",
      });
      const output = JSON.parse(logs[0]);
      expect(output.id).toBe("new-comment-1");
      expect(output.success).toBe(true);
    });

    it("creates a comment with --body-file", async () => {
      const { registerCommentCommands } = await import(
        "../commands/comment.js"
      );
      const { Command } = await import("commander");

      const bodyFilePath = join(testDir, "comment-body.md");
      writeFileSync(bodyFilePath, "Content from file");

      mockCreateComment.mockResolvedValueOnce({
        success: true,
        comment: Promise.resolve({ id: "new-comment-2" }),
      });

      const program = new Command();
      program
        .option("--agent <id>")
        .option("--credentials-dir <path>")
        .option("--format <format>");
      registerCommentCommands(program);

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
          "comment",
          "add",
          "MAIN-42",
          "--body-file",
          bodyFilePath,
        ]);
      } finally {
        console.log = origLog;
      }

      expect(mockCreateComment).toHaveBeenCalledWith({
        issueId: "MAIN-42",
        body: "Content from file",
      });
      const output = JSON.parse(logs[0]);
      expect(output.body).toBe("Content from file");
    });

    it("creates a threaded reply with --reply-to", async () => {
      const { registerCommentCommands } = await import(
        "../commands/comment.js"
      );
      const { Command } = await import("commander");

      mockCreateComment.mockResolvedValueOnce({
        success: true,
        comment: Promise.resolve({ id: "reply-1" }),
      });

      const program = new Command();
      program
        .option("--agent <id>")
        .option("--credentials-dir <path>")
        .option("--format <format>");
      registerCommentCommands(program);

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
          "comment",
          "add",
          "MAIN-42",
          "--body",
          "This is a reply",
          "--reply-to",
          "parent-comment-id",
        ]);
      } finally {
        console.log = origLog;
      }

      expect(mockCreateComment).toHaveBeenCalledWith({
        issueId: "MAIN-42",
        body: "This is a reply",
        parentId: "parent-comment-id",
      });
      const output = JSON.parse(logs[0]);
      expect(output.parentId).toBe("parent-comment-id");
    });
  });

  describe("comment add stdin", () => {
    it("creates a comment reading body from stdin", async () => {
      vi.resetModules();

      vi.doMock("fs", async () => {
        const actual = await vi.importActual<typeof import("fs")>("fs");
        return {
          ...actual,
          readFileSync: (fd: unknown, ...args: unknown[]) => {
            if (fd === 0) return "Piped stdin content";
            return (actual.readFileSync as (...a: unknown[]) => unknown)(fd, ...args);
          },
        };
      });

      (process.stdin as { isTTY: boolean | undefined }).isTTY = undefined;

      try {
        const { registerCommentCommands } = await import("../commands/comment.js");
        const { Command } = await import("commander");

        mockCreateComment.mockResolvedValueOnce({
          success: true,
          comment: Promise.resolve({ id: "stdin-comment-1" }),
        });

        const program = new Command();
        program
          .option("--agent <id>")
          .option("--credentials-dir <path>")
          .option("--format <format>");
        registerCommentCommands(program);

        const logs: string[] = [];
        const origLog = console.log;
        console.log = (...a: unknown[]) => logs.push(a.join(" "));

        try {
          await program.parseAsync([
            "node", "linear",
            "--agent", "test-bot",
            "--credentials-dir", testDir,
            "--format", "json",
            "comment", "add", "MAIN-42",
          ]);
        } finally {
          console.log = origLog;
        }

        expect(mockCreateComment).toHaveBeenCalledWith({
          issueId: "MAIN-42",
          body: "Piped stdin content",
        });
        const output = JSON.parse(logs[0]);
        expect(output.id).toBe("stdin-comment-1");
      } finally {
        vi.doUnmock("fs");
      }
    });
  });

  describe("comment update", () => {
    it("updates a comment body", async () => {
      const { registerCommentCommands } = await import(
        "../commands/comment.js"
      );
      const { Command } = await import("commander");

      mockUpdateComment.mockResolvedValueOnce({
        success: true,
      });

      const program = new Command();
      program
        .option("--agent <id>")
        .option("--credentials-dir <path>")
        .option("--format <format>");
      registerCommentCommands(program);

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
          "comment",
          "update",
          "comment-123",
          "--body",
          "Updated text",
        ]);
      } finally {
        console.log = origLog;
      }

      expect(mockUpdateComment).toHaveBeenCalledWith("comment-123", {
        body: "Updated text",
      });
      const output = JSON.parse(logs[0]);
      expect(output.id).toBe("comment-123");
      expect(output.success).toBe(true);
    });
  });
});
