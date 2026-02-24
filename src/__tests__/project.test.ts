import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { writeCredentials } from "../credentials.js";
import type { Credentials } from "../credentials.js";

const mockUpdateProject = vi.fn();
const mockProject = vi.fn();
const mockProjects = vi.fn();
const mockUsers = vi.fn();

vi.mock("@linear/sdk", () => ({
  LinearClient: vi.fn().mockImplementation(() => ({
    project: mockProject,
    projects: mockProjects,
    updateProject: mockUpdateProject,
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

describe("project commands", () => {
  let testDir: string;
  let origStdinIsTTY: boolean | undefined;

  beforeEach(() => {
    testDir = join(tmpdir(), `linear-cli-project-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    writeCredentials("test-bot", testDir, validCredentials);

    origStdinIsTTY = process.stdin.isTTY;
    (process.stdin as { isTTY: boolean | undefined }).isTTY = true;

    mockUpdateProject.mockReset();
    mockProject.mockReset();
    mockProjects.mockReset();
    mockUsers.mockReset();
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

  describe("project update", () => {
    it("updates project name", async () => {
      vi.resetModules();
      const { registerProjectCommands } = await import("../commands/project.js");
      const { Command } = await import("commander");

      mockUpdateProject.mockResolvedValue({
        success: true,
        project: Promise.resolve({
          id: "proj-uuid-1",
          name: "New Name",
          url: "https://linear.app/test/project/proj-1",
        }),
      });

      const program = new Command();
      program.option("--agent <id>").option("--credentials-dir <path>").option("--format <format>");
      registerProjectCommands(program);

      const logs: string[] = [];
      const origLog = console.log;
      console.log = (...args: unknown[]) => logs.push(args.join(" "));

      try {
        await program.parseAsync([
          "node", "linear",
          "--agent", "test-bot",
          "--credentials-dir", testDir,
          "--format", "json",
          "project", "update", "proj-uuid-1",
          "--name", "New Name",
        ]);
      } finally {
        console.log = origLog;
      }

      expect(mockUpdateProject).toHaveBeenCalledWith("proj-uuid-1", { name: "New Name" });
      const output = JSON.parse(logs[0]);
      expect(output.name).toBe("New Name");
      expect(output.success).toBe(true);
    });

    it("updates description from --description flag", async () => {
      vi.resetModules();
      const { registerProjectCommands } = await import("../commands/project.js");
      const { Command } = await import("commander");

      mockUpdateProject.mockResolvedValue({
        success: true,
        project: Promise.resolve({
          id: "proj-uuid-1",
          name: "My Project",
          url: "https://linear.app/test/project/proj-1",
        }),
      });

      const program = new Command();
      program.option("--agent <id>").option("--credentials-dir <path>").option("--format <format>");
      registerProjectCommands(program);

      const logs: string[] = [];
      const origLog = console.log;
      console.log = (...args: unknown[]) => logs.push(args.join(" "));

      try {
        await program.parseAsync([
          "node", "linear",
          "--agent", "test-bot",
          "--credentials-dir", testDir,
          "--format", "json",
          "project", "update", "proj-uuid-1",
          "--description", "Updated description",
        ]);
      } finally {
        console.log = origLog;
      }

      expect(mockUpdateProject).toHaveBeenCalledWith(
        "proj-uuid-1",
        expect.objectContaining({ description: "Updated description" })
      );
    });

    it("updates description from --description-file", async () => {
      vi.resetModules();
      const { registerProjectCommands } = await import("../commands/project.js");
      const { Command } = await import("commander");

      const descFile = join(testDir, "desc.md");
      writeFileSync(descFile, "# Description from file");

      mockUpdateProject.mockResolvedValue({
        success: true,
        project: Promise.resolve({
          id: "proj-uuid-1",
          name: "My Project",
          url: "https://linear.app/test/project/proj-1",
        }),
      });

      const program = new Command();
      program.option("--agent <id>").option("--credentials-dir <path>").option("--format <format>");
      registerProjectCommands(program);

      const logs: string[] = [];
      const origLog = console.log;
      console.log = (...args: unknown[]) => logs.push(args.join(" "));

      try {
        await program.parseAsync([
          "node", "linear",
          "--agent", "test-bot",
          "--credentials-dir", testDir,
          "--format", "json",
          "project", "update", "proj-uuid-1",
          "--description-file", descFile,
        ]);
      } finally {
        console.log = origLog;
      }

      expect(mockUpdateProject).toHaveBeenCalledWith(
        "proj-uuid-1",
        expect.objectContaining({ description: "# Description from file" })
      );
    });

    it("sets target-date and start-date", async () => {
      vi.resetModules();
      const { registerProjectCommands } = await import("../commands/project.js");
      const { Command } = await import("commander");

      mockUpdateProject.mockResolvedValue({
        success: true,
        project: Promise.resolve({ id: "proj-uuid-1", name: "P", url: null }),
      });

      const program = new Command();
      program.option("--agent <id>").option("--credentials-dir <path>").option("--format <format>");
      registerProjectCommands(program);

      const logs: string[] = [];
      const origLog = console.log;
      console.log = (...args: unknown[]) => logs.push(args.join(" "));

      try {
        await program.parseAsync([
          "node", "linear",
          "--agent", "test-bot",
          "--credentials-dir", testDir,
          "--format", "json",
          "project", "update", "proj-uuid-1",
          "--start-date", "2026-03-01",
          "--target-date", "2026-06-30",
        ]);
      } finally {
        console.log = origLog;
      }

      expect(mockUpdateProject).toHaveBeenCalledWith(
        "proj-uuid-1",
        expect.objectContaining({ startDate: "2026-03-01", targetDate: "2026-06-30" })
      );
    });

    it('clears start-date when passed "null"', async () => {
      vi.resetModules();
      const { registerProjectCommands } = await import("../commands/project.js");
      const { Command } = await import("commander");

      mockUpdateProject.mockResolvedValue({
        success: true,
        project: Promise.resolve({ id: "proj-uuid-1", name: "P", url: null }),
      });

      const program = new Command();
      program.option("--agent <id>").option("--credentials-dir <path>").option("--format <format>");
      registerProjectCommands(program);

      const logs: string[] = [];
      const origLog = console.log;
      console.log = (...args: unknown[]) => logs.push(args.join(" "));

      try {
        await program.parseAsync([
          "node", "linear",
          "--agent", "test-bot",
          "--credentials-dir", testDir,
          "--format", "json",
          "project", "update", "proj-uuid-1",
          "--start-date", "null",
        ]);
      } finally {
        console.log = origLog;
      }

      expect(mockUpdateProject).toHaveBeenCalledWith(
        "proj-uuid-1",
        expect.objectContaining({ startDate: null })
      );
    });

    it('clears target-date when passed "null"', async () => {
      vi.resetModules();
      const { registerProjectCommands } = await import("../commands/project.js");
      const { Command } = await import("commander");

      mockUpdateProject.mockResolvedValue({
        success: true,
        project: Promise.resolve({ id: "proj-uuid-1", name: "P", url: null }),
      });

      const program = new Command();
      program.option("--agent <id>").option("--credentials-dir <path>").option("--format <format>");
      registerProjectCommands(program);

      const logs: string[] = [];
      const origLog = console.log;
      console.log = (...args: unknown[]) => logs.push(args.join(" "));

      try {
        await program.parseAsync([
          "node", "linear",
          "--agent", "test-bot",
          "--credentials-dir", testDir,
          "--format", "json",
          "project", "update", "proj-uuid-1",
          "--target-date", "null",
        ]);
      } finally {
        console.log = origLog;
      }

      expect(mockUpdateProject).toHaveBeenCalledWith(
        "proj-uuid-1",
        expect.objectContaining({ targetDate: null })
      );
    });

    it("resolves lead by name", async () => {
      vi.resetModules();
      const { registerProjectCommands } = await import("../commands/project.js");
      const { Command } = await import("commander");

      mockUsers.mockResolvedValue({
        nodes: [{ id: "user-1", name: "Alice", email: "alice@example.com", displayName: "Alice" }],
      });

      mockUpdateProject.mockResolvedValue({
        success: true,
        project: Promise.resolve({ id: "proj-uuid-1", name: "P", url: null }),
      });

      const program = new Command();
      program.option("--agent <id>").option("--credentials-dir <path>").option("--format <format>");
      registerProjectCommands(program);

      const logs: string[] = [];
      const origLog = console.log;
      console.log = (...args: unknown[]) => logs.push(args.join(" "));

      try {
        await program.parseAsync([
          "node", "linear",
          "--agent", "test-bot",
          "--credentials-dir", testDir,
          "--format", "json",
          "project", "update", "proj-uuid-1",
          "--lead", "Alice",
        ]);
      } finally {
        console.log = origLog;
      }

      expect(mockUpdateProject).toHaveBeenCalledWith(
        "proj-uuid-1",
        expect.objectContaining({ leadId: "user-1" })
      );
    });

    it('clears lead when passed "null"', async () => {
      vi.resetModules();
      const { registerProjectCommands } = await import("../commands/project.js");
      const { Command } = await import("commander");

      mockUpdateProject.mockResolvedValue({
        success: true,
        project: Promise.resolve({ id: "proj-uuid-1", name: "P", url: null }),
      });

      const program = new Command();
      program.option("--agent <id>").option("--credentials-dir <path>").option("--format <format>");
      registerProjectCommands(program);

      const logs: string[] = [];
      const origLog = console.log;
      console.log = (...args: unknown[]) => logs.push(args.join(" "));

      try {
        await program.parseAsync([
          "node", "linear",
          "--agent", "test-bot",
          "--credentials-dir", testDir,
          "--format", "json",
          "project", "update", "proj-uuid-1",
          "--lead", "null",
        ]);
      } finally {
        console.log = origLog;
      }

      expect(mockUpdateProject).toHaveBeenCalledWith(
        "proj-uuid-1",
        expect.objectContaining({ leadId: null })
      );
    });

    it("rejects invalid priority values", async () => {
      vi.resetModules();
      const { registerProjectCommands } = await import("../commands/project.js");
      const { Command } = await import("commander");

      const program = new Command();
      program.option("--agent <id>").option("--credentials-dir <path>").option("--format <format>");
      registerProjectCommands(program);

      const errors: string[] = [];
      const origErr = console.error;
      console.error = (...args: unknown[]) => errors.push(args.join(" "));

      const origExit = process.exit;
      let exitCode: number | undefined;
      (process as { exit: (code?: number) => never }).exit = (code?: number) => {
        exitCode = code;
        throw new Error(`process.exit(${code})`);
      };

      try {
        await program.parseAsync([
          "node", "linear",
          "--agent", "test-bot",
          "--credentials-dir", testDir,
          "--format", "json",
          "project", "update", "proj-uuid-1",
          "--priority", "foo",
        ]);
      } catch {
        // expected
      } finally {
        console.error = origErr;
        (process as { exit: (code?: number) => never }).exit = origExit;
      }

      expect(exitCode).toBe(1);
      expect(errors[0]).toContain("Invalid value for --priority");
      expect(mockUpdateProject).not.toHaveBeenCalled();
    });

    it("sets priority", async () => {
      vi.resetModules();
      const { registerProjectCommands } = await import("../commands/project.js");
      const { Command } = await import("commander");

      mockUpdateProject.mockResolvedValue({
        success: true,
        project: Promise.resolve({ id: "proj-uuid-1", name: "P", url: null }),
      });

      const program = new Command();
      program.option("--agent <id>").option("--credentials-dir <path>").option("--format <format>");
      registerProjectCommands(program);

      const logs: string[] = [];
      const origLog = console.log;
      console.log = (...args: unknown[]) => logs.push(args.join(" "));

      try {
        await program.parseAsync([
          "node", "linear",
          "--agent", "test-bot",
          "--credentials-dir", testDir,
          "--format", "json",
          "project", "update", "proj-uuid-1",
          "--priority", "2",
        ]);
      } finally {
        console.log = origLog;
      }

      expect(mockUpdateProject).toHaveBeenCalledWith(
        "proj-uuid-1",
        expect.objectContaining({ priority: 2 })
      );
    });
  });
});
