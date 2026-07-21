import assert from "node:assert/strict";
import test from "node:test";

import { collectUpstashRedisUsage } from "../dist/index.js";

test("collects scalar and time-series Upstash Redis usage", async () => {
  const calls = [];
  const fetchImpl = async (input, init = {}) => {
    calls.push({ url: String(input), init });
    return jsonResponse({
      daily_net_commands: [{ value: 250_000 }, { value: 400_000 }],
      daily_read_requests: [{ count: 100 }, { count: 200 }],
      daily_write_requests: "50",
      keyspace: [{ keys: 30 }, { keys: 40 }],
      diskusage: [{ bytes: 512 }, { bytes: 1_024 }],
      latencymean: [{ ms: 1.5 }, { ms: 2.5 }],
    });
  };

  const result = await collectUpstashRedisUsage({
    databaseId: "db/one",
    email: "owner@example.com",
    apiKey: "upstash-secret",
    limits: {
      dailyReads: 250,
      dailyWrites: 100,
    },
    fetchImpl,
    now: new Date("2026-07-21T12:00:00Z"),
  });

  assert.equal(result.provider, "upstash-redis");
  assert.equal(metric(result, "redis.commands.daily_net").value, 400_000);
  assert.equal(metric(result, "redis.commands.daily_net").status, "warning");
  assert.equal(metric(result, "redis.commands.daily_reads").value, 200);
  assert.equal(metric(result, "redis.commands.daily_reads").status, "warning");
  assert.equal(metric(result, "redis.commands.daily_writes").value, 50);
  assert.equal(metric(result, "redis.keyspace.keys").value, 40);
  assert.equal(metric(result, "redis.disk_usage.bytes").value, 1_024);
  assert.equal(metric(result, "redis.latency.mean_ms").value, 2.5);

  assert.equal(calls.length, 1);
  assert.equal(
    calls[0].url,
    "https://api.upstash.com/v2/redis/stats/db%2Fone",
  );
  assert.equal(
    calls[0].init.headers.authorization,
    `Basic ${Buffer.from("owner@example.com:upstash-secret").toString("base64")}`,
  );
});

function metric(result, key) {
  const found = result.metrics.find((item) => item.key === key);
  assert.ok(found, `Expected metric ${key}`);
  return found;
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}
