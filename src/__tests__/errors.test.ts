import { describe, it, expect } from "vitest";
import {
  CLIError,
  RateLimitError,
  AuthenticationError,
  ForbiddenError,
  ValidationError,
  NetworkError,
  PartialSuccessError,
  classifyError,
} from "../errors.js";

describe("errors", () => {
  it("CLIError has correct exitCode", () => {
    const err = new CLIError("test", 42);
    expect(err.exitCode).toBe(42);
    expect(err.message).toBe("test");
    expect(err.name).toBe("CLIError");
  });

  it("RateLimitError has exit code 1", () => {
    const err = new RateLimitError("limited");
    expect(err.exitCode).toBe(1);
    expect(err.resetAt).toBeUndefined();
  });

  it("RateLimitError stores reset timestamp", () => {
    const resetAt = Date.now() + 60_000;
    const err = new RateLimitError("limited", resetAt);
    expect(err.resetAt).toBe(resetAt);
  });

  it("AuthenticationError has exit code 2", () => {
    const err = new AuthenticationError("bad token");
    expect(err.exitCode).toBe(2);
    expect(err.resolution).toContain("auth setup");
  });

  it("ForbiddenError has exit code 3", () => {
    const err = new ForbiddenError("no access");
    expect(err.exitCode).toBe(3);
  });

  it("ValidationError has exit code 4", () => {
    const err = new ValidationError("bad input");
    expect(err.exitCode).toBe(4);
  });

  it("ValidationError includes valid options", () => {
    const err = new ValidationError("bad input", ["option-a", "option-b"]);
    expect(err.exitCode).toBe(4);
    expect(err.validOptions).toEqual(["option-a", "option-b"]);
    expect(err.resolution).toContain("option-a");
    expect(err.resolution).toContain("option-b");
  });

  it("NetworkError has exit code 5", () => {
    const err = new NetworkError("connection refused");
    expect(err.exitCode).toBe(5);
  });

  it("PartialSuccessError has exit code 6", () => {
    const err = new PartialSuccessError(
      "partial",
      ["relation-1"],
      ["relation-2"]
    );
    expect(err.exitCode).toBe(6);
    expect(err.succeeded).toEqual(["relation-1"]);
    expect(err.failed).toEqual(["relation-2"]);
  });

  describe("classifyError", () => {
    it("passes through CLIError instances", () => {
      const original = new AuthenticationError("test");
      expect(classifyError(original)).toBe(original);
    });

    it("classifies RATELIMITED errors", () => {
      const err = { type: "RATELIMITED", message: "too many requests" };
      const result = classifyError(err);
      expect(result).toBeInstanceOf(RateLimitError);
    });

    it("classifies AUTHENTICATION_ERROR", () => {
      const err = { type: "AUTHENTICATION_ERROR", message: "bad token" };
      const result = classifyError(err);
      expect(result).toBeInstanceOf(AuthenticationError);
    });

    it("classifies FORBIDDEN errors", () => {
      const err = { type: "FORBIDDEN", message: "no access" };
      const result = classifyError(err);
      expect(result).toBeInstanceOf(ForbiddenError);
    });

    it("classifies InvalidInputLinearError", () => {
      const err = { type: "InvalidInputLinearError", message: "bad field" };
      const result = classifyError(err);
      expect(result).toBeInstanceOf(ValidationError);
    });

    it("classifies network errors by message", () => {
      const err = new Error("ECONNREFUSED: connection refused");
      const result = classifyError(err);
      expect(result).toBeInstanceOf(NetworkError);
    });

    it("classifies ETIMEDOUT as network error", () => {
      const err = new Error("ETIMEDOUT: operation timed out");
      const result = classifyError(err);
      expect(result).toBeInstanceOf(NetworkError);
    });

    it("defaults to CLIError with exit code 1", () => {
      const err = new Error("something else");
      const result = classifyError(err);
      expect(result).toBeInstanceOf(CLIError);
      expect(result.exitCode).toBe(1);
    });
  });
});
