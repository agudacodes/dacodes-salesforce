/**
 * @dacodes/salesforce — helpers for building Prismatic Salesforce integrations.
 *
 * The usual entry point is `createSalesforceClient`, which takes the Prismatic
 * Salesforce OAuth connection config var and returns a client with every method
 * bound to it. The standalone functions are exported too, for callers that
 * would rather pass a context around.
 */

export { createSalesforceClient } from "./client.js";
export type { SalesforceClient, CreateClientOptions } from "./client.js";

export {
  SalesforceApiError,
  assertApiName,
  createRequester,
  dataPath,
  escapeSoql,
  getConnectionTokens,
  resolveApiVersion,
} from "./helpers.js";
export type { SalesforceContext, SalesforceRequest } from "./helpers.js";

export {
  decodeValidFor,
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
  toFieldSummary,
} from "./discovery.js";
export type { DiscoverObjectsOptions } from "./discovery.js";

export {
  discoverChildRelationships,
  discoverObjectRelationships,
  discoverParentRelationships,
  discoverRelatedObjects,
} from "./relationships.js";
export type { RelationshipOptions } from "./relationships.js";

export {
  getLatestApiVersion,
  getOrgInfo,
  getOrgLimits,
  query,
  queryAll,
} from "./environment.js";

export type * from "./types.js";
