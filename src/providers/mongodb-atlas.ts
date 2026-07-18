import { createUsageMetric } from "../thresholds.js";
import type { CommonCollectorOptions, ProviderUsageResult } from "../types.js";
import {
  asArray,
  asRecord,
  bytesFromGigabytes,
  createBasicAuthHeader,
  getFetch,
  readProviderJson,
  toNumber,
} from "../utils.js";

export interface MongoDBAtlasCollectorOptions extends CommonCollectorOptions {
  projectId: string;
  clientId?: string;
  clientSecret?: string;
  accessToken?: string;
  processId?: string;
  endpoint?: string;
  tokenEndpoint?: string;
  period?: string;
  granularity?: string;
  limits?: {
    storageBytes?: number;
    connections?: number;
    operationsPerSecond?: number;
    networkBytesIn?: number;
    networkBytesOut?: number;
  };
}

export interface MongoDBAtlasMeasurement {
  name?: unknown;
  units?: unknown;
  dataPoints?: unknown;
  [key: string]: unknown;
}

export interface MongoDBAtlasMeasurementsPayload {
  end?: unknown;
  granularity?: unknown;
  groupId?: unknown;
  measurements?: unknown;
  processId?: unknown;
  start?: unknown;
  [key: string]: unknown;
}

export interface MongoDBAtlasRawResult {
  process: Record<string, unknown>;
  measurements: MongoDBAtlasMeasurementsPayload;
}

const DEFAULT_ATLAS_LIMITS = {
  storageBytes: bytesFromGigabytes(0.5),
  connections: 500,
  operationsPerSecond: 100,
  networkBytesIn: bytesFromGigabytes(10),
  networkBytesOut: bytesFromGigabytes(10),
};

const ATLAS_MEASUREMENTS = [
  "DB_STORAGE_TOTAL",
  "CONNECTIONS",
  "NETWORK_BYTES_IN",
  "NETWORK_BYTES_OUT",
  "OPCOUNTER_QUERY",
  "OPCOUNTER_INSERT",
  "OPCOUNTER_UPDATE",
  "OPCOUNTER_DELETE",
] as const;

const DEFAULT_ENDPOINT = "https://cloud.mongodb.com/api/atlas/v2";
const DEFAULT_TOKEN_ENDPOINT = "https://cloud.mongodb.com/api/oauth/token";
const ATLAS_ACCEPT = "application/vnd.atlas.2025-03-12+json";

export async function collectMongoDBAtlasUsage(
  options: MongoDBAtlasCollectorOptions,
): Promise<ProviderUsageResult<MongoDBAtlasRawResult>> {
  const fetchImpl = getFetch(options.fetchImpl);
  const accessToken =
    options.accessToken ?? (await requestMongoDBAtlasAccessToken(options));
  const endpoint = (options.endpoint ?? DEFAULT_ENDPOINT).replace(/\/$/, "");
  const headers = {
    accept: ATLAS_ACCEPT,
    authorization: `Bearer ${accessToken}`,
  };

  let process: Record<string, unknown>;

  if (options.processId) {
    process = { id: options.processId };
  } else {
    const processes = await readProviderJson<unknown>(
      "mongodb-atlas",
      await fetchImpl(
        `${endpoint}/groups/${encodeURIComponent(options.projectId)}/processes?itemsPerPage=500`,
        { headers },
      ),
    );
    process = selectMongoDBAtlasProcess(processes);
  }

  const processId = typeof process.id === "string" ? process.id : undefined;
  if (!processId) {
    throw new Error("MongoDB Atlas returned no usable process ID");
  }

  const query = new URLSearchParams({
    period: options.period ?? "P7D",
    granularity: options.granularity ?? "PT1H",
  });
  for (const measurement of ATLAS_MEASUREMENTS) {
    query.append("m", measurement);
  }

  const measurements = await readProviderJson<MongoDBAtlasMeasurementsPayload>(
    "mongodb-atlas",
    await fetchImpl(
      `${endpoint}/groups/${encodeURIComponent(options.projectId)}/processes/${encodeURIComponent(processId)}/measurements?${query.toString()}`,
      { headers },
    ),
  );

  return createMongoDBAtlasUsageMetrics({ process, measurements }, options);
}

export function createMongoDBAtlasUsageMetrics(
  raw: MongoDBAtlasRawResult,
  options: Pick<
    MongoDBAtlasCollectorOptions,
    "limits" | "thresholds" | "now"
  > = {},
): ProviderUsageResult<MongoDBAtlasRawResult> {
  const limits = { ...DEFAULT_ATLAS_LIMITS, ...options.limits };
  const updatedAt = (options.now ?? new Date()).toISOString();
  const measurements = measurementMap(raw.measurements.measurements);
  const metadata = {
    processId: raw.process.id ?? raw.measurements.processId,
    processType: raw.process.typeName,
    replicaSetName: raw.process.replicaSetName,
    period:
      raw.measurements.start && raw.measurements.end
        ? `${String(raw.measurements.start)}/${String(raw.measurements.end)}`
        : undefined,
    granularity: raw.measurements.granularity,
  };

  const operationsPerSecond = [
    "OPCOUNTER_QUERY",
    "OPCOUNTER_INSERT",
    "OPCOUNTER_UPDATE",
    "OPCOUNTER_DELETE",
  ].reduce(
    (total, name) => total + latestMeasurementValue(measurements.get(name)),
    0,
  );

  return {
    provider: "mongodb-atlas",
    metrics: [
      createUsageMetric({
        provider: "mongodb-atlas",
        key: "atlas.storage.bytes",
        label: "MongoDB Atlas logical storage",
        value: measurementValueInBytes(measurements.get("DB_STORAGE_TOTAL")),
        unit: "bytes",
        period: "instant",
        limit: limits.storageBytes,
        source: "mongodb-atlas-admin-api:process-measurements",
        updatedAt,
        metadata,
        thresholds: options.thresholds,
      }),
      createUsageMetric({
        provider: "mongodb-atlas",
        key: "atlas.connections",
        label: "MongoDB Atlas connections",
        value: latestMeasurementValue(measurements.get("CONNECTIONS")),
        unit: "count",
        period: "instant",
        limit: limits.connections,
        source: "mongodb-atlas-admin-api:process-measurements",
        updatedAt,
        metadata,
        thresholds: options.thresholds,
      }),
      createUsageMetric({
        provider: "mongodb-atlas",
        key: "atlas.operations.per_second",
        label: "MongoDB Atlas operations per second",
        value: operationsPerSecond,
        unit: "operations_per_second",
        period: "instant",
        limit: limits.operationsPerSecond,
        source: "mongodb-atlas-admin-api:process-measurements",
        updatedAt,
        metadata,
        thresholds: options.thresholds,
      }),
      createUsageMetric({
        provider: "mongodb-atlas",
        key: "atlas.network.in_bytes",
        label: "MongoDB Atlas network transfer in",
        value: measurementRangeBytes(
          measurements.get("NETWORK_BYTES_IN"),
          raw.measurements,
        ),
        unit: "bytes",
        period: "range",
        limit: limits.networkBytesIn,
        source: "mongodb-atlas-admin-api:process-measurements",
        updatedAt,
        metadata,
        thresholds: options.thresholds,
      }),
      createUsageMetric({
        provider: "mongodb-atlas",
        key: "atlas.network.out_bytes",
        label: "MongoDB Atlas network transfer out",
        value: measurementRangeBytes(
          measurements.get("NETWORK_BYTES_OUT"),
          raw.measurements,
        ),
        unit: "bytes",
        period: "range",
        limit: limits.networkBytesOut,
        source: "mongodb-atlas-admin-api:process-measurements",
        updatedAt,
        metadata,
        thresholds: options.thresholds,
      }),
    ],
    raw,
  };
}

async function requestMongoDBAtlasAccessToken(
  options: MongoDBAtlasCollectorOptions,
): Promise<string> {
  if (!options.clientId || !options.clientSecret) {
    throw new Error(
      "MongoDB Atlas requires accessToken or both clientId and clientSecret",
    );
  }

  const fetchImpl = getFetch(options.fetchImpl);
  const payload = await readProviderJson<Record<string, unknown>>(
    "mongodb-atlas",
    await fetchImpl(options.tokenEndpoint ?? DEFAULT_TOKEN_ENDPOINT, {
      method: "POST",
      headers: {
        accept: "application/json",
        authorization: createBasicAuthHeader(
          options.clientId,
          options.clientSecret,
        ),
        "content-type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
    }),
  );

  if (typeof payload.access_token !== "string" || !payload.access_token) {
    throw new Error(
      "MongoDB Atlas OAuth response did not include an access token",
    );
  }

  return payload.access_token;
}

function selectMongoDBAtlasProcess(payload: unknown): Record<string, unknown> {
  const processes = asArray(asRecord(payload)?.results)
    .map(asRecord)
    .filter((process): process is Record<string, unknown> => Boolean(process));
  const primary = processes.find(
    (process) =>
      process.typeName === "REPLICA_PRIMARY" ||
      process.typeName === "SHARD_PRIMARY",
  );
  const process =
    primary ??
    processes.find((candidate) => candidate.typeName !== "NO_DATA");

  if (!process) {
    throw new Error("MongoDB Atlas project has no active MongoDB processes");
  }

  return process;
}

function measurementMap(value: unknown): Map<string, MongoDBAtlasMeasurement> {
  const result = new Map<string, MongoDBAtlasMeasurement>();
  for (const item of asArray(value)) {
    const measurement = asRecord(item) as MongoDBAtlasMeasurement | undefined;
    if (measurement && typeof measurement.name === "string") {
      result.set(measurement.name, measurement);
    }
  }
  return result;
}

function measurementPoints(measurement?: MongoDBAtlasMeasurement): Array<{
  timestamp?: string;
  value: number;
}> {
  return asArray(measurement?.dataPoints)
    .map(asRecord)
    .map((point) => ({
      timestamp:
        typeof point?.timestamp === "string" ? point.timestamp : undefined,
      value: toNumber(point?.value),
    }))
    .filter(
      (point): point is { timestamp: string | undefined; value: number } =>
        typeof point.value === "number",
    );
}

function latestMeasurementValue(measurement?: MongoDBAtlasMeasurement): number {
  const points = measurementPoints(measurement);
  return points[points.length - 1]?.value ?? 0;
}

function measurementValueInBytes(measurement?: MongoDBAtlasMeasurement): number {
  const value = latestMeasurementValue(measurement);
  switch (measurement?.units) {
    case "GIGABYTES":
      return bytesFromGigabytes(value);
    case "MEGABYTES":
      return value * 1024 * 1024;
    case "KILOBYTES":
      return value * 1024;
    default:
      return value;
  }
}

function measurementRangeBytes(
  measurement: MongoDBAtlasMeasurement | undefined,
  payload: MongoDBAtlasMeasurementsPayload,
): number {
  const points = measurementPoints(measurement);
  if (measurement?.units !== "BYTES_PER_SECOND") {
    return points.reduce((total, point) => total + point.value, 0);
  }

  const fallbackSeconds = isoDurationSeconds(payload.granularity) ?? 0;
  return points.reduce((total, point, index) => {
    const currentTime = point.timestamp
      ? Date.parse(point.timestamp)
      : Number.NaN;
    const nextTimestamp = points[index + 1]?.timestamp;
    const nextTime = nextTimestamp ? Date.parse(nextTimestamp) : Number.NaN;
    const seconds =
      Number.isFinite(currentTime) && Number.isFinite(nextTime)
        ? Math.max(0, (nextTime - currentTime) / 1000)
        : fallbackSeconds;
    return total + point.value * seconds;
  }, 0);
}

function isoDurationSeconds(value: unknown): number | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const match =
    /^P(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(
      value,
    );
  if (!match) {
    return undefined;
  }
  return (
    Number(match[1] ?? 0) * 86400 +
    Number(match[2] ?? 0) * 3600 +
    Number(match[3] ?? 0) * 60 +
    Number(match[4] ?? 0)
  );
}
