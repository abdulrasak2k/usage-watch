import assert from "node:assert/strict";
import test from "node:test";

import {
  collectProviderUsage,
  collectVercelUsage,
  createVercelUsageMetricsFromCliJson,
} from "../dist/index.js";

test("collects and aggregates Vercel FOCUS billing charges", async () => {
  const calls = [];
  const charges = [
    {
      ServiceName: "Fast Data Transfer",
      ConsumedQuantity: "0.5",
      ConsumedUnit: "GB",
      EffectiveCost: "0.10",
      BilledCost: "0.08",
      BillingCurrency: "USD",
    },
    {
      ServiceName: "Fast Data Transfer",
      ConsumedQuantity: 0.5,
      ConsumedUnit: "GB",
      EffectiveCost: 0.1,
      BilledCost: 0.08,
      BillingCurrency: "USD",
    },
    {
      ServiceName: "Edge Requests",
      ConsumedQuantity: 800_000,
      ConsumedUnit: "requests",
      EffectiveCost: 0.05,
      BilledCost: 0.04,
      BillingCurrency: "USD",
    },
  ];
  const fetchImpl = async (input, init = {}) => {
    calls.push({ url: String(input), init });
    return new Response(charges.map((charge) => JSON.stringify(charge)).join("\n"), {
      status: 200,
      headers: { "content-type": "application/x-ndjson" },
    });
  };

  const result = await collectVercelUsage({
    token: "vercel-secret",
    teamId: "team_example",
    from: "2026-07-01T00:00:00Z",
    to: "2026-07-18T00:00:00Z",
    limits: {
      bandwidthBytes: 2 * 1024 ** 3,
      edgeRequests: 1_000_000,
      monthlyCostUsd: 0,
    },
    fetchImpl,
    now: new Date("2026-07-18T12:00:00Z"),
  });

  assert.equal(result.provider, "vercel");
  assert.equal(result.raw.length, 3);
  assert.equal(metric(result, "vercel.service.fast_data_transfer.gb").value, 1024 ** 3);
  assert.equal(metric(result, "vercel.service.fast_data_transfer.gb").unit, "bytes");
  assert.equal(metric(result, "vercel.service.edge_requests.requests").value, 800_000);
  assert.equal(metric(result, "vercel.service.edge_requests.requests").status, "warning");
  assert.equal(metric(result, "vercel.cost.effective_usd").value, 0.25);
  assert.equal(metric(result, "vercel.cost.effective_usd").status, "critical");
  assert.equal(metric(result, "vercel.cost.billed_usd").value, 0.2);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.headers.authorization, "Bearer vercel-secret");
  const requestUrl = new URL(calls[0].url);
  assert.equal(requestUrl.pathname, "/v1/billing/charges");
  assert.equal(requestUrl.searchParams.get("teamId"), "team_example");
  assert.equal(requestUrl.searchParams.get("from"), "2026-07-01T00:00:00.000Z");
  assert.equal(requestUrl.searchParams.get("to"), "2026-07-18T00:00:00.000Z");
});

test("collectProviderUsage accepts live Vercel options and isolates API errors", async () => {
  const result = await collectProviderUsage({
    vercel: {
      token: "expired",
      fetchImpl: async () =>
        new Response(JSON.stringify({ error: { message: "Not authorized" } }), {
          status: 403,
        }),
    },
  });

  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].provider, "vercel");
  assert.deepEqual(result.results[0].metrics, []);
  assert.match(result.results[0].errors[0], /HTTP 403/);
});

test("parses the current vercel usage JSON format", () => {
  const result = createVercelUsageMetricsFromCliJson(
    {
      period: { from: "2026-07-01", to: "2026-07-18" },
      context: "example-team",
      services: [
        {
          name: "Fast Data Transfer",
          pricingQuantity: 1.5,
          pricingUnit: "GB",
          effectiveCost: 0.12,
          billedCost: 0.1,
        },
      ],
      totals: {
        pricingQuantity: 1.5,
        effectiveCost: 0.12,
        billedCost: 0.1,
      },
      chargeCount: 1,
    },
    { limits: { bandwidthBytes: 2 * 1024 ** 3 } },
  );

  assert.equal(metric(result, "vercel.service.fast_data_transfer").value, 1.5 * 1024 ** 3);
  assert.equal(metric(result, "vercel.service.fast_data_transfer").status, "warning");
  assert.equal(metric(result, "vercel.cost.projected_usd").value, 0.12);
});

function metric(result, key) {
  const found = result.metrics.find((item) => item.key === key);
  assert.ok(found, `Expected metric ${key}`);
  return found;
}
