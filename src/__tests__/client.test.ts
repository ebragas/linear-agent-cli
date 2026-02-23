import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { LinearClient } from "@linear/sdk";
import { withRetry, createClient } from "../client.js";
import { writeCredentials } from "../credentials.js";
import type { Credentials } from "../credentials.js";
import {
  AuthenticationError,
  RateLimitError,
  NetworkError,
} from "../errors.js";

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

vi.mock("@linear/sdk", () => ({
  LinearClient: vi.fn().mockImplementation(() => ({})),
}));

const testCredentials: Credentials = {
  authMethod: "client_credentials",
  clientId: "test-client-id",
  clientSecret: "test-client-secret",
  accessToken: "test-access-token",
  refreshToken: null,
  tokenExpiresAt: "2026-03-24T10:00:00Z",
  actorId: "actor-123",
  workspaceId: "org-456",
  workspaceSlug: "test-workspace",
};

describe("client", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `linear-cli-client-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    writeCredentials("test-agent", testDir, testCredentials);
    mockFetch.mockReset();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
    try {
      const { rmSync } = require("fs");
      rmSync(testDir, { recursive: true, force: true });
    } catch {
      // cleanup
    }
  });

  describe("createClient", () => {
    it("creates LinearClient with access token", () => {
      const client = createClient(testCredentials);
      expect(LinearClient).toHaveBeenCalledWith({
        accessToken: "test-access-token",
      });
    });
  });

  describe("withRetry", () => {
    const getClient = (creds: Credentials) =>
      new LinearClient({ accessToken: creds.accessToken });

    it("returns result on success", async () => {
      const fn = vi.fn().mockResolvedValue("success");
      const result = await withRetry(
        fn,
        testCredentials,
        "test-agent",
        testDir,
        getClient
      );
      expect(result).toBe("success");
      expect(fn).toHaveBeenCalledTimes(1);
    });

    describe("rate limit handling", () => {
      it("retries on RATELIMITED error and succeeds", { timeout: 10_000 }, async () => {
        const fn = vi
          .fn()
          .mockRejectedValueOnce({ type: "RATELIMITED" })
          .mockResolvedValue("success after retry");

        const result = await withRetry(
          fn,
          testCredentials,
          "test-agent",
          testDir,
          getClient
        );
        expect(result).toBe("success after retry");
        expect(fn).toHaveBeenCalledTimes(2);
      });

      it("throws RateLimitError after retry fails", { timeout: 10_000 }, async () => {
        const fn = vi
          .fn()
          .mockRejectedValueOnce({ type: "RATELIMITED" })
          .mockRejectedValueOnce(new Error("still limited"));

        await expect(
          withRetry(fn, testCredentials, "test-agent", testDir, getClient)
        ).rejects.toThrow(RateLimitError);
        expect(fn).toHaveBeenCalledTimes(2);
      });

      it("detects RATELIMITED in GraphQL errors array", { timeout: 10_000 }, async () => {
        const fn = vi
          .fn()
          .mockRejectedValueOnce({
            errors: [{ extensions: { code: "RATELIMITED" } }],
          })
          .mockResolvedValue("recovered");

        const result = await withRetry(
          fn,
          testCredentials,
          "test-agent",
          testDir,
          getClient
        );
        expect(result).toBe("recovered");
      });
    });

    describe("auth error handling", () => {
      it("attempts token refresh on AUTHENTICATION_ERROR", async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            access_token: "new-token",
            token_type: "Bearer",
            expires_in: 2592000,
          }),
        });

        const fn = vi
          .fn()
          .mockRejectedValue({ type: "AUTHENTICATION_ERROR" });

        // After refresh, withRetry throws AuthenticationError with "Token refreshed"
        await expect(
          withRetry(fn, testCredentials, "test-agent", testDir, getClient)
        ).rejects.toThrow(AuthenticationError);

        // Verify token refresh was attempted
        expect(mockFetch).toHaveBeenCalledWith(
          "https://api.linear.app/oauth/token",
          expect.objectContaining({ method: "POST" })
        );
      });

      it("detects AUTHENTICATION_ERROR in message", async () => {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 401,
          statusText: "Unauthorized",
        });

        const fn = vi
          .fn()
          .mockRejectedValue(
            new Error("AUTHENTICATION_ERROR: invalid token")
          );

        await expect(
          withRetry(fn, testCredentials, "test-agent", testDir, getClient)
        ).rejects.toThrow(AuthenticationError);
      });

      it("throws AuthenticationError when refresh fails", async () => {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 400,
          statusText: "Bad Request",
        });

        const fn = vi
          .fn()
          .mockRejectedValue({ type: "AUTHENTICATION_ERROR" });

        await expect(
          withRetry(fn, testCredentials, "test-agent", testDir, getClient)
        ).rejects.toThrow(AuthenticationError);
      });
    });

    describe("network error handling", () => {
      it("retries on network error and succeeds", async () => {
        const fn = vi
          .fn()
          .mockRejectedValueOnce(new Error("ECONNREFUSED"))
          .mockResolvedValue("recovered");

        const result = await withRetry(
          fn,
          testCredentials,
          "test-agent",
          testDir,
          getClient
        );
        expect(result).toBe("recovered");
        expect(fn).toHaveBeenCalledTimes(2);
      });

      it("throws NetworkError after retry fails", async () => {
        const fn = vi
          .fn()
          .mockRejectedValueOnce(new Error("ECONNREFUSED"))
          .mockRejectedValueOnce(new Error("ECONNREFUSED again"));

        await expect(
          withRetry(fn, testCredentials, "test-agent", testDir, getClient)
        ).rejects.toThrow(NetworkError);
        expect(fn).toHaveBeenCalledTimes(2);
      });

      it("detects ETIMEDOUT as network error", async () => {
        const fn = vi
          .fn()
          .mockRejectedValueOnce(new Error("ETIMEDOUT"))
          .mockResolvedValue("ok");

        const result = await withRetry(
          fn,
          testCredentials,
          "test-agent",
          testDir,
          getClient
        );
        expect(result).toBe("ok");
      });

      it("detects fetch failed as network error", async () => {
        const fn = vi
          .fn()
          .mockRejectedValueOnce(new Error("fetch failed"))
          .mockResolvedValue("ok");

        const result = await withRetry(
          fn,
          testCredentials,
          "test-agent",
          testDir,
          getClient
        );
        expect(result).toBe("ok");
      });
    });

    it("classifies unknown errors and throws", async () => {
      const fn = vi
        .fn()
        .mockRejectedValue(new Error("Something unexpected"));

      await expect(
        withRetry(fn, testCredentials, "test-agent", testDir, getClient)
      ).rejects.toThrow();
      expect(fn).toHaveBeenCalledTimes(1);
    });
  });
});
