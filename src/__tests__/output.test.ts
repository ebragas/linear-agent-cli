import { describe, it, expect } from "vitest";
import { formatOutput, getFormat } from "../output.js";
import type { CommandResult } from "../output.js";

describe("output", () => {
  describe("getFormat", () => {
    it("returns json when explicitly set", () => {
      expect(getFormat("json")).toBe("json");
    });

    it("returns text when explicitly set", () => {
      expect(getFormat("text")).toBe("text");
    });
  });

  describe("formatOutput — json", () => {
    it("wraps arrays in results", () => {
      const result: CommandResult<string[]> = {
        data: ["a", "b", "c"],
      };
      const output = formatOutput(result, "json");
      const parsed = JSON.parse(output);
      expect(parsed.results).toEqual(["a", "b", "c"]);
    });

    it("outputs single objects directly", () => {
      const result: CommandResult<{ id: string; name: string }> = {
        data: { id: "1", name: "test" },
      };
      const output = formatOutput(result, "json");
      const parsed = JSON.parse(output);
      expect(parsed.id).toBe("1");
      expect(parsed.name).toBe("test");
    });

    it("includes warnings in array output", () => {
      const result: CommandResult<string[]> = {
        data: ["a"],
        warnings: ["something went wrong"],
      };
      const output = formatOutput(result, "json");
      const parsed = JSON.parse(output);
      expect(parsed.results).toEqual(["a"]);
      expect(parsed.warnings).toEqual(["something went wrong"]);
    });

    it("includes warnings in object output", () => {
      const result: CommandResult<{ id: string }> = {
        data: { id: "1" },
        warnings: ["partial failure"],
      };
      const output = formatOutput(result, "json");
      const parsed = JSON.parse(output);
      expect(parsed.id).toBe("1");
      expect(parsed._warnings).toEqual(["partial failure"]);
    });
  });

  describe("formatOutput — text", () => {
    it("formats object as key-value pairs", () => {
      const result: CommandResult<{ id: string; name: string }> = {
        data: { id: "1", name: "test" },
      };
      const output = formatOutput(result, "text");
      expect(output).toContain("id: 1");
      expect(output).toContain("name: test");
    });

    it("formats array items", () => {
      const result: CommandResult<Array<{ id: string }>> = {
        data: [{ id: "1" }, { id: "2" }],
      };
      const output = formatOutput(result, "text");
      expect(output).toContain("id: 1");
      expect(output).toContain("id: 2");
    });

    it("shows null values as dash", () => {
      const result: CommandResult<{ field: null }> = {
        data: { field: null },
      };
      const output = formatOutput(result, "text");
      expect(output).toContain("field: -");
    });

    it("appends warnings", () => {
      const result: CommandResult<{ id: string }> = {
        data: { id: "1" },
        warnings: ["oops"],
      };
      const output = formatOutput(result, "text");
      expect(output).toContain("Warning: oops");
    });
  });
});
