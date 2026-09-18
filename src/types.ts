/**
 * Structural types for the Salesforce REST API and for the Prismatic OAuth
 * connection that carries the credentials.
 *
 * These are declared here rather than imported from `@prismatic-io/spectral` on
 * purpose: the package stays dependency-free, so it installs anywhere and can
 * never conflict with the spectral version the host integration pins. A real
 * spectral `Connection` satisfies `SalesforceConnection` structurally, so it can
 * be passed straight in with no cast.
 */

export interface SalesforceToken {
  access_token: string;
  instance_url: string;
  token_type?: string;
  issued_at?: string;
  refresh_token?: string;
  scope?: string;
  signature?: string;
  id?: string;
  id_token?: string;
}

/**
 * The shape of a Prismatic Salesforce OAuth 2.0 connection config var. Only
 * `token.access_token` and `token.instance_url` are actually read — everything
 * else is declared so a real connection assigns cleanly.
 */
export interface SalesforceConnection {
  token?: SalesforceToken;
  key?: string;
  configVarKey?: string;
  fields?: Record<string, unknown>;
  context?: Record<string, unknown>;
}

/** Explicit credentials, for callers not running inside Prismatic (tests, scripts). */
export interface SalesforceCredentials {
  instanceUrl: string;
  accessToken: string;
}

/** Anything `createSalesforceClient` accepts as its credential source. */
export type SalesforceConnectionInput =
  | SalesforceConnection
  | SalesforceCredentials;

/* ────────────────────────────── Describe results ───────────────────────────── */

/** One entry of the global describe (`/sobjects`). Lightweight — no field data. */
export interface SObjectSummary {
  name: string;
  label: string;
  labelPlural?: string;
  keyPrefix?: string | null;
  custom: boolean;
  queryable: boolean;
  createable: boolean;
  updateable: boolean;
  deletable?: boolean;
  layoutable?: boolean;
  deprecatedAndHidden: boolean;
  [key: string]: unknown;
}

export interface PicklistEntry {
  label: string | null;
  value: string;
  active: boolean;
  defaultValue: boolean;
  /**
   * Base64 bitmap marking which controlling-field values this entry is valid
   * for. Only present on dependent picklists. Decoded by `discoverPicklistValues`.
   */
  validFor?: string | null;
}

/** A field as returned by `/sobjects/{object}/describe`. */
export interface SalesforceFieldDescribe {
  name: string;
  label: string;
  type: string;
  length: number;
  createable: boolean;
  updateable: boolean;
  custom: boolean;
  nillable: boolean;
  defaultedOnCreate: boolean;
  externalId: boolean;
  unique: boolean;
  autoNumber: boolean;
  calculated: boolean;
  referenceTo: string[];
  relationshipName: string | null;
  picklistValues?: PicklistEntry[];
  /** Name of the controlling field, when this picklist is dependent. */
  controllerName?: string | null;
  dependentPicklist?: boolean;
  restrictedPicklist?: boolean;
  [key: string]: unknown;
}

export interface RecordTypeInfo {
  name: string;
  developerName?: string;
  recordTypeId: string;
  available: boolean;
  defaultRecordTypeMapping: boolean;
  master: boolean;
  [key: string]: unknown;
}

/** A child (reverse) relationship pointing at the described object. */
export interface ChildRelationship {
  childSObject: string;
  field: string;
  relationshipName: string | null;
  cascadeDelete?: boolean;
  deprecatedAndHidden?: boolean;
  [key: string]: unknown;
}

/** The full result of `/sobjects/{object}/describe`. */
export interface SObjectDescribe {
  name: string;
  label: string;
  labelPlural?: string;
  custom: boolean;
  queryable: boolean;
  createable: boolean;
  updateable: boolean;
  deletable?: boolean;
  keyPrefix?: string | null;
  fields: SalesforceFieldDescribe[];
  recordTypeInfos?: RecordTypeInfo[];
  childRelationships?: ChildRelationship[];
  [key: string]: unknown;
}

/* ─────────────────────────── Trimmed / derived shapes ──────────────────────── */

/**
 * The subset of a field describe that config wizards actually need. Full
 * describes are large — a single object can be hundreds of KB — and Prismatic
 * data sources serialize their result into the config var, so returning
 * everything is wasteful. Reach for `describeObject` when you need the raw field.
 */
export interface FieldSummary {
  name: string;
  label: string;
  type: string;
  length: number;
  createable: boolean;
  updateable: boolean;
  custom: boolean;
  nillable: boolean;
  externalId: boolean;
  referenceTo: string[];
  relationshipName: string | null;
}

/** A picklist value, with its dependency on a controlling field resolved. */
export interface PicklistValue {
  label: string;
  value: string;
  active: boolean;
  defaultValue: boolean;
  /**
   * Controlling-field values this entry is valid for, decoded from `validFor`.
   * `undefined` on an independent picklist — which is different from `[]`, an
   * entry valid for no controlling value at all.
   */
  validFor?: string[];
}

export interface PicklistResult {
  object: string;
  field: string;
  /** Name of the controlling field, or `null` when the picklist is independent. */
  controllingField: string | null;
  /** Values of the controlling field, in the index order `validFor` bitmaps use. */
  controllingValues: string[];
  values: PicklistValue[];
}

/** A lookup/master-detail field on the object, pointing at a parent. */
export interface ParentRelationship {
  /** The field holding the reference, e.g. `AccountId`. */
  field: string;
  label: string;
  /** The relationship name used in SOQL traversal, e.g. `Account`. */
  relationshipName: string | null;
  /** Objects this field may point at — more than one for a polymorphic field. */
  referenceTo: string[];
  /** True when the field may reference several different objects (e.g. `OwnerId`). */
  polymorphic: boolean;
  required: boolean;
  custom: boolean;
}

export interface ObjectRelationships {
  object: string;
  /** Objects this one points at, via its own lookup/master-detail fields. */
  parents: ParentRelationship[];
  /** Objects pointing back at this one. */
  children: ChildRelationship[];
}

/* ─────────────────────────────── Environment ───────────────────────────────── */

export interface ApiVersion {
  label: string;
  url: string;
  version: string;
}

/** One entry of the Limits API: how much of a given resource is left. */
export interface OrgLimit {
  Max: number;
  Remaining: number;
  [key: string]: unknown;
}

/** The Limits API response. Keys vary by org edition and enabled features. */
export type OrgLimits = Record<string, OrgLimit>;

export interface OrgInfo {
  id: string;
  name: string;
  /** `true` for a sandbox — worth branching on when the same code runs against both. */
  isSandbox: boolean;
  /** Edition, e.g. `Enterprise Edition`. Salesforce calls this `OrganizationType`. */
  organizationType: string | null;
  instanceName: string | null;
  namespacePrefix: string | null;
  languageLocaleKey: string | null;
  /** Set only on trial orgs. */
  trialExpirationDate: string | null;
}

/** A page of SOQL results. */
export interface QueryResponse<T = SalesforceRecord> {
  totalSize: number;
  /** `false` when more rows remain — Salesforce pages SOQL at 2,000 rows. */
  done: boolean;
  /** Path to the next page, present only while `done` is false. */
  nextRecordsUrl?: string;
  records: T[];
}

export interface SalesforceRecord {
  attributes?: { type: string; url: string };
  [key: string]: unknown;
}
