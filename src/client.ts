import { LinearClient } from "@linear/sdk";
import type { Credentials } from "./credentials.js";
import { writeCredentials } from "./credentials.js";
import {
  AuthenticationError,
  RateLimitError,
  NetworkError,
  classifyError,
} from "./errors.js";

interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope?: string;
  refresh_token?: string;
}

async function refreshToken(
  credentials: Credentials,
  agentId: string,
  credentialsDir: string
): Promise<Credentials> {
  const body: Record<string, string> = {
    client_id: credentials.clientId,
    client_secret: credentials.clientSecret,
  };

  if (credentials.authMethod === "client_credentials") {
    body.grant_type = "client_credentials";
    body.scope = "read,write,app:assignable,app:mentionable";
  } else {
    body.grant_type = "refresh_token";
    body.refresh_token = credentials.refreshToken ?? "";
  }

  const response = await fetch("https://api.linear.app/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
  });

  if (!response.ok) {
    throw new AuthenticationError(
      `Token refresh failed: ${response.status} ${response.statusText}`
    );
  }

  const data = (await response.json()) as TokenResponse;
  const expiresAt = new Date(
    Date.now() + data.expires_in * 1000
  ).toISOString();

  const updated: Credentials = {
    ...credentials,
    accessToken: data.access_token,
    tokenExpiresAt: expiresAt,
    refreshToken: data.refresh_token ?? credentials.refreshToken,
  };

  writeCredentials(agentId, credentialsDir, updated);
  return updated;
}

function isRateLimited(err: unknown): number | true | false {
  const errObj = err as Record<string, unknown>;
  const extensions = errObj?.extensions as Record<string, unknown> | undefined;
  const type =
    (errObj?.type as string) ?? (extensions?.code as string) ?? "";
  if (type === "RATELIMITED") {
    const reset = extensions?.rateLimit as Record<string, unknown> | undefined;
    return (reset?.reset as number) ?? true;
  }

  // Check for errors array (GraphQL response)
  const errors = errObj?.errors as Array<Record<string, unknown>> | undefined;
  if (errors?.some((e) => (e.extensions as Record<string, unknown>)?.code === "RATELIMITED")) {
    return true;
  }

  return false;
}

function isAuthError(err: unknown): boolean {
  const errObj = err as Record<string, unknown>;
  const type =
    (errObj?.type as string) ??
    (errObj?.extensions as Record<string, unknown>)?.code;
  if (type === "AUTHENTICATION_ERROR") return true;
  const message = errObj?.message as string;
  return message?.includes("AUTHENTICATION_ERROR") ?? false;
}

function isNetworkError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return (
    message.includes("ECONNREFUSED") ||
    message.includes("ENOTFOUND") ||
    message.includes("ETIMEDOUT") ||
    message.includes("fetch failed") ||
    message.includes("network")
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withRetry<T>(
  fn: (client: LinearClient) => Promise<T>,
  credentials: Credentials,
  agentId: string,
  credentialsDir: string,
): Promise<T> {
  const client = createClient(credentials);
  try {
    return await fn(client);
  } catch (err) {
    // Rate limit: wait and retry once
    const rateLimitResult = isRateLimited(err);
    if (rateLimitResult) {
      if (typeof rateLimitResult === "number") {
        const waitMs = Math.max(0, rateLimitResult - Date.now());
        await sleep(Math.min(waitMs, 60_000)); // Cap at 60s
      } else {
        await sleep(5_000);
      }
      try {
        return await fn(client);
      } catch {
        throw new RateLimitError("Rate limited after retry");
      }
    }

    // Auth error: refresh token and retry once with new client
    if (isAuthError(err)) {
      try {
        const updated = await refreshToken(
          credentials,
          agentId,
          credentialsDir
        );
        const newClient = createClient(updated);
        return await fn(newClient);
      } catch (refreshErr) {
        if (refreshErr instanceof AuthenticationError) throw refreshErr;
        throw new AuthenticationError(
          "Token refresh failed. Run 'linear auth setup' to re-authenticate."
        );
      }
    }

    // Network error: retry once after 2s
    if (isNetworkError(err)) {
      await sleep(2_000);
      try {
        return await fn(client);
      } catch {
        throw new NetworkError(
          "Network error after retry. Check connectivity."
        );
      }
    }

    throw classifyError(err);
  }
}

export function createClient(credentials: Credentials): LinearClient {
  return new LinearClient({ accessToken: credentials.accessToken });
}
