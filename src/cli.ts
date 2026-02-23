import { Command, Option } from "commander";
import { readFileSync } from "fs";
import { join } from "path";
import { registerAuthCommands } from "./commands/auth.js";
import { registerIssueCommands } from "./commands/issue.js";
import { registerCommentCommands } from "./commands/comment.js";
import { registerInboxCommands } from "./commands/inbox.js";
import { registerDelegateCommands } from "./commands/delegate.js";
import { registerLabelCommands } from "./commands/label.js";
import { registerUserCommands } from "./commands/user.js";
import { registerTeamCommands } from "./commands/team.js";
import { registerProjectCommands } from "./commands/project.js";
import { registerAttachmentCommands } from "./commands/attachment.js";
import { registerStateCommands } from "./commands/state.js";
import { CLIError } from "./errors.js";

const pkg = JSON.parse(
  readFileSync(join(__dirname, "..", "package.json"), "utf-8")
);

const program = new Command();

program
  .name("linear")
  .description("CLI tool for AI agents to interact with Linear")
  .version(pkg.version)
  .option("--agent <id>", "agent identifier (env: LINEAR_AGENT_ID)", process.env.LINEAR_AGENT_ID)
  .option(
    "--credentials-dir <path>",
    "path to credentials directory (env: LINEAR_AGENT_CREDENTIALS_DIR)",
    process.env.LINEAR_AGENT_CREDENTIALS_DIR ?? "~/.linear/credentials/"
  )
  .addOption(
    new Option("--format <format>", "output format (default: auto-detect TTY)")
      .choices(["json", "text"])
  );

// Register command groups
registerAuthCommands(program);
registerIssueCommands(program);
registerCommentCommands(program);
registerInboxCommands(program);
registerDelegateCommands(program);
registerLabelCommands(program);
registerUserCommands(program);
registerTeamCommands(program);
registerProjectCommands(program);
registerAttachmentCommands(program);
registerStateCommands(program);

program.parseAsync(process.argv).catch((err) => {
  if (err instanceof CLIError) {
    console.error(`Error: ${err.message}`);
    if (err.resolution) console.error(err.resolution);
    process.exit(err.exitCode);
  }
  console.error(`Error: ${err.message ?? err}`);
  process.exit(1);
});
