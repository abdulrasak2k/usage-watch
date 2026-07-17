import { createUsageMetric } from "../thresholds";
import type { CommonCollectorOptions, ProviderUsageResult } from "../types";
import {
  asRecord,
  createBasicAuthHeader,
  getFetch,
  latestSeriesNumber,
  readProviderJson,
  toNumber,
} from "../utils";

export interface UpstashRedisCollectorOptions extends CommonCollectorOptions {
  databaseId: string;
  email: string;
  apiKey: string;
  endpoint?: string;
  limits?: {
    dailyCommands?: number;
    dailyReads?: number;
    dailyWrites?: number;
  };
}

export interface UpstashRedisStatsPayload {
  daily_net_commands?: unknown;
  daily_read_requests?: unknown;
  daily_write_requests?: unknown;
  keyspace?: unknown;
  throughput?: unknown;
  diskusage?: unknown;
  latencymean?: unknown;
  [key: string]: unknown;
}

const DEFAULT_UPSTASH_LIMITS = {
  dailyCommands: 500_000,
};

export async function collectUpstashRedisUsage(
  options: UpstashRedisCollectorOptions,
): Promise<ProviderUsageResult<UpstashRedisStatsPayload>> {
  const fetchImpl = getFetch(options.fetchImpl);
  const endpoint =
    options.endpoint ??
    `https://api.upstash.com/v2/redis/stats/${encodeURIComponent(options.databaseId)}`;
  const payload = await readProviderJson<UpstashRedisStatsPayload>(
    "upstash-redis",
    await fetchImpl(endpoint, {
      headers: {
        authorization: createBasicAuthHeader(options.email, options.apiKey),
      },
    }),
  );

  return createUpstashRedisUsageMetrics(payload, options);
}

export function createUpstashRedisUsageMetrics(
  payload: UpstashRedisStatsPayload,
  options: Pick<UpstashRedisCollectorOptions, "limits" | "thresholds" | "now"> = {},
): ProviderUsageResult<UpstashRedisStatsPayload> {
  const limits = { ...DEFAULT_UPSTASH_LIMITS, ...options.limits };
  const updatedAt = (options.now ?? new Date()).toISOString();
  const keyspaceSeries = Array.isArray(payload.keyspace) ? payload.keyspace : undefined;
  const keyspaceRecord = asRecord(
    keyspaceSeries ? keyspaceSeries[keyspaceSeries.length - 1] : payload.keyspace,
  );

  return {
    provider: "upstash-redis",
    metrics: [
      createUsageMetric({
        provider: "upstash-redis",
        key: "redis.commands.daily_net",
        label: "Redis daily commands",
        value:
          toNumber(payload.daily_net_commands) ??
          latestSeriesNumber(payload.daily_net_commands),
        unit: "count",
        period: "day",
        limit: limits.dailyCommands,
        source: "upstash-developer-api:redis/stats",
        updatedAt,
        thresholds: options.thresholds,
      }),
      createUsageMetric({
        provider: "upstash-redis",
        key: "redis.commands.daily_reads",
        label: "Redis daily read requests",
        value:
          toNumber(payload.daily_read_requests) ??
          latestSeriesNumber(payload.daily_read_requests),
        unit: "count",
        period: "day",
        limit: limits.dailyReads,
        source: "upstash-developer-api:redis/stats",
        updatedAt,
        thresholds: options.thresholds,
      }),
      createUsageMetric({
        provider: "upstash-redis",
        key: "redis.commands.daily_writes",
        label: "Redis daily write requests",
        value:
          toNumber(payload.daily_write_requests) ??
          latestSeriesNumber(payload.daily_write_requests),
        unit: "count",
        period: "day",
        limit: limits.dailyWrites,
        source: "upstash-developer-api:redis/stats",
        updatedAt,
        thresholds: options.thresholds,
      }),
      createUsageMetric({
        provider: "upstash-redis",
        key: "redis.keyspace.keys",
        label: "Redis key count",
        value: toNumber(keyspaceRecord?.keys) ?? latestSeriesNumber(payload.keyspace, ["keys"]),
        unit: "count",
        period: "instant",
        source: "upstash-developer-api:redis/stats",
        updatedAt,
        thresholds: options.thresholds,
      }),
      createUsageMetric({
        provider: "upstash-redis",
        key: "redis.disk_usage.bytes",
        label: "Redis disk usage",
        value: latestSeriesNumber(payload.diskusage, ["value", "usage", "bytes"]),
        unit: "bytes",
        period: "instant",
        source: "upstash-developer-api:redis/stats",
        updatedAt,
        thresholds: options.thresholds,
      }),
      createUsageMetric({
        provider: "upstash-redis",
        key: "redis.latency.mean_ms",
        label: "Redis mean latency",
        value: latestSeriesNumber(payload.latencymean, ["value", "latency", "ms"]),
        unit: "milliseconds",
        period: "instant",
        source: "upstash-developer-api:redis/stats",
        updatedAt,
        thresholds: options.thresholds,
      }),
    ],
    raw: payload,
  };
}
