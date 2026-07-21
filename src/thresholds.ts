import type {
  UsageMetric,
  UsagePeriod,
  UsageProvider,
  UsageStatus,
  UsageThresholds,
  UsageUnit,
} from "./types.js";

export const DEFAULT_USAGE_THRESHOLDS: UsageThresholds = {
  warning: 0.75,
  critical: 0.9,
};

export function normalizeThresholds(
  thresholds?: Partial<UsageThresholds>,
): UsageThresholds {
  return {
    warning: thresholds?.warning ?? DEFAULT_USAGE_THRESHOLDS.warning,
    critical: thresholds?.critical ?? DEFAULT_USAGE_THRESHOLDS.critical,
  };
}

export function evaluateUsageStatus(
  value: number | undefined,
  limit?: number,
  thresholds?: Partial<UsageThresholds>,
): UsageStatus {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "unknown";
  }

  if (typeof limit !== "number" || limit < 0) {
    return "ok";
  }

  if (limit === 0) {
    return value > 0 ? "critical" : "ok";
  }

  const normalizedThresholds = normalizeThresholds(thresholds);
  const ratio = value / limit;

  if (ratio >= normalizedThresholds.critical) {
    return "critical";
  }

  if (ratio >= normalizedThresholds.warning) {
    return "warning";
  }

  return "ok";
}

export function createUsageMetric(params: {
  provider: UsageProvider;
  key: string;
  label: string;
  value?: number;
  unit: UsageUnit;
  period: UsagePeriod;
  limit?: number;
  source: string;
  updatedAt?: string;
  metadata?: Record<string, unknown>;
  thresholds?: Partial<UsageThresholds>;
}): UsageMetric {
  const value = params.value ?? 0;

  return {
    provider: params.provider,
    key: params.key,
    label: params.label,
    value,
    unit: params.unit,
    period: params.period,
    limit: params.limit,
    status: evaluateUsageStatus(value, params.limit, params.thresholds),
    source: params.source,
    updatedAt: params.updatedAt ?? new Date().toISOString(),
    metadata: params.metadata,
  };
}
