import { createUsageMetric } from "../thresholds";
import type { CommonCollectorOptions, ProviderUsageResult } from "../types";

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

const DEFAULT_RESEND_LIMITS = {
  dailyEmails: 100,
  monthlyEmails: 3_000,
};

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
