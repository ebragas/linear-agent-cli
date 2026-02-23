import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync, writeFileSync, mkdirSync, statSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  readCredentials,
  writeCredentials,
  getCredentialsDir,
} from "../credentials.js";
import type { Credentials } from "../credentials.js";

const validCredentials: Credentials = {
  authMethod: "client_credentials",
  clientId: "test-client-id",
  clientSecret: "test-client-secret",
  accessToken: "test-access-token",
  refreshToken: null,
  tokenExpiresAt: "2026-03-24T10:00:00Z",
  actorId: "actor-123",
  workspaceId: "workspace-456",
  workspaceSlug: "test-workspace",
};

describe("credentials", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `linear-cli-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    try {
      const { rmSync } = require("fs");
      rmSync(testDir, { recursive: true, force: true });
    } catch {
      // cleanup best effort
    }
  });

  describe("writeCredentials", () => {
    it("writes credentials as JSON", () => {
      writeCredentials("test-agent", testDir, validCredentials);
      const path = join(testDir, "test-agent.json");
      const raw = readFileSync(path, "utf-8");
      const data = JSON.parse(raw);
      expect(data.clientId).toBe("test-client-id");
      expect(data.accessToken).toBe("test-access-token");
    });

    it("sets file permissions to 600", () => {
      writeCredentials("test-agent", testDir, validCredentials);
      const path = join(testDir, "test-agent.json");
      const stats = statSync(path);
      // Check owner read+write (0o600)
      const mode = stats.mode & 0o777;
      expect(mode).toBe(0o600);
    });

    it("creates directory if it does not exist", () => {
      const nestedDir = join(testDir, "nested", "dir");
      writeCredentials("test-agent", nestedDir, validCredentials);
      const path = join(nestedDir, "test-agent.json");
      const raw = readFileSync(path, "utf-8");
      expect(JSON.parse(raw).clientId).toBe("test-client-id");
    });
  });

  describe("readCredentials", () => {
    it("reads valid credentials", () => {
      writeCredentials("test-agent", testDir, validCredentials);
      const result = readCredentials("test-agent", testDir);
      expect(result.authMethod).toBe("client_credentials");
      expect(result.clientId).toBe("test-client-id");
      expect(result.actorId).toBe("actor-123");
    });

    it("throws on missing file", () => {
      expect(() => readCredentials("nonexistent", testDir)).toThrow(
        /Credentials not found/
      );
    });

    it("throws on missing required fields", () => {
      const path = join(testDir, "bad-agent.json");
      writeFileSync(path, JSON.stringify({ clientId: "only-this" }));
      expect(() => readCredentials("bad-agent", testDir)).toThrow(
        /missing required fields/
      );
    });
  });

  describe("getCredentialsDir", () => {
    it("uses provided option", () => {
      const result = getCredentialsDir({ credentialsDir: "/custom/path" });
      expect(result).toBe("/custom/path");
    });

    it("uses env var when no option", () => {
      const original = process.env.LINEAR_AGENT_CREDENTIALS_DIR;
      process.env.LINEAR_AGENT_CREDENTIALS_DIR = "/env/path";
      try {
        const result = getCredentialsDir();
        expect(result).toBe("/env/path");
      } finally {
        if (original === undefined) {
          delete process.env.LINEAR_AGENT_CREDENTIALS_DIR;
        } else {
          process.env.LINEAR_AGENT_CREDENTIALS_DIR = original;
        }
      }
    });

    it("defaults to ~/.linear/credentials", () => {
      const original = process.env.LINEAR_AGENT_CREDENTIALS_DIR;
      delete process.env.LINEAR_AGENT_CREDENTIALS_DIR;
      try {
        const result = getCredentialsDir();
        expect(result).toContain(".linear");
        expect(result).toContain("credentials");
      } finally {
        if (original !== undefined) {
          process.env.LINEAR_AGENT_CREDENTIALS_DIR = original;
        }
      }
    });
  });
});
