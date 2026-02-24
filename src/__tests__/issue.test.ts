import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { writeCredentials } from "../credentials.js";
import type { Credentials } from "../credentials.js";

// Track mock calls
const mockCreateIssueRelation = vi.fn().mockResolvedValue({ success: true });
const mockCreateIssue = vi.fn();
const mockUpdateIssue = vi.fn();
const mockArchiveIssue = vi.fn().mockResolvedValue({ success: true });
const mockDeleteIssue = vi.fn().mockResolvedValue({ success: true });
const mockIssues = vi.fn();
const mockIssue = vi.fn();
const mockSearchIssues = vi.fn();
const mockTeams = vi.fn();
const mockTeam = vi.fn();
const mockUsers = vi.fn();
const mockProjects = vi.fn();

// Mock @linear/sdk
vi.mock("@linear/sdk", () => ({
  LinearClient: vi.fn().mockImplementation(() => ({
    issues: mockIssues,
    issue: mockIssue,
    createIssue: mockCreateIssue,
    updateIssue: mockUpdateIssue,
    archiveIssue: mockArchiveIssue,
    deleteIssue: mockDeleteIssue,
    searchIssues: mockSearchIssues,
    createIssueRelation: mockCreateIssueRelation,
    teams: mockTeams,
    team: mockTeam,
    users: mockUsers,
    projects: mockProjects,
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

describe("issue commands", () => {
  let testDir: string;
  let origStdinIsTTY: boolean | undefined;

  beforeEach(() => {
    testDir = join(tmpdir(), `linear-cli-issue-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    writeCredentials("test-bot", testDir, validCredentials);

    // Ensure stdin is treated as a TTY so tests don't accidentally read from stdin
    origStdinIsTTY = process.stdin.isTTY;
    (process.stdin as { isTTY: boolean | undefined }).isTTY = true;

    // Reset all mocks
    mockCreateIssueRelation.mockReset().mockResolvedValue({ success: true });
    mockCreateIssue.mockReset();
    mockUpdateIssue.mockReset();
    mockArchiveIssue.mockReset().mockResolvedValue({ success: true });
    mockDeleteIssue.mockReset().mockResolvedValue({ success: true });
    mockIssues.mockReset();
    mockIssue.mockReset();
    mockSearchIssues.mockReset();
    mockTeams.mockReset();
    mockTeam.mockReset();
    mockUsers.mockReset();
    mockProjects.mockReset();

    // Default mock for users (needed by resolveUser)
    mockUsers.mockResolvedValue({
      nodes: [
        { id: "user-1", name: "Alice", email: "alice@example.com", displayName: "Alice" },
        { id: "user-2", name: "Bob", email: "bob@example.com", displayName: "Bob" },
      ],
    });
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

  describe("issue list", () => {
    it("lists issues with default parameters", async () => {
      vi.resetModules();
      const { registerIssueCommands } = await import("../commands/issue.js");
      const { Command } = await import("commander");

      mockIssues.mockResolvedValue({
        nodes: [
          {
            identifier: "MAIN-1",
            title: "Fix bug",
            priority: 1,
            url: "https://linear.app/test/issue/MAIN-1",
          },
          {
            identifier: "MAIN-2",
            title: "Add feature",
            priority: 2,
            url: "https://linear.app/test/issue/MAIN-2",
          },
        ],
      });

      const program = new Command();
      program.option("--agent <id>").option("--credentials-dir <path>").option("--format <format>");
      registerIssueCommands(program);

      const logs: string[] = [];
      const origLog = console.log;
      console.log = (...args: unknown[]) => logs.push(args.join(" "));

      try {
        await program.parseAsync([
          "node", "linear",
          "--agent", "test-bot",
          "--credentials-dir", testDir,
          "--format", "json",
          "issue", "list",
        ]);
      } finally {
        console.log = origLog;
      }

      expect(mockIssues).toHaveBeenCalledWith(
        expect.objectContaining({
          filter: {},
          first: 50,
          includeArchived: false,
        })
      );

      const output = JSON.parse(logs[0]);
      expect(output.results).toHaveLength(2);
      expect(output.results[0].id).toBe("MAIN-1");
    });

    it("builds correct filter from CLI flags", async () => {
      vi.resetModules();
      const { registerIssueCommands } = await import("../commands/issue.js");
      const { Command } = await import("commander");

      mockIssues.mockResolvedValue({ nodes: [] });

      const program = new Command();
      program.option("--agent <id>").option("--credentials-dir <path>").option("--format <format>");
      registerIssueCommands(program);

      const logs: string[] = [];
      const origLog = console.log;
      console.log = (...args: unknown[]) => logs.push(args.join(" "));

      try {
        await program.parseAsync([
          "node", "linear",
          "--agent", "test-bot",
          "--credentials-dir", testDir,
          "--format", "json",
          "issue", "list",
          "--assignee", "me",
          "--state", "In Progress",
          "--priority", "1",
          "--team", "Engineering",
          "--limit", "10",
          "--include-archived",
        ]);
      } finally {
        console.log = origLog;
      }

      expect(mockIssues).toHaveBeenCalledWith(
        expect.objectContaining({
          filter: expect.objectContaining({
            assignee: { id: { eq: "actor-123" } },
            state: { name: { eqIgnoreCase: "In Progress" } },
            priority: { eq: 1 },
            team: { name: { eqIgnoreCase: "Engineering" } },
          }),
          first: 10,
          includeArchived: true,
        })
      );
    });

    it("respects max limit of 250", async () => {
      vi.resetModules();
      const { registerIssueCommands } = await import("../commands/issue.js");
      const { Command } = await import("commander");

      mockIssues.mockResolvedValue({ nodes: [] });

      const program = new Command();
      program.option("--agent <id>").option("--credentials-dir <path>").option("--format <format>");
      registerIssueCommands(program);

      const logs: string[] = [];
      const origLog = console.log;
      console.log = (...args: unknown[]) => logs.push(args.join(" "));

      try {
        await program.parseAsync([
          "node", "linear",
          "--agent", "test-bot",
          "--credentials-dir", testDir,
          "--format", "json",
          "issue", "list",
          "--limit", "500",
        ]);
      } finally {
        console.log = origLog;
      }

      expect(mockIssues).toHaveBeenCalledWith(
        expect.objectContaining({ first: 250 })
      );
    });
  });

  describe("issue get", () => {
    it("fetches issue and nested data", async () => {
      vi.resetModules();
      const { registerIssueCommands } = await import("../commands/issue.js");
      const { Command } = await import("commander");

      mockIssue.mockResolvedValue({
        identifier: "MAIN-42",
        title: "Test issue",
        description: "Some description",
        priority: 2,
        priorityLabel: "Medium",
        dueDate: "2026-03-01",
        estimate: 3,
        url: "https://linear.app/test/issue/MAIN-42",
        state: Promise.resolve({ name: "In Progress", type: "started" }),
        assignee: Promise.resolve({ id: "user-1", name: "Alice" }),
        delegate: Promise.resolve(null),
        labels: () => Promise.resolve({ nodes: [{ id: "label-1", name: "bug" }] }),
        parent: Promise.resolve({ identifier: "MAIN-10", title: "Parent" }),
        children: () => Promise.resolve({ nodes: [{ identifier: "MAIN-43", title: "Child" }] }),
        comments: () =>
          Promise.resolve({
            nodes: [{ id: "comment-1", body: "A comment", createdAt: "2026-02-20T00:00:00Z" }],
          }),
        relations: () => Promise.resolve({ nodes: [] }),
      });

      const program = new Command();
      program.option("--agent <id>").option("--credentials-dir <path>").option("--format <format>");
      registerIssueCommands(program);

      const logs: string[] = [];
      const origLog = console.log;
      console.log = (...args: unknown[]) => logs.push(args.join(" "));

      try {
        await program.parseAsync([
          "node", "linear",
          "--agent", "test-bot",
          "--credentials-dir", testDir,
          "--format", "json",
          "issue", "get", "MAIN-42",
        ]);
      } finally {
        console.log = origLog;
      }

      expect(mockIssue).toHaveBeenCalledWith("MAIN-42");

      const output = JSON.parse(logs[0]);
      expect(output.id).toBe("MAIN-42");
      expect(output.title).toBe("Test issue");
      expect(output.state).toBe("In Progress");
      expect(output.assignee.name).toBe("Alice");
      expect(output.labels).toHaveLength(1);
      expect(output.parent.id).toBe("MAIN-10");
      expect(output.children).toHaveLength(1);
      expect(output.comments).toHaveLength(1);
    });

    it("fetches multiple issues and returns results array", async () => {
      vi.resetModules();
      const { registerIssueCommands } = await import("../commands/issue.js");
      const { Command } = await import("commander");

      const makeIssueMock = (id: string, title: string) => ({
        identifier: id,
        title,
        description: null,
        priority: 0,
        priorityLabel: "No priority",
        dueDate: null,
        estimate: null,
        url: `https://linear.app/test/issue/${id}`,
        state: Promise.resolve({ name: "Todo", type: "unstarted" }),
        assignee: Promise.resolve(null),
        delegate: Promise.resolve(null),
        labels: () => Promise.resolve({ nodes: [] }),
        parent: Promise.resolve(null),
        children: () => Promise.resolve({ nodes: [] }),
        comments: () => Promise.resolve({ nodes: [] }),
        relations: () => Promise.resolve({ nodes: [] }),
      });

      mockIssue
        .mockResolvedValueOnce(makeIssueMock("MAIN-42", "First issue"))
        .mockResolvedValueOnce(makeIssueMock("MAIN-43", "Second issue"));

      const program = new Command();
      program.option("--agent <id>").option("--credentials-dir <path>").option("--format <format>");
      registerIssueCommands(program);

      const logs: string[] = [];
      const origLog = console.log;
      console.log = (...args: unknown[]) => logs.push(args.join(" "));

      try {
        await program.parseAsync([
          "node", "linear",
          "--agent", "test-bot",
          "--credentials-dir", testDir,
          "--format", "json",
          "issue", "get", "MAIN-42", "MAIN-43",
        ]);
      } finally {
        console.log = origLog;
      }

      expect(mockIssue).toHaveBeenCalledWith("MAIN-42");
      expect(mockIssue).toHaveBeenCalledWith("MAIN-43");

      const output = JSON.parse(logs[0]);
      expect(output.results).toHaveLength(2);
      expect(output.results[0].id).toBe("MAIN-42");
      expect(output.results[1].id).toBe("MAIN-43");
    });

    it("returns valid issues and warnings when some IDs fail", async () => {
      vi.resetModules();
      const { registerIssueCommands } = await import("../commands/issue.js");
      const { Command } = await import("commander");

      mockIssue
        .mockResolvedValueOnce({
          identifier: "MAIN-42",
          title: "Valid issue",
          description: null,
          priority: 0,
          priorityLabel: "No priority",
          dueDate: null,
          estimate: null,
          url: "https://linear.app/test/issue/MAIN-42",
          state: Promise.resolve({ name: "Todo", type: "unstarted" }),
          assignee: Promise.resolve(null),
          delegate: Promise.resolve(null),
          labels: () => Promise.resolve({ nodes: [] }),
          parent: Promise.resolve(null),
          children: () => Promise.resolve({ nodes: [] }),
          comments: () => Promise.resolve({ nodes: [] }),
          relations: () => Promise.resolve({ nodes: [] }),
        })
        .mockRejectedValueOnce(new Error("Entity not found: MAIN-99"));

      const program = new Command();
      program.option("--agent <id>").option("--credentials-dir <path>").option("--format <format>");
      registerIssueCommands(program);

      const logs: string[] = [];
      const origLog = console.log;
      console.log = (...args: unknown[]) => logs.push(args.join(" "));

      try {
        await program.parseAsync([
          "node", "linear",
          "--agent", "test-bot",
          "--credentials-dir", testDir,
          "--format", "json",
          "issue", "get", "MAIN-42", "MAIN-99",
        ]);
      } finally {
        console.log = origLog;
      }

      const output = JSON.parse(logs[0]);
      expect(output.results).toHaveLength(1);
      expect(output.results[0].id).toBe("MAIN-42");
      expect(output.warnings).toHaveLength(1);
      expect(output.warnings[0]).toContain("MAIN-99");
    });
  });

  describe("issue create", () => {
    it("calls createIssue with correct fields", async () => {
      vi.resetModules();
      const { registerIssueCommands } = await import("../commands/issue.js");
      const { Command } = await import("commander");

      mockTeams.mockResolvedValue({
        nodes: [{ id: "team-1", key: "MAIN" }],
      });
      mockTeam.mockResolvedValue({ key: "MAIN" });

      mockCreateIssue.mockResolvedValue({
        issue: Promise.resolve({
          id: "issue-uuid-1",
          identifier: "MAIN-50",
          title: "New issue",
          url: "https://linear.app/test/issue/MAIN-50",
        }),
      });

      const program = new Command();
      program.option("--agent <id>").option("--credentials-dir <path>").option("--format <format>");
      registerIssueCommands(program);

      const logs: string[] = [];
      const origLog = console.log;
      console.log = (...args: unknown[]) => logs.push(args.join(" "));

      try {
        await program.parseAsync([
          "node", "linear",
          "--agent", "test-bot",
          "--credentials-dir", testDir,
          "--format", "json",
          "issue", "create",
          "--title", "New issue",
          "--team", "Engineering",
          "--description", "Issue body",
          "--priority", "2",
        ]);
      } finally {
        console.log = origLog;
      }

      expect(mockCreateIssue).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "New issue",
          teamId: "team-1",
          description: "Issue body",
          priority: 2,
        })
      );

      const output = JSON.parse(logs[0]);
      expect(output.id).toBe("MAIN-50");
    });

    it("reads description from file", async () => {
      vi.resetModules();
      const { registerIssueCommands } = await import("../commands/issue.js");
      const { Command } = await import("commander");

      const descFile = join(testDir, "desc.md");
      writeFileSync(descFile, "# From file\nDescription content");

      mockTeams.mockResolvedValue({
        nodes: [{ id: "team-1", key: "MAIN" }],
      });
      mockTeam.mockResolvedValue({ key: "MAIN" });

      mockCreateIssue.mockResolvedValue({
        issue: Promise.resolve({
          id: "issue-uuid-2",
          identifier: "MAIN-51",
          title: "File desc issue",
          url: "https://linear.app/test/issue/MAIN-51",
        }),
      });

      const program = new Command();
      program.option("--agent <id>").option("--credentials-dir <path>").option("--format <format>");
      registerIssueCommands(program);

      const logs: string[] = [];
      const origLog = console.log;
      console.log = (...args: unknown[]) => logs.push(args.join(" "));

      try {
        await program.parseAsync([
          "node", "linear",
          "--agent", "test-bot",
          "--credentials-dir", testDir,
          "--format", "json",
          "issue", "create",
          "--title", "File desc issue",
          "--team", "Engineering",
          "--description-file", descFile,
        ]);
      } finally {
        console.log = origLog;
      }

      expect(mockCreateIssue).toHaveBeenCalledWith(
        expect.objectContaining({
          description: "# From file\nDescription content",
        })
      );
    });

    it("resolves assignee and delegate", async () => {
      vi.resetModules();
      const { registerIssueCommands } = await import("../commands/issue.js");
      const { Command } = await import("commander");

      mockTeams.mockResolvedValue({
        nodes: [{ id: "team-1", key: "MAIN" }],
      });
      mockTeam.mockResolvedValue({ key: "MAIN" });

      mockCreateIssue.mockResolvedValue({
        issue: Promise.resolve({
          id: "issue-uuid-3",
          identifier: "MAIN-52",
          title: "Assigned issue",
          url: "https://linear.app/test/issue/MAIN-52",
        }),
      });

      const program = new Command();
      program.option("--agent <id>").option("--credentials-dir <path>").option("--format <format>");
      registerIssueCommands(program);

      const logs: string[] = [];
      const origLog = console.log;
      console.log = (...args: unknown[]) => logs.push(args.join(" "));

      try {
        await program.parseAsync([
          "node", "linear",
          "--agent", "test-bot",
          "--credentials-dir", testDir,
          "--format", "json",
          "issue", "create",
          "--title", "Assigned issue",
          "--team", "Engineering",
          "--assignee", "me",
          "--delegate", "Alice",
        ]);
      } finally {
        console.log = origLog;
      }

      expect(mockCreateIssue).toHaveBeenCalledWith(
        expect.objectContaining({
          assigneeId: "actor-123", // "me" -> actorId
          delegateId: "user-1", // "Alice" resolved from user cache
        })
      );
    });
  });

  describe("issue create stdin", () => {
    it("reads description from stdin when piped", async () => {
      vi.resetModules();

      vi.doMock("fs", async () => {
        const actual = await vi.importActual<typeof import("fs")>("fs");
        return {
          ...actual,
          readFileSync: (fd: unknown, ...args: unknown[]) => {
            if (fd === 0) return "Description from stdin";
            return (actual.readFileSync as (...a: unknown[]) => unknown)(fd, ...args);
          },
        };
      });

      (process.stdin as { isTTY: boolean | undefined }).isTTY = undefined;

      try {
        const { registerIssueCommands } = await import("../commands/issue.js");
        const { Command } = await import("commander");

        mockTeams.mockResolvedValue({ nodes: [{ id: "team-1", key: "MAIN" }] });
        mockTeam.mockResolvedValue({ key: "MAIN" });
        mockCreateIssue.mockResolvedValue({
          issue: Promise.resolve({
            id: "issue-stdin",
            identifier: "MAIN-99",
            title: "Stdin issue",
            url: "https://linear.app/test/issue/MAIN-99",
          }),
        });

        const program = new Command();
        program.option("--agent <id>").option("--credentials-dir <path>").option("--format <format>");
        registerIssueCommands(program);

        const logs: string[] = [];
        const origLog = console.log;
        console.log = (...a: unknown[]) => logs.push(a.join(" "));

        try {
          await program.parseAsync([
            "node", "linear",
            "--agent", "test-bot",
            "--credentials-dir", testDir,
            "--format", "json",
            "issue", "create",
            "--title", "Stdin issue",
            "--team", "Engineering",
          ]);
        } finally {
          console.log = origLog;
        }

        expect(mockCreateIssue).toHaveBeenCalledWith(
          expect.objectContaining({
            title: "Stdin issue",
            teamId: "team-1",
            description: "Description from stdin",
          })
        );
        const output = JSON.parse(logs[0]);
        expect(output.id).toBe("MAIN-99");
      } finally {
        vi.doUnmock("fs");
      }
    });
  });

  describe("issue update stdin", () => {
    it("reads description from stdin when piped", async () => {
      vi.resetModules();

      vi.doMock("fs", async () => {
        const actual = await vi.importActual<typeof import("fs")>("fs");
        return {
          ...actual,
          readFileSync: (fd: unknown, ...args: unknown[]) => {
            if (fd === 0) return "Updated description from stdin";
            return (actual.readFileSync as (...a: unknown[]) => unknown)(fd, ...args);
          },
        };
      });

      (process.stdin as { isTTY: boolean | undefined }).isTTY = undefined;

      try {
        const { registerIssueCommands } = await import("../commands/issue.js");
        const { Command } = await import("commander");

        mockUpdateIssue.mockResolvedValue({
          issue: Promise.resolve({
            identifier: "MAIN-42",
            title: "Existing title",
            url: "https://linear.app/test/issue/MAIN-42",
          }),
        });

        const program = new Command();
        program.option("--agent <id>").option("--credentials-dir <path>").option("--format <format>");
        registerIssueCommands(program);

        const logs: string[] = [];
        const origLog = console.log;
        console.log = (...a: unknown[]) => logs.push(a.join(" "));

        try {
          await program.parseAsync([
            "node", "linear",
            "--agent", "test-bot",
            "--credentials-dir", testDir,
            "--format", "json",
            "issue", "update", "MAIN-42",
          ]);
        } finally {
          console.log = origLog;
        }

        expect(mockUpdateIssue).toHaveBeenCalledWith(
          "MAIN-42",
          expect.objectContaining({ description: "Updated description from stdin" })
        );
      } finally {
        vi.doUnmock("fs");
      }
    });
  });

  describe("issue update", () => {
    it("handles nullable fields: null clears them", async () => {
      vi.resetModules();
      const { registerIssueCommands } = await import("../commands/issue.js");
      const { Command } = await import("commander");

      mockUpdateIssue.mockResolvedValue({
        issue: Promise.resolve({
          identifier: "MAIN-42",
          title: "Updated",
          url: "https://linear.app/test/issue/MAIN-42",
        }),
      });

      const program = new Command();
      program.option("--agent <id>").option("--credentials-dir <path>").option("--format <format>");
      registerIssueCommands(program);

      const logs: string[] = [];
      const origLog = console.log;
      console.log = (...args: unknown[]) => logs.push(args.join(" "));

      try {
        await program.parseAsync([
          "node", "linear",
          "--agent", "test-bot",
          "--credentials-dir", testDir,
          "--format", "json",
          "issue", "update", "MAIN-42",
          "--assignee", "null",
          "--delegate", "null",
          "--parent", "null",
        ]);
      } finally {
        console.log = origLog;
      }

      expect(mockUpdateIssue).toHaveBeenCalledWith(
        "MAIN-42",
        expect.objectContaining({
          assigneeId: null,
          delegateId: null,
          parentId: null,
        })
      );
    });

    it("updates title and priority", async () => {
      vi.resetModules();
      const { registerIssueCommands } = await import("../commands/issue.js");
      const { Command } = await import("commander");

      mockUpdateIssue.mockResolvedValue({
        issue: Promise.resolve({
          identifier: "MAIN-42",
          title: "New Title",
          url: "https://linear.app/test/issue/MAIN-42",
        }),
      });

      const program = new Command();
      program.option("--agent <id>").option("--credentials-dir <path>").option("--format <format>");
      registerIssueCommands(program);

      const logs: string[] = [];
      const origLog = console.log;
      console.log = (...args: unknown[]) => logs.push(args.join(" "));

      try {
        await program.parseAsync([
          "node", "linear",
          "--agent", "test-bot",
          "--credentials-dir", testDir,
          "--format", "json",
          "issue", "update", "MAIN-42",
          "--title", "New Title",
          "--priority", "3",
        ]);
      } finally {
        console.log = origLog;
      }

      expect(mockUpdateIssue).toHaveBeenCalledWith(
        "MAIN-42",
        expect.objectContaining({
          title: "New Title",
          priority: 3,
        })
      );

      const output = JSON.parse(logs[0]);
      expect(output.id).toBe("MAIN-42");
    });
  });

  describe("issue transition", () => {
    it("resolves state via parseTeamKey and updates issue", async () => {
      vi.resetModules();
      const { registerIssueCommands } = await import("../commands/issue.js");
      const { Command } = await import("commander");

      // Set up the cache file with team states
      const cacheData = {
        teams: {
          MAIN: {
            states: {
              "Todo": "state-1",
              "In Progress": "state-2",
              "Done": "state-3",
            },
            updatedAt: new Date().toISOString(),
          },
        },
      };
      writeFileSync(
        join(testDir, "test-bot.cache.json"),
        JSON.stringify(cacheData)
      );

      mockUpdateIssue.mockResolvedValue({
        issue: Promise.resolve({
          identifier: "MAIN-42",
          url: "https://linear.app/test/issue/MAIN-42",
        }),
      });

      const program = new Command();
      program.option("--agent <id>").option("--credentials-dir <path>").option("--format <format>");
      registerIssueCommands(program);

      const logs: string[] = [];
      const origLog = console.log;
      console.log = (...args: unknown[]) => logs.push(args.join(" "));

      try {
        await program.parseAsync([
          "node", "linear",
          "--agent", "test-bot",
          "--credentials-dir", testDir,
          "--format", "json",
          "issue", "transition", "MAIN-42", "In Progress",
        ]);
      } finally {
        console.log = origLog;
      }

      expect(mockUpdateIssue).toHaveBeenCalledWith("MAIN-42", {
        stateId: "state-2",
      });

      const output = JSON.parse(logs[0]);
      expect(output.id).toBe("MAIN-42");
      expect(output.state).toBe("In Progress");
    });
  });

  describe("issue search", () => {
    it("calls searchIssues with query", async () => {
      vi.resetModules();
      const { registerIssueCommands } = await import("../commands/issue.js");
      const { Command } = await import("commander");

      mockSearchIssues.mockResolvedValue({
        nodes: [
          {
            identifier: "MAIN-10",
            title: "Bug fix",
            url: "https://linear.app/test/issue/MAIN-10",
          },
        ],
      });

      const program = new Command();
      program.option("--agent <id>").option("--credentials-dir <path>").option("--format <format>");
      registerIssueCommands(program);

      const logs: string[] = [];
      const origLog = console.log;
      console.log = (...args: unknown[]) => logs.push(args.join(" "));

      try {
        await program.parseAsync([
          "node", "linear",
          "--agent", "test-bot",
          "--credentials-dir", testDir,
          "--format", "json",
          "issue", "search", "bug fix",
        ]);
      } finally {
        console.log = origLog;
      }

      expect(mockSearchIssues).toHaveBeenCalledWith("bug fix", {});

      const output = JSON.parse(logs[0]);
      expect(output.results).toHaveLength(1);
      expect(output.results[0].id).toBe("MAIN-10");
    });

    it("passes team and include flags to searchIssues", async () => {
      vi.resetModules();
      const { registerIssueCommands } = await import("../commands/issue.js");
      const { Command } = await import("commander");

      mockSearchIssues.mockResolvedValue({ nodes: [] });
      mockTeams.mockResolvedValue({ nodes: [{ id: "team-uuid" }] });

      const program = new Command();
      program.option("--agent <id>").option("--credentials-dir <path>").option("--format <format>");
      registerIssueCommands(program);

      const logs: string[] = [];
      const origLog = console.log;
      console.log = (...args: unknown[]) => logs.push(args.join(" "));

      try {
        await program.parseAsync([
          "node", "linear",
          "--agent", "test-bot",
          "--credentials-dir", testDir,
          "--format", "json",
          "issue", "search", "query",
          "--team", "team-uuid",
          "--include-comments",
          "--include-archived",
        ]);
      } finally {
        console.log = origLog;
      }

      expect(mockSearchIssues).toHaveBeenCalledWith("query", {
        teamId: "team-uuid",
        includeComments: true,
        includeArchived: true,
      });
    });
  });

  describe("issue archive", () => {
    it("archives the issue", async () => {
      vi.resetModules();
      const { registerIssueCommands } = await import("../commands/issue.js");
      const { Command } = await import("commander");

      const program = new Command();
      program.option("--agent <id>").option("--credentials-dir <path>").option("--format <format>");
      registerIssueCommands(program);

      const logs: string[] = [];
      const origLog = console.log;
      console.log = (...args: unknown[]) => logs.push(args.join(" "));

      try {
        await program.parseAsync([
          "node", "linear",
          "--agent", "test-bot",
          "--credentials-dir", testDir,
          "--format", "json",
          "issue", "archive", "MAIN-42",
        ]);
      } finally {
        console.log = origLog;
      }

      expect(mockArchiveIssue).toHaveBeenCalledWith("MAIN-42");

      const output = JSON.parse(logs[0]);
      expect(output.id).toBe("MAIN-42");
      expect(output.status).toBe("archived");
    });
  });

  describe("issue delete", () => {
    it("deletes the issue", async () => {
      vi.resetModules();
      const { registerIssueCommands } = await import("../commands/issue.js");
      const { Command } = await import("commander");

      const program = new Command();
      program.option("--agent <id>").option("--credentials-dir <path>").option("--format <format>");
      registerIssueCommands(program);

      const logs: string[] = [];
      const origLog = console.log;
      console.log = (...args: unknown[]) => logs.push(args.join(" "));

      try {
        await program.parseAsync([
          "node", "linear",
          "--agent", "test-bot",
          "--credentials-dir", testDir,
          "--format", "json",
          "issue", "delete", "MAIN-42",
        ]);
      } finally {
        console.log = origLog;
      }

      expect(mockDeleteIssue).toHaveBeenCalledWith("MAIN-42");

      const output = JSON.parse(logs[0]);
      expect(output.id).toBe("MAIN-42");
      expect(output.status).toBe("deleted");
    });
  });

  describe("relation handling", () => {
    it("creates blocks relations after issue create", async () => {
      vi.resetModules();
      const { registerIssueCommands } = await import("../commands/issue.js");
      const { Command } = await import("commander");

      mockTeams.mockResolvedValue({
        nodes: [{ id: "team-1", key: "MAIN" }],
      });
      mockTeam.mockResolvedValue({ key: "MAIN" });

      mockCreateIssue.mockResolvedValue({
        issue: Promise.resolve({
          id: "issue-uuid-new",
          identifier: "MAIN-60",
          title: "With relations",
          url: "https://linear.app/test/issue/MAIN-60",
        }),
      });

      const program = new Command();
      program.option("--agent <id>").option("--credentials-dir <path>").option("--format <format>");
      registerIssueCommands(program);

      const logs: string[] = [];
      const origLog = console.log;
      console.log = (...args: unknown[]) => logs.push(args.join(" "));

      try {
        await program.parseAsync([
          "node", "linear",
          "--agent", "test-bot",
          "--credentials-dir", testDir,
          "--format", "json",
          "issue", "create",
          "--title", "With relations",
          "--team", "Engineering",
          "--blocks", "MAIN-10",
          "--related-to", "MAIN-20",
        ]);
      } finally {
        console.log = origLog;
      }

      // blocks: issueId = created issue, relatedIssueId = MAIN-10
      expect(mockCreateIssueRelation).toHaveBeenCalledWith({
        issueId: "issue-uuid-new",
        relatedIssueId: "MAIN-10",
        type: "blocks",
      });

      // related-to: issueId = created issue, relatedIssueId = MAIN-20
      expect(mockCreateIssueRelation).toHaveBeenCalledWith({
        issueId: "issue-uuid-new",
        relatedIssueId: "MAIN-20",
        type: "related",
      });

      const output = JSON.parse(logs[0]);
      expect(output.relations.succeeded).toHaveLength(2);
    });

    it("creates blocked-by relations with reversed direction", async () => {
      vi.resetModules();
      const { registerIssueCommands } = await import("../commands/issue.js");
      const { Command } = await import("commander");

      mockTeams.mockResolvedValue({
        nodes: [{ id: "team-1", key: "MAIN" }],
      });
      mockTeam.mockResolvedValue({ key: "MAIN" });

      mockCreateIssue.mockResolvedValue({
        issue: Promise.resolve({
          id: "issue-uuid-bb",
          identifier: "MAIN-70",
          title: "Blocked issue",
          url: "https://linear.app/test/issue/MAIN-70",
        }),
      });

      const program = new Command();
      program.option("--agent <id>").option("--credentials-dir <path>").option("--format <format>");
      registerIssueCommands(program);

      const logs: string[] = [];
      const origLog = console.log;
      console.log = (...args: unknown[]) => logs.push(args.join(" "));

      try {
        await program.parseAsync([
          "node", "linear",
          "--agent", "test-bot",
          "--credentials-dir", testDir,
          "--format", "json",
          "issue", "create",
          "--title", "Blocked issue",
          "--team", "Engineering",
          "--blocked-by", "MAIN-5",
        ]);
      } finally {
        console.log = origLog;
      }

      // blocked-by reverses: the target (MAIN-5) blocks this issue
      expect(mockCreateIssueRelation).toHaveBeenCalledWith({
        issueId: "MAIN-5",
        relatedIssueId: "issue-uuid-bb",
        type: "blocks",
      });
    });

    it("reports partial failure with PartialSuccessError", async () => {
      vi.resetModules();
      const { registerIssueCommands } = await import("../commands/issue.js");
      const { Command } = await import("commander");

      mockTeams.mockResolvedValue({
        nodes: [{ id: "team-1", key: "MAIN" }],
      });
      mockTeam.mockResolvedValue({ key: "MAIN" });

      mockCreateIssue.mockResolvedValue({
        issue: Promise.resolve({
          id: "issue-uuid-pf",
          identifier: "MAIN-80",
          title: "Partial fail",
          url: "https://linear.app/test/issue/MAIN-80",
        }),
      });

      // First relation succeeds, second fails
      mockCreateIssueRelation
        .mockResolvedValueOnce({ success: true })
        .mockRejectedValueOnce(new Error("Not found"));

      const program = new Command();
      program.option("--agent <id>").option("--credentials-dir <path>").option("--format <format>");
      registerIssueCommands(program);

      const logs: string[] = [];
      const origLog = console.log;
      console.log = (...args: unknown[]) => logs.push(args.join(" "));

      try {
        await expect(
          program.parseAsync([
            "node", "linear",
            "--agent", "test-bot",
            "--credentials-dir", testDir,
            "--format", "json",
            "issue", "create",
            "--title", "Partial fail",
            "--team", "Engineering",
            "--blocks", "MAIN-10",
            "--blocks", "MAIN-INVALID",
          ])
        ).rejects.toThrow(/some relations failed/);
      } finally {
        console.log = origLog;
      }

      // The primary result should still have been printed
      expect(logs.length).toBeGreaterThan(0);
      const output = JSON.parse(logs[0]);
      expect(output.id).toBe("MAIN-80");
      expect(output.relations.succeeded).toHaveLength(1);
      expect(output.relations.failed).toHaveLength(1);
    });
  });

  describe("resolveTeam and resolveProject validation", () => {
    it("throws ValidationError when team name does not match", async () => {
      vi.resetModules();
      const { registerIssueCommands } = await import("../commands/issue.js");
      const { Command } = await import("commander");
      const { ValidationError } = await import("../errors.js");

      mockTeams.mockResolvedValue({ nodes: [] });

      const program = new Command();
      program.option("--agent <id>").option("--credentials-dir <path>").option("--format <format>");
      registerIssueCommands(program);

      await expect(
        program.parseAsync([
          "node", "linear",
          "--agent", "test-bot",
          "--credentials-dir", testDir,
          "--format", "json",
          "issue", "create",
          "--title", "Test",
          "--team", "nonexistent",
        ])
      ).rejects.toThrow(ValidationError);
    });

    it("throws ValidationError when project name does not match", async () => {
      vi.resetModules();
      const { registerIssueCommands } = await import("../commands/issue.js");
      const { Command } = await import("commander");
      const { ValidationError } = await import("../errors.js");

      mockTeams.mockResolvedValue({ nodes: [{ id: "team-1", key: "MAIN" }] });
      mockProjects.mockResolvedValue({ nodes: [] });
      mockCreateIssue.mockResolvedValue({
        issue: Promise.resolve({
          id: "issue-uuid-x",
          identifier: "MAIN-99",
          title: "Test",
          url: "https://linear.app/test/issue/MAIN-99",
        }),
      });

      const program = new Command();
      program.option("--agent <id>").option("--credentials-dir <path>").option("--format <format>");
      registerIssueCommands(program);

      await expect(
        program.parseAsync([
          "node", "linear",
          "--agent", "test-bot",
          "--credentials-dir", testDir,
          "--format", "json",
          "issue", "create",
          "--title", "Test",
          "--team", "Engineering",
          "--project", "nonexistent",
        ])
      ).rejects.toThrow(ValidationError);
    });
  });
});
