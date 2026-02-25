import { Command } from "commander";
import { basename } from "path";
import { readFile, stat } from "fs/promises";
import { runWithClient } from "../context.js";
import { getFormat, printResult } from "../output.js";

export function registerAttachmentCommands(program: Command): void {
  const attachment = program
    .command("attachment")
    .description("Manage issue/project attachments");

  attachment
    .command("add")
    .description("Add an attachment to an issue (idempotent per URL)")
    .argument("<issue-id>", "Issue identifier (e.g., TEAM-123)")
    .requiredOption("--url <url>", "URL to attach")
    .option("--title <text>", "Display title for the link")
    .action(async (issueId: string, opts, cmd) => {
      const globalOpts = cmd.optsWithGlobals();
      await runWithClient(globalOpts, async (client) => {
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
    });

  attachment
    .command("upload")
    .description("Upload a local file and attach it to an issue or project")
    .argument("<file-path>", "Path to local file")
    .option("--issue <id>", "Issue identifier (e.g., TEAM-123)")
    .option("--project <id>", "Project ID or identifier")
    .option("--title <text>", "Display title for the attachment")
    .action(async (filePath: string, opts, cmd) => {
      const globalOpts = cmd.optsWithGlobals();

      const targetCount = Number(Boolean(opts.issue)) + Number(Boolean(opts.project));
      if (targetCount !== 1) {
        console.error("Error: exactly one of --issue or --project must be provided");
        process.exit(4);
      }

      const fileName = basename(filePath);
      const fileStats = await stat(filePath);
      const fileBuffer = await readFile(filePath);
      const contentType = fileName.endsWith(".png")
        ? "image/png"
        : fileName.endsWith(".jpg") || fileName.endsWith(".jpeg")
          ? "image/jpeg"
          : fileName.endsWith(".pdf")
            ? "application/pdf"
            : "application/octet-stream";

      await runWithClient(globalOpts, async (client) => {
        const uploadPayload = await client.fileUpload(contentType, fileName, fileStats.size);
        if (!uploadPayload.success || !uploadPayload.uploadFile) {
          throw new Error("Linear API did not return upload details");
        }

        const uploadResponse = await fetch(uploadPayload.uploadFile.uploadUrl, {
          method: "PUT",
          headers: {
            "Content-Type": contentType,
            ...Object.fromEntries(uploadPayload.uploadFile.headers.map((h) => [h.key, h.value])),
          },
          body: fileBuffer,
        });

        if (!uploadResponse.ok) {
          throw new Error(`Upload failed with status ${uploadResponse.status}`);
        }

        const input: Record<string, unknown> = {
          url: uploadPayload.uploadFile.assetUrl,
          title: opts.title ?? fileName,
        };
        if (opts.issue) input.issueId = opts.issue;
        if (opts.project) input.projectId = opts.project;

        const created = await client.createAttachment(input as {
          issueId?: string;
          projectId?: string;
          url: string;
          title?: string;
        });

        const attachmentRecord = await created.attachment;
        const format = getFormat(globalOpts.format);
        printResult({
          data: {
            id: attachmentRecord?.id,
            filePath,
            title: opts.title ?? fileName,
            issueId: opts.issue ?? null,
            projectId: opts.project ?? null,
            assetUrl: uploadPayload.uploadFile.assetUrl,
          },
        }, format);
      });
    });

  attachment
    .command("list")
    .description("List attachments on an issue")
    .argument("<issue-id>", "Issue identifier (e.g., TEAM-123)")
    .action(async (issueId: string, _opts, cmd) => {
      const globalOpts = cmd.optsWithGlobals();
      await runWithClient(globalOpts, async (client) => {
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
    });

  attachment
    .command("remove")
    .description("Remove an attachment")
    .argument("<attachment-id>", "Attachment ID")
    .action(async (attachmentId: string, _opts, cmd) => {
      const globalOpts = cmd.optsWithGlobals();
      await runWithClient(globalOpts, async (client) => {
        await client.deleteAttachment(attachmentId);

        const format = getFormat(globalOpts.format);
        printResult(
          { data: { status: "removed", attachmentId } },
          format,
        );
      });
    });
}
