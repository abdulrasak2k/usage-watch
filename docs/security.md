# Security guide

This package is designed for server-side provider usage monitoring.

## Rules

- Do not import this package from React client components.
- Do not put provider tokens in `NEXT_PUBLIC_*` variables.
- Do not return raw provider API responses to normal users.
- Protect usage dashboards with an admin/super-admin permission.
- Store only normalized metrics unless you have a reason to store raw payloads.
- Rotate provider tokens if they are accidentally committed or exposed.

## Safe Next.js usage

Use route handlers, server actions, or scheduled jobs:

```txt
app/api/admin/usage-watch/route.ts
```

Protect the route before collecting data:

```ts
await requirePermission(userId, "settings:manage");
```

## Unsafe usage

Avoid this:

```tsx
"use client";

import { collectProviderUsage } from "@abdulrasak2k/usage-watch";
```

That can leak implementation details and encourages secrets near browser code.

## Environment variable guidance

Server-only:

```env
CLOUDFLARE_API_TOKEN=
MONGODB_ATLAS_CLIENT_ID=
MONGODB_ATLAS_CLIENT_SECRET=
UPSTASH_EMAIL=
UPSTASH_API_KEY=
RESEND_USAGE_API_KEY=
SUPABASE_ACCESS_TOKEN=
VERCEL_TOKEN=
```

Identifiers such as account IDs, project references, database IDs, team IDs,
and bucket names are configuration rather than authentication secrets. They
should still remain server-side when they reveal infrastructure details.

### Use separate operational and monitoring credentials

- Keep the application's Resend Sending-access key separate from the
  Full-access key used by the live usage collector. A clear name such as
  `RESEND_USAGE_API_KEY` prevents accidental privilege expansion.
- Use a Supabase Management API personal access token for live Supabase usage.
  Do not substitute the project's anon key or service-role key.
- Prefer a MongoDB Atlas OAuth service account with `Project Read Only` over a
  human user's credentials.
- Scope every token to the smallest account, project, and role that can read the
  required usage data.

Never:

```env
NEXT_PUBLIC_CLOUDFLARE_API_TOKEN=
NEXT_PUBLIC_UPSTASH_API_KEY=
NEXT_PUBLIC_MONGODB_ATLAS_CLIENT_SECRET=
NEXT_PUBLIC_RESEND_USAGE_API_KEY=
NEXT_PUBLIC_SUPABASE_ACCESS_TOKEN=
NEXT_PUBLIC_VERCEL_TOKEN=
```

## Logging and persistence

- Do not log the options object passed to a collector; it contains credentials.
- Persist `result.metrics`, not `result.raw`, unless raw provider data is
  explicitly required and reviewed.
- Treat `result.errors` as operational diagnostics. Avoid returning them to
  untrusted clients because provider responses can contain account details.
- Protect manual collection endpoints with admin authorization and scheduled
  endpoints with an unguessable cron secret.
- Rotate a credential immediately if it appears in source control, logs, build
  output, browser bundles, or screenshots.
