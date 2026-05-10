/** Typed exceptions for the Vocametrix SDK. */

export class VocametrixError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly body?: unknown,
  ) {
    super(message);
    this.name = "VocametrixError";
  }
}

export class VocametrixAuthError extends VocametrixError {
  constructor(message: string, body?: unknown) {
    super(message, 401, body);
    this.name = "VocametrixAuthError";
  }
}

export class VocametrixForbiddenError extends VocametrixError {
  constructor(message: string, body?: unknown) {
    super(message, 403, body);
    this.name = "VocametrixForbiddenError";
  }
}

export class VocametrixNotFoundError extends VocametrixError {
  constructor(message: string, body?: unknown) {
    super(message, 404, body);
    this.name = "VocametrixNotFoundError";
  }
}

export class VocametrixValidationError extends VocametrixError {
  constructor(message: string, body?: unknown) {
    super(message, 422, body);
    this.name = "VocametrixValidationError";
  }
}

export class VocametrixRateLimitError extends VocametrixError {
  constructor(
    message: string,
    public readonly retryAfter?: number,
    body?: unknown,
  ) {
    super(message, 429, body);
    this.name = "VocametrixRateLimitError";
  }
}

export class VocametrixServerError extends VocametrixError {
  constructor(message: string, statusCode = 500, body?: unknown) {
    super(message, statusCode, body);
    this.name = "VocametrixServerError";
  }
}

const RETRYABLE = new Set([429, 500, 502, 503, 504]);

export function isRetryable(status: number): boolean {
  return RETRYABLE.has(status);
}

export function raiseForStatus(status: number, body: unknown): never {
  const msg = typeof body === "object" && body !== null
    ? JSON.stringify(body)
    : `HTTP ${String(status)}`;

  if (status === 401) throw new VocametrixAuthError(msg, body);
  if (status === 403) throw new VocametrixForbiddenError(msg, body);
  if (status === 404) throw new VocametrixNotFoundError(msg, body);
  if (status === 422) throw new VocametrixValidationError(msg, body);
  if (status === 429) throw new VocametrixRateLimitError(msg, undefined, body);
  if (status >= 500) throw new VocametrixServerError(msg, status, body);
  throw new VocametrixError(msg, status, body);
}
