export interface CommandResult<T> {
  data: T;
  warnings?: string[];
}

export function getFormat(formatFlag?: string): "json" | "text" {
  if (formatFlag === "json" || formatFlag === "text") return formatFlag;
  return process.stdout.isTTY ? "text" : "json";
}

export function formatOutput<T>(
  result: CommandResult<T>,
  format: "json" | "text"
): string {
  if (format === "json") {
    return formatJson(result);
  }
  return formatText(result);
}

function formatJson<T>(result: CommandResult<T>): string {
  const { data, warnings } = result;
  if (Array.isArray(data)) {
    const obj: Record<string, unknown> = { results: data };
    if (warnings?.length) obj.warnings = warnings;
    return JSON.stringify(obj, null, 2);
  }
  if (warnings?.length) {
    return JSON.stringify({ ...data, _warnings: warnings }, null, 2);
  }
  return JSON.stringify(data, null, 2);
}

function formatText<T>(result: CommandResult<T>): string {
  const { data, warnings } = result;
  const lines: string[] = [];

  if (Array.isArray(data)) {
    for (const item of data) {
      lines.push(formatRecord(item));
    }
  } else if (data && typeof data === "object") {
    lines.push(formatRecord(data));
  } else {
    lines.push(String(data));
  }

  if (warnings?.length) {
    lines.push("");
    for (const w of warnings) {
      lines.push(`Warning: ${w}`);
    }
  }

  return lines.join("\n");
}

function formatRecord(item: unknown): string {
  if (!item || typeof item !== "object") return String(item);
  const record = item as Record<string, unknown>;
  return Object.entries(record)
    .map(([key, value]) => {
      if (value === null || value === undefined) return `${key}: -`;
      if (typeof value === "object") return `${key}: ${JSON.stringify(value)}`;
      return `${key}: ${value}`;
    })
    .join("\n");
}

export function printResult<T>(
  result: CommandResult<T>,
  format: "json" | "text"
): void {
  console.log(formatOutput(result, format));
}
