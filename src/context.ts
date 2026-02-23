import { LinearClient } from "@linear/sdk";
import { readCredentials, getCredentialsDir } from "./credentials.js";
import type { Credentials } from "./credentials.js";
import { withRetry } from "./client.js";

export interface CommandContext {
  credentials: Credentials;
  agentId: string;
  credentialsDir: string;
}

export function requireAgent(globalOpts: Record<string, unknown>): string {
  const agent = globalOpts.agent as string | undefined;
  if (!agent) {
    console.error(
      "Error: --agent is required (or set LINEAR_AGENT_ID env var)"
    );
    process.exit(4);
  }
  return agent;
}

export async function runWithClient<T>(
  globalOpts: Record<string, unknown>,
  fn: (client: LinearClient, ctx: CommandContext) => Promise<T>
): Promise<T> {
  const agentId = requireAgent(globalOpts);
  const credentialsDir = getCredentialsDir(globalOpts);
  const credentials = readCredentials(agentId, credentialsDir);
  return withRetry(
    (client) => fn(client, { credentials, agentId, credentialsDir }),
    credentials,
    agentId,
    credentialsDir
  );
}
