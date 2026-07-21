import assert from "node:assert/strict";
import test from "node:test";

import { collectProviderUsage } from "../dist/index.js";

test("combines provider metrics in a stable order", async () => {
  const result = await collectProviderUsage({
    resend: { sentToday: 10, sentThisMonth: 20 },
    supabase: { databaseBytes: 100 },
    vercel: { edgeRequests: 30 },
  });

  assert.deepEqual(
    result.results.map((providerResult) => providerResult.provider),
    ["resend", "supabase", "vercel"],
  );
  assert.equal(result.metrics.length, 13);
  assert.equal(result.metrics[0].key, "email.sent.today");
  assert.equal(result.metrics.at(-1).key, "vercel.cost.projected_usd");
});

test("isolates a failed live provider without dropping other metrics", async () => {
  const result = await collectProviderUsage({
    cloudflareR2: {
      accountId: "account-id",
      apiToken: "invalid",
      start: "2026-07-20T00:00:00Z",
      end: "2026-07-21T00:00:00Z",
      fetchImpl: async () =>
        new Response(JSON.stringify({ error: "Not authorized" }), {
          status: 403,
        }),
    },
    resend: { sentToday: 5 },
  });

  assert.equal(result.results.length, 2);
  assert.equal(result.results[0].provider, "cloudflare-r2");
  assert.deepEqual(result.results[0].metrics, []);
  assert.match(result.results[0].errors[0], /HTTP 403/);
  assert.equal(result.results[1].provider, "resend");
  assert.equal(result.metrics.length, 4);
});
