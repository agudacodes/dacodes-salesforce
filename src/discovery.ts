/**
 * Discovery: what is in an org, and what a given object looks like.
 *
 * These back config-wizard data sources, where the point is to show an admin a
 * usable list of objects and fields without them hand-typing API names.
 *
 * Note: describes are not cached. Each call is a live request, so a wizard page
 * that needs several views of the same object is better served by calling
 * `describeObject` once and deriving from it.
 */

import {
  assertApiName,
  dataPath,
  type SalesforceContext,
} from "./helpers.js";
import type {
  FieldSummary,
  PicklistEntry,
  PicklistResult,
  PicklistValue,
  RecordTypeInfo,
  SObjectDescribe,
  SObjectSummary,
  SalesforceFieldDescribe,
} from "./types.js";

export interface DiscoverObjectsOptions {
  /**
   * Include objects that cannot be queried, and ones Salesforce marks
   * deprecated and hidden. Off by default: a raw global describe returns 800+
   * entries in a typical org and most are unusable in a config wizard.
   */
  includeAll?: boolean;
  /** Return only custom objects (`__c`). */
  customOnly?: boolean;
  /** Return only objects that accept new records. */
  createableOnly?: boolean;
}

/**
 * Lists the objects in the org, filtered down to what is actually usable.
 *
 * Results are sorted by label so they can be dropped straight into a picklist.
 */
export const discoverEnvironmentObjects = async (
  ctx: SalesforceContext,
  options: DiscoverObjectsOptions = {},
): Promise<SObjectSummary[]> => {
  const { sobjects } = await ctx.request<{ sobjects: SObjectSummary[] }>(
    dataPath(ctx, "/sobjects/"),
  );

  const objects = sobjects ?? [];

  const filtered = objects.filter((object) => {
    if (!options.includeAll) {
      if (object.deprecatedAndHidden) return false;
      if (!object.queryable) return false;
    }
    if (options.customOnly && !object.custom) return false;
    if (options.createableOnly && !object.createable) return false;
    return true;
  });

  return filtered.sort((a, b) =>
    (a.label ?? a.name).localeCompare(b.label ?? b.name),
  );
};

/** The raw, full describe for an object. Large — prefer a narrower method. */
export const describeObject = async (
  ctx: SalesforceContext,
  objectName: string,
): Promise<SObjectDescribe> => {
  assertApiName(objectName, "object name");
  return ctx.request<SObjectDescribe>(
    dataPath(ctx, `/sobjects/${objectName}/describe`),
  );
};

/** Trims a raw field describe down to what a config wizard needs. */
export const toFieldSummary = (field: SalesforceFieldDescribe): FieldSummary => ({
  name: field.name,
  label: field.label,
  type: field.type,
  length: field.length,
  createable: field.createable,
  updateable: field.updateable,
  custom: field.custom,
  nillable: field.nillable,
  externalId: field.externalId,
  referenceTo: field.referenceTo ?? [],
  relationshipName: field.relationshipName ?? null,
});

/** Every field on the object, trimmed to `FieldSummary`. */
export const discoverObjectFields = async (
  ctx: SalesforceContext,
  objectName: string,
): Promise<FieldSummary[]> => {
  const describe = await describeObject(ctx, objectName);
  return (describe.fields ?? []).map(toFieldSummary);
};

/**
 * Fields that can be written on an existing record — the set worth offering as
 * mapping targets in a wizard, since anything else will be rejected on update.
 */
export const discoverUpdateableFields = async (
  ctx: SalesforceContext,
  objectName: string,
): Promise<FieldSummary[]> => {
  const describe = await describeObject(ctx, objectName);
  return (describe.fields ?? []).filter((f) => f.updateable).map(toFieldSummary);
};

/** Fields that can be set when creating a record. */
export const discoverCreateableFields = async (
  ctx: SalesforceContext,
  objectName: string,
): Promise<FieldSummary[]> => {
  const describe = await describeObject(ctx, objectName);
  return (describe.fields ?? []).filter((f) => f.createable).map(toFieldSummary);
};

/**
 * Fields that must be supplied to create a record: createable, not nillable,
 * and without a value Salesforce fills in itself.
 *
 * Use it to validate a payload before sending, rather than learning what was
 * missing from a REQUIRED_FIELD_MISSING error.
 */
export const discoverRequiredFields = async (
  ctx: SalesforceContext,
  objectName: string,
): Promise<FieldSummary[]> => {
  const describe = await describeObject(ctx, objectName);

  return (describe.fields ?? [])
    .filter(
      (field) =>
        field.createable &&
        !field.nillable &&
        !field.defaultedOnCreate &&
        // Auto-number and formula fields are never nillable but are also never
        // writable by the caller, so they are not the caller's to supply.
        !field.autoNumber &&
        !field.calculated,
    )
    .map(toFieldSummary);
};

/**
 * Fields flagged as External ID, which is what an upsert keys on.
 *
 * Distinct from "updateable": an upsert target must be an External ID (or the
 * record Id), and a field being writable says nothing about whether it is one.
 */
export const discoverExternalIdFields = async (
  ctx: SalesforceContext,
  objectName: string,
): Promise<FieldSummary[]> => {
  const describe = await describeObject(ctx, objectName);
  return (describe.fields ?? []).filter((f) => f.externalId).map(toFieldSummary);
};

/**
 * Record types defined on an object.
 *
 * Fields, picklist values and layouts differ per record type, so sync logic that
 * assumes one shape per object breaks on orgs that use them.
 *
 * @param includeUnavailable - include record types the connected user cannot
 *   access. Off by default, since offering one that the integration's own user
 *   cannot write to just moves the failure later.
 */
export const discoverObjectRecordTypes = async (
  ctx: SalesforceContext,
  objectName: string,
  includeUnavailable = false,
): Promise<RecordTypeInfo[]> => {
  const describe = await describeObject(ctx, objectName);
  const recordTypes = describe.recordTypeInfos ?? [];
  return includeUnavailable
    ? recordTypes
    : recordTypes.filter((rt) => rt.available);
};

/**
 * Decodes a dependent picklist entry's `validFor` bitmap into the controlling
 * values it applies to.
 *
 * Salesforce encodes this as base64 over a big-endian bitmap: bit N (counting
 * from the most significant bit of byte 0) is set when the entry is valid for
 * the controlling value at index N.
 */
export const decodeValidFor = (
  validFor: string,
  controllingValues: string[],
): string[] => {
  const bytes = Buffer.from(validFor, "base64");

  return controllingValues.filter((_value, index) => {
    const byte = bytes[index >> 3];
    if (byte === undefined) return false;
    return (byte & (0x80 >> index % 8)) !== 0;
  });
};

const activeEntries = (entries: PicklistEntry[] | undefined): PicklistEntry[] =>
  (entries ?? []).filter((entry) => entry.active);

/**
 * Valid values for a picklist field, with dependent-picklist logic resolved.
 *
 * When the field is dependent, each value carries the controlling-field values
 * it is valid for, so a wizard can narrow the second dropdown once the first is
 * chosen instead of offering values Salesforce will reject.
 *
 * Costs a single describe: the controlling field lives on the same object, so
 * its values are already in hand to interpret the bitmap against.
 */
export const discoverPicklistValues = async (
  ctx: SalesforceContext,
  objectName: string,
  fieldName: string,
): Promise<PicklistResult> => {
  assertApiName(fieldName, "field name");
  const describe = await describeObject(ctx, objectName);

  const field = (describe.fields ?? []).find((f) => f.name === fieldName);
  if (!field) {
    throw new Error(
      `Field "${fieldName}" does not exist on Salesforce object "${objectName}".`,
    );
  }

  if (field.type !== "picklist" && field.type !== "multipicklist") {
    throw new Error(
      `Field "${objectName}.${fieldName}" is of type "${field.type}", not a picklist.`,
    );
  }

  const entries = activeEntries(field.picklistValues);
  const controllingField = field.controllerName ?? null;

  if (!controllingField) {
    return {
      object: objectName,
      field: fieldName,
      controllingField: null,
      controllingValues: [],
      values: entries.map(toPicklistValue),
    };
  }

  const controllingValues = getControllingValues(describe, controllingField);

  return {
    object: objectName,
    field: fieldName,
    controllingField,
    controllingValues,
    values: entries.map((entry) => ({
      ...toPicklistValue(entry),
      validFor: entry.validFor
        ? decodeValidFor(entry.validFor, controllingValues)
        : [],
    })),
  };
};

const toPicklistValue = (entry: PicklistEntry): PicklistValue => ({
  label: entry.label ?? entry.value,
  value: entry.value,
  active: entry.active,
  defaultValue: entry.defaultValue,
});

/**
 * The controlling field's values, in the index order the `validFor` bitmaps use.
 *
 * A controlling field is either a picklist (its active values, in order) or a
 * checkbox, in which case the bitmap has exactly two positions: index 0 is
 * `false`, index 1 is `true`.
 *
 * It always lives on the same object, so it is read from the describe already in
 * hand rather than costing a second request.
 */
const getControllingValues = (
  describe: SObjectDescribe,
  controllingFieldName: string,
): string[] => {
  const controller = (describe.fields ?? []).find(
    (f) => f.name === controllingFieldName,
  );

  if (!controller) {
    throw new Error(
      `Controlling field "${controllingFieldName}" was not found on "${describe.name}", so dependent picklist values cannot be resolved.`,
    );
  }

  if (controller.type === "boolean") return ["false", "true"];

  return activeEntries(controller.picklistValues).map((entry) => entry.value);
};

/**
 * Maps every object's API name to its display label.
 *
 * A client-facing dropdown shows labels, but everything downstream — SOQL,
 * REST paths, field mappings — needs the API name, so the two have to be
 * resolvable in both directions.
 */
export const getObjectLabelMap = async (
  ctx: SalesforceContext,
  options: DiscoverObjectsOptions = {},
): Promise<Record<string, string>> => {
  const objects = await discoverEnvironmentObjects(ctx, options);

  return Object.fromEntries(
    objects.map((object) => [object.name, object.label ?? object.name]),
  );
};
