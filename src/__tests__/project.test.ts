import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { writeCredentials } from "../credentials.js";
import type { Credentials } from "../credentials.js";

const mockCreateProject = vi.fn();
const mockUpdateProject = vi.fn();
const mockProject = vi.fn();
const mockProjects = vi.fn();
const mockTeams = vi.fn();
const mockUsers = vi.fn();

vi.mock("@linear/sdk", () => ({
  LinearClient: vi.fn().mockImplementation(() => ({
    createProject: mockCreateProject,
    project: mockProject,
    projects: mockProjects,
    teams: mockTeams,
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

    mockCreateProject.mockReset();
    mockUpdateProject.mockReset();
    mockProject.mockReset();
    mockProjects.mockReset();
    mockTeams.mockReset();
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

    it("updates content from --content flag", async () => {
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
          "--content", "# My Project Spec\n\nLong form content here.",
        ]);
      } finally {
        console.log = origLog;
      }

      expect(mockUpdateProject).toHaveBeenCalledWith(
        "proj-uuid-1",
        expect.objectContaining({ content: "# My Project Spec\n\nLong form content here." })
      );
    });

    it("updates content from --content-file", async () => {
      vi.resetModules();
      const { registerProjectCommands } = await import("../commands/project.js");
      const { Command } = await import("commander");

      const contentFile = join(testDir, "spec.md");
      writeFileSync(contentFile, "# Project Spec\n\nDetailed content from file.");

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
          "--content-file", contentFile,
        ]);
      } finally {
        console.log = origLog;
      }

      expect(mockUpdateProject).toHaveBeenCalledWith(
        "proj-uuid-1",
        expect.objectContaining({ content: "# Project Spec\n\nDetailed content from file." })
      );
    });
  });

  describe("project get", () => {
    it("includes content field in output", async () => {
      vi.resetModules();
      const { registerProjectCommands } = await import("../commands/project.js");
      const { Command } = await import("commander");

      mockProject.mockResolvedValue({
        id: "proj-uuid-1",
        name: "My Project",
        description: "Short description",
        content: "# Overview\n\nLong-form project content.",
        state: "started",
        progress: 0.5,
        startDate: null,
        targetDate: null,
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
          "project", "get", "proj-uuid-1",
        ]);
      } finally {
        console.log = origLog;
      }

      const output = JSON.parse(logs[0]);
      expect(output.content).toBe("# Overview\n\nLong-form project content.");
    });
  });

  describe("project create", () => {
    async function runCreate(args: string[]) {
      vi.resetModules();
      const { registerProjectCommands } = await import("../commands/project.js");
      const { Command } = await import("commander");
      const program = new Command();
      program.option("--agent <id>").option("--credentials-dir <path>").option("--format <format>");
      registerProjectCommands(program);

      const logs: string[] = [];
      const origLog = console.log;
      console.log = (...a: unknown[]) => logs.push(a.join(" "));
      try {
        await program.parseAsync([
          "node", "linear",
          "--agent", "test-bot",
          "--credentials-dir", testDir,
          "--format", "json",
          "project", "create",
          ...args,
        ]);
      } finally {
        console.log = origLog;
      }
      return JSON.parse(logs[0]);
    }

    it("creates a project by team name", async () => {
      mockTeams.mockResolvedValueOnce({
        nodes: [{ id: "team-uuid-1" }],
      });
      mockCreateProject.mockResolvedValueOnce({
        success: true,
        projectId: "proj-uuid-1",
        project: Promise.resolve({
          id: "proj-uuid-1",
          name: "My Project",
          url: "https://linear.app/test/project/proj-1",
        }),
      });

      const output = await runCreate(["--name", "My Project", "--team", "Main"]);

      expect(mockTeams).toHaveBeenCalledWith({
        filter: { name: { eqIgnoreCase: "Main" } },
      });
      expect(mockCreateProject).toHaveBeenCalledWith(
        expect.objectContaining({ name: "My Project", teamIds: ["team-uuid-1"] })
      );
      expect(output.id).toBe("proj-uuid-1");
      expect(output.name).toBe("My Project");
      expect(output.url).toBe("https://linear.app/test/project/proj-1");
    });

    it("accepts a team UUID directly without resolving", async () => {
      const teamUuid = "aaaabbbb-cccc-dddd-eeee-ffffaaaabbbb";
      mockCreateProject.mockResolvedValueOnce({
        success: true,
        projectId: "proj-uuid-2",
        project: Promise.resolve({
          id: "proj-uuid-2",
          name: "UUID Project",
          url: "https://linear.app/test/project/proj-2",
        }),
      });

      await runCreate(["--name", "UUID Project", "--team", teamUuid]);

      expect(mockTeams).not.toHaveBeenCalled();
      expect(mockCreateProject).toHaveBeenCalledWith(
        expect.objectContaining({ teamIds: [teamUuid] })
      );
    });

    it("passes optional description, start-date, and target-date", async () => {
      mockTeams.mockResolvedValueOnce({ nodes: [{ id: "team-uuid-1" }] });
      mockCreateProject.mockResolvedValueOnce({
        success: true,
        projectId: "proj-uuid-3",
        project: Promise.resolve({ id: "proj-uuid-3", name: "Full Project", url: null }),
      });

      await runCreate([
        "--name", "Full Project",
        "--team", "Main",
        "--description", "A detailed description",
        "--start-date", "2026-03-01",
        "--target-date", "2026-06-30",
      ]);

      expect(mockCreateProject).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "Full Project",
          teamIds: ["team-uuid-1"],
          description: "A detailed description",
          startDate: "2026-03-01",
          targetDate: "2026-06-30",
        })
      );
    });

    it("throws when team name does not match any team", async () => {
      mockTeams.mockResolvedValueOnce({ nodes: [] });

      await expect(
        runCreate(["--name", "Orphan Project", "--team", "NonExistentTeam"])
      ).rejects.toThrow('No team matching "NonExistentTeam"');

      expect(mockCreateProject).not.toHaveBeenCalled();
    });
  });
});
