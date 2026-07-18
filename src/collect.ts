import {
  collectCloudflareR2Usage,
  type CloudflareR2CollectorOptions,
} from "./providers/cloudflare-r2.js";
import {
  collectMongoDBAtlasUsage,
  type MongoDBAtlasCollectorOptions,
} from "./providers/mongodb-atlas.js";
import {
  collectUpstashRedisUsage,
  type UpstashRedisCollectorOptions,
} from "./providers/upstash-redis.js";
import {
  createResendUsageMetrics,
  type ResendUsageSummaryOptions,
} from "./providers/resend.js";
import {
  createSupabaseUsageMetrics,
  type SupabaseUsageSummaryOptions,
} from "./providers/supabase.js";
import {
  createVercelUsageMetrics,
  createVercelUsageMetricsFromCliJson,
  type VercelUsageSummaryOptions,
} from "./providers/vercel.js";
import type { ProviderUsageResult, UsageMetric } from "./types.js";
import { compactErrors } from "./utils.js";

export interface CollectProviderUsageOptions {
  cloudflareR2?: CloudflareR2CollectorOptions;
  mongodbAtlas?: MongoDBAtlasCollectorOptions;
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
    results.push(
      await safeCollect("cloudflare-r2", () =>
        collectCloudflareR2Usage(options.cloudflareR2!),
      ),
    );
  }

  if (options.mongodbAtlas) {
    results.push(
      await safeCollect("mongodb-atlas", () =>
        collectMongoDBAtlasUsage(options.mongodbAtlas!),
      ),
    );
  }

  if (options.upstashRedis) {
    results.push(
      await safeCollect("upstash-redis", () =>
        collectUpstashRedisUsage(options.upstashRedis!),
      ),
    );
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
  provider: ProviderUsageResult["provider"],
  collect: () => Promise<ProviderUsageResult>,
): Promise<ProviderUsageResult> {
  try {
    return await collect();
  } catch (error) {
    return {
      provider,
      metrics: [],
      errors: compactErrors([error]) ?? ["Provider usage collection failed"],
    };
  }
}
