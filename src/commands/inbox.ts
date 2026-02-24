import { Command } from "commander";
import { runWithClient } from "../context.js";
import { getFormat, printResult } from "../output.js";

const VALID_CATEGORIES = [
  "assignments",
  "mentions",
  "statusChanges",
  "commentsAndReplies",
  "reactions",
  "reviews",
  "appsAndIntegrations",
  "triage",
  "system",
] as const;

function parseSinceDate(since: string): Date {
  // ISO-8601 duration (e.g., -P7D, P1D)
  const durationMatch = since.match(
    /^-?P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/i
  );
  if (durationMatch) {
    const days = parseInt(durationMatch[1] ?? "0", 10);
    const hours = parseInt(durationMatch[2] ?? "0", 10);
    const minutes = parseInt(durationMatch[3] ?? "0", 10);
    const seconds = parseInt(durationMatch[4] ?? "0", 10);
    const ms =
      (days * 86400 + hours * 3600 + minutes * 60 + seconds) * 1000;
    return new Date(Date.now() - ms);
  }
  // Otherwise treat as ISO date string
  const date = new Date(since);
  if (isNaN(date.getTime())) {
    throw new Error(`Invalid date or duration: ${since}`);
  }
  return date;
}

export function registerInboxCommands(program: Command): void {
  const inbox = program
    .command("inbox")
    .description("View and manage inbox notifications");

  inbox
    .command("list", { isDefault: true })
    .description("List notifications")
    .option("--include-archived", "Show all notifications (not just unprocessed)")
    .option("--type <type>", "Filter by notification type string")
    .option("--category <category>", "Filter by notification category")
    .option("--since <date>", "Only notifications after this date or duration")
    .action(async (opts: Record<string, string | boolean>, cmd: Command) => {
      const globalOpts = cmd.optsWithGlobals();

      if (
        opts.category &&
        !VALID_CATEGORIES.includes(opts.category as typeof VALID_CATEGORIES[number])
      ) {
        console.error(
          `Error: Invalid category "${opts.category}". Valid categories: ${VALID_CATEGORIES.join(", ")}`
        );
        process.exit(4);
      }

      await runWithClient(globalOpts, async (client) => {
        const filter: Record<string, unknown> = {};
        if (opts.type) {
          filter.type = { eq: opts.type };
        }

        const notificationsConnection = await client.notifications({
          filter: Object.keys(filter).length > 0 ? filter : undefined,
        });
        let notifications = notificationsConnection.nodes;

        // Client-side filters
        if (!opts.includeArchived) {
          notifications = notifications.filter(
            (n: { archivedAt?: Date | null }) => !n.archivedAt
          );
        }
        if (opts.category) {
          notifications = notifications.filter(
            (n: { type: string }) => (n as unknown as Record<string, string>).category === opts.category
          );
        }
        if (opts.since) {
          const sinceDate = parseSinceDate(opts.since as string);
          notifications = notifications.filter(
            (n: { createdAt: Date }) => new Date(n.createdAt) >= sinceDate
          );
        }

        const results = [];
        for (const n of notifications) {
          const issue = await n.issue;
          results.push({
            id: n.id,
            type: n.type,
            createdAt: n.createdAt,
            archivedAt: n.archivedAt ?? null,
            issue: issue
              ? { id: issue.id, identifier: issue.identifier, title: issue.title, url: issue.url }
              : null,
          });
        }

        const format = getFormat(globalOpts.format);
        printResult({ data: results }, format);
      });
    });

  inbox
    .command("dismiss")
    .description("Dismiss (archive) a notification")
    .argument("<id>", "Notification ID")
    .action(async (id: string, _opts: unknown, cmd: Command) => {
      const globalOpts = cmd.optsWithGlobals();
      await runWithClient(globalOpts, async (client) => {
        const result = await client.archiveNotification(id);

        const format = getFormat(globalOpts.format);
        printResult(
          {
            data: {
              id,
              status: "dismissed",
              success: result.success,
            },
          },
          format
        );
      });
    });

  inbox
    .command("dismiss-all")
    .description("Dismiss all unprocessed notifications")
    .action(async (_opts: unknown, cmd: Command) => {
      const globalOpts = cmd.optsWithGlobals();
      await runWithClient(globalOpts, async (client) => {
        const notificationsConnection = await client.notifications();
        const unarchived = notificationsConnection.nodes.filter(
          (n: { archivedAt?: Date | null }) => !n.archivedAt
        );

        let dismissed = 0;
        for (const n of unarchived) {
          await client.archiveNotification(n.id);
          dismissed++;
        }

        const format = getFormat(globalOpts.format);
        printResult(
          {
            data: {
              status: "dismissed-all",
              count: dismissed,
            },
          },
          format
        );
      });
    });
}
