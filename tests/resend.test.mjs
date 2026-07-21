import assert from "node:assert/strict";
import test from "node:test";

import { collectProviderUsage, collectResendUsage } from "../dist/index.js";

test("collects Resend quota usage without retaining email contents", async () => {
  const calls = [];
  const result = await collectResendUsage({
    apiKey: "re_secret",
    limits: { dailyEmails: 100, monthlyEmails: 3_000 },
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init });
      return jsonResponse(
        {
          object: "list",
          data: [
            {
              id: "email-id",
              to: ["private@example.com"],
              subject: "Private subject",
            },
          ],
        },
        {
          headers: {
            "x-resend-daily-quota": "80",
            "x-resend-monthly-quota": "2800",
            "ratelimit-limit": "10",
            "ratelimit-remaining": "9",
            "ratelimit-reset": "1",
          },
        },
      );
    },
    now: new Date("2026-07-21T12:00:00Z"),
  });

  assert.equal(result.provider, "resend");
  assert.equal(result.metrics.length, 2);
  assert.equal(metric(result, "email.sent.today").value, 80);
  assert.equal(metric(result, "email.sent.today").status, "warning");
  assert.equal(metric(result, "email.sent.month").value, 2_800);
  assert.equal(metric(result, "email.sent.month").status, "critical");
  assert.equal(
    metric(result, "email.sent.month").source,
    "resend-api:quota-headers",
  );
  assert.equal(
    metric(result, "email.sent.month").metadata.quotaIncludesReceivedEmails,
    true,
  );
  assert.deepEqual(result.raw.rateLimit, {
    limit: 10,
    remaining: 9,
    resetSeconds: 1,
  });
  assert.doesNotMatch(JSON.stringify(result), /re_secret|private@example|Private subject/);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.resend.com/emails?limit=1");
  assert.equal(calls[0].init.headers.authorization, "Bearer re_secret");
  assert.equal(calls[0].init.headers["user-agent"], "usage-watch/collector");
});

test("supports paid Resend plans without a daily quota header", async () => {
  const result = await collectResendUsage({
    apiKey: "re_paid",
    failedToday: 2,
    fetchImpl: async () =>
      jsonResponse(
        { object: "list", data: [] },
        { headers: { "x-resend-monthly-quota": "12000/50000" } },
      ),
  });

  assert.equal(result.metrics.length, 2);
  assert.equal(metric(result, "email.sent.month").value, 12_000);
  assert.equal(metric(result, "email.failed.today").value, 2);
  assert.equal(
    result.metrics.some((item) => item.key === "email.sent.today"),
    false,
  );
});

test("isolates Resend API failures in combined collection", async () => {
  const result = await collectProviderUsage({
    resend: {
      apiKey: "invalid",
      fetchImpl: async () =>
        jsonResponse({ message: "Invalid API key" }, { status: 403 }),
    },
    supabase: { databaseBytes: 100 },
  });

  assert.equal(result.results.length, 2);
  assert.equal(result.results[0].provider, "resend");
  assert.deepEqual(result.results[0].metrics, []);
  assert.match(result.results[0].errors[0], /HTTP 403/);
  assert.equal(result.results[1].provider, "supabase");
  assert.equal(result.metrics.length, 4);
});

function metric(result, key) {
  const found = result.metrics.find((item) => item.key === key);
  assert.ok(found, `Expected metric ${key}`);
  return found;
}

function jsonResponse(value, init) {
  return new Response(JSON.stringify(value), {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
}
