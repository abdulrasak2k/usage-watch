# Integration guide for developers and AI coding agents

This is the canonical end-to-end guide for adding `usage-watch` to a server-side
Node.js or Next.js application. It is written to be directly executable by a
developer and unambiguous enough for an AI coding agent to follow safely.

## What the package owns

`usage-watch` owns:

- calling supported provider usage APIs;
- converting provider responses into a shared `UsageMetric` shape;
- comparing values with configured limits;
- isolating provider failures when `collectProviderUsage` is used.

The host application owns:

- server-only environment configuration;
- authentication and authorization;
- scheduling and retry policy;
- database migrations and snapshot retention;
- dashboards, notifications, and incident response.

The package does not create database tables, register cron jobs, send alerts, or
expose a user interface.

## 1. Install a pinned version

Pin a release tag so deployments are reproducible:

```bash
npm install github:abdulrasak2k/usage-watch#v0.3.0
```

Avoid installing from `#main` in production. Review the changelog and update the
tag intentionally when adopting a new release.

## 2. Choose live collection or a trusted summary

| Provider | Live credentials | Summary fallback |
| --- | --- | --- |
| Cloudflare R2 | Account ID and analytics API token | No built-in summary adapter |
| MongoDB Atlas | Project ID and OAuth service account or access token | No built-in summary adapter |
| Upstash Redis | Database ID, Developer API email, and API key | Raw stats can be normalized with the provider helper |
| Resend | Dedicated Full-access API key | Sent, failed, and bounced counts from application logs |
| Supabase | Project ref and Management API access token | Database, MAU, egress, and Storage values from trusted server data |
| Vercel | Access token and optional team ID/slug | Normalized summary or `vercel usage --format json` output |

Use live collection when a read-only or narrowly scoped credential is
available. Use a summary when the provider does not expose the metric, the
required endpoint is unavailable on the account, or application data is more
accurate.

Never report an unavailable metric as zero. Omit it until a trustworthy source
exists; zero is a real measurement and can hide monitoring gaps.

## 3. Define the server-only environment contract

Copy only the providers the application uses:

```env
# Cloudflare R2
CLOUDFLARE_R2_ACCOUNT_ID=
CLOUDFLARE_R2_BUCKET_NAME=
CLOUDFLARE_API_TOKEN=

# MongoDB Atlas
MONGODB_ATLAS_PROJECT_ID=
MONGODB_ATLAS_CLIENT_ID=
MONGODB_ATLAS_CLIENT_SECRET=
MONGODB_ATLAS_PROCESS_ID=

# Upstash Developer API (not the Redis REST token)
UPSTASH_DATABASE_ID=
UPSTASH_EMAIL=
UPSTASH_API_KEY=

# Resend monitoring key with Full access; keep separate from the sending key
RESEND_USAGE_API_KEY=

# Supabase Management API (not anon/service-role credentials)
SUPABASE_PROJECT_REF=
SUPABASE_ACCESS_TOKEN=

# Vercel billing usage
VERCEL_TOKEN=
VERCEL_TEAM_ID=
```

Do not use a `NEXT_PUBLIC_` prefix for any credential. Validate configuration at
application startup or deployment time. A provider should be enabled only when
all of its required values are present.

## 4. Build options without non-null assertions

The following pattern supports partial deployments and prevents empty
credentials from triggering provider requests:

```ts
import {
  collectProviderUsage,
  type CollectProviderUsageOptions,
} from "@abdulrasak2k/usage-watch";

export function buildUsageWatchOptions(
  now = new Date(),
): CollectProviderUsageOptions {
  const options: CollectProviderUsageOptions = {};
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const cloudflareAccountId = process.env.CLOUDFLARE_R2_ACCOUNT_ID;
  const cloudflareApiToken = process.env.CLOUDFLARE_API_TOKEN;
  const atlasProjectId = process.env.MONGODB_ATLAS_PROJECT_ID;
  const atlasClientId = process.env.MONGODB_ATLAS_CLIENT_ID;
  const atlasClientSecret = process.env.MONGODB_ATLAS_CLIENT_SECRET;
  const upstashDatabaseId = process.env.UPSTASH_DATABASE_ID;
  const upstashEmail = process.env.UPSTASH_EMAIL;
  const upstashApiKey = process.env.UPSTASH_API_KEY;
  const resendUsageApiKey = process.env.RESEND_USAGE_API_KEY;
  const supabaseProjectRef = process.env.SUPABASE_PROJECT_REF;
  const supabaseAccessToken = process.env.SUPABASE_ACCESS_TOKEN;
  const vercelToken = process.env.VERCEL_TOKEN;

  if (cloudflareAccountId && cloudflareApiToken) {
    options.cloudflareR2 = {
      accountId: cloudflareAccountId,
      apiToken: cloudflareApiToken,
      bucketName: process.env.CLOUDFLARE_R2_BUCKET_NAME,
      start: dayAgo,
      end: now,
    };
  }

  if (atlasProjectId && atlasClientId && atlasClientSecret) {
    options.mongodbAtlas = {
      projectId: atlasProjectId,
      clientId: atlasClientId,
      clientSecret: atlasClientSecret,
      processId: process.env.MONGODB_ATLAS_PROCESS_ID,
    };
  }

  if (upstashDatabaseId && upstashEmail && upstashApiKey) {
    options.upstashRedis = {
      databaseId: upstashDatabaseId,
      email: upstashEmail,
      apiKey: upstashApiKey,
    };
  }

  if (resendUsageApiKey) {
    options.resend = {
      apiKey: resendUsageApiKey,
    };
  }

  if (supabaseProjectRef && supabaseAccessToken) {
    options.supabase = {
      projectRef: supabaseProjectRef,
      accessToken: supabaseAccessToken,
      interval: "7day",
    };
  }

  if (vercelToken) {
    options.vercel = {
      token: vercelToken,
      teamId: process.env.VERCEL_TEAM_ID,
    };
  }

  return options;
}

export async function collectUsageSnapshot() {
  return collectProviderUsage(buildUsageWatchOptions());
}
```

If an application validates environment variables into a typed server-only
object, use that object instead of reading `process.env` throughout the code.

## 5. Understand the result and partial failures

```ts
const result = await collectUsageSnapshot();

for (const provider of result.results) {
  if (provider.errors?.length) {
    console.error(provider.provider, provider.errors);
  }
}

const actionable = result.metrics.filter(
  (metric) => metric.status === "warning" || metric.status === "critical",
);
```

`collectProviderUsage` isolates failures by provider. One rejected API request
does not discard successful metrics from other providers. Inspect both:

- `result.metrics` for all successfully normalized metrics;
- `result.results` for provider-level metrics, errors, and optional raw data.

An empty metric list is not necessarily healthy. It may mean that no providers
were configured or every configured provider failed. Record collection health
separately from usage thresholds.

## 6. Set limits deliberately

Default limits target common free tiers and are starting points, not billing
guarantees. Provider plans change. Override limits to match the actual account:

```ts
options.mongodbAtlas = {
  ...options.mongodbAtlas!,
  limits: {
    storageBytes: 5 * 1024 ** 3,
    connections: 500,
  },
};
```

The default status thresholds are 75% for `warning` and 90% for `critical`.
Override them per provider when the application needs more lead time.

Be careful with a zero limit: any positive value becomes critical. This is
useful for strict zero-cost deployments, but should be an explicit decision.

## 7. Persist normalized snapshots

Store `result.metrics` after each scheduled collection. Use a table similar to
the schema in the README and retain at least:

- provider, metric key, value, unit, period, limit, and status;
- source and collection timestamp;
- non-secret metadata needed to group projects or resources.

Use a unique snapshot ID rather than overwriting the latest row if trends are
required. Add a retention job if snapshot volume can grow indefinitely.

Persist normalized metrics by default. Raw responses vary by provider and may
contain infrastructure or billing details even though collectors exclude known
credentials and Resend discards the email-list body.

## 8. Schedule collection safely

A common production setup is one collection per day plus an admin-only manual
refresh. More frequent collection may consume provider API quotas without
improving billing-cycle visibility.

For a Next.js cron route:

1. Require `Authorization: Bearer <CRON_SECRET>` before doing any work.
2. Build options only from validated server-side configuration.
3. Collect and persist normalized metrics.
4. Record provider failures without exposing them to public clients.
5. Make retry behavior idempotent or accept duplicate timestamped snapshots.

Protect manual endpoints with the host application's administrator permission,
not merely with a hidden URL.

## 9. Combine live data with trusted summaries

Live Resend quota headers do not provide failures or bounces. Add trusted
application-log values alongside the live key:

```ts
options.resend = {
  apiKey: process.env.RESEND_USAGE_API_KEY!,
  failedToday,
  bouncedThisMonth,
};
```

Supabase does not expose stable billing-cycle MAU or egress through the live
Management API endpoints used by this package. Supply them only when a trusted
server-side source exists:

```ts
options.supabase = {
  projectRef: process.env.SUPABASE_PROJECT_REF!,
  accessToken: process.env.SUPABASE_ACCESS_TOKEN!,
  monthlyActiveUsers,
  egressBytesThisMonth,
};
```

## 10. Validate the integration

Before merging:

1. Run the host application's tests, typecheck, lint, and production build.
2. Test the option builder with complete, partial, and absent credential sets.
3. Confirm unauthorized users cannot call manual or scheduled endpoints.
4. Confirm credentials and raw responses are absent from API output and logs.
5. Test one provider failure and verify other provider metrics still persist.
6. Check that limits match the deployed provider plans.
7. Run a production smoke collection with real credentials from a secure
   environment; do not place those credentials in fixtures or CI logs.

## AI coding agent execution contract

An AI agent modifying a host application should follow these invariants:

1. Inspect the existing environment validation, authorization, cron, database,
   and testing conventions before editing.
2. Keep all collector imports and credentials in server-only modules.
3. Reuse existing persistence, cron logging, and admin authorization patterns.
4. Enable a provider only when its complete credential set is present.
5. Preserve existing summary adapters when adding live collection; they are
   valid fallbacks and can provide metrics absent from provider APIs.
6. Never replace an unknown value with zero.
7. Never expose, log, commit, or persist credentials.
8. Never broaden an operational credential when a separate monitoring
   credential can be used.
9. Add documentation for every new environment variable and permission.
10. Add tests for configuration gating, authorization, partial failure, and
    secret redaction.
11. Run the repository's required checks and report checks that could not run.
12. Keep package integration changes separate from unrelated refactors.

### Completion criteria

The integration is complete only when:

- at least one provider is configured or a documented no-provider state exists;
- scheduled or manual collection can execute server-side;
- normalized metrics are consumed or persisted;
- provider errors are observable to administrators;
- credentials remain server-only;
- limits are appropriate for the real plans;
- configuration and operational steps are documented;
- relevant automated checks pass.

## Troubleshooting

### A provider returns no metrics

Inspect the matching entry in `result.results`. Confirm the full credential set,
token scope, account/project identifier, API availability, and plan support.

### Resend returns 401 or 403

Confirm the usage key has Full access. A Sending-access key cannot call
`GET /emails?limit=1`.

### Resend returns only monthly usage

The daily quota header is normally available only on free plans. This is an
expected provider limitation.

### Supabase omits MAU or egress

Pass trusted application or billing summaries. The Management API endpoints
used by the collector do not provide stable project billing-cycle values for
those metrics.

### Vercel billing collection is unavailable

The token, account plan, or role may not permit the billing charges endpoint.
Use the normalized summary or CLI JSON adapter described in the provider guide.

### MongoDB Atlas cannot select a process

Set `MONGODB_ATLAS_PROCESS_ID` explicitly, confirm the service account has
`Project Read Only`, and check the Atlas Administration API access list.

## Related references

- [Provider-specific configuration](provider-configuration.md)
- [Security guide](security.md)
- [Next.js route handler example](../examples/nextjs-route-handler.md)
- [Public API overview](../README.md)
