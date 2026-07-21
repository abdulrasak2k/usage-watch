import assert from "node:assert/strict";
import test from "node:test";

import {
  createResendUsageMetrics,
  createSupabaseUsageMetrics,
} from "../dist/index.js";

test("normalizes Resend application summaries with default limits", () => {
  const result = createResendUsageMetrics({
    sentToday: 80,
    sentThisMonth: 2_800,
    failedToday: 3,
    bouncedThisMonth: 4,
    metadata: { tenant: "example" },
    now: new Date("2026-07-21T12:00:00Z"),
  });

  assert.equal(result.provider, "resend");
  assert.equal(metric(result, "email.sent.today").status, "warning");
  assert.equal(metric(result, "email.sent.month").status, "critical");
  assert.equal(metric(result, "email.failed.today").value, 3);
  assert.equal(metric(result, "email.bounced.month").value, 4);
  assert.deepEqual(metric(result, "email.sent.today").metadata, {
    tenant: "example",
  });
});

test("normalizes Supabase summaries with free-tier defaults", () => {
  const result = createSupabaseUsageMetrics({
    databaseBytes: 400 * 1024 ** 2,
    monthlyActiveUsers: 46_000,
    egressBytesThisMonth: 4 * 1024 ** 3,
    storageBytes: 0,
    metadata: { project: "example" },
    now: new Date("2026-07-21T12:00:00Z"),
  });

  assert.equal(result.provider, "supabase");
  assert.equal(metric(result, "supabase.database.bytes").status, "warning");
  assert.equal(
    metric(result, "supabase.auth.monthly_active_users").status,
    "critical",
  );
  assert.equal(metric(result, "supabase.egress.month").status, "warning");
  assert.equal(metric(result, "supabase.storage.bytes").status, "ok");
  assert.match(
    metric(result, "supabase.storage.bytes").metadata.note,
    /Cloudflare R2/,
  );
});

function metric(result, key) {
  const found = result.metrics.find((item) => item.key === key);
  assert.ok(found, `Expected metric ${key}`);
  return found;
}
