export type UsageProvider =
  | "cloudflare-r2"
  | "mongodb-atlas"
  | "upstash-redis"
  | "resend"
  | "supabase"
  | "vercel"
  | "custom";

export type UsageStatus = "ok" | "warning" | "critical" | "unknown";

export type UsageUnit =
  | "count"
  | "bytes"
  | "usd"
  | "percent"
  | "milliseconds"
  | "operations_per_second"
  | "requests";

export type UsagePeriod = "instant" | "day" | "month" | "range";

export interface UsageThresholds {
  warning: number;
  critical: number;
}

export interface UsageMetric {
  provider: UsageProvider;
  key: string;
  label: string;
  value: number;
  unit: UsageUnit;
  period: UsagePeriod;
  limit?: number;
  status: UsageStatus;
  source: string;
  updatedAt: string;
  metadata?: Record<string, unknown>;
}

export interface ProviderUsageResult<TRaw = unknown> {
  provider: UsageProvider;
  metrics: UsageMetric[];
  errors?: string[];
  raw?: TRaw;
}

export interface FetchLike {
  (input: string | URL | Request, init?: RequestInit): Promise<Response>;
}

export interface CommonCollectorOptions {
  fetchImpl?: FetchLike;
  thresholds?: Partial<UsageThresholds>;
  now?: Date;
}

export interface UsageLimit {
  label?: string;
  value: number;
}
