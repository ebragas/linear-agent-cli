import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join, resolve } from "path";
import { homedir } from "os";

export interface Credentials {
  authMethod: "client_credentials" | "oauth";
  clientId: string;
  clientSecret: string;
  accessToken: string;
  refreshToken: string | null;
  tokenExpiresAt: string;
  actorId: string;
  workspaceId: string;
  workspaceSlug: string;
}

const REQUIRED_FIELDS: (keyof Credentials)[] = [
  "authMethod",
  "clientId",
  "clientSecret",
  "accessToken",
  "tokenExpiresAt",
  "actorId",
  "workspaceId",
  "workspaceSlug",
];

export function getCredentialsDir(opts?: {
  credentialsDir?: string;
}): string {
  const dir =
    opts?.credentialsDir ??
    process.env.LINEAR_AGENT_CREDENTIALS_DIR ??
    join(homedir(), ".linear", "credentials");
  return dir.startsWith("~") ? join(homedir(), dir.slice(2)) : resolve(dir);
}

function credentialsPath(agentId: string, credentialsDir: string): string {
  return join(credentialsDir, `${agentId}.json`);
}

export function readCredentials(
  agentId: string,
  credentialsDir: string
): Credentials {
  const path = credentialsPath(agentId, credentialsDir);
  let raw: string;
  try {
    raw = readFileSync(path, "utf-8");
  } catch {
    throw new Error(
      `Credentials not found for agent "${agentId}" at ${path}. Run "linear auth setup" first.`
    );
  }

  const data = JSON.parse(raw) as Record<string, unknown>;
  const missing = REQUIRED_FIELDS.filter(
    (f) => data[f] === undefined || data[f] === null
  );
  if (missing.length > 0) {
    throw new Error(
      `Credentials file missing required fields: ${missing.join(", ")}`
    );
  }

  return data as unknown as Credentials;
}

export function writeCredentials(
  agentId: string,
  credentialsDir: string,
  data: Credentials
): void {
  mkdirSync(credentialsDir, { recursive: true });
  const path = credentialsPath(agentId, credentialsDir);
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n", {
    mode: 0o600,
  });
}

export function deleteCredentials(
  agentId: string,
  credentialsDir: string
): void {
  const path = credentialsPath(agentId, credentialsDir);
  try {
    const { unlinkSync } = require("fs");
    unlinkSync(path);
  } catch {
    // File may not exist — that's fine
  }
}
