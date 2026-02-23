import { Command } from "commander";
import { readCredentials, getCredentialsDir } from "../credentials.js";
import { createClient } from "../client.js";
import { getFormat, printResult } from "../output.js";

export function registerAttachmentCommands(program: Command): void {
  const attachment = program
    .command("attachment")
    .description("Manage issue attachments");

  attachment
    .command("add")
    .description("Add an attachment to an issue (idempotent per URL)")
    .argument("<issue-id>", "Issue identifier (e.g., TEAM-123)")
    .requiredOption("--url <url>", "URL to attach")
    .option("--title <text>", "Display title for the link")
    .action(async (issueId: string, opts, cmd) => {
      const globalOpts = cmd.optsWithGlobals();
      const agent = globalOpts.agent;
      if (!agent) {
        console.error("Error: --agent is required (or set LINEAR_AGENT_ID env var)");
        process.exit(4);
      }
      const credentialsDir = getCredentialsDir(globalOpts);
      const credentials = readCredentials(agent, credentialsDir);
      const client = createClient(credentials);

      const input: Record<string, unknown> = {
        issueId,
        url: opts.url,
      };
      if (opts.title) input.title = opts.title;

      const result = await client.createAttachment(input as {
        issueId: string;
        url: string;
        title?: string;
      });

      const created = await result.attachment;
      const format = getFormat(globalOpts.format);
      printResult(
        {
          data: {
            id: created?.id,
            url: opts.url,
            title: opts.title ?? null,
            issueId,
          },
        },
        format,
      );
    });

  attachment
    .command("list")
    .description("List attachments on an issue")
    .argument("<issue-id>", "Issue identifier (e.g., TEAM-123)")
    .action(async (issueId: string, _opts, cmd) => {
      const globalOpts = cmd.optsWithGlobals();
      const agent = globalOpts.agent;
      if (!agent) {
        console.error("Error: --agent is required (or set LINEAR_AGENT_ID env var)");
        process.exit(4);
      }
      const credentialsDir = getCredentialsDir(globalOpts);
      const credentials = readCredentials(agent, credentialsDir);
      const client = createClient(credentials);

      const issue = await client.issue(issueId);
      const attachments = await issue.attachments();

      const attachmentData = attachments.nodes.map((a) => ({
        id: a.id,
        url: a.url,
        title: a.title ?? null,
      }));

      const format = getFormat(globalOpts.format);
      printResult({ data: attachmentData }, format);
    });

  attachment
    .command("remove")
    .description("Remove an attachment")
    .argument("<attachment-id>", "Attachment ID")
    .action(async (attachmentId: string, _opts, cmd) => {
      const globalOpts = cmd.optsWithGlobals();
      const agent = globalOpts.agent;
      if (!agent) {
        console.error("Error: --agent is required (or set LINEAR_AGENT_ID env var)");
        process.exit(4);
      }
      const credentialsDir = getCredentialsDir(globalOpts);
      const credentials = readCredentials(agent, credentialsDir);
      const client = createClient(credentials);

      await client.deleteAttachment(attachmentId);

      const format = getFormat(globalOpts.format);
      printResult(
        { data: { status: "removed", attachmentId } },
        format,
      );
    });
}
