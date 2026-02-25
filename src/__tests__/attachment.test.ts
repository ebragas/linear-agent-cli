import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { writeCredentials } from "../credentials.js";
import type { Credentials } from "../credentials.js";

const mockCreateAttachment = vi.fn();
const mockDeleteAttachment = vi.fn();
const mockFileUpload = vi.fn();
const mockIssue = vi.fn();

vi.mock("@linear/sdk", () => ({
  LinearClient: vi.fn().mockImplementation(() => ({
    createAttachment: mockCreateAttachment,
    deleteAttachment: mockDeleteAttachment,
    fileUpload: mockFileUpload,
    issue: mockIssue,
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

describe("attachment commands", () => {
  let testDir: string;
  let origStdinIsTTY: boolean | undefined;

  beforeEach(() => {
    testDir = join(tmpdir(), `linear-cli-attachment-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    writeCredentials("test-bot", testDir, validCredentials);

    origStdinIsTTY = process.stdin.isTTY;
    (process.stdin as { isTTY: boolean | undefined }).isTTY = true;

    mockCreateAttachment.mockReset();
    mockDeleteAttachment.mockReset();
    mockFileUpload.mockReset();
    mockIssue.mockReset();
  });

  afterEach(() => {
    (process.stdin as { isTTY: boolean | undefined }).isTTY = origStdinIsTTY;
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch {
      // cleanup best effort
    }
  });

  describe("attachment add", () => {
    it("creates an attachment with --url", async () => {
      const { registerAttachmentCommands } = await import(
        "../commands/attachment.js"
      );
      const { Command } = await import("commander");

      mockCreateAttachment.mockResolvedValueOnce({
        success: true,
        attachment: Promise.resolve({ id: "attach-1" }),
      });

      const program = new Command();
      program
        .option("--agent <id>")
        .option("--credentials-dir <path>")
        .option("--format <format>");
      registerAttachmentCommands(program);

      const logs: string[] = [];
      const origLog = console.log;
      console.log = (...args: unknown[]) => logs.push(args.join(" "));

      try {
        await program.parseAsync([
          "node", "linear",
          "--agent", "test-bot",
          "--credentials-dir", testDir,
          "--format", "json",
          "attachment", "add", "MAIN-42",
          "--url", "https://example.com/file.png",
          "--title", "Test File",
        ]);
      } finally {
        console.log = origLog;
      }

      expect(mockCreateAttachment).toHaveBeenCalledWith({
        issueId: "MAIN-42",
        url: "https://example.com/file.png",
        title: "Test File",
      });
      const output = JSON.parse(logs[0]);
      expect(output.id).toBe("attach-1");
      expect(output.url).toBe("https://example.com/file.png");
    });
  });

  describe("attachment list", () => {
    it("lists attachments on an issue", async () => {
      const { registerAttachmentCommands } = await import(
        "../commands/attachment.js"
      );
      const { Command } = await import("commander");

      mockIssue.mockResolvedValueOnce({
        attachments: () =>
          Promise.resolve({
            nodes: [
              { id: "a1", url: "https://example.com/1", title: "File 1" },
              { id: "a2", url: "https://example.com/2", title: null },
            ],
          }),
      });

      const program = new Command();
      program
        .option("--agent <id>")
        .option("--credentials-dir <path>")
        .option("--format <format>");
      registerAttachmentCommands(program);

      const logs: string[] = [];
      const origLog = console.log;
      console.log = (...args: unknown[]) => logs.push(args.join(" "));

      try {
        await program.parseAsync([
          "node", "linear",
          "--agent", "test-bot",
          "--credentials-dir", testDir,
          "--format", "json",
          "attachment", "list", "MAIN-42",
        ]);
      } finally {
        console.log = origLog;
      }

      const output = JSON.parse(logs[0]);
      expect(output.results).toHaveLength(2);
      expect(output.results[0].id).toBe("a1");
      expect(output.results[1].title).toBeNull();
    });
  });

  describe("attachment remove", () => {
    it("removes an attachment by id", async () => {
      const { registerAttachmentCommands } = await import(
        "../commands/attachment.js"
      );
      const { Command } = await import("commander");

      mockDeleteAttachment.mockResolvedValueOnce({ success: true });

      const program = new Command();
      program
        .option("--agent <id>")
        .option("--credentials-dir <path>")
        .option("--format <format>");
      registerAttachmentCommands(program);

      const logs: string[] = [];
      const origLog = console.log;
      console.log = (...args: unknown[]) => logs.push(args.join(" "));

      try {
        await program.parseAsync([
          "node", "linear",
          "--agent", "test-bot",
          "--credentials-dir", testDir,
          "--format", "json",
          "attachment", "remove", "attach-99",
        ]);
      } finally {
        console.log = origLog;
      }

      expect(mockDeleteAttachment).toHaveBeenCalledWith("attach-99");
      const output = JSON.parse(logs[0]);
      expect(output.status).toBe("removed");
      expect(output.attachmentId).toBe("attach-99");
    });
  });

  describe("attachment upload", () => {
    it("uploads a file and creates an attachment on an issue", async () => {
      const { registerAttachmentCommands } = await import(
        "../commands/attachment.js"
      );
      const { Command } = await import("commander");

      // Create a temp file to upload
      const testFilePath = join(testDir, "test-image.png");
      writeFileSync(testFilePath, "fake-png-content");

      const assetUrl = "https://uploads.linear.app/asset-123/test-image.png";
      const uploadUrl = "https://s3.amazonaws.com/signed-upload-url";

      mockFileUpload.mockResolvedValueOnce({
        success: true,
        uploadFile: {
          uploadUrl,
          assetUrl,
          filename: "test-image.png",
          contentType: "image/png",
          size: 16,
          headers: [{ key: "x-amz-acl", value: "public-read" }],
        },
      });

      mockCreateAttachment.mockResolvedValueOnce({
        success: true,
        attachment: Promise.resolve({ id: "attach-new-1" }),
      });

      // Mock fetch for the S3 PUT request
      const origFetch = global.fetch;
      const fetchSpy = vi.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: "OK",
      } as Response);
      global.fetch = fetchSpy;

      const program = new Command();
      program
        .option("--agent <id>")
        .option("--credentials-dir <path>")
        .option("--format <format>");
      registerAttachmentCommands(program);

      const logs: string[] = [];
      const origLog = console.log;
      console.log = (...args: unknown[]) => logs.push(args.join(" "));

      try {
        await program.parseAsync([
          "node", "linear",
          "--agent", "test-bot",
          "--credentials-dir", testDir,
          "--format", "json",
          "attachment", "upload", testFilePath,
          "--issue", "MAIN-42",
          "--title", "Test Screenshot",
        ]);
      } finally {
        console.log = origLog;
        global.fetch = origFetch;
      }

      // Verify fileUpload was called with correct content type
      expect(mockFileUpload).toHaveBeenCalledWith(
        "image/png",
        "test-image.png",
        16
      );

      // Verify S3 PUT was called with correct headers
      expect(fetchSpy).toHaveBeenCalledWith(
        uploadUrl,
        expect.objectContaining({
          method: "PUT",
          headers: expect.objectContaining({
            "Content-Type": "image/png",
            "x-amz-acl": "public-read",
          }),
        })
      );

      // Verify attachment was created with assetUrl
      expect(mockCreateAttachment).toHaveBeenCalledWith({
        issueId: "MAIN-42",
        url: assetUrl,
        title: "Test Screenshot",
      });

      const output = JSON.parse(logs[0]);
      expect(output.id).toBe("attach-new-1");
      expect(output.url).toBe(assetUrl);
      expect(output.issueId).toBe("MAIN-42");
    });

    it("uses filename as default title when --title is omitted", async () => {
      const { registerAttachmentCommands } = await import(
        "../commands/attachment.js"
      );
      const { Command } = await import("commander");

      const testFilePath = join(testDir, "report.pdf");
      writeFileSync(testFilePath, "pdf-content");

      const assetUrl = "https://uploads.linear.app/asset-456/report.pdf";

      mockFileUpload.mockResolvedValueOnce({
        success: true,
        uploadFile: {
          uploadUrl: "https://s3.amazonaws.com/upload",
          assetUrl,
          filename: "report.pdf",
          contentType: "application/pdf",
          size: 11,
          headers: [],
        },
      });

      mockCreateAttachment.mockResolvedValueOnce({
        success: true,
        attachment: Promise.resolve({ id: "attach-new-2" }),
      });

      const origFetch = global.fetch;
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: "OK",
      } as Response);

      const program = new Command();
      program
        .option("--agent <id>")
        .option("--credentials-dir <path>")
        .option("--format <format>");
      registerAttachmentCommands(program);

      const logs: string[] = [];
      const origLog = console.log;
      console.log = (...args: unknown[]) => logs.push(args.join(" "));

      try {
        await program.parseAsync([
          "node", "linear",
          "--agent", "test-bot",
          "--credentials-dir", testDir,
          "--format", "json",
          "attachment", "upload", testFilePath,
          "--issue", "MAIN-42",
        ]);
      } finally {
        console.log = origLog;
        global.fetch = origFetch;
      }

      expect(mockCreateAttachment).toHaveBeenCalledWith({
        issueId: "MAIN-42",
        url: assetUrl,
        title: "report.pdf",
      });

      const output = JSON.parse(logs[0]);
      expect(output.title).toBe("report.pdf");
    });

    it("uploads a file for a project and returns assetUrl without creating attachment", async () => {
      const { registerAttachmentCommands } = await import(
        "../commands/attachment.js"
      );
      const { Command } = await import("commander");

      const testFilePath = join(testDir, "spec.pdf");
      writeFileSync(testFilePath, "spec-content");

      const assetUrl = "https://uploads.linear.app/asset-789/spec.pdf";

      mockFileUpload.mockResolvedValueOnce({
        success: true,
        uploadFile: {
          uploadUrl: "https://s3.amazonaws.com/upload",
          assetUrl,
          filename: "spec.pdf",
          contentType: "application/pdf",
          size: 12,
          headers: [],
        },
      });

      const origFetch = global.fetch;
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: "OK",
      } as Response);

      const program = new Command();
      program
        .option("--agent <id>")
        .option("--credentials-dir <path>")
        .option("--format <format>");
      registerAttachmentCommands(program);

      const logs: string[] = [];
      const origLog = console.log;
      console.log = (...args: unknown[]) => logs.push(args.join(" "));

      try {
        await program.parseAsync([
          "node", "linear",
          "--agent", "test-bot",
          "--credentials-dir", testDir,
          "--format", "json",
          "attachment", "upload", testFilePath,
          "--project", "Linear CLI",
        ]);
      } finally {
        console.log = origLog;
        global.fetch = origFetch;
      }

      // createAttachment should NOT be called for projects
      expect(mockCreateAttachment).not.toHaveBeenCalled();

      const output = JSON.parse(logs[0]);
      expect(output.url).toBe(assetUrl);
      expect(output.projectId).toBe("Linear CLI");
    });

    it("exits with error when neither --issue nor --project is provided", async () => {
      const { registerAttachmentCommands } = await import(
        "../commands/attachment.js"
      );
      const { Command } = await import("commander");

      const testFilePath = join(testDir, "no-target.txt");
      writeFileSync(testFilePath, "content");

      const program = new Command();
      program
        .option("--agent <id>")
        .option("--credentials-dir <path>")
        .option("--format <format>");
      registerAttachmentCommands(program);

      const exitSpy = vi.spyOn(process, "exit").mockImplementation((code) => {
        throw new Error(`process.exit(${code})`);
      });
      const errLogs: string[] = [];
      const origErr = console.error;
      console.error = (...args: unknown[]) => errLogs.push(args.join(" "));

      try {
        await expect(
          program.parseAsync([
            "node", "linear",
            "--agent", "test-bot",
            "--credentials-dir", testDir,
            "--format", "json",
            "attachment", "upload", testFilePath,
          ])
        ).rejects.toThrow("process.exit(4)");
      } finally {
        console.error = origErr;
        exitSpy.mockRestore();
      }

      expect(mockFileUpload).not.toHaveBeenCalled();
      expect(errLogs[0]).toContain("--issue or --project is required");
    });

    it("exits with error when file does not exist", async () => {
      const { registerAttachmentCommands } = await import(
        "../commands/attachment.js"
      );
      const { Command } = await import("commander");

      const nonExistentPath = join(testDir, "does-not-exist.txt");

      const program = new Command();
      program
        .option("--agent <id>")
        .option("--credentials-dir <path>")
        .option("--format <format>");
      registerAttachmentCommands(program);

      const exitSpy = vi.spyOn(process, "exit").mockImplementation((code) => {
        throw new Error(`process.exit(${code})`);
      });
      const errLogs: string[] = [];
      const origErr = console.error;
      console.error = (...args: unknown[]) => errLogs.push(args.join(" "));

      try {
        await expect(
          program.parseAsync([
            "node", "linear",
            "--agent", "test-bot",
            "--credentials-dir", testDir,
            "--format", "json",
            "attachment", "upload", nonExistentPath,
            "--issue", "MAIN-42",
          ])
        ).rejects.toThrow("process.exit(4)");
      } finally {
        console.error = origErr;
        exitSpy.mockRestore();
      }

      expect(mockFileUpload).not.toHaveBeenCalled();
      expect(errLogs[0]).toContain("file not found");
    });

    it("exits with error when path is a directory", async () => {
      const { registerAttachmentCommands } = await import(
        "../commands/attachment.js"
      );
      const { Command } = await import("commander");

      const program = new Command();
      program
        .option("--agent <id>")
        .option("--credentials-dir <path>")
        .option("--format <format>");
      registerAttachmentCommands(program);

      const exitSpy = vi.spyOn(process, "exit").mockImplementation((code) => {
        throw new Error(`process.exit(${code})`);
      });
      const errLogs: string[] = [];
      const origErr = console.error;
      console.error = (...args: unknown[]) => errLogs.push(args.join(" "));

      try {
        await expect(
          program.parseAsync([
            "node", "linear",
            "--agent", "test-bot",
            "--credentials-dir", testDir,
            "--format", "json",
            "attachment", "upload", testDir,
            "--issue", "MAIN-42",
          ])
        ).rejects.toThrow("process.exit(4)");
      } finally {
        console.error = origErr;
        exitSpy.mockRestore();
      }

      expect(mockFileUpload).not.toHaveBeenCalled();
      expect(errLogs[0]).toContain("is not a file");
    });

    it("throws when S3 upload fails", async () => {
      const { registerAttachmentCommands } = await import(
        "../commands/attachment.js"
      );
      const { Command } = await import("commander");

      const testFilePath = join(testDir, "s3-fail.txt");
      writeFileSync(testFilePath, "content");

      mockFileUpload.mockResolvedValueOnce({
        success: true,
        uploadFile: {
          uploadUrl: "https://s3.amazonaws.com/upload",
          assetUrl: "https://uploads.linear.app/asset-000/s3-fail.txt",
          filename: "s3-fail.txt",
          contentType: "text/plain",
          size: 7,
          headers: [],
        },
      });

      const origFetch = global.fetch;
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
      } as Response);

      const program = new Command();
      program
        .option("--agent <id>")
        .option("--credentials-dir <path>")
        .option("--format <format>");
      registerAttachmentCommands(program);

      try {
        await expect(
          program.parseAsync([
            "node", "linear",
            "--agent", "test-bot",
            "--credentials-dir", testDir,
            "--format", "json",
            "attachment", "upload", testFilePath,
            "--issue", "MAIN-42",
          ])
        ).rejects.toThrow("Upload failed: 500");
      } finally {
        global.fetch = origFetch;
      }

      expect(mockCreateAttachment).not.toHaveBeenCalled();
    });

    it("throws when Linear returns null uploadFile", async () => {
      const { registerAttachmentCommands } = await import(
        "../commands/attachment.js"
      );
      const { Command } = await import("commander");

      const testFilePath = join(testDir, "null-upload.txt");
      writeFileSync(testFilePath, "content");

      mockFileUpload.mockResolvedValueOnce({
        success: true,
        uploadFile: null,
      });

      const origFetch = global.fetch;
      const fetchSpy = vi.fn();
      global.fetch = fetchSpy;

      const program = new Command();
      program
        .option("--agent <id>")
        .option("--credentials-dir <path>")
        .option("--format <format>");
      registerAttachmentCommands(program);

      try {
        await expect(
          program.parseAsync([
            "node", "linear",
            "--agent", "test-bot",
            "--credentials-dir", testDir,
            "--format", "json",
            "attachment", "upload", testFilePath,
            "--issue", "MAIN-42",
          ])
        ).rejects.toThrow("Failed to get upload URL from Linear");
      } finally {
        global.fetch = origFetch;
      }

      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });
});
