import assert from "node:assert/strict";
import test from "node:test";

import { collectMongoDBAtlasUsage } from "../dist/index.js";

test("collects and normalizes MongoDB Atlas Free-cluster measurements", async () => {
  const calls = [];
  const fetchImpl = async (input, init = {}) => {
    const url = String(input);
    calls.push({ url, init });

    if (url.endsWith("/api/oauth/token")) {
      return jsonResponse({ access_token: "atlas-token", expires_in: 3600 });
    }

    if (url.includes("/processes?")) {
      return jsonResponse({
        results: [
          { id: "secondary.example.com:27017", typeName: "REPLICA_SECONDARY" },
          {
            id: "primary.example.com:27017",
            typeName: "REPLICA_PRIMARY",
            replicaSetName: "atlas-test-shard-0",
          },
        ],
      });
    }

    if (url.includes("/measurements?")) {
      return jsonResponse({
        start: "2026-07-11T00:00:00Z",
        end: "2026-07-18T00:00:00Z",
        granularity: "PT1H",
        processId: "primary.example.com:27017",
        measurements: [
          measurement("DB_STORAGE_TOTAL", "GIGABYTES", [0.2, 0.25]),
          measurement("CONNECTIONS", "SCALAR", [350, 400]),
          measurement("NETWORK_BYTES_IN", "BYTES_PER_SECOND", [10, 10]),
          measurement("NETWORK_BYTES_OUT", "BYTES_PER_SECOND", [20, 20]),
          measurement("OPCOUNTER_QUERY", "SCALAR_PER_SECOND", [3, 4]),
          measurement("OPCOUNTER_INSERT", "SCALAR_PER_SECOND", [2, 3]),
          measurement("OPCOUNTER_UPDATE", "SCALAR_PER_SECOND", [1, 2]),
          measurement("OPCOUNTER_DELETE", "SCALAR_PER_SECOND", [0, 1]),
        ],
      });
    }

    throw new Error(`Unexpected request: ${url}`);
  };

  const result = await collectMongoDBAtlasUsage({
    projectId: "0123456789abcdef01234567",
    clientId: "client-id",
    clientSecret: "client-secret",
    fetchImpl,
    now: new Date("2026-07-18T12:00:00Z"),
  });

  assert.equal(result.provider, "mongodb-atlas");
  assert.equal(result.metrics.length, 5);
  assert.equal(metric(result, "atlas.storage.bytes").value, 0.25 * 1024 ** 3);
  assert.equal(metric(result, "atlas.connections").value, 400);
  assert.equal(metric(result, "atlas.connections").status, "warning");
  assert.equal(metric(result, "atlas.operations.per_second").value, 10);
  assert.equal(metric(result, "atlas.network.in_bytes").value, 72_000);
  assert.equal(metric(result, "atlas.network.out_bytes").value, 144_000);
  assert.equal(
    metric(result, "atlas.storage.bytes").metadata.processId,
    "primary.example.com:27017",
  );

  assert.equal(calls.length, 3);
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.body, "grant_type=client_credentials");
  assert.match(calls[0].init.headers.authorization, /^Basic /);
  assert.match(calls[2].init.headers.authorization, /^Bearer atlas-token$/);
  assert.match(calls[2].url, /m=DB_STORAGE_TOTAL/);
  assert.match(calls[2].url, /period=P7D/);
});

function measurement(name, units, values) {
  return {
    name,
    units,
    dataPoints: values.map((value, index) => ({
      timestamp: `2026-07-18T0${index}:00:00Z`,
      value,
    })),
  };
}

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
