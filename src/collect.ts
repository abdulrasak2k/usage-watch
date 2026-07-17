import {
  collectCloudflareR2Usage,
  type CloudflareR2CollectorOptions,
} from "./providers/cloudflare-r2";
import {
  collectUpstashRedisUsage,
  type UpstashRedisCollectorOptions,
} from "./providers/upstash-redis";
import {
  createResendUsageMetrics,
  type ResendUsageSummaryOptions,
} from "./providers/resend";
import {
  createSupabaseUsageMetrics,
  type SupabaseUsageSummaryOptions,
} from "./providers/supabase";
import {
  createVercelUsageMetrics,
  createVercelUsageMetricsFromCliJson,
  type VercelUsageSummaryOptions,
} from "./providers/vercel";
import type { ProviderUsageResult, UsageMetric } from "./types";
import { compactErrors } from "./utils";

export interface CollectProviderUsageOptions {
  cloudflareR2?: CloudflareR2CollectorOptions;
  upstashRedis?: UpstashRedisCollectorOptions;
  resend?: ResendUsageSummaryOptions;
  supabase?: SupabaseUsageSummaryOptions;
  vercel?: VercelUsageSummaryOptions;
  vercelCliUsageJson?: unknown;
}

export interface CollectProviderUsageResult {
  metrics: UsageMetric[];
  results: ProviderUsageResult[];
}

export async function collectProviderUsage(
  options: CollectProviderUsageOptions,
): Promise<CollectProviderUsageResult> {
  const results: ProviderUsageResult[] = [];

  if (options.cloudflareR2) {
    results.push(await safeCollect(() => collectCloudflareR2Usage(options.cloudflareR2!)));
  }

  if (options.upstashRedis) {
    results.push(await safeCollect(() => collectUpstashRedisUsage(options.upstashRedis!)));
  }

  if (options.resend) {
    results.push(createResendUsageMetrics(options.resend));
  }

  if (options.supabase) {
    results.push(createSupabaseUsageMetrics(options.supabase));
  }

  if (options.vercel) {
    results.push(createVercelUsageMetrics(options.vercel));
  }

  if (options.vercelCliUsageJson) {
    results.push(createVercelUsageMetricsFromCliJson(options.vercelCliUsageJson));
  }

  return {
    metrics: results.flatMap((result) => result.metrics),
    results,
  };
}

async function safeCollect(
  collect: () => Promise<ProviderUsageResult>,
): Promise<ProviderUsageResult> {
  try {
    return await collect();
  } catch (error) {
    return {
      provider: "custom",
      metrics: [],
      errors: compactErrors([error]) ?? ["Provider usage collection failed"],
    };
  }
}
