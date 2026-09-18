/**
 * The client: one object holding the resolved credentials and API version, with
 * every discovery, relationship and environment method bound to it.
 */

import {
  createRequester,
  getConnectionTokens,
  resolveApiVersion,
  type SalesforceContext,
  type SalesforceRequest,
} from "./helpers.js";
import {
  describeObject,
  discoverCreateableFields,
  discoverEnvironmentObjects,
  discoverExternalIdFields,
  discoverObjectFields,
  discoverObjectRecordTypes,
  discoverPicklistValues,
  discoverRequiredFields,
  discoverUpdateableFields,
  getObjectLabelMap,
  type DiscoverObjectsOptions,
} from "./discovery.js";
import {
  discoverObjectRelationships,
  discoverRelatedObjects,
  type RelationshipOptions,
} from "./relationships.js";
import {
  getOrgInfo,
  getOrgLimits,
  query,
  queryAll,
} from "./environment.js";
import type {
  FieldSummary,
  ObjectRelationships,
  OrgInfo,
  OrgLimits,
  PicklistResult,
  QueryResponse,
  RecordTypeInfo,
  SObjectDescribe,
  SObjectSummary,
  SalesforceConnectionInput,
  SalesforceRecord,
} from "./types.js";

export interface CreateClientOptions {
  /**
   * Pin an API version (e.g. `v62.0` or `62.0`) instead of asking the org for
   * its newest. Skips a round trip, at the cost of going stale — Salesforce
   * supports roughly the last three years of versions.
   */
  apiVersion?: string;
  /** Inject a fetch implementation, for tests or a proxied runtime. */
  fetch?: typeof fetch;
}

export interface SalesforceClient extends SalesforceContext {
  readonly instanceUrl: string;
  readonly apiVersion: string;
  readonly request: SalesforceRequest;

  /* Discovery */
  discoverEnvironmentObjects(
    options?: DiscoverObjectsOptions,
  ): Promise<SObjectSummary[]>;
  describeObject(objectName: string): Promise<SObjectDescribe>;
  discoverObjectFields(objectName: string): Promise<FieldSummary[]>;
  discoverUpdateableFields(objectName: string): Promise<FieldSummary[]>;
  discoverCreateableFields(objectName: string): Promise<FieldSummary[]>;
  discoverRequiredFields(objectName: string): Promise<FieldSummary[]>;
  discoverExternalIdFields(objectName: string): Promise<FieldSummary[]>;
  discoverObjectRecordTypes(
    objectName: string,
    includeUnavailable?: boolean,
  ): Promise<RecordTypeInfo[]>;
  discoverPicklistValues(
    objectName: string,
    fieldName: string,
  ): Promise<PicklistResult>;
  getObjectLabelMap(
    options?: DiscoverObjectsOptions,
  ): Promise<Record<string, string>>;

  /* Relationships */
  discoverObjectRelationships(
    objectName: string,
    options?: RelationshipOptions,
  ): Promise<ObjectRelationships>;
  discoverRelatedObjects(
    objectName: string,
    options?: RelationshipOptions,
  ): Promise<string[]>;

  /* Environment */
  getOrgLimits(): Promise<OrgLimits>;
  getOrgInfo(): Promise<OrgInfo>;
  query<T extends SalesforceRecord = SalesforceRecord>(
    soql: string,
  ): Promise<QueryResponse<T>>;
  queryAll<T extends SalesforceRecord = SalesforceRecord>(
    soql: string,
    maxRecords?: number,
  ): Promise<T[]>;
}

const normalizeVersion = (version: string): string =>
  version.startsWith("v") ? version : `v${version}`;

/**
 * Builds a client from a Prismatic Salesforce OAuth connection, or from
 * explicit `{ instanceUrl, accessToken }` credentials.
 *
 * Async because it resolves the org's newest API version on creation — once per
 * client rather than once per call, which is what the version lookup would
 * otherwise cost. Pass `apiVersion` to skip it.
 *
 * ```ts
 * const sf = await createSalesforceClient(connection);
 * const objects = await sf.discoverEnvironmentObjects();
 * const fields = await sf.discoverUpdateableFields("Account");
 * ```
 *
 * Describe results are not cached: every method call is a live request. When a
 * config-wizard page needs several views of one object, call `describeObject`
 * once and derive from it.
 */
export const createSalesforceClient = async (
  connection: SalesforceConnectionInput,
  options: CreateClientOptions = {},
): Promise<SalesforceClient> => {
  const credentials = getConnectionTokens(connection);
  const request = createRequester(credentials, options.fetch ?? fetch);

  const apiVersion = options.apiVersion
    ? normalizeVersion(options.apiVersion)
    : await resolveApiVersion(request);

  const ctx: SalesforceContext = {
    instanceUrl: credentials.instanceUrl,
    apiVersion,
    request,
  };

  return {
    ...ctx,

    discoverEnvironmentObjects: (opts) => discoverEnvironmentObjects(ctx, opts),
    describeObject: (objectName) => describeObject(ctx, objectName),
    discoverObjectFields: (objectName) => discoverObjectFields(ctx, objectName),
    discoverUpdateableFields: (objectName) =>
      discoverUpdateableFields(ctx, objectName),
    discoverCreateableFields: (objectName) =>
      discoverCreateableFields(ctx, objectName),
    discoverRequiredFields: (objectName) =>
      discoverRequiredFields(ctx, objectName),
    discoverExternalIdFields: (objectName) =>
      discoverExternalIdFields(ctx, objectName),
    discoverObjectRecordTypes: (objectName, includeUnavailable) =>
      discoverObjectRecordTypes(ctx, objectName, includeUnavailable),
    discoverPicklistValues: (objectName, fieldName) =>
      discoverPicklistValues(ctx, objectName, fieldName),
    getObjectLabelMap: (opts) => getObjectLabelMap(ctx, opts),

    discoverObjectRelationships: (objectName, opts) =>
      discoverObjectRelationships(ctx, objectName, opts),
    discoverRelatedObjects: (objectName, opts) =>
      discoverRelatedObjects(ctx, objectName, opts),

    getOrgLimits: () => getOrgLimits(ctx),
    getOrgInfo: () => getOrgInfo(ctx),
    query: (soql) => query(ctx, soql),
    queryAll: (soql, maxRecords) => queryAll(ctx, soql, maxRecords),
  };
};
