import type { FetchLike } from "./types";

export class UsageProviderError extends Error {
  readonly provider: string;
  readonly status?: number;
  readonly details?: unknown;

  constructor(params: {
    provider: string;
    message: string;
    status?: number;
    details?: unknown;
  }) {
    super(params.message);
    this.name = "UsageProviderError";
    this.provider = params.provider;
    this.status = params.status;
    this.details = params.details;
  }
}

export function getFetch(fetchImpl?: FetchLike): FetchLike {
  if (fetchImpl) {
    return fetchImpl;
  }

  if (typeof fetch === "function") {
    return fetch;
  }

  throw new UsageProviderError({
    provider: "runtime",
    message: "No fetch implementation is available. Pass fetchImpl in options.",
  });
}

export async function readProviderJson<T>(
  provider: string,
  response: Response,
): Promise<T> {
  const text = await response.text();
  const payload = parseJsonSafely(text);

  if (!response.ok) {
    throw new UsageProviderError({
      provider,
      status: response.status,
      message: `${provider} usage request failed with HTTP ${response.status}`,
      details: payload ?? text,
    });
  }

  return payload as T;
}

export function parseJsonSafely(value: string): unknown {
  if (!value) {
    return {};
  }

  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return undefined;
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function toNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  return undefined;
}

export function toIsoString(value: Date | string | number): string {
  if (value instanceof Date) {
    return value.toISOString();
  }

  return new Date(value).toISOString();
}

export function bytesFromGigabytes(value: number): number {
  return value * 1024 * 1024 * 1024;
}

export function bytesFromMegabytes(value: number): number {
  return value * 1024 * 1024;
}

export function latestSeriesNumber(
  value: unknown,
  preferredKeys: string[] = ["value", "count", "usage", "commands"],
): number | undefined {
  const records = asArray(value).map(asRecord).filter(Boolean);
  const latest = records[records.length - 1];

  if (!latest) {
    return toNumber(value);
  }

  for (const key of preferredKeys) {
    const numericValue = toNumber(latest[key]);
    if (typeof numericValue === "number") {
      return numericValue;
    }
  }

  for (const possibleValue of Object.values(latest)) {
    const numericValue = toNumber(possibleValue);
    if (typeof numericValue === "number") {
      return numericValue;
    }
  }

  return undefined;
}

export function createBasicAuthHeader(username: string, password: string): string {
  const value = `${username}:${password}`;
  const encoded =
    typeof btoa === "function"
      ? btoa(value)
      : Buffer.from(value, "utf8").toString("base64");

  return `Basic ${encoded}`;
}

export function compactErrors(errors: unknown[]): string[] | undefined {
  const messages = errors
    .map((error) => {
      if (error instanceof Error) {
        return error.message;
      }

      if (typeof error === "string") {
        return error;
      }

      return undefined;
    })
    .filter((message): message is string => Boolean(message));

  return messages.length ? messages : undefined;
}
