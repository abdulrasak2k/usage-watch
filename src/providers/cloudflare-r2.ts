import { createUsageMetric } from "../thresholds.js";
import type { CommonCollectorOptions, ProviderUsageResult } from "../types.js";
import {
  asArray,
  asRecord,
  bytesFromGigabytes,
  getFetch,
  readProviderJson,
  toIsoString,
  toNumber,
} from "../utils.js";

export interface CloudflareR2CollectorOptions extends CommonCollectorOptions {
  accountId: string;
  apiToken: string;
  bucketName?: string;
  start: Date | string | number;
  end: Date | string | number;
  endpoint?: string;
  limits?: {
    storageBytes?: number;
    classARequests?: number;
    classBRequests?: number;
    totalRequests?: number;
  };
}

interface CloudflareGraphQLResponse {
  data?: {
    viewer?: {
      accounts?: Array<{
        r2OperationsAdaptiveGroups?: Array<{
          sum?: {
            requests?: number;
          };
          dimensions?: {
            actionType?: string;
          };
        }>;
        r2StorageAdaptiveGroups?: Array<{
          max?: {
            objectCount?: number;
            uploadCount?: number;
            payloadSize?: number;
            metadataSize?: number;
          };
          dimensions?: {
            datetime?: string;
          };
        }>;
      }>;
    };
  };
  errors?: Array<{
    message?: string;
  }>;
}

const DEFAULT_R2_LIMITS = {
  storageBytes: bytesFromGigabytes(10),
  classARequests: 1_000_000,
  classBRequests: 10_000_000,
};

const CLASS_A_ACTION_PARTS = [
  "copy",
  "create",
  "delete",
  "list",
  "multipart",
  "put",
  "upload",
];

const CLASS_B_ACTION_PARTS = ["get", "head"];

export async function collectCloudflareR2Usage(
  options: CloudflareR2CollectorOptions,
): Promise<ProviderUsageResult<CloudflareGraphQLResponse>> {
  const fetchImpl = getFetch(options.fetchImpl);
  const endpoint = options.endpoint ?? "https://api.cloudflare.com/client/v4/graphql";
  const now = options.now ?? new Date();
  const updatedAt = now.toISOString();
  const bucketFilter = options.bucketName ? ", bucketName: $bucketName" : "";
  const query = `
    query BnsR2Usage(
      $accountTag: string!
      $startDate: Time
      $endDate: Time
      ${options.bucketName ? "$bucketName: string" : ""}
    ) {
      viewer {
        accounts(filter: { accountTag: $accountTag }) {
          r2OperationsAdaptiveGroups(
            limit: 10000
            filter: { datetime_geq: $startDate, datetime_leq: $endDate${bucketFilter} }
          ) {
            sum {
              requests
            }
            dimensions {
              actionType
            }
          }
          r2StorageAdaptiveGroups(
            limit: 10000
            filter: { datetime_geq: $startDate, datetime_leq: $endDate${bucketFilter} }
            orderBy: [datetime_DESC]
          ) {
            max {
              objectCount
              uploadCount
              payloadSize
              metadataSize
            }
            dimensions {
              datetime
            }
          }
        }
      }
    }
  `;

  const variables: Record<string, string> = {
    accountTag: options.accountId,
    startDate: toIsoString(options.start),
    endDate: toIsoString(options.end),
  };

  if (options.bucketName) {
    variables.bucketName = options.bucketName;
  }

  const payload = await readProviderJson<CloudflareGraphQLResponse>(
    "cloudflare-r2",
    await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${options.apiToken}`,
      },
      body: JSON.stringify({ query, variables }),
    }),
  );

  const graphqlErrors = payload.errors
    ?.map((error) => error.message)
    .filter((message): message is string => Boolean(message));

  const account = payload.data?.viewer?.accounts?.[0];
  const operations = account?.r2OperationsAdaptiveGroups ?? [];
  const storageSnapshot = account?.r2StorageAdaptiveGroups?.[0];
  const limits = { ...DEFAULT_R2_LIMITS, ...options.limits };

  let totalRequests = 0;
  let classARequests = 0;
  let classBRequests = 0;

  const metrics = operations.map((operation) => {
    const actionType = operation.dimensions?.actionType ?? "unknown";
    const requests = operation.sum?.requests ?? 0;
    totalRequests += requests;

    if (isClassARequest(actionType)) {
      classARequests += requests;
    }

    if (isClassBRequest(actionType)) {
      classBRequests += requests;
    }

    return createUsageMetric({
      provider: "cloudflare-r2",
      key: `r2.requests.${normalizeKey(actionType)}`,
      label: `R2 ${actionType} requests`,
      value: requests,
      unit: "requests",
      period: "range",
      source: "cloudflare-graphql:r2OperationsAdaptiveGroups",
      updatedAt,
      metadata: {
        bucketName: options.bucketName,
        actionType,
      },
      thresholds: options.thresholds,
    });
  });

  metrics.unshift(
    createUsageMetric({
      provider: "cloudflare-r2",
      key: "r2.storage.payload_bytes",
      label: "R2 stored file payload",
      value: storageSnapshot?.max?.payloadSize ?? 0,
      unit: "bytes",
      period: "instant",
      limit: limits.storageBytes,
      source: "cloudflare-graphql:r2StorageAdaptiveGroups",
      updatedAt,
      metadata: {
        bucketName: options.bucketName,
        snapshotAt: storageSnapshot?.dimensions?.datetime,
      },
      thresholds: options.thresholds,
    }),
    createUsageMetric({
      provider: "cloudflare-r2",
      key: "r2.objects",
      label: "R2 object count",
      value: storageSnapshot?.max?.objectCount ?? 0,
      unit: "count",
      period: "instant",
      source: "cloudflare-graphql:r2StorageAdaptiveGroups",
      updatedAt,
      metadata: {
        bucketName: options.bucketName,
      },
      thresholds: options.thresholds,
    }),
    createUsageMetric({
      provider: "cloudflare-r2",
      key: "r2.requests.total",
      label: "R2 total requests",
      value: totalRequests,
      unit: "requests",
      period: "range",
      limit: limits.totalRequests,
      source: "cloudflare-graphql:r2OperationsAdaptiveGroups",
      updatedAt,
      metadata: {
        bucketName: options.bucketName,
      },
      thresholds: options.thresholds,
    }),
    createUsageMetric({
      provider: "cloudflare-r2",
      key: "r2.requests.class_a_estimated",
      label: "R2 Class A requests estimated",
      value: classARequests,
      unit: "requests",
      period: "range",
      limit: limits.classARequests,
      source: "cloudflare-graphql:r2OperationsAdaptiveGroups",
      updatedAt,
      metadata: {
        bucketName: options.bucketName,
        note: "Estimated from actionType names; verify for billing-critical reporting.",
      },
      thresholds: options.thresholds,
    }),
    createUsageMetric({
      provider: "cloudflare-r2",
      key: "r2.requests.class_b_estimated",
      label: "R2 Class B requests estimated",
      value: classBRequests,
      unit: "requests",
      period: "range",
      limit: limits.classBRequests,
      source: "cloudflare-graphql:r2OperationsAdaptiveGroups",
      updatedAt,
      metadata: {
        bucketName: options.bucketName,
        note: "Estimated from actionType names; verify for billing-critical reporting.",
      },
      thresholds: options.thresholds,
    }),
  );

  return {
    provider: "cloudflare-r2",
    metrics,
    errors: graphqlErrors,
    raw: payload,
  };
}

export function extractCloudflareR2MetricsFromGraphQL(
  payload: unknown,
  options: Pick<CloudflareR2CollectorOptions, "bucketName" | "limits" | "thresholds" | "now"> = {},
): ProviderUsageResult<unknown> {
  const account = asRecord(
    asArray(
      asRecord(asRecord(asRecord(payload)?.data)?.viewer)?.accounts,
    )[0],
  );
  const operations = asArray(account?.r2OperationsAdaptiveGroups).map(asRecord);
  const storageSnapshot = asRecord(asArray(account?.r2StorageAdaptiveGroups)[0]);
  const storageMax = asRecord(storageSnapshot?.max);
  const limits = { ...DEFAULT_R2_LIMITS, ...options.limits };
  const updatedAt = (options.now ?? new Date()).toISOString();
  let totalRequests = 0;

  const metrics = operations
    .filter((operation): operation is Record<string, unknown> => Boolean(operation))
    .map((operation) => {
      const dimensions = asRecord(operation.dimensions);
      const sum = asRecord(operation.sum);
      const actionType =
        typeof dimensions?.actionType === "string"
          ? dimensions.actionType
          : "unknown";
      const requests = toNumber(sum?.requests) ?? 0;
      totalRequests += requests;

      return createUsageMetric({
        provider: "cloudflare-r2",
        key: `r2.requests.${normalizeKey(actionType)}`,
        label: `R2 ${actionType} requests`,
        value: requests,
        unit: "requests",
        period: "range",
        source: "cloudflare-graphql:r2OperationsAdaptiveGroups",
        updatedAt,
        metadata: {
          bucketName: options.bucketName,
          actionType,
        },
        thresholds: options.thresholds,
      });
    });

  metrics.unshift(
    createUsageMetric({
      provider: "cloudflare-r2",
      key: "r2.storage.payload_bytes",
      label: "R2 stored file payload",
      value: toNumber(storageMax?.payloadSize) ?? 0,
      unit: "bytes",
      period: "instant",
      limit: limits.storageBytes,
      source: "cloudflare-graphql:r2StorageAdaptiveGroups",
      updatedAt,
      thresholds: options.thresholds,
    }),
    createUsageMetric({
      provider: "cloudflare-r2",
      key: "r2.requests.total",
      label: "R2 total requests",
      value: totalRequests,
      unit: "requests",
      period: "range",
      limit: limits.totalRequests,
      source: "cloudflare-graphql:r2OperationsAdaptiveGroups",
      updatedAt,
      thresholds: options.thresholds,
    }),
  );

  return {
    provider: "cloudflare-r2",
    metrics,
    raw: payload,
  };
}

function isClassARequest(actionType: string): boolean {
  const normalized = actionType.toLowerCase();
  return CLASS_A_ACTION_PARTS.some((part) => normalized.includes(part));
}

function isClassBRequest(actionType: string): boolean {
  const normalized = actionType.toLowerCase();
  return CLASS_B_ACTION_PARTS.some((part) => normalized.includes(part));
}

function normalizeKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}
