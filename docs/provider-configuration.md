# Provider configuration

This package should run only on the server. Keep all provider tokens in server-only environment variables.

## Cloudflare R2

Required values:

```env
CLOUDFLARE_R2_ACCOUNT_ID=
CLOUDFLARE_R2_BUCKET_NAME=
CLOUDFLARE_API_TOKEN=
```

`CLOUDFLARE_API_TOKEN` is not the R2 S3 access key. It is a Cloudflare API token with permission to read account analytics.

Recommended token permissions:

- Account analytics/read access.
- Scope it to the specific Cloudflare account where possible.

The collector reads:

- stored payload bytes;
- object count;
- operation request counts by action type;
- estimated Class A and Class B requests.

## Upstash Redis

Required values:

```env
UPSTASH_DATABASE_ID=
UPSTASH_EMAIL=
UPSTASH_API_KEY=
```

These are for the Upstash Developer API, not the Redis REST token.

The collector reads:

- daily net commands;
- daily read requests;
- daily write requests;
- key count;
- disk usage;
- mean latency.

## MongoDB Atlas

Required values:

```env
MONGODB_ATLAS_PROJECT_ID=
MONGODB_ATLAS_CLIENT_ID=
MONGODB_ATLAS_CLIENT_SECRET=
```

Optional value:

```env
MONGODB_ATLAS_PROCESS_ID=
```

Create an Atlas service account with the `Project Read Only` role and grant it
access to the target project. If your organization requires an Atlas
Administration API access list, allow the outbound IP address of the server or
cron worker that runs the collector.

Service-account credentials are exchanged for a one-hour OAuth bearer token.
You can alternatively pass an existing `accessToken` instead of `clientId` and
`clientSecret`. Legacy public/private API keys use HTTP Digest authentication
and are not accepted by this collector.

The collector reads one process's:

- logical storage;
- current connections;
- current query, insert, update, and delete operations per second;
- estimated network transfer in and out over the requested range.

If `processId` is omitted, the collector selects an active replica-set or shard
primary, then falls back to the first active process. Set `processId` explicitly
when a project contains multiple clusters.

The default request covers seven days at one-hour granularity. Default limits
match Atlas Free clusters: 0.5 GB storage, 500 connections, 100 operations per
second, and 10 GB each of inbound and outbound transfer over seven days.
Override `limits` for Flex or dedicated clusters, and when changing `period`.

## Resend

Recommended source: your host application database.

For example, in BNS File Tracking you can summarize `email_logs`:

- successful emails today;
- successful emails this month;
- failed emails today;
- bounced emails this month if available.

Then call:

```ts
createResendUsageMetrics({
  sentToday,
  sentThisMonth,
  failedToday,
  limits: {
    dailyEmails: 100,
    monthlyEmails: 3000,
  },
});
```

## Supabase

Recommended source: trusted server-side summary.

Pass values such as:

- database bytes;
- monthly active users;
- egress bytes this month;
- Supabase Storage bytes if the host app uses Supabase Storage.

BNS File Tracking should keep document files in Cloudflare R2, so Supabase Storage should normally be zero or near-zero.

## Vercel

Option 1: pass a normalized summary:

```ts
createVercelUsageMetrics({
  bandwidthBytes,
  edgeRequests,
  functionInvocations,
  buildMinutes,
  projectedMonthlyCostUsd,
});
```

Option 2: pass CLI JSON:

```bash
vercel usage --format json > vercel-usage.json
```

Then:

```ts
import usage from "./vercel-usage.json" assert { type: "json" };
import { createVercelUsageMetricsFromCliJson } from "@abdulrasak2k/usage-watch";

const result = createVercelUsageMetricsFromCliJson(usage);
```

## Thresholds

Default thresholds:

- `warning`: 75% of limit.
- `critical`: 90% of limit.

Override per provider:

```ts
collectProviderUsage({
  upstashRedis: {
    databaseId,
    email,
    apiKey,
    thresholds: {
      warning: 0.6,
      critical: 0.8,
    },
  },
});
```
