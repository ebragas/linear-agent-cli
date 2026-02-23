import { Command } from "commander";
import { readFileSync } from "fs";
import {
  readCredentials,
  getCredentialsDir,
} from "../credentials.js";
import { createClient } from "../client.js";
import { getFormat, printResult } from "../output.js";

export function registerCommentCommands(program: Command): void {
  const comment = program
    .command("comment")
    .description("Add and list comments on issues");

  comment
    .command("list")
    .description("List all comments on an issue")
    .argument("<issue-id>", "Issue identifier (e.g., MAIN-42)")
    .action(async (issueId: string, _opts: unknown, cmd: Command) => {
      const globalOpts = cmd.optsWithGlobals();
      const agent = globalOpts.agent;
      if (!agent) {
        console.error(
          "Error: --agent is required (or set LINEAR_AGENT_ID env var)"
        );
        process.exit(4);
      }
      const credentialsDir = getCredentialsDir(globalOpts);
      const credentials = readCredentials(agent, credentialsDir);
      const client = createClient(credentials);

      const issue = await client.issue(issueId);
      const commentsConnection = await issue.comments();
      const comments = [];

      for (const c of commentsConnection.nodes) {
        const user = await c.user;
        comments.push({
          id: c.id,
          author: user?.name ?? user?.id ?? "Unknown",
          body: c.body,
          createdAt: c.createdAt,
          parentId: c.parentId ?? null,
        });
      }

      const format = getFormat(globalOpts.format);
      printResult({ data: comments }, format);
    });

  comment
    .command("add")
    .description("Add a comment to an issue")
    .argument("<issue-id>", "Issue identifier (e.g., MAIN-42)")
    .option("--body <text>", "Comment body as markdown")
    .option("--body-file <path>", "Read body from file")
    .option("--reply-to <comment-id>", "Reply to a specific comment")
    .action(async (issueId: string, opts: Record<string, string>, cmd: Command) => {
      const globalOpts = cmd.optsWithGlobals();
      const agent = globalOpts.agent;
      if (!agent) {
        console.error(
          "Error: --agent is required (or set LINEAR_AGENT_ID env var)"
        );
        process.exit(4);
      }
      const credentialsDir = getCredentialsDir(globalOpts);
      const credentials = readCredentials(agent, credentialsDir);
      const client = createClient(credentials);

      let body = opts.body;
      if (opts.bodyFile) {
        body = readFileSync(opts.bodyFile, "utf-8");
      }
      if (!body) {
        console.error("Error: --body or --body-file is required");
        process.exit(4);
      }

      const input: Record<string, string> = { issueId, body };
      if (opts.replyTo) {
        input.parentId = opts.replyTo;
      }

      const result = await client.createComment(input);
      const commentNode = await result.comment;

      const format = getFormat(globalOpts.format);
      printResult(
        {
          data: {
            id: commentNode?.id,
            issueId,
            body,
            parentId: opts.replyTo ?? null,
            success: result.success,
          },
        },
        format
      );
    });

  comment
    .command("update")
    .description("Update an existing comment")
    .argument("<comment-id>", "Comment ID")
    .option("--body <text>", "Updated comment body")
    .option("--body-file <path>", "Read body from file")
    .action(async (commentId: string, opts: Record<string, string>, cmd: Command) => {
      const globalOpts = cmd.optsWithGlobals();
      const agent = globalOpts.agent;
      if (!agent) {
        console.error(
          "Error: --agent is required (or set LINEAR_AGENT_ID env var)"
        );
        process.exit(4);
      }
      const credentialsDir = getCredentialsDir(globalOpts);
      const credentials = readCredentials(agent, credentialsDir);
      const client = createClient(credentials);

      let body = opts.body;
      if (opts.bodyFile) {
        body = readFileSync(opts.bodyFile, "utf-8");
      }
      if (!body) {
        console.error("Error: --body or --body-file is required");
        process.exit(4);
      }

      const result = await client.updateComment(commentId, { body });

      const format = getFormat(globalOpts.format);
      printResult(
        {
          data: {
            id: commentId,
            body,
            success: result.success,
          },
        },
        format
      );
    });
}
