/**
 * Org-level information: API version, governor limits, org identity.
 */

import {
  dataPath,
  resolveApiVersion,
  escapeSoql,
  type SalesforceContext,
  type SalesforceRequest,
} from "./helpers.js";
import type {
  OrgInfo,
  OrgLimits,
  QueryResponse,
  SalesforceRecord,
} from "./types.js";

export { resolveApiVersion };

/**
 * The newest API version this org supports, as a `v`-prefixed string.
 *
 * A client already resolved this at creation — `client.apiVersion` is the same
 * value without a round trip. This re-reads it from the org.
 */
export const getLatestApiVersion = (
  request: SalesforceRequest,
): Promise<string> => resolveApiVersion(request);

/**
 * The org's governor limits: how much of each resource is allocated and how much
 * is left (`DailyApiRequests`, `DataStorageMB`, and so on — the exact keys vary
 * by edition and enabled features).
 *
 * Worth checking before a large sync, so a job that would exhaust the daily API
 * allowance can back off rather than half-finish.
 */
export const getOrgLimits = (ctx: SalesforceContext): Promise<OrgLimits> =>
  ctx.request<OrgLimits>(dataPath(ctx, "/limits/"));

/**
 * Runs a SOQL query and returns the first page of results.
 *
 * Salesforce pages at 2,000 rows; when `done` is false, `nextRecordsUrl` holds
 * the next page. Use `queryAll` to follow those automatically.
 */
export const query = <T extends SalesforceRecord = SalesforceRecord>(
  ctx: SalesforceContext,
  soql: string,
): Promise<QueryResponse<T>> =>
  ctx.request<QueryResponse<T>>(
    dataPath(ctx, `/query/?q=${encodeURIComponent(soql)}`),
  );

/**
 * Runs a SOQL query and follows pagination to the end.
 *
 * @param maxRecords - safety cap. Stops early once this many rows are collected,
 *   so an unbounded query against a large object cannot run away. The returned
 *   array may therefore be shorter than the org's true result set.
 */
export const queryAll = async <T extends SalesforceRecord = SalesforceRecord>(
  ctx: SalesforceContext,
  soql: string,
  maxRecords = 10000,
): Promise<T[]> => {
  const records: T[] = [];
  let page = await query<T>(ctx, soql);

  for (;;) {
    records.push(...page.records);
    if (page.done || !page.nextRecordsUrl || records.length >= maxRecords) break;
    page = await ctx.request<QueryResponse<T>>(page.nextRecordsUrl);
  }

  return records.slice(0, maxRecords);
};

interface OrganizationRecord extends SalesforceRecord {
  Id?: string;
  Name?: string;
  IsSandbox?: boolean;
  OrganizationType?: string | null;
  InstanceName?: string | null;
  NamespacePrefix?: string | null;
  LanguageLocaleKey?: string | null;
  TrialExpirationDate?: string | null;
}

/**
 * Identity of the connected org.
 *
 * `isSandbox` is the one to branch on: the same integration code runs against a
 * client's sandbox during testing and their production org later, and behaviour
 * that should differ between the two (test record creation, notification
 * targets) has no other reliable signal.
 *
 * Requires read access to the `Organization` object.
 */
export const getOrgInfo = async (ctx: SalesforceContext): Promise<OrgInfo> => {
  const result = await query<OrganizationRecord>(
    ctx,
    "SELECT Id, Name, IsSandbox, OrganizationType, InstanceName, NamespacePrefix, LanguageLocaleKey, TrialExpirationDate FROM Organization LIMIT 1",
  );

  const record = result.records[0];
  if (!record) {
    throw new Error(
      "Salesforce returned no Organization record. The connected user may lack read access to the Organization object.",
    );
  }

  return {
    id: record.Id ?? "",
    name: record.Name ?? "",
    isSandbox: record.IsSandbox === true,
    organizationType: record.OrganizationType ?? null,
    instanceName: record.InstanceName ?? null,
    namespacePrefix: record.NamespacePrefix ?? null,
    languageLocaleKey: record.LanguageLocaleKey ?? null,
    trialExpirationDate: record.TrialExpirationDate ?? null,
  };
};

export { escapeSoql };
