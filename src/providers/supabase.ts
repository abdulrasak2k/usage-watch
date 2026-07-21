import { createUsageMetric } from "../thresholds.js";
import type { CommonCollectorOptions, ProviderUsageResult } from "../types.js";
import {
  asArray,
  asRecord,
  bytesFromGigabytes,
  bytesFromMegabytes,
  compactErrors,
  getFetch,
  readProviderJson,
  toNumber,
} from "../utils.js";

export interface SupabaseUsageSummaryOptions extends CommonCollectorOptions {
  databaseBytes?: number;
  monthlyActiveUsers?: number;
  egressBytesThisMonth?: number;
  storageBytes?: number;
  limits?: {
    databaseBytes?: number;
    monthlyActiveUsers?: number;
    egressBytes?: number;
    storageBytes?: number;
  };
  metadata?: Record<string, unknown>;
}

export type SupabaseUsageInterval =
  | "15min"
  | "30min"
  | "1hr"
  | "3hr"
  | "1day"
  | "3day"
  | "7day";

export interface SupabaseCollectorOptions extends SupabaseUsageSummaryOptions {
  projectRef: string;
  accessToken: string;
  endpoint?: string;
  interval?: SupabaseUsageInterval;
  limits?: SupabaseUsageSummaryOptions["limits"] & {
    apiRequests?: number;
    authRequests?: number;
    realtimeRequests?: number;
    restRequests?: number;
    storageRequests?: number;
  };
}

export interface SupabaseApiCount {
  timestamp?: unknown;
  total_auth_requests?: unknown;
  total_realtime_requests?: unknown;
  total_rest_requests?: unknown;
  total_storage_requests?: unknown;
  [key: string]: unknown;
}

export interface SupabaseApiCountsPayload {
  result?: unknown;
  error?: unknown;
  [key: string]: unknown;
}

export interface SupabaseLiveRawResult {
  database?: unknown;
  apiCounts?: SupabaseApiCountsPayload;
}

const DEFAULT_SUPABASE_LIMITS = {
  databaseBytes: bytesFromMegabytes(500),
  monthlyActiveUsers: 50_000,
  egressBytes: bytesFromGigabytes(5),
  storageBytes: bytesFromGigabytes(1),
};

const DEFAULT_ENDPOINT = "https://api.supabase.com";
const DATABASE_USAGE_QUERY = `select
  (select coalesce(sum(pg_catalog.pg_database_size(pg_catalog.pg_database.datname)), 0)::double precision
    from pg_catalog.pg_database) as database_bytes,
  (select coalesce(sum(
    case
      when storage.objects.metadata ->> 'size' ~ '^[0-9]+$'
        then (storage.objects.metadata ->> 'size')::numeric
      else 0
    end
  ), 0)::double precision from storage.objects) as storage_bytes;`;

export async function collectSupabaseUsage(
  options: SupabaseCollectorOptions,
): Promise<ProviderUsageResult<SupabaseLiveRawResult>> {
  const fetchImpl = getFetch(options.fetchImpl);
  const endpoint = (options.endpoint ?? DEFAULT_ENDPOINT).replace(/\/$/, "");
  const projectRef = encodeURIComponent(options.projectRef);
  const headers = {
    accept: "application/json",
    authorization: `Bearer ${options.accessToken}`,
  };
  const interval = options.interval ?? "7day";

  const [databaseResult, apiCountsResult] = await Promise.allSettled([
    (async () =>
      readProviderJson<unknown>(
        "supabase",
        await fetchImpl(
          `${endpoint}/v1/projects/${projectRef}/database/query/read-only`,
          {
            method: "POST",
            headers: { ...headers, "content-type": "application/json" },
            body: JSON.stringify({ query: DATABASE_USAGE_QUERY }),
          },
        ),
      ))(),
    (async () =>
      readProviderJson<SupabaseApiCountsPayload>(
        "supabase",
        await fetchImpl(
          `${endpoint}/v1/projects/${projectRef}/analytics/endpoints/usage.api-counts?interval=${interval}`,
          { headers },
        ),
      ))(),
  ]);

  const raw: SupabaseLiveRawResult = {
    database:
      databaseResult.status === "fulfilled" ? databaseResult.value : undefined,
    apiCounts:
      apiCountsResult.status === "fulfilled" ? apiCountsResult.value : undefined,
  };
  const errors = compactErrors([
    databaseResult.status === "rejected" ? databaseResult.reason : undefined,
    apiCountsResult.status === "rejected" ? apiCountsResult.reason : undefined,
    apiCountsResult.status === "fulfilled"
      ? payloadError(apiCountsResult.value.error)
      : undefined,
  ]);

  return createSupabaseLiveUsageMetrics(raw, options, errors);
}

export function createSupabaseUsageMetrics(
  options: SupabaseUsageSummaryOptions,
): ProviderUsageResult<SupabaseUsageSummaryOptions> {
  const limits = { ...DEFAULT_SUPABASE_LIMITS, ...options.limits };
  const updatedAt = (options.now ?? new Date()).toISOString();

  return {
    provider: "supabase",
    metrics: [
      createUsageMetric({
        provider: "supabase",
        key: "supabase.database.bytes",
        label: "Supabase database size",
        value: options.databaseBytes ?? 0,
        unit: "bytes",
        period: "instant",
        limit: limits.databaseBytes,
        source: "application-or-provider-summary",
        updatedAt,
        metadata: options.metadata,
        thresholds: options.thresholds,
      }),
      createUsageMetric({
        provider: "supabase",
        key: "supabase.auth.monthly_active_users",
        label: "Supabase monthly active users",
        value: options.monthlyActiveUsers ?? 0,
        unit: "count",
        period: "month",
        limit: limits.monthlyActiveUsers,
        source: "application-or-provider-summary",
        updatedAt,
        metadata: options.metadata,
        thresholds: options.thresholds,
      }),
      createUsageMetric({
        provider: "supabase",
        key: "supabase.egress.month",
        label: "Supabase egress this month",
        value: options.egressBytesThisMonth ?? 0,
        unit: "bytes",
        period: "month",
        limit: limits.egressBytes,
        source: "application-or-provider-summary",
        updatedAt,
        metadata: options.metadata,
        thresholds: options.thresholds,
      }),
      createUsageMetric({
        provider: "supabase",
        key: "supabase.storage.bytes",
        label: "Supabase Storage usage",
        value: options.storageBytes ?? 0,
        unit: "bytes",
        period: "instant",
        limit: limits.storageBytes,
        source: "application-or-provider-summary",
        updatedAt,
        metadata: {
          ...options.metadata,
          note: "BNS File Tracking should keep document binaries in Cloudflare R2, not Supabase Storage.",
        },
        thresholds: options.thresholds,
      }),
    ],
    raw: options,
  };
}

export function createSupabaseLiveUsageMetrics(
  raw: SupabaseLiveRawResult,
  options: Pick<
    SupabaseCollectorOptions,
    | "projectRef"
    | "interval"
    | "limits"
    | "thresholds"
    | "now"
    | "databaseBytes"
    | "monthlyActiveUsers"
    | "egressBytesThisMonth"
    | "storageBytes"
    | "metadata"
  >,
  errors?: string[],
): ProviderUsageResult<SupabaseLiveRawResult> {
  const databaseRow = firstResultRow(raw.database);
  const databaseBytes =
    options.databaseBytes ?? toNumber(databaseRow?.database_bytes);
  const storageBytes =
    options.storageBytes ?? toNumber(databaseRow?.storage_bytes);
  const summary = createSupabaseUsageMetrics({
    databaseBytes,
    monthlyActiveUsers: options.monthlyActiveUsers,
    egressBytesThisMonth: options.egressBytesThisMonth,
    storageBytes,
    limits: options.limits,
    metadata: options.metadata,
    thresholds: options.thresholds,
    now: options.now,
  });
  const includedSummaryKeys = new Set<string>();
  if (typeof databaseBytes === "number") {
    includedSummaryKeys.add("supabase.database.bytes");
  }
  if (typeof options.monthlyActiveUsers === "number") {
    includedSummaryKeys.add("supabase.auth.monthly_active_users");
  }
  if (typeof options.egressBytesThisMonth === "number") {
    includedSummaryKeys.add("supabase.egress.month");
  }
  if (typeof storageBytes === "number") {
    includedSummaryKeys.add("supabase.storage.bytes");
  }

  const limits = { ...DEFAULT_SUPABASE_LIMITS, ...options.limits };
  const updatedAt = (options.now ?? new Date()).toISOString();
  const interval = options.interval ?? "7day";
  const metadata = {
    ...options.metadata,
    projectRef: options.projectRef,
    interval,
  };
  const counts = aggregateApiCounts(raw.apiCounts?.result);
  const apiMetrics = counts
    ? [
        createUsageMetric({
          provider: "supabase",
          key: "supabase.api.requests.total",
          label: "Supabase API requests",
          value:
            counts.auth + counts.realtime + counts.rest + counts.storage,
          unit: "requests",
          period: "range",
          limit: limits.apiRequests,
          source: "supabase-management-api:usage.api-counts",
          updatedAt,
          metadata,
          thresholds: options.thresholds,
        }),
        createUsageMetric({
          provider: "supabase",
          key: "supabase.api.requests.auth",
          label: "Supabase Auth requests",
          value: counts.auth,
          unit: "requests",
          period: "range",
          limit: limits.authRequests,
          source: "supabase-management-api:usage.api-counts",
          updatedAt,
          metadata,
          thresholds: options.thresholds,
        }),
        createUsageMetric({
          provider: "supabase",
          key: "supabase.api.requests.realtime",
          label: "Supabase Realtime requests",
          value: counts.realtime,
          unit: "requests",
          period: "range",
          limit: limits.realtimeRequests,
          source: "supabase-management-api:usage.api-counts",
          updatedAt,
          metadata,
          thresholds: options.thresholds,
        }),
        createUsageMetric({
          provider: "supabase",
          key: "supabase.api.requests.rest",
          label: "Supabase REST requests",
          value: counts.rest,
          unit: "requests",
          period: "range",
          limit: limits.restRequests,
          source: "supabase-management-api:usage.api-counts",
          updatedAt,
          metadata,
          thresholds: options.thresholds,
        }),
        createUsageMetric({
          provider: "supabase",
          key: "supabase.api.requests.storage",
          label: "Supabase Storage requests",
          value: counts.storage,
          unit: "requests",
          period: "range",
          limit: limits.storageRequests,
          source: "supabase-management-api:usage.api-counts",
          updatedAt,
          metadata,
          thresholds: options.thresholds,
        }),
      ]
    : [];

  return {
    provider: "supabase",
    metrics: [
      ...summary.metrics
        .filter((metric) => includedSummaryKeys.has(metric.key))
        .map((metric) => ({
          ...metric,
          source:
            (metric.key === "supabase.database.bytes" &&
              typeof options.databaseBytes !== "number") ||
            (metric.key === "supabase.storage.bytes" &&
              typeof options.storageBytes !== "number")
              ? "supabase-management-api:database/query/read-only"
              : metric.source,
          metadata: { ...metric.metadata, ...metadata },
        })),
      ...apiMetrics,
    ],
    errors,
    raw,
  };
}

function firstResultRow(value: unknown): Record<string, unknown> | undefined {
  const directRows = asArray(value);
  if (directRows.length) {
    return asRecord(directRows[0]);
  }

  const record = asRecord(value);
  const nestedRows = asArray(record?.result ?? record?.data);
  if (nestedRows.length) {
    return asRecord(nestedRows[0]);
  }

  return record &&
    ("database_bytes" in record || "storage_bytes" in record)
    ? record
    : undefined;
}

function aggregateApiCounts(value: unknown):
  | { auth: number; realtime: number; rest: number; storage: number }
  | undefined {
  const rows = asArray(value)
    .map(asRecord)
    .filter((row): row is SupabaseApiCount => Boolean(row));
  if (!rows.length) {
    return undefined;
  }

  return rows.reduce<{
    auth: number;
    realtime: number;
    rest: number;
    storage: number;
  }>(
    (total, row) => ({
      auth: total.auth + (toNumber(row.total_auth_requests) ?? 0),
      realtime:
        total.realtime + (toNumber(row.total_realtime_requests) ?? 0),
      rest: total.rest + (toNumber(row.total_rest_requests) ?? 0),
      storage: total.storage + (toNumber(row.total_storage_requests) ?? 0),
    }),
    { auth: 0, realtime: 0, rest: 0, storage: 0 },
  );
}

function payloadError(value: unknown): string | undefined {
  if (typeof value === "string" && value) {
    return value;
  }

  const record = asRecord(value);
  return typeof record?.message === "string" ? record.message : undefined;
}
