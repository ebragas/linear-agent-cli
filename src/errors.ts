export class CLIError extends Error {
  constructor(
    message: string,
    public readonly exitCode: number,
    public readonly resolution?: string
  ) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class RateLimitError extends CLIError {
  constructor(
    message: string,
    public readonly resetAt?: number // UTC epoch milliseconds
  ) {
    super(message, 1, "Wait for rate limit reset or reduce request frequency.");
  }
}

export class AuthenticationError extends CLIError {
  constructor(message: string) {
    super(message, 2, 'Run "linear auth setup" to re-authenticate.');
  }
}

export class ForbiddenError extends CLIError {
  constructor(message: string) {
    super(
      message,
      3,
      "The agent may have lost access. Check team permissions in Linear."
    );
  }
}

export class ValidationError extends CLIError {
  constructor(
    message: string,
    public readonly validOptions?: string[]
  ) {
    const resolution = validOptions?.length
      ? `Valid options:\n${validOptions.map((o) => `  - ${o}`).join("\n")}`
      : undefined;
    super(message, 4, resolution);
  }
}

export class NetworkError extends CLIError {
  constructor(message: string) {
    super(message, 5, "Check network connectivity and try again.");
  }
}

export class PartialSuccessError extends CLIError {
  constructor(
    message: string,
    public readonly succeeded: string[],
    public readonly failed: string[]
  ) {
    super(message, 6);
  }
}

export function classifyError(err: unknown): CLIError {
  if (err instanceof CLIError) return err;

  const message = err instanceof Error ? err.message : String(err);
  const errObj = err as Record<string, unknown>;
  const type =
    (errObj?.type as string) ??
    (errObj?.extensions as Record<string, unknown>)?.code;

  switch (type) {
    case "RATELIMITED":
      return new RateLimitError(message);
    case "AUTHENTICATION_ERROR":
      return new AuthenticationError(message);
    case "FORBIDDEN":
      return new ForbiddenError(message);
    case "InvalidInputLinearError":
      return new ValidationError(message);
    default:
      if (
        message.includes("ECONNREFUSED") ||
        message.includes("ENOTFOUND") ||
        message.includes("ETIMEDOUT") ||
        message.includes("fetch failed")
      ) {
        return new NetworkError(message);
      }
      return new CLIError(message, 1);
  }
}
