import assert from "node:assert/strict";
import test from "node:test";

import {
  createUsageMetric,
  evaluateUsageStatus,
  normalizeThresholds,
} from "../dist/index.js";

test("evaluates default and custom threshold boundaries", () => {
  assert.equal(evaluateUsageStatus(undefined, 100), "unknown");
  assert.equal(evaluateUsageStatus(Number.NaN, 100), "unknown");
  assert.equal(evaluateUsageStatus(74, 100), "ok");
  assert.equal(evaluateUsageStatus(75, 100), "warning");
  assert.equal(evaluateUsageStatus(90, 100), "critical");
  assert.equal(
    evaluateUsageStatus(60, 100, { warning: 0.5, critical: 0.8 }),
    "warning",
  );
});

test("handles missing, negative, and zero limits", () => {
  assert.equal(evaluateUsageStatus(10), "ok");
  assert.equal(evaluateUsageStatus(10, -1), "ok");
  assert.equal(evaluateUsageStatus(0, 0), "ok");
  assert.equal(evaluateUsageStatus(0.01, 0), "critical");
});

test("normalizes partial thresholds and creates stable metrics", () => {
  assert.deepEqual(normalizeThresholds({ warning: 0.6 }), {
    warning: 0.6,
    critical: 0.9,
  });

  const metric = createUsageMetric({
    provider: "custom",
    key: "custom.requests",
    label: "Custom requests",
    value: 8,
    unit: "requests",
    period: "day",
    limit: 10,
    source: "test",
    updatedAt: "2026-07-21T12:00:00.000Z",
    metadata: { environment: "test" },
  });

  assert.deepEqual(metric, {
    provider: "custom",
    key: "custom.requests",
    label: "Custom requests",
    value: 8,
    unit: "requests",
    period: "day",
    limit: 10,
    status: "warning",
    source: "test",
    updatedAt: "2026-07-21T12:00:00.000Z",
    metadata: { environment: "test" },
  });
});
