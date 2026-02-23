/**
 * Integration tests — run against a real Linear workspace.
 *
 * Guarded behind INTEGRATION=true env flag (skipped by default).
 *
 * Required env vars:
 *   LINEAR_TEST_AGENT_ID      — agent identifier
 *   LINEAR_TEST_CLIENT_ID     — OAuth app client ID
 *   LINEAR_TEST_CLIENT_SECRET — OAuth app client secret
 *   LINEAR_TEST_TEAM          — team name or key to use for testing
 *
 * Run with: npm run test:integration
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync } from "child_process";
import { mkdirSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const INTEGRATION = process.env.INTEGRATION === "true";
const CLI = join(__dirname, "../../../dist/cli.js");

const AGENT_ID = process.env.LINEAR_TEST_AGENT_ID ?? "";
const CLIENT_ID = process.env.LINEAR_TEST_CLIENT_ID ?? "";
const CLIENT_SECRET = process.env.LINEAR_TEST_CLIENT_SECRET ?? "";
const TEST_TEAM = process.env.LINEAR_TEST_TEAM ?? "Main";

function run(args: string, opts?: { expectFail?: boolean }): string {
  const credDir = join(tmpdir(), "linear-cli-integration-test");
  mkdirSync(credDir, { recursive: true });
  const cmd = `node ${CLI} --agent ${AGENT_ID} --credentials-dir ${credDir} --format json ${args}`;
  try {
    return execSync(cmd, { encoding: "utf-8", timeout: 30_000 });
  } catch (err: any) {
    if (opts?.expectFail) {
      return err.stdout ?? err.stderr ?? "";
    }
    throw err;
  }
}

describe.skipIf(!INTEGRATION)("integration: lifecycle", () => {
  let createdIssueId: string;
  let createdCommentId: string;

  beforeAll(() => {
    // Auth setup
    run(
      `auth setup --client-credentials --client-id ${CLIENT_ID} --client-secret ${CLIENT_SECRET}`
    );
  });

  afterAll(() => {
    // Cleanup: archive the test issue
    if (createdIssueId) {
      try {
        run(`issue archive ${createdIssueId}`);
      } catch {
        // best effort
      }
    }
  });

  it("auth whoami returns agent identity", () => {
    const output = JSON.parse(run("auth whoami"));
    expect(output.agent).toBe(AGENT_ID);
    expect(output.actorId).toBeTruthy();
    expect(output.workspace).toBeTruthy();
  });

  it("team list returns teams", () => {
    const output = JSON.parse(run("team list"));
    expect(output.results).toBeDefined();
    expect(output.results.length).toBeGreaterThan(0);
  });

  it("state list returns states", () => {
    const output = JSON.parse(run(`state list --team ${TEST_TEAM}`));
    expect(output.results).toBeDefined();
    expect(output.results.length).toBeGreaterThan(0);
  });

  it("user list returns users", () => {
    const output = JSON.parse(run("user list"));
    expect(output.results).toBeDefined();
    expect(output.results.length).toBeGreaterThan(0);
  });

  it("issue create → get → update → transition → archive", () => {
    // Create
    const createOutput = JSON.parse(
      run(
        `issue create --title "Integration test issue" --team ${TEST_TEAM} --description "Created by integration test"`
      )
    );
    expect(createOutput.id).toBeTruthy();
    createdIssueId = createOutput.identifier ?? createOutput.id;

    // Get
    const getOutput = JSON.parse(run(`issue get ${createdIssueId}`));
    expect(getOutput.title).toBe("Integration test issue");

    // Update
    const updateOutput = JSON.parse(
      run(
        `issue update ${createdIssueId} --title "Updated integration test issue"`
      )
    );
    expect(updateOutput.id).toBeTruthy();
    expect(updateOutput.title).toBe("Updated integration test issue");

    // Transition (to first available state)
    const stateOutput = JSON.parse(
      run(`state list --team ${TEST_TEAM}`)
    );
    if (stateOutput.results?.length > 1) {
      const targetState = stateOutput.results[1].name;
      run(`issue transition ${createdIssueId} "${targetState}"`);
    }
  });

  it("comment add → list → reply", () => {
    if (!createdIssueId) return;

    // Add comment
    const addOutput = JSON.parse(
      run(
        `comment add ${createdIssueId} --body "Integration test comment"`
      )
    );
    expect(addOutput.id).toBeTruthy();
    createdCommentId = addOutput.id;

    // List comments
    const listOutput = JSON.parse(
      run(`comment list ${createdIssueId}`)
    );
    expect(listOutput.results).toBeDefined();
    expect(listOutput.results.length).toBeGreaterThan(0);

    // Reply
    if (createdCommentId) {
      const replyOutput = JSON.parse(
        run(
          `comment add ${createdIssueId} --body "Reply to test comment" --reply-to ${createdCommentId}`
        )
      );
      expect(replyOutput.id).toBeTruthy();
    }
  });

  it("inbox list returns notifications", () => {
    const output = JSON.parse(run("inbox"));
    expect(output.results).toBeDefined();
    // May be empty, that's OK
  });

  it("label list returns labels", () => {
    const output = JSON.parse(run("label list"));
    expect(output.results).toBeDefined();
  });

  it("project list returns projects", () => {
    const output = JSON.parse(run("project list"));
    expect(output.results).toBeDefined();
  });

  it("search finds issues", () => {
    const output = JSON.parse(run('issue search "integration test"'));
    expect(output.results).toBeDefined();
  });

  it("json output is valid across all commands", () => {
    const commands = [
      "team list",
      "user list",
      "label list",
      "project list",
      `state list --team ${TEST_TEAM}`,
      "inbox",
    ];
    for (const cmd of commands) {
      const output = run(cmd);
      expect(() => JSON.parse(output)).not.toThrow();
    }
  });
});
