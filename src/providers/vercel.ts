import { createUsageMetric } from "../thresholds.js";
import type { CommonCollectorOptions, ProviderUsageResult } from "../types.js";
import {
  asArray,
  asRecord,
  getFetch,
  parseJsonSafely,
  toIsoString,
  toNumber,
  UsageProviderError,
} from "../utils.js";

export interface VercelUsageLimits {
  bandwidthBytes?: number;
  edgeRequests?: number;
  functionInvocations?: number;
  buildMinutes?: number;
  monthlyCostUsd?: number;
  serviceUsage?: Record<string, number>;
}

export interface VercelUsageSummaryOptions extends CommonCollectorOptions {
  bandwidthBytes?: number;
  edgeRequests?: number;
  functionInvocations?: number;
  buildMinutes?: number;
  projectedMonthlyCostUsd?: number;
  limits?: VercelUsageLimits;
  metadata?: Record<string, unknown>;
}

export interface VercelCollectorOptions extends CommonCollectorOptions {
  token: string;
  teamId?: string;
  slug?: string;
  from?: Date | string | number;
  to?: Date | string | number;
  endpoint?: string;
  limits?: VercelUsageLimits;
  metadata?: Record<string, unknown>;
}

export type VercelFocusCharge = Record<string, unknown>;

const DEFAULT_VERCEL_BILLING_ENDPOINT =
  "https://api.vercel.com/v1/billing/charges";

export async function collectVercelUsage(
  options: VercelCollectorOptions,
): Promise<ProviderUsageResult<VercelFocusCharge[]>> {
  const hasFrom = options.from !== undefined;
  const hasTo = options.to !== undefined;
  if (hasFrom !== hasTo) {
    throw new UsageProviderError({
      provider: "vercel",
      message: "Vercel usage requires both from and to when setting a date range",
    });
  }

  const fetchImpl = getFetch(options.fetchImpl);
  const endpoint = new URL(options.endpoint ?? DEFAULT_VERCEL_BILLING_ENDPOINT);

  if (options.teamId) {
    endpoint.searchParams.set("teamId", options.teamId);
  }
  if (options.slug) {
    endpoint.searchParams.set("slug", options.slug);
  }
  if (options.from !== undefined) {
    endpoint.searchParams.set("from", toIsoString(options.from));
  }
  if (options.to !== undefined) {
    endpoint.searchParams.set("to", toIsoString(options.to));
  }

  const response = await fetchImpl(endpoint, {
    headers: {
      accept: "application/x-ndjson, application/json",
      authorization: `Bearer ${options.token}`,
    },
  });
  const text = await response.text();

  if (!response.ok) {
    throw new UsageProviderError({
      provider: "vercel",
      status: response.status,
      message: `vercel usage request failed with HTTP ${response.status}`,
      details: parseJsonSafely(text) ?? text,
    });
  }

  const charges = parseVercelFocusCharges(text);
  return createVercelUsageMetricsFromFocusCharges(charges, options);
}

export function parseVercelFocusCharges(value: string): VercelFocusCharge[] {
  const trimmed = value.trim();
  if (!trimmed) {
    return [];
  }

  const completePayload = parseJsonSafely(trimmed);
  if (Array.isArray(completePayload)) {
    return completePayload
      .map(asRecord)
      .filter((charge): charge is VercelFocusCharge => Boolean(charge));
  }

  const completeRecord = asRecord(completePayload);
  const wrappedCharges = asArray(
    completeRecord?.charges ?? completeRecord?.results,
  )
    .map(asRecord)
    .filter((charge): charge is VercelFocusCharge => Boolean(charge));
  if (wrappedCharges.length) {
    return wrappedCharges;
  }
  if (completeRecord) {
    return [completeRecord];
  }

  return trimmed.split(/\r?\n/).map((line, index) => {
    const charge = asRecord(parseJsonSafely(line));
    if (!charge) {
      throw new UsageProviderError({
        provider: "vercel",
        message: `Vercel billing response contained invalid JSONL on line ${index + 1}`,
        details: line,
      });
    }
    return charge;
  });
}

export function createVercelUsageMetricsFromFocusCharges(
  charges: VercelFocusCharge[],
  options: Pick<
    VercelCollectorOptions,
    | "limits"
    | "thresholds"
    | "now"
    | "teamId"
    | "slug"
    | "from"
    | "to"
    | "metadata"
  > = {},
): ProviderUsageResult<VercelFocusCharge[]> {
  const updatedAt = (options.now ?? new Date()).toISOString();
  const groupedUsage = new Map<
    string,
    { serviceName: string; rawUnit: string; value: number; chargeCount: number }
  >();
  let effectiveCost = 0;
  let billedCost = 0;
  let currency: string | undefined;

  for (const charge of charges) {
    const serviceName =
      readVercelString(charge, [
        "ServiceName",
        "serviceName",
        "ChargeDescription",
        "chargeDescription",
      ]) ?? "unknown";
    const rawUnit =
      readVercelString(charge, [
        "ConsumedUnit",
        "consumedUnit",
        "PricingUnit",
        "pricingUnit",
      ]) ?? "count";
    const quantity =
      readVercelNumber(charge, [
        "ConsumedQuantity",
        "consumedQuantity",
        "PricingQuantity",
        "pricingQuantity",
      ]) ?? 0;
    const groupKey = `${normalizeKey(serviceName)}:${normalizeKey(rawUnit)}`;
    const existing = groupedUsage.get(groupKey);

    groupedUsage.set(groupKey, {
      serviceName,
      rawUnit,
      value: (existing?.value ?? 0) + normalizeVercelValue(quantity, rawUnit),
      chargeCount: (existing?.chargeCount ?? 0) + 1,
    });

    effectiveCost +=
      readVercelNumber(charge, ["EffectiveCost", "effectiveCost"]) ?? 0;
    billedCost += readVercelNumber(charge, ["BilledCost", "billedCost"]) ?? 0;
    currency ??= readVercelString(charge, [
      "BillingCurrency",
      "billingCurrency",
    ]);
  }

  const commonMetadata = {
    ...options.metadata,
    teamId: options.teamId,
    slug: options.slug,
    from: options.from !== undefined ? toIsoString(options.from) : undefined,
    to: options.to !== undefined ? toIsoString(options.to) : undefined,
    currency,
    chargeCount: charges.length,
  };

  const metrics = [...groupedUsage.values()].map((usage) => {
    const serviceKey = normalizeKey(usage.serviceName);
    return createUsageMetric({
      provider: "vercel",
      key: `vercel.service.${serviceKey}.${normalizeKey(usage.rawUnit)}`,
      label: `Vercel ${usage.serviceName}`,
      value: usage.value,
      unit: normalizeVercelUnit(usage.rawUnit),
      period: "range",
      limit: resolveVercelServiceLimit(
        serviceKey,
        usage.serviceName,
        usage.rawUnit,
        options.limits,
      ),
      source: "vercel-rest-api:billing/charges",
      updatedAt,
      metadata: {
        ...commonMetadata,
        rawUnit: usage.rawUnit,
        chargeCount: usage.chargeCount,
      },
      thresholds: options.thresholds,
    });
  });

  metrics.unshift(
    createUsageMetric({
      provider: "vercel",
      key: "vercel.cost.billed_usd",
      label: "Vercel billed cost",
      value: billedCost,
      unit: "usd",
      period: "range",
      limit: options.limits?.monthlyCostUsd,
      source: "vercel-rest-api:billing/charges",
      updatedAt,
      metadata: commonMetadata,
      thresholds: options.thresholds,
    }),
    createUsageMetric({
      provider: "vercel",
      key: "vercel.cost.effective_usd",
      label: "Vercel effective cost",
      value: effectiveCost,
      unit: "usd",
      period: "range",
      limit: options.limits?.monthlyCostUsd,
      source: "vercel-rest-api:billing/charges",
      updatedAt,
      metadata: commonMetadata,
      thresholds: options.thresholds,
    }),
  );

  return {
    provider: "vercel",
    metrics,
    raw: charges,
  };
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
    const rawUnit =
      readVercelString(service, ["pricingUnit", "unit"]) ?? "count";
    const rawUsage =
      readVercelNumber(service, ["pricingQuantity", "usage", "used"]) ?? 0;
    const usage = normalizeVercelValue(rawUsage, rawUnit);
    const serviceKey = normalizeKey(serviceName);
    const limit =
      toNumber(service.limit) ??
      resolveVercelServiceLimit(
        serviceKey,
        serviceName,
        rawUnit,
        options.limits,
      );
    const unit = normalizeVercelUnit(rawUnit);

    return createUsageMetric({
      provider: "vercel",
      key: `vercel.service.${serviceKey}`,
      label: `Vercel ${serviceName}`,
      value: usage,
      unit,
      period: "month",
      limit,
      source: "vercel-cli:usage-json",
      updatedAt,
      metadata: {
        rawUnit,
        billedCost: service.billedCost,
        effectiveCost: service.effectiveCost,
      },
      thresholds: options.thresholds,
    });
  });

  const totals = asRecord(record?.totals);
  const totalCost =
    toNumber(record?.totalCost) ??
    toNumber(totals?.effectiveCost) ??
    toNumber(totals?.billedCost) ??
    services.reduce((sum, service) => {
      return (
        sum +
        (toNumber(service.effectiveCost) ??
          toNumber(service.billedCost) ??
          0)
      );
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

  if (
    normalized.includes("byte") ||
    ["kb", "mb", "gb", "tb"].includes(normalized)
  ) {
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

function normalizeVercelValue(value: number, unit: string): number {
  switch (unit.trim().toLowerCase()) {
    case "kb":
    case "kilobyte":
    case "kilobytes":
      return value * 1024;
    case "mb":
    case "megabyte":
    case "megabytes":
      return value * 1024 * 1024;
    case "gb":
    case "gigabyte":
    case "gigabytes":
      return value * 1024 * 1024 * 1024;
    case "tb":
    case "terabyte":
    case "terabytes":
      return value * 1024 * 1024 * 1024 * 1024;
    default:
      return value;
  }
}

function resolveVercelServiceLimit(
  serviceKey: string,
  serviceName: string,
  rawUnit: string,
  limits?: VercelUsageLimits,
): number | undefined {
  const explicitLimit =
    limits?.serviceUsage?.[serviceName] ?? limits?.serviceUsage?.[serviceKey];
  if (typeof explicitLimit === "number") {
    return explicitLimit;
  }

  if (
    serviceKey.includes("fast_data_transfer") ||
    serviceKey.includes("bandwidth")
  ) {
    return limits?.bandwidthBytes;
  }
  if (serviceKey.includes("edge_request")) {
    return limits?.edgeRequests;
  }
  if (serviceKey.includes("function_invocation")) {
    return limits?.functionInvocations;
  }
  if (
    serviceKey.includes("build") &&
    rawUnit.toLowerCase().includes("minute")
  ) {
    return limits?.buildMinutes;
  }

  return undefined;
}

function readVercelString(
  record: Record<string, unknown>,
  keys: string[],
): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }
  return undefined;
}

function readVercelNumber(
  record: Record<string, unknown>,
  keys: string[],
): number | undefined {
  for (const key of keys) {
    const value = toNumber(record[key]);
    if (typeof value === "number") {
      return value;
    }
  }
  return undefined;
}

function normalizeKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}
