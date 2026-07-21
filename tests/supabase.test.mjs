import assert from "node:assert/strict";
import test from "node:test";

import {
  collectProviderUsage,
  collectSupabaseUsage,
} from "../dist/index.js";

test("collects live Supabase database, Storage, and API request usage", async () => {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (String(url).endsWith("/database/query/read-only")) {
      return jsonResponse(
        [{ database_bytes: "419430400", storage_bytes: "1048576" }],
        { status: 201 },
      );
    }

    return jsonResponse({
      result: [
        {
          timestamp: "2026-07-20T00:00:00Z",
          total_auth_requests: 10,
          total_realtime_requests: 20,
          total_rest_requests: 30,
          total_storage_requests: 40,
        },
        {
          timestamp: "2026-07-21T00:00:00Z",
          total_auth_requests: 1,
          total_realtime_requests: 2,
          total_rest_requests: 3,
          total_storage_requests: 4,
        },
      ],
    });
  };

  const result = await collectSupabaseUsage({
    projectRef: "abcdefghijklmnopqrst",
    accessToken: "supabase-secret",
    interval: "7day",
    monthlyActiveUsers: 46_000,
    egressBytesThisMonth: 4 * 1024 ** 3,
    limits: { apiRequests: 100 },
    fetchImpl,
    now: new Date("2026-07-21T12:00:00Z"),
  });

  assert.equal(result.provider, "supabase");
  assert.equal(result.metrics.length, 9);
  assert.equal(metric(result, "supabase.database.bytes").value, 419_430_400);
  assert.equal(metric(result, "supabase.storage.bytes").value, 1_048_576);
  assert.equal(metric(result, "supabase.api.requests.auth").value, 11);
  assert.equal(metric(result, "supabase.api.requests.realtime").value, 22);
  assert.equal(metric(result, "supabase.api.requests.rest").value, 33);
  assert.equal(metric(result, "supabase.api.requests.storage").value, 44);
  assert.equal(metric(result, "supabase.api.requests.total").value, 110);
  assert.equal(metric(result, "supabase.api.requests.total").status, "critical");
  assert.equal(
    metric(result, "supabase.database.bytes").source,
    "supabase-management-api:database/query/read-only",
  );
  assert.equal(
    metric(result, "supabase.auth.monthly_active_users").source,
    "application-or-provider-summary",
  );

  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.equal(call.init.headers.authorization, "Bearer supabase-secret");
  }
  const databaseCall = calls.find((call) =>
    call.url.endsWith("/database/query/read-only"),
  );
  assert.equal(databaseCall.init.method, "POST");
  assert.match(JSON.parse(databaseCall.init.body).query, /pg_database_size/);
  assert.ok(
    calls.some((call) =>
      call.url.endsWith("usage.api-counts?interval=7day"),
    ),
  );
  assert.doesNotMatch(JSON.stringify(result.raw), /supabase-secret/);
});

test("keeps Supabase analytics metrics when the database query is unavailable", async () => {
  const result = await collectProviderUsage({
    supabase: {
      projectRef: "abcdefghijklmnopqrst",
      accessToken: "restricted-token",
      fetchImpl: async (url) => {
        if (String(url).endsWith("/database/query/read-only")) {
          return jsonResponse({ message: "Forbidden" }, { status: 403 });
        }

        return jsonResponse({
          result: [
            {
              timestamp: "2026-07-21T00:00:00Z",
              total_auth_requests: 1,
              total_realtime_requests: 2,
              total_rest_requests: 3,
              total_storage_requests: 4,
            },
          ],
        });
      },
    },
  });

  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].provider, "supabase");
  assert.equal(result.results[0].metrics.length, 5);
  assert.match(result.results[0].errors[0], /HTTP 403/);
  assert.equal(metric(result.results[0], "supabase.api.requests.total").value, 10);
  assert.equal(
    result.results[0].metrics.some(
      (item) => item.key === "supabase.auth.monthly_active_users",
    ),
    false,
  );
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
