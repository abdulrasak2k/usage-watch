# @abdulrasak2k/usage-watch

[![CI](https://github.com/abdulrasak2k/usage-watch/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/abdulrasak2k/usage-watch/actions/workflows/ci.yml)

Reusable server-side usage monitoring package for startup SaaS/internal tools.

It collects or normalizes usage metrics from the providers commonly used in BNS File Tracking:

- Cloudflare R2
- MongoDB Atlas
- Upstash Redis
- Resend
- Supabase
- Vercel

The package is intentionally UI-free and framework-light. It does not depend on Next.js, Supabase clients, React, Tailwind, or BNS application code. You can use it from any Node/TypeScript backend, Next.js route handler, cron job, queue worker, or admin script.

## Why this package exists

For a zero-cost or low-cost startup setup, the biggest risk is quietly crossing a free-tier limit. This package gives every project a shared way to:

- collect provider usage server-side;
- normalize usage into one metric shape;
- compare usage against limits;
- mark metrics as `ok`, `warning`, or `critical`;
- store snapshots in any app database;
- render dashboards in each host app’s own UI.

## Install from GitHub

Public repository:

```bash
npm install github:abdulrasak2k/usage-watch
```

Specific branch:

```bash
npm install github:abdulrasak2k/usage-watch#main
```

Specific tag:

```bash
npm install github:abdulrasak2k/usage-watch#v0.2.0
```

Private repository over SSH:

```bash
npm install git+ssh://git@github.com/abdulrasak2k/usage-watch.git
```

Then import it:

```ts
import { collectProviderUsage } from "@abdulrasak2k/usage-watch";
```

The package includes a `prepare` script, so when it is installed from GitHub, npm builds the TypeScript output automatically.

## Quick start

```ts
import { collectProviderUsage } from "@abdulrasak2k/usage-watch";

export async function collectUsageSnapshot() {
  const result = await collectProviderUsage({
    cloudflareR2: {
      accountId: process.env.CLOUDFLARE_R2_ACCOUNT_ID!,
      apiToken: process.env.CLOUDFLARE_API_TOKEN!,
      bucketName: process.env.CLOUDFLARE_R2_BUCKET_NAME,
      start: new Date(Date.now() - 24 * 60 * 60 * 1000),
      end: new Date(),
    },
    upstashRedis: {
      databaseId: process.env.UPSTASH_DATABASE_ID!,
      email: process.env.UPSTASH_EMAIL!,
      apiKey: process.env.UPSTASH_API_KEY!,
    },
    mongodbAtlas: {
      projectId: process.env.MONGODB_ATLAS_PROJECT_ID!,
      clientId: process.env.MONGODB_ATLAS_CLIENT_ID!,
      clientSecret: process.env.MONGODB_ATLAS_CLIENT_SECRET!,
      // Optional. If omitted, the collector selects an active primary process.
      processId: process.env.MONGODB_ATLAS_PROCESS_ID,
    },
    resend: {
      sentToday: 12,
      sentThisMonth: 250,
      failedToday: 0,
    },
    supabase: {
      databaseBytes: 120_000_000,
      monthlyActiveUsers: 45,
      egressBytesThisMonth: 300_000_000,
    },
    vercel: {
      token: process.env.VERCEL_TOKEN!,
      teamId: process.env.VERCEL_TEAM_ID,
      limits: {
        monthlyCostUsd: 0,
      },
    },
  });

  return result.metrics;
}
```

Each metric has the same shape:

```ts
type UsageMetric = {
  provider: "cloudflare-r2" | "mongodb-atlas" | "upstash-redis" | "resend" | "supabase" | "vercel" | "custom";
  key: string;
  label: string;
  value: number;
  unit: "count" | "bytes" | "usd" | "percent" | "milliseconds" | "operations_per_second" | "requests";
  period: "instant" | "day" | "month" | "range";
  limit?: number;
  status: "ok" | "warning" | "critical" | "unknown";
  source: string;
  updatedAt: string;
  metadata?: Record<string, unknown>;
};
```

## Server-side only security rule

Use this package only from server-side code.

Never expose these values to browser bundles:

- `CLOUDFLARE_API_TOKEN`
- `MONGODB_ATLAS_CLIENT_ID`
- `MONGODB_ATLAS_CLIENT_SECRET`
- `UPSTASH_EMAIL`
- `UPSTASH_API_KEY`
- `RESEND_API_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `VERCEL_TOKEN`

Good places to use it:

- Next.js route handlers
- Next.js server actions
- scheduled cron jobs
- backend workers
- admin scripts

Bad places to use it:

- React client components
- public browser JavaScript
- files using `"use client"`

## Provider support

| Provider | Collection style | Notes |
| --- | --- | --- |
| Cloudflare R2 | Live API | Uses Cloudflare GraphQL analytics. |
| MongoDB Atlas | Live API | Uses OAuth service accounts and Atlas process measurements. |
| Upstash Redis | Live API | Uses Upstash Developer API database stats. |
| Resend | App summary | Count your own `email_logs`; this is more accurate per product/tenant. |
| Supabase | App/provider summary | Pass database size, MAU, egress, etc. from your own trusted source. |
| Vercel | Live API, summary, or CLI JSON | Uses FOCUS billing charges, or accepts normalized/CLI usage data. |

## Recommended host-app database table

The package does not create tables. In each project, store snapshots however you prefer. A simple Postgres table is enough:

```sql
create table provider_usage_snapshots (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  metric_key text not null,
  label text not null,
  value numeric not null,
  unit text not null,
  period text not null,
  usage_limit numeric,
  status text not null,
  source text not null,
  metadata jsonb not null default '{}'::jsonb,
  collected_at timestamptz not null default now()
);

create index provider_usage_snapshots_provider_idx
  on provider_usage_snapshots (provider);

create index provider_usage_snapshots_metric_key_idx
  on provider_usage_snapshots (metric_key);

create index provider_usage_snapshots_collected_at_idx
  on provider_usage_snapshots (collected_at desc);
```

## Recommended Next.js route handler

See [examples/nextjs-route-handler.md](examples/nextjs-route-handler.md).

## Provider configuration

See [docs/provider-configuration.md](docs/provider-configuration.md).

## Creating a separate GitHub repository

See [docs/standalone-github-repo.md](docs/standalone-github-repo.md).

## Build

```bash
npm install
npm run build
npm run typecheck
```

## Release workflow

```bash
npm version patch
git push origin main --tags
```

Then install a tagged version in host apps:

```bash
npm install github:abdulrasak2k/usage-watch#v0.2.0
```

## Limitations

- Cloudflare R2 Class A/Class B request counts are estimated from GraphQL `actionType` names. For billing-critical reporting, validate against Cloudflare billing exports.
- MongoDB Atlas rolling network transfer is estimated by integrating the sampled bytes-per-second measurements. The default limits match Free clusters and should be overridden for Flex or dedicated clusters.
- Resend usage is intentionally summary-based. Your app’s email log table is usually the most trustworthy source for product-level usage.
- The live Vercel collector depends on access to the account's billing charges endpoint. Keep using the summary or CLI JSON adapter when that endpoint is unavailable for the account, plan, or role.
- Supabase billing APIs can vary by account/product. This package accepts normalized summaries so host apps can adapt without changing the shared metric model.
