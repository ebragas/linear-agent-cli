import { Command } from "commander";
import http from "http";
import { LinearClient } from "@linear/sdk";
import {
  readCredentials,
  writeCredentials,
  deleteCredentials,
  getCredentialsDir,
} from "../credentials.js";
import type { Credentials } from "../credentials.js";
import { AuthenticationError } from "../errors.js";
import { formatOutput, getFormat, printResult } from "../output.js";

const TOKEN_URL = "https://api.linear.app/oauth/token";
const AUTHORIZE_URL = "https://linear.app/oauth/authorize";
const DEFAULT_SCOPES = "read,write,app:assignable,app:mentionable";

interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope?: string;
  refresh_token?: string;
}

async function fetchToken(
  params: Record<string, string>
): Promise<TokenResponse> {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString(),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new AuthenticationError(
      `Token request failed: ${response.status} ${response.statusText}\n${body}`
    );
  }

  return (await response.json()) as TokenResponse;
}

async function fetchViewerAndOrg(accessToken: string): Promise<{
  actorId: string;
  workspaceId: string;
  workspaceSlug: string;
  name: string;
}> {
  const client = new LinearClient({ accessToken });
  const viewer = await client.viewer;
  const org = await client.organization;

  return {
    actorId: viewer.id,
    name: viewer.name ?? viewer.id,
    workspaceId: org.id,
    workspaceSlug: org.urlKey,
  };
}

async function setupClientCredentials(opts: {
  agent: string;
  clientId: string;
  clientSecret: string;
  scopes: string;
  credentialsDir: string;
  format: string;
}): Promise<void> {
  const tokenData = await fetchToken({
    grant_type: "client_credentials",
    client_id: opts.clientId,
    client_secret: opts.clientSecret,
    scope: opts.scopes,
  });

  const { actorId, name, workspaceId, workspaceSlug } =
    await fetchViewerAndOrg(tokenData.access_token);

  const credentials: Credentials = {
    authMethod: "client_credentials",
    clientId: opts.clientId,
    clientSecret: opts.clientSecret,
    accessToken: tokenData.access_token,
    refreshToken: null,
    tokenExpiresAt: new Date(
      Date.now() + tokenData.expires_in * 1000
    ).toISOString(),
    actorId,
    workspaceId,
    workspaceSlug,
  };

  writeCredentials(opts.agent, opts.credentialsDir, credentials);

  const format = getFormat(opts.format);
  printResult(
    {
      data: {
        status: "authenticated",
        agent: opts.agent,
        actorId,
        name,
        workspace: workspaceSlug,
        expiresAt: credentials.tokenExpiresAt,
      },
    },
    format
  );
}

async function setupOAuth(opts: {
  agent: string;
  clientId: string;
  clientSecret: string;
  scopes: string;
  port: number;
  credentialsDir: string;
  format: string;
}): Promise<void> {
  const redirectUri = `http://localhost:${opts.port}/callback`;

  // Wait for the authorization code via local HTTP server
  const code = await new Promise<string>((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? "/", `http://localhost:${opts.port}`);
      if (url.pathname === "/callback") {
        const code = url.searchParams.get("code");
        const error = url.searchParams.get("error");
        if (error) {
          res.writeHead(400, { "Content-Type": "text/html" });
          res.end(`<h1>Authorization failed</h1><p>${error}</p>`);
          server.close();
          reject(
            new AuthenticationError(`OAuth authorization failed: ${error}`)
          );
          return;
        }
        if (code) {
          res.writeHead(200, { "Content-Type": "text/html" });
          res.end(
            "<h1>Authorization successful</h1><p>You can close this window.</p>"
          );
          server.close();
          resolve(code);
          return;
        }
      }
      res.writeHead(404);
      res.end("Not found");
    });

    server.listen(opts.port, () => {
      const authUrl = new URL(AUTHORIZE_URL);
      authUrl.searchParams.set("response_type", "code");
      authUrl.searchParams.set("client_id", opts.clientId);
      authUrl.searchParams.set("redirect_uri", redirectUri);
      authUrl.searchParams.set("scope", opts.scopes);
      authUrl.searchParams.set("actor", "app");

      console.log(`\nOpen this URL in your browser:\n${authUrl.toString()}\n`);
      console.log(`Waiting for callback on port ${opts.port}...`);
    });

    server.on("error", (err) => {
      reject(
        new AuthenticationError(
          `Failed to start callback server: ${err.message}`
        )
      );
    });

    // Timeout after 5 minutes
    setTimeout(() => {
      server.close();
      reject(new AuthenticationError("OAuth callback timed out after 5 minutes"));
    }, 5 * 60 * 1000);
  });

  // Exchange code for tokens
  const tokenData = await fetchToken({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    client_id: opts.clientId,
    client_secret: opts.clientSecret,
  });

  const { actorId, name, workspaceId, workspaceSlug } =
    await fetchViewerAndOrg(tokenData.access_token);

  const credentials: Credentials = {
    authMethod: "oauth",
    clientId: opts.clientId,
    clientSecret: opts.clientSecret,
    accessToken: tokenData.access_token,
    refreshToken: tokenData.refresh_token ?? null,
    tokenExpiresAt: new Date(
      Date.now() + tokenData.expires_in * 1000
    ).toISOString(),
    actorId,
    workspaceId,
    workspaceSlug,
  };

  writeCredentials(opts.agent, opts.credentialsDir, credentials);

  const format = getFormat(opts.format);
  printResult(
    {
      data: {
        status: "authenticated",
        agent: opts.agent,
        actorId,
        name,
        workspace: workspaceSlug,
        method: "oauth",
        expiresAt: credentials.tokenExpiresAt,
      },
    },
    format
  );
}

export function registerAuthCommands(program: Command): void {
  const auth = program
    .command("auth")
    .description("Manage authentication and API tokens");

  auth
    .command("setup")
    .description("Authenticate an agent with Linear")
    .requiredOption("--client-id <id>", "OAuth application client ID")
    .requiredOption("--client-secret <secret>", "OAuth application client secret")
    .option("--client-credentials", "Use client credentials grant (default)", true)
    .option("--oauth", "Use OAuth authorization code flow")
    .option("--port <port>", "Local callback server port (OAuth only)", "9876")
    .option("--scopes <scopes>", "OAuth scopes", DEFAULT_SCOPES)
    .action(async (opts, cmd) => {
      const globalOpts = cmd.optsWithGlobals();
      const agent = globalOpts.agent;
      if (!agent) {
        console.error(
          "Error: --agent is required (or set LINEAR_AGENT_ID env var)"
        );
        process.exit(4);
      }
      const credentialsDir = getCredentialsDir(globalOpts);
      const format = globalOpts.format;

      if (opts.oauth) {
        await setupOAuth({
          agent,
          clientId: opts.clientId,
          clientSecret: opts.clientSecret,
          scopes: opts.scopes,
          port: parseInt(opts.port, 10),
          credentialsDir,
          format,
        });
      } else {
        await setupClientCredentials({
          agent,
          clientId: opts.clientId,
          clientSecret: opts.clientSecret,
          scopes: opts.scopes,
          credentialsDir,
          format,
        });
      }
    });

  auth
    .command("whoami")
    .description("Verify token and print agent identity")
    .action(async (_opts, cmd) => {
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
      const client = new LinearClient({
        accessToken: credentials.accessToken,
      });

      const viewer = await client.viewer;
      const org = await client.organization;

      const format = getFormat(globalOpts.format);
      printResult(
        {
          data: {
            agent,
            actorId: credentials.actorId,
            name: viewer.name ?? viewer.id,
            email: viewer.email,
            workspace: org.urlKey,
            workspaceId: org.id,
            authMethod: credentials.authMethod,
            tokenExpiresAt: credentials.tokenExpiresAt,
          },
        },
        format
      );
    });

  auth
    .command("refresh")
    .description("Request a new token")
    .action(async (_opts, cmd) => {
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

      const params: Record<string, string> = {
        client_id: credentials.clientId,
        client_secret: credentials.clientSecret,
      };

      if (credentials.authMethod === "client_credentials") {
        params.grant_type = "client_credentials";
        params.scope = "read,write,app:assignable,app:mentionable";
      } else {
        params.grant_type = "refresh_token";
        params.refresh_token = credentials.refreshToken ?? "";
      }

      const tokenData = await fetchToken(params);

      const updated: Credentials = {
        ...credentials,
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token ?? credentials.refreshToken,
        tokenExpiresAt: new Date(
          Date.now() + tokenData.expires_in * 1000
        ).toISOString(),
      };

      writeCredentials(agent, credentialsDir, updated);

      const format = getFormat(globalOpts.format);
      printResult(
        {
          data: {
            status: "refreshed",
            agent,
            expiresAt: updated.tokenExpiresAt,
          },
        },
        format
      );
    });

  auth
    .command("revoke")
    .description("Revoke token and delete credentials")
    .action(async (_opts, cmd) => {
      const globalOpts = cmd.optsWithGlobals();
      const agent = globalOpts.agent;
      if (!agent) {
        console.error(
          "Error: --agent is required (or set LINEAR_AGENT_ID env var)"
        );
        process.exit(4);
      }
      const credentialsDir = getCredentialsDir(globalOpts);

      let credentials: Credentials;
      try {
        credentials = readCredentials(agent, credentialsDir);
      } catch {
        console.error(`No credentials found for agent "${agent}".`);
        process.exit(4);
      }

      // Attempt to revoke via API (best effort)
      try {
        const response = await fetch(
          "https://api.linear.app/oauth/revoke",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/x-www-form-urlencoded",
              Authorization: `Bearer ${credentials.accessToken}`,
            },
          }
        );
        if (!response.ok) {
          console.error(
            `Warning: Token revocation returned ${response.status} (token may already be expired)`
          );
        }
      } catch {
        console.error(
          "Warning: Could not reach Linear API to revoke token"
        );
      }

      deleteCredentials(agent, credentialsDir);

      const format = getFormat(globalOpts.format);
      printResult(
        {
          data: {
            status: "revoked",
            agent,
          },
        },
        format
      );
    });
}
