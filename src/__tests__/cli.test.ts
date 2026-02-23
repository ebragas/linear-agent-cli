import { describe, it, expect } from "vitest";
import { execSync } from "child_process";
import { join } from "path";

describe("cli", () => {
  it("should display help with all subcommands", () => {
    const result = execSync(`node ${join(__dirname, "../../dist/cli.js")} --help`, {
      encoding: "utf-8",
    });

    expect(result).toContain("linear");
    expect(result).toContain("--agent");
    expect(result).toContain("--credentials-dir");
    expect(result).toContain("--format");
    expect(result).toContain("auth");
    expect(result).toContain("issue");
    expect(result).toContain("comment");
    expect(result).toContain("inbox");
    expect(result).toContain("delegate");
    expect(result).toContain("label");
    expect(result).toContain("user");
    expect(result).toContain("team");
    expect(result).toContain("project");
    expect(result).toContain("attachment");
    expect(result).toContain("state");
  });

  it("should display version", () => {
    const result = execSync(`node ${join(__dirname, "../../dist/cli.js")} --version`, {
      encoding: "utf-8",
    });

    expect(result.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
