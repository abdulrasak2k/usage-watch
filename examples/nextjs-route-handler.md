# Next.js route handler example

Example admin-only endpoint:

```ts
import { NextResponse } from "next/server";
import { collectProviderUsage } from "@abdulrasak2k/usage-watch";

export async function GET() {
  // Replace this with your host app auth/RBAC.
  // await requirePermission(currentUserId, "settings:manage");

  const usage = await collectProviderUsage({
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
      processId: process.env.MONGODB_ATLAS_PROCESS_ID,
    },
    vercel: {
      token: process.env.VERCEL_TOKEN!,
      teamId: process.env.VERCEL_TEAM_ID,
      limits: {
        // Treat any incurred cost as critical for a zero-cost deployment.
        monthlyCostUsd: 0,
      },
    },
    resend: {
      // Replace these with counts from your email_logs table.
      sentToday: 0,
      sentThisMonth: 0,
      failedToday: 0,
    },
    supabase: {
      // Replace these with trusted server-side summaries.
      databaseBytes: 0,
      monthlyActiveUsers: 0,
      egressBytesThisMonth: 0,
    },
  });

  return NextResponse.json({
    metrics: usage.metrics,
  });
}
```

Recommended production behavior:

1. Collect usage in a cron job.
2. Store metrics in a `provider_usage_snapshots` table.
3. Render the dashboard from stored snapshots.
4. Restrict the dashboard to super admins.
5. Alert when any metric status is `warning` or `critical`.
