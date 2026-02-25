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
import { mkdirSync, existsSync, writeFileSync, unlinkSync } from "fs";
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
  let createdAttachmentId: string;

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

  it("user me returns agent identity", () => {
    const output = JSON.parse(run("user me"));
    expect(output.agent).toBe(AGENT_ID);
    expect(output.actorId).toBeTruthy();
  });

  it("user search finds users", () => {
    const output = JSON.parse(run("user search a"));
    expect(output.results).toBeDefined();
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
    createdIssueId = createOutput.id;

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

  it("comment update modifies existing comment", () => {
    if (!createdCommentId) return;

    const output = JSON.parse(
      run(
        `comment update ${createdCommentId} --body "Updated integration test comment"`
      )
    );
    expect(output.id).toBe(createdCommentId);
    expect(output.body).toBe("Updated integration test comment");
    expect(output.success).toBe(true);
  });

  it("delegate assign → list → remove", () => {
    if (!createdIssueId) return;

    // Assign delegation to self (the agent)
    const assignOutput = JSON.parse(
      run(`delegate assign ${createdIssueId} --to me`)
    );
    expect(assignOutput.status).toBe("delegated");
    expect(assignOutput.issueId).toBe(createdIssueId);
    expect(assignOutput.delegateId).toBeTruthy();

    // List delegated issues
    const listOutput = JSON.parse(run("delegate list"));
    expect(listOutput.results).toBeDefined();
    const found = listOutput.results.find(
      (r: { id: string }) => r.id === createdIssueId
    );
    expect(found).toBeTruthy();

    // Remove delegation
    const removeOutput = JSON.parse(
      run(`delegate remove ${createdIssueId}`)
    );
    expect(removeOutput.status).toBe("delegation_removed");
    expect(removeOutput.issueId).toBe(createdIssueId);
  });

  it("attachment add → list → remove", () => {
    if (!createdIssueId) return;

    // Add attachment
    const addOutput = JSON.parse(
      run(
        `attachment add ${createdIssueId} --url https://example.com/test --title "Test attachment"`
      )
    );
    expect(addOutput.id).toBeTruthy();
    expect(addOutput.url).toBe("https://example.com/test");
    createdAttachmentId = addOutput.id;

    // List attachments
    const listOutput = JSON.parse(
      run(`attachment list ${createdIssueId}`)
    );
    expect(listOutput.results).toBeDefined();
    const found = listOutput.results.find(
      (a: { url: string }) => a.url === "https://example.com/test"
    );
    expect(found).toBeTruthy();

    // Remove attachment
    if (createdAttachmentId) {
      const removeOutput = JSON.parse(
        run(`attachment remove ${createdAttachmentId}`)
      );
      expect(removeOutput.status).toBe("removed");
      expect(removeOutput.attachmentId).toBe(createdAttachmentId);
    }
  });

  it("attachment upload → creates attachment on issue", () => {
    if (!createdIssueId) return;

    // Create a temp file to upload
    const uploadFilePath = join(tmpdir(), "integration-test-upload.txt");
    writeFileSync(uploadFilePath, "Integration test file content for Linear CLI upload.");

    try {
      const output = JSON.parse(
        run(
          `attachment upload ${uploadFilePath} --issue ${createdIssueId} --title "Integration upload test"`
        )
      );
      expect(output.id).toBeTruthy();
      expect(output.url).toMatch(/^https?:\/\//);
      expect(output.issueId).toBe(createdIssueId);
      expect(output.title).toBe("Integration upload test");

      // Clean up the uploaded attachment
      if (output.id) {
        run(`attachment remove ${output.id}`);
      }
    } finally {
      try { unlinkSync(uploadFilePath); } catch { /* best effort */ }
    }
  });

  it("issue list with --team filter returns results", () => {
    const output = JSON.parse(
      run(`issue list --team ${TEST_TEAM}`)
    );
    expect(output.results).toBeDefined();
  });

  it("issue list with --state filter returns results", () => {
    const stateOutput = JSON.parse(
      run(`state list --team ${TEST_TEAM}`)
    );
    if (stateOutput.results?.length > 0) {
      const stateName = stateOutput.results[0].name;
      const output = JSON.parse(
        run(`issue list --team ${TEST_TEAM} --state "${stateName}"`)
      );
      expect(output.results).toBeDefined();
    }
  });

  it("inbox list returns notifications", () => {
    const output = JSON.parse(run("inbox"));
    expect(output.results).toBeDefined();
    // May be empty, that's OK
  });

  it("inbox list --category mentions returns results", () => {
    const output = JSON.parse(run("inbox list --category mentions"));
    expect(output.results).toBeDefined();
    // May be empty — just verifying the filter doesn't error
  });

  it("inbox dismiss archives a notification", () => {
    // Get current notifications
    const listOutput = JSON.parse(run("inbox"));
    if (listOutput.results?.length > 0) {
      const notifId = listOutput.results[0].id;
      const output = JSON.parse(run(`inbox dismiss ${notifId}`));
      expect(output.status).toBe("dismissed");
      expect(output.id).toBe(notifId);
    }
    // If no notifications, skip gracefully
  });

  it("inbox dismiss-all archives all notifications", () => {
    const output = JSON.parse(run("inbox dismiss-all"));
    expect(output.status).toBe("dismissed-all");
    expect(typeof output.count).toBe("number");
  });

  it("label list returns labels", () => {
    const output = JSON.parse(run("label list"));
    expect(output.results).toBeDefined();
  });

  it("project list returns projects", () => {
    const output = JSON.parse(run("project list"));
    expect(output.results).toBeDefined();
  });

  it("project create → get → archive", () => {
    const createOutput = JSON.parse(
      run(`project create --name "Integration test project" --team ${TEST_TEAM} --description "Created by integration test" --target-date 2026-12-31`)
    );
    expect(createOutput.id).toBeTruthy();
    expect(createOutput.name).toBe("Integration test project");
    expect(createOutput.url).toMatch(/^https?:\/\//);

    const getOutput = JSON.parse(run(`project get ${createOutput.id}`));
    expect(getOutput.name).toBe("Integration test project");
    expect(getOutput.description).toBe("Created by integration test");

    // Note: no project archive/delete command in CLI yet; project left in workspace
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

  it("issue delete removes an issue", () => {
    // Create a dedicated issue for deletion test
    const createOutput = JSON.parse(
      run(
        `issue create --title "Delete test issue" --team ${TEST_TEAM} --description "Will be deleted"`
      )
    );
    const deleteId = createOutput.identifier ?? createOutput.id;
    expect(deleteId).toBeTruthy();

    const output = JSON.parse(run(`issue delete ${deleteId}`));
    expect(output.id).toBe(deleteId);
    expect(output.status).toBe("deleted");
  });
});
