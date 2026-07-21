import assert from "node:assert/strict";
import test from "node:test";

import { collectCloudflareR2Usage } from "../dist/index.js";

test("collects and classifies Cloudflare R2 usage", async () => {
  const calls = [];
  const fetchImpl = async (input, init = {}) => {
    calls.push({ url: String(input), init });
    return jsonResponse({
      data: {
        viewer: {
          accounts: [
            {
              r2OperationsAdaptiveGroups: [
                operation("PutObject", 600),
                operation("GetObject", 800),
                operation("HeadObject", 100),
                operation("Other", 50),
              ],
              r2StorageAdaptiveGroups: [
                {
                  max: {
                    objectCount: 42,
                    payloadSize: 8 * 1024 ** 3,
                  },
                  dimensions: { datetime: "2026-07-21T12:00:00Z" },
                },
              ],
            },
          ],
        },
      },
      errors: [{ message: "partial analytics warning" }],
    });
  };

  const result = await collectCloudflareR2Usage({
    accountId: "account-id",
    apiToken: "cloudflare-secret",
    bucketName: "documents",
    start: "2026-07-20T00:00:00Z",
    end: "2026-07-21T00:00:00Z",
    limits: {
      storageBytes: 10 * 1024 ** 3,
      classARequests: 1_000,
      classBRequests: 1_000,
      totalRequests: 1_000,
    },
    fetchImpl,
    now: new Date("2026-07-21T12:00:00Z"),
  });

  assert.equal(result.provider, "cloudflare-r2");
  assert.deepEqual(result.errors, ["partial analytics warning"]);
  assert.equal(metric(result, "r2.storage.payload_bytes").status, "warning");
  assert.equal(metric(result, "r2.objects").value, 42);
  assert.equal(metric(result, "r2.requests.total").value, 1_550);
  assert.equal(metric(result, "r2.requests.total").status, "critical");
  assert.equal(metric(result, "r2.requests.class_a_estimated").value, 600);
  assert.equal(metric(result, "r2.requests.class_b_estimated").value, 900);
  assert.equal(metric(result, "r2.requests.class_b_estimated").status, "critical");

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.cloudflare.com/client/v4/graphql");
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.headers.authorization, "Bearer cloudflare-secret");
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.variables.accountTag, "account-id");
  assert.equal(body.variables.bucketName, "documents");
  assert.equal(body.variables.startDate, "2026-07-20T00:00:00.000Z");
  assert.match(body.query, /bucketName: \$bucketName/);
});

function operation(actionType, requests) {
  return { sum: { requests }, dimensions: { actionType } };
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
