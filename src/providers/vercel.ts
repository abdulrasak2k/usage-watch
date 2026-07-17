import { createUsageMetric } from "../thresholds";
import type { CommonCollectorOptions, ProviderUsageResult } from "../types";
import { asArray, asRecord, toNumber } from "../utils";

export interface VercelUsageSummaryOptions extends CommonCollectorOptions {
  bandwidthBytes?: number;
  edgeRequests?: number;
  functionInvocations?: number;
  buildMinutes?: number;
  projectedMonthlyCostUsd?: number;
  limits?: {
    bandwidthBytes?: number;
    edgeRequests?: number;
    functionInvocations?: number;
    buildMinutes?: number;
    monthlyCostUsd?: number;
  };
  metadata?: Record<string, unknown>;
}

export function createVercelUsageMetrics(
  options: VercelUsageSummaryOptions,
): ProviderUsageResult<VercelUsageSummaryOptions> {
  const updatedAt = (options.now ?? new Date()).toISOString();

  return {
    provider: "vercel",
    metrics: [
      createUsageMetric({
        provider: "vercel",
        key: "vercel.bandwidth.bytes",
        label: "Vercel bandwidth",
        value: options.bandwidthBytes ?? 0,
        unit: "bytes",
        period: "month",
        limit: options.limits?.bandwidthBytes,
        source: "vercel-usage-summary",
        updatedAt,
        metadata: options.metadata,
        thresholds: options.thresholds,
      }),
      createUsageMetric({
        provider: "vercel",
        key: "vercel.edge.requests",
        label: "Vercel edge requests",
        value: options.edgeRequests ?? 0,
        unit: "requests",
        period: "month",
        limit: options.limits?.edgeRequests,
        source: "vercel-usage-summary",
        updatedAt,
        metadata: options.metadata,
        thresholds: options.thresholds,
      }),
      createUsageMetric({
        provider: "vercel",
        key: "vercel.functions.invocations",
        label: "Vercel function invocations",
        value: options.functionInvocations ?? 0,
        unit: "count",
        period: "month",
        limit: options.limits?.functionInvocations,
        source: "vercel-usage-summary",
        updatedAt,
        metadata: options.metadata,
        thresholds: options.thresholds,
      }),
      createUsageMetric({
        provider: "vercel",
        key: "vercel.build.minutes",
        label: "Vercel build minutes",
        value: options.buildMinutes ?? 0,
        unit: "count",
        period: "month",
        limit: options.limits?.buildMinutes,
        source: "vercel-usage-summary",
        updatedAt,
        metadata: options.metadata,
        thresholds: options.thresholds,
      }),
      createUsageMetric({
        provider: "vercel",
        key: "vercel.cost.projected_usd",
        label: "Vercel projected monthly cost",
        value: options.projectedMonthlyCostUsd ?? 0,
        unit: "usd",
        period: "month",
        limit: options.limits?.monthlyCostUsd,
        source: "vercel-usage-summary",
        updatedAt,
        metadata: options.metadata,
        thresholds: options.thresholds,
      }),
    ],
    raw: options,
  };
}

export function createVercelUsageMetricsFromCliJson(
  payload: unknown,
  options: Pick<VercelUsageSummaryOptions, "limits" | "thresholds" | "now"> = {},
): ProviderUsageResult<unknown> {
  const updatedAt = (options.now ?? new Date()).toISOString();
  const record = asRecord(payload);
  const services = asArray(record?.services)
    .map(asRecord)
    .filter((service): service is Record<string, unknown> => Boolean(service));

  const metrics = services.map((service) => {
    const serviceName = getServiceName(service);
    const usage = toNumber(service.usage) ?? toNumber(service.used) ?? 0;
    const limit = toNumber(service.limit);
    const unit = normalizeVercelUnit(service.unit);

    return createUsageMetric({
      provider: "vercel",
      key: `vercel.service.${normalizeKey(serviceName)}`,
      label: `Vercel ${serviceName}`,
      value: usage,
      unit,
      period: "month",
      limit,
      source: "vercel-cli:usage-json",
      updatedAt,
      metadata: {
        rawUnit: service.unit,
        billedCost: service.billedCost,
        effectiveCost: service.effectiveCost,
      },
      thresholds: options.thresholds,
    });
  });

  const totalCost =
    toNumber(record?.totalCost) ??
    services.reduce((sum, service) => {
      return sum + (toNumber(service.effectiveCost) ?? toNumber(service.billedCost) ?? 0);
    }, 0);

  metrics.unshift(
    createUsageMetric({
      provider: "vercel",
      key: "vercel.cost.projected_usd",
      label: "Vercel projected monthly cost",
      value: totalCost,
      unit: "usd",
      period: "month",
      limit: options.limits?.monthlyCostUsd,
      source: "vercel-cli:usage-json",
      updatedAt,
      thresholds: options.thresholds,
    }),
  );

  return {
    provider: "vercel",
    metrics,
    raw: payload,
  };
}

function getServiceName(service: Record<string, unknown>): string {
  for (const key of ["name", "service", "type", "label"]) {
    const value = service[key];
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }

  return "unknown";
}

function normalizeVercelUnit(value: unknown): "bytes" | "count" | "usd" | "requests" {
  if (typeof value !== "string") {
    return "count";
  }

  const normalized = value.toLowerCase();

  if (normalized.includes("byte") || normalized === "gb" || normalized === "mb") {
    return "bytes";
  }

  if (normalized.includes("request")) {
    return "requests";
  }

  if (normalized.includes("usd") || normalized.includes("$")) {
    return "usd";
  }

  return "count";
}

function normalizeKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}
