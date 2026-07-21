import { createUsageMetric } from "../thresholds.js";
import type { CommonCollectorOptions, ProviderUsageResult } from "../types.js";
import { getFetch, readProviderJson, toNumber } from "../utils.js";

export interface ResendUsageSummaryOptions extends CommonCollectorOptions {
  sentToday?: number;
  sentThisMonth?: number;
  failedToday?: number;
  bouncedThisMonth?: number;
  limits?: {
    dailyEmails?: number;
    monthlyEmails?: number;
  };
  metadata?: Record<string, unknown>;
}

export interface ResendCollectorOptions extends ResendUsageSummaryOptions {
  apiKey: string;
  endpoint?: string;
  userAgent?: string;
}

export interface ResendQuotaRawResult {
  dailyQuotaUsed?: number;
  monthlyQuotaUsed?: number;
  rateLimit?: {
    limit?: number;
    remaining?: number;
    resetSeconds?: number;
  };
}

const DEFAULT_RESEND_LIMITS = {
  dailyEmails: 100,
  monthlyEmails: 3_000,
};

const DEFAULT_ENDPOINT = "https://api.resend.com";

export async function collectResendUsage(
  options: ResendCollectorOptions,
): Promise<ProviderUsageResult<ResendQuotaRawResult>> {
  const fetchImpl = getFetch(options.fetchImpl);
  const endpoint = (options.endpoint ?? DEFAULT_ENDPOINT).replace(/\/$/, "");
  const response = await fetchImpl(`${endpoint}/emails?limit=1`, {
    headers: {
      accept: "application/json",
      authorization: `Bearer ${options.apiKey}`,
      "user-agent": options.userAgent ?? "usage-watch/collector",
    },
  });

  // Validate the response but deliberately discard the email-list body because
  // it can contain recipient addresses and message subjects.
  await readProviderJson<unknown>("resend", response);

  const raw: ResendQuotaRawResult = {
    dailyQuotaUsed: headerNumber(response.headers, "x-resend-daily-quota"),
    monthlyQuotaUsed: headerNumber(response.headers, "x-resend-monthly-quota"),
    rateLimit: {
      limit: headerNumber(response.headers, "ratelimit-limit"),
      remaining: headerNumber(response.headers, "ratelimit-remaining"),
      resetSeconds: headerNumber(response.headers, "ratelimit-reset"),
    },
  };

  if (
    typeof raw.dailyQuotaUsed !== "number" &&
    typeof raw.monthlyQuotaUsed !== "number"
  ) {
    throw new Error("Resend response did not include email quota headers");
  }

  return createResendLiveUsageMetrics(raw, options);
}

export function createResendUsageMetrics(
  options: ResendUsageSummaryOptions,
): ProviderUsageResult<ResendUsageSummaryOptions> {
  const limits = { ...DEFAULT_RESEND_LIMITS, ...options.limits };
  const updatedAt = (options.now ?? new Date()).toISOString();

  return {
    provider: "resend",
    metrics: [
      createUsageMetric({
        provider: "resend",
        key: "email.sent.today",
        label: "Emails sent today",
        value: options.sentToday ?? 0,
        unit: "count",
        period: "day",
        limit: limits.dailyEmails,
        source: "application-email-logs",
        updatedAt,
        metadata: options.metadata,
        thresholds: options.thresholds,
      }),
      createUsageMetric({
        provider: "resend",
        key: "email.sent.month",
        label: "Emails sent this month",
        value: options.sentThisMonth ?? 0,
        unit: "count",
        period: "month",
        limit: limits.monthlyEmails,
        source: "application-email-logs",
        updatedAt,
        metadata: options.metadata,
        thresholds: options.thresholds,
      }),
      createUsageMetric({
        provider: "resend",
        key: "email.failed.today",
        label: "Emails failed today",
        value: options.failedToday ?? 0,
        unit: "count",
        period: "day",
        source: "application-email-logs",
        updatedAt,
        metadata: options.metadata,
        thresholds: options.thresholds,
      }),
      createUsageMetric({
        provider: "resend",
        key: "email.bounced.month",
        label: "Emails bounced this month",
        value: options.bouncedThisMonth ?? 0,
        unit: "count",
        period: "month",
        source: "application-email-logs",
        updatedAt,
        metadata: options.metadata,
        thresholds: options.thresholds,
      }),
    ],
    raw: options,
  };
}

export function createResendLiveUsageMetrics(
  raw: ResendQuotaRawResult,
  options: Pick<
    ResendCollectorOptions,
    | "limits"
    | "thresholds"
    | "now"
    | "failedToday"
    | "bouncedThisMonth"
    | "metadata"
  > = {},
): ProviderUsageResult<ResendQuotaRawResult> {
  const summary = createResendUsageMetrics({
    sentToday: raw.dailyQuotaUsed,
    sentThisMonth: raw.monthlyQuotaUsed,
    failedToday: options.failedToday,
    bouncedThisMonth: options.bouncedThisMonth,
    limits: options.limits,
    thresholds: options.thresholds,
    metadata: options.metadata,
    now: options.now,
  });
  const includedKeys = new Set<string>();
  if (typeof raw.dailyQuotaUsed === "number") {
    includedKeys.add("email.sent.today");
  }
  if (typeof raw.monthlyQuotaUsed === "number") {
    includedKeys.add("email.sent.month");
  }
  if (typeof options.failedToday === "number") {
    includedKeys.add("email.failed.today");
  }
  if (typeof options.bouncedThisMonth === "number") {
    includedKeys.add("email.bounced.month");
  }

  return {
    provider: "resend",
    metrics: summary.metrics
      .filter((metric) => includedKeys.has(metric.key))
      .map((metric) =>
        metric.key === "email.sent.today" || metric.key === "email.sent.month"
          ? {
              ...metric,
              label:
                metric.key === "email.sent.today"
                  ? "Resend email quota used today"
                  : "Resend email quota used this month",
              source: "resend-api:quota-headers",
              metadata: {
                ...metric.metadata,
                quotaIncludesReceivedEmails: true,
                rateLimit: raw.rateLimit,
              },
            }
          : metric,
      ),
    raw,
  };
}

function headerNumber(headers: Headers, name: string): number | undefined {
  const value = headers.get(name);
  const numericValue = toNumber(value);
  if (typeof numericValue === "number") {
    return numericValue;
  }

  const leadingNumber = value?.match(/^\s*(\d+(?:\.\d+)?)/)?.[1];
  return toNumber(leadingNumber);
}
