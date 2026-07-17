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
UPSTASH_EMAIL=
UPSTASH_API_KEY=
SUPABASE_SERVICE_ROLE_KEY=
RESEND_API_KEY=
VERCEL_TOKEN=
```

Never:

```env
NEXT_PUBLIC_CLOUDFLARE_API_TOKEN=
NEXT_PUBLIC_UPSTASH_API_KEY=
NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY=
```
