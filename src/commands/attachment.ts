import { readFileSync, statSync } from "fs";
import { basename, extname, resolve } from "path";
import { Command } from "commander";
import { runWithClient } from "../context.js";
import { getFormat, printResult } from "../output.js";

const CONTENT_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".json": "application/json",
  ".csv": "text/csv",
  ".zip": "application/zip",
};

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

  attachment
    .command("upload")
    .description("Upload a local file and attach it to an issue or project")
    .argument("<file-path>", "Path to the local file to upload")
    .option("--issue <id>", "Issue identifier to attach the file to (e.g., TEAM-123)")
    .option("--project <id>", "Project name or ID to upload the file for")
    .option("--title <text>", "Display title for the attachment (defaults to filename)")
    .action(async (filePath: string, opts, cmd) => {
      const globalOpts = cmd.optsWithGlobals();
      await runWithClient(globalOpts, async (client) => {
        if (!opts.issue && !opts.project) {
          console.error("Error: --issue or --project is required");
          process.exit(4);
        }

        const resolvedPath = resolve(filePath);
        let stat: ReturnType<typeof statSync>;
        try {
          stat = statSync(resolvedPath);
        } catch {
          console.error(`Error: file not found: ${filePath}`);
          process.exit(4);
        }
        if (!stat.isFile()) {
          console.error(`Error: ${filePath} is not a file`);
          process.exit(4);
        }

        const filename = basename(resolvedPath);
        const ext = extname(filename).toLowerCase();
        const contentType = CONTENT_TYPES[ext] ?? "application/octet-stream";
        const size = stat.size;

        // Step 1: Request a signed upload URL from Linear
        const uploadPayload = await client.fileUpload(contentType, filename, size);
        const uploadFile = uploadPayload.uploadFile;
        if (!uploadFile) {
          throw new Error("Failed to get upload URL from Linear");
        }

        // Step 2: PUT the file content to the signed URL
        let fileContent: Buffer;
        try {
          fileContent = readFileSync(resolvedPath);
        } catch {
          console.error(`Error: could not read file: ${filePath}`);
          process.exit(4);
        }
        const headers: Record<string, string> = {
          "Content-Type": contentType,
          "Cache-Control": "public, max-age=31536000",
        };
        for (const h of uploadFile.headers) {
          headers[h.key] = h.value;
        }

        const uploadResponse = await fetch(uploadFile.uploadUrl, {
          method: "PUT",
          headers,
          body: fileContent,
        });
        if (!uploadResponse.ok) {
          throw new Error(
            `Upload failed: ${uploadResponse.status} ${uploadResponse.statusText}`
          );
        }

        const title = opts.title ?? filename;
        const format = getFormat(globalOpts.format);

        // Step 3: Create an attachment record (issues only — Linear API does not
        // support creating attachments directly on projects)
        if (opts.issue) {
          const result = await client.createAttachment({
            issueId: opts.issue,
            url: uploadFile.assetUrl,
            title,
          });
          const created = await result.attachment;
          printResult(
            {
              data: {
                id: created?.id,
                url: uploadFile.assetUrl,
                title,
                issueId: opts.issue,
              },
            },
            format,
          );
        } else {
          printResult(
            {
              data: {
                url: uploadFile.assetUrl,
                title,
                projectId: opts.project,
              },
            },
            format,
          );
        }
      });
    });
}
