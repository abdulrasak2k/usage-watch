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
  collectResendUsage,
  createResendUsageMetrics,
  type ResendCollectorOptions,
  type ResendUsageSummaryOptions,
} from "./providers/resend.js";
import {
  collectSupabaseUsage,
  createSupabaseUsageMetrics,
  type SupabaseCollectorOptions,
  type SupabaseUsageSummaryOptions,
} from "./providers/supabase.js";
import {
  collectVercelUsage,
  createVercelUsageMetrics,
  createVercelUsageMetricsFromCliJson,
  type VercelCollectorOptions,
  type VercelUsageSummaryOptions,
} from "./providers/vercel.js";
import type { ProviderUsageResult, UsageMetric } from "./types.js";
import { compactErrors } from "./utils.js";

export interface CollectProviderUsageOptions {
  cloudflareR2?: CloudflareR2CollectorOptions;
  mongodbAtlas?: MongoDBAtlasCollectorOptions;
  upstashRedis?: UpstashRedisCollectorOptions;
  resend?: ResendUsageSummaryOptions | ResendCollectorOptions;
  supabase?: SupabaseUsageSummaryOptions | SupabaseCollectorOptions;
  vercel?: VercelUsageSummaryOptions | VercelCollectorOptions;
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
    const resendOptions = options.resend;
    if (isResendCollectorOptions(resendOptions)) {
      results.push(
        await safeCollect("resend", () => collectResendUsage(resendOptions)),
      );
    } else {
      results.push(createResendUsageMetrics(resendOptions));
    }
  }

  if (options.supabase) {
    const supabaseOptions = options.supabase;
    if (isSupabaseCollectorOptions(supabaseOptions)) {
      results.push(
        await safeCollect("supabase", () =>
          collectSupabaseUsage(supabaseOptions),
        ),
      );
    } else {
      results.push(createSupabaseUsageMetrics(supabaseOptions));
    }
  }

  if (options.vercel) {
    const vercelOptions = options.vercel;
    if (isVercelCollectorOptions(vercelOptions)) {
      results.push(
        await safeCollect("vercel", () => collectVercelUsage(vercelOptions)),
      );
    } else {
      results.push(createVercelUsageMetrics(vercelOptions));
    }
  }

  if (options.vercelCliUsageJson) {
    results.push(createVercelUsageMetricsFromCliJson(options.vercelCliUsageJson));
  }

  return {
    metrics: results.flatMap((result) => result.metrics),
    results,
  };
}

function isResendCollectorOptions(
  options: ResendUsageSummaryOptions | ResendCollectorOptions,
): options is ResendCollectorOptions {
  return "apiKey" in options && typeof options.apiKey === "string";
}

function isSupabaseCollectorOptions(
  options: SupabaseUsageSummaryOptions | SupabaseCollectorOptions,
): options is SupabaseCollectorOptions {
  return (
    "accessToken" in options &&
    typeof options.accessToken === "string" &&
    "projectRef" in options &&
    typeof options.projectRef === "string"
  );
}

function isVercelCollectorOptions(
  options: VercelUsageSummaryOptions | VercelCollectorOptions,
): options is VercelCollectorOptions {
  return "token" in options && typeof options.token === "string";
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
