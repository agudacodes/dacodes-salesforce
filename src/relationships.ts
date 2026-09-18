/**
 * Relationships between objects.
 *
 * Both directions come out of a single describe: `fields` carries the lookup and
 * master-detail fields this object points at (parents), and `childRelationships`
 * carries the ones pointing back at it (children).
 */

import { assertApiName, type SalesforceContext } from "./helpers.js";
import { describeObject } from "./discovery.js";
import type {
  ChildRelationship,
  ObjectRelationships,
  ParentRelationship,
  SObjectDescribe,
  SalesforceFieldDescribe,
} from "./types.js";

export interface RelationshipOptions {
  /**
   * Include child relationships Salesforce marks deprecated and hidden, and
   * ones with no relationship name (which cannot be traversed in SOQL).
   * Off by default — a standard object like Account reports 100+ children,
   * mostly internal system objects.
   */
  includeAll?: boolean;
  /**
   * Drop polymorphic parent fields such as `OwnerId` and `CreatedById`, which
   * may point at several objects and are rarely what a mapping wants.
   */
  excludePolymorphic?: boolean;
}

const isReferenceField = (field: SalesforceFieldDescribe): boolean =>
  field.type === "reference" && (field.referenceTo?.length ?? 0) > 0;

const toParentRelationship = (
  field: SalesforceFieldDescribe,
): ParentRelationship => {
  const referenceTo = field.referenceTo ?? [];
  return {
    field: field.name,
    label: field.label,
    relationshipName: field.relationshipName ?? null,
    referenceTo,
    polymorphic: referenceTo.length > 1,
    // A master-detail field is createable but not nillable; a plain lookup is
    // usually nillable. This mirrors discoverRequiredFields' definition.
    required: !field.nillable && field.createable,
    custom: field.custom,
  };
};

/** Parent side only: the lookup/master-detail fields this object points at. */
export const discoverParentRelationships = (
  describe: SObjectDescribe,
  options: RelationshipOptions = {},
): ParentRelationship[] => {
  const parents = (describe.fields ?? [])
    .filter(isReferenceField)
    .map(toParentRelationship);

  return options.excludePolymorphic
    ? parents.filter((parent) => !parent.polymorphic)
    : parents;
};

/** Child side only: the objects pointing back at this one. */
export const discoverChildRelationships = (
  describe: SObjectDescribe,
  options: RelationshipOptions = {},
): ChildRelationship[] => {
  const children = describe.childRelationships ?? [];

  if (options.includeAll) return children;

  return children.filter(
    (child) => !child.deprecatedAndHidden && Boolean(child.relationshipName),
  );
};

/**
 * An object's direct relationships in both directions.
 *
 * One describe call covers both, so there is no saving in asking for a single
 * direction — the per-direction helpers above take the describe you already have.
 */
export const discoverObjectRelationships = async (
  ctx: SalesforceContext,
  objectName: string,
  options: RelationshipOptions = {},
): Promise<ObjectRelationships> => {
  assertApiName(objectName, "object name");
  const describe = await describeObject(ctx, objectName);

  return {
    object: describe.name ?? objectName,
    parents: discoverParentRelationships(describe, options),
    children: discoverChildRelationships(describe, options),
  };
};

/**
 * The distinct object names this one is directly related to, in either
 * direction — the neighbours of this node in the org's object graph.
 *
 * Useful when you want to offer "what can I reach from here" without the field
 * detail that `discoverObjectRelationships` returns.
 */
export const discoverRelatedObjects = async (
  ctx: SalesforceContext,
  objectName: string,
  options: RelationshipOptions = {},
): Promise<string[]> => {
  const { parents, children } = await discoverObjectRelationships(
    ctx,
    objectName,
    options,
  );

  const related = new Set<string>();
  for (const parent of parents) {
    for (const target of parent.referenceTo) related.add(target);
  }
  for (const child of children) related.add(child.childSObject);

  related.delete(objectName);

  return [...related].sort((a, b) => a.localeCompare(b));
};
