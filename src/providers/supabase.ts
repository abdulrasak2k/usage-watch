import { createUsageMetric } from "../thresholds.js";
import type { CommonCollectorOptions, ProviderUsageResult } from "../types.js";
import { bytesFromGigabytes, bytesFromMegabytes } from "../utils.js";

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

const DEFAULT_SUPABASE_LIMITS = {
  databaseBytes: bytesFromMegabytes(500),
  monthlyActiveUsers: 50_000,
  egressBytes: bytesFromGigabytes(5),
  storageBytes: bytesFromGigabytes(1),
};

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
