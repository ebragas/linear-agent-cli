import { Command, Option } from "commander";
import { readFileSync } from "fs";
import { join } from "path";

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

// Register placeholder subcommands
program.command("auth").description("Manage authentication and API tokens");
program.command("issue").description("Create, read, update, and search issues");
program.command("comment").description("Add and list comments on issues");
program.command("inbox").description("View and manage inbox notifications");
program.command("delegate").description("Assign and delegate issues");
program.command("label").description("Manage labels");
program.command("user").description("Look up users and teams");
program.command("team").description("Manage team settings and members");
program.command("project").description("Manage projects and milestones");
program.command("attachment").description("Manage issue attachments");
program.command("state").description("Manage workflow states");

program.parseAsync(process.argv);
