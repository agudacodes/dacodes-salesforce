# @dacodes/salesforce

Discovery and environment helpers for building [Prismatic](https://prismatic.io) Salesforce integrations — the
describe-and-discover work that config wizards need on every project, and that the stock Prismatic Salesforce
component doesn't cover.

- **No dependencies.** Uses native `fetch` (Node 18+). Nothing to conflict with the `@prismatic-io/spectral`
  version your integration pins.
- **Takes the connection, not secrets.** Pass the Salesforce OAuth config var straight in; the access token and
  instance URL are read off it.
- **Typed.** Ships `.d.ts` and source maps.

## Install

The package is not on a registry yet — it installs straight from the GitHub repo, which is
private, so you need read access to it.

```bash
npm install agudacodes/dacodes-salesforce
```

`dist/` is not committed; npm runs the `prepare` script and compiles the package at install
time, so a working Node toolchain is all that's needed.

To pin a release rather than tracking `main`, append a tag or commit SHA:

```bash
npm install agudacodes/dacodes-salesforce#v0.1.0
```

<details>
<summary>If you keep several GitHub accounts behind SSH host aliases</summary>

npm expands the `owner/repo` shorthand to `ssh://git@github.com/...`, which always uses
whichever key your `Host github.com` block names. If the key with access to this repo sits
behind an alias such as `github-company`, the shorthand authenticates as the wrong account
and fails with `ERROR: Repository not found` — the same message you get for a repo that
doesn't exist. Spell the alias out instead:

```bash
npm install git+ssh://git@github-company/agudacodes/dacodes-salesforce.git
```

Also worth setting `IdentitiesOnly yes` on each `Host` block in `~/.ssh/config`: without it a
running `ssh-agent` offers every loaded key and the first one GitHub accepts wins, which can
silently authenticate you as a different account than the one the alias intends.

</details>

## Usage

```ts
import { createSalesforceClient } from "@dacodes/salesforce";

// Inside a Prismatic data source or flow — `connection` is the Salesforce
// OAuth 2.0 config var.
const sf = await createSalesforceClient(connection);

const objects = await sf.discoverEnvironmentObjects();
const fields = await sf.discoverUpdateableFields("Account");
const { parents, children } = await sf.discoverObjectRelationships("Contact");
```

In a config-wizard data source:

```ts
export const selectableObjects = dataSource({
  display: { label: "Salesforce Object", description: "Object to sync" },
  dataSourceType: "picklist",
  perform: async (context, { salesforceConnection }) => {
    const sf = await createSalesforceClient(salesforceConnection);
    const objects = await sf.discoverEnvironmentObjects({ createableOnly: true });
    return { result: objects.map((o) => o.name) };
  },
});
```

`createSalesforceClient` is async because it resolves the org's newest API version once, on creation, rather than
on every call. Pin it to skip that round trip:

```ts
const sf = await createSalesforceClient(connection, { apiVersion: "v62.0" });
```

Outside Prismatic (scripts, tests) pass credentials directly, and inject a `fetch` to stub the API:

```ts
const sf = await createSalesforceClient({
  instanceUrl: "https://acme.my.salesforce.com",
  accessToken: process.env.SF_TOKEN!,
});
```

## API

### Discovery

| Method | Returns |
| --- | --- |
| `discoverEnvironmentObjects(options?)` | Objects in the org, label-sorted. Skips non-queryable and deprecated ones unless `includeAll`; also takes `customOnly` and `createableOnly`. |
| `describeObject(name)` | The raw describe. Large — prefer a narrower method. |
| `discoverObjectFields(name)` | All fields, trimmed to the subset a wizard needs. |
| `discoverUpdateableFields(name)` | Fields writable on an existing record. |
| `discoverCreateableFields(name)` | Fields settable at creation. |
| `discoverRequiredFields(name)` | Fields required to create a record — createable, not nillable, no default. Validate a payload before sending, instead of reading it off a `REQUIRED_FIELD_MISSING`. |
| `discoverExternalIdFields(name)` | Fields flagged External ID — what an upsert keys on. Not the same as updateable. |
| `discoverObjectRecordTypes(name, includeUnavailable?)` | Record types. Fields and picklists differ per record type, which breaks logic assuming one shape per object. |
| `discoverPicklistValues(object, field)` | Valid values, with dependent-picklist logic resolved. |
| `getObjectLabelMap(options?)` | API name → display label, for dropdowns that show labels but must resolve back to API names. |

#### Dependent picklists

When a picklist is controlled by another field, each value carries the controlling values it is valid for —
decoded from the base64 bitmap Salesforce returns — so the second dropdown can be narrowed once the first is
chosen, rather than offering values Salesforce will reject.

```ts
const states = await sf.discoverPicklistValues("Account", "State__c");
// {
//   controllingField: "Country__c",
//   controllingValues: ["USA", "Canada"],
//   values: [
//     { value: "CA", label: "California", validFor: ["USA"] },
//     { value: "OT", label: "Other",      validFor: ["USA", "Canada"] },
//   ],
// }

const forUsa = states.values.filter((v) => v.validFor?.includes("USA"));
```

`validFor` is `undefined` on an independent picklist, and `[]` for a value valid for no controlling value at all.

### Relationships

| Method | Returns |
| --- | --- |
| `discoverObjectRelationships(name, options?)` | `{ parents, children }`. Both directions come from one describe. |
| `discoverRelatedObjects(name, options?)` | Distinct neighbouring object names, either direction. |

Parents are the object's own lookup/master-detail fields; children are the objects pointing back at it.
Polymorphic fields such as `OwnerId` are flagged `polymorphic: true` and can be dropped with
`{ excludePolymorphic: true }`. Child relationships are filtered to traversable, non-deprecated ones by default —
a standard object like `Account` reports 100+, mostly internal.

### Environment

| Method | Returns |
| --- | --- |
| `getOrgLimits()` | The Limits API: allocation and remaining, per resource. Check before a large sync so a job can back off rather than half-finish. |
| `getOrgInfo()` | Org id, name, and `isSandbox` — the flag to branch on when the same code runs against a client's sandbox in testing and production later. Needs read access to `Organization`. |
| `query(soql)` | One page of SOQL results. |
| `queryAll(soql, maxRecords?)` | Follows pagination, capped at `maxRecords` (default 10,000) so an unbounded query can't run away. |

Also exported: `getLatestApiVersion(request)`, `escapeSoql(value)`.

### Errors

Non-2xx responses throw `SalesforceApiError`, carrying `status`, `path`, the parsed `body` and Salesforce's own
`errorCode` — which usually says more than the status alone.

```ts
import { SalesforceApiError } from "@dacodes/salesforce";

try {
  await sf.describeObject("Missing__c");
} catch (error) {
  if (error instanceof SalesforceApiError && error.errorCode === "NOT_FOUND") {
    // ...
  }
}
```

### Functional form

Every method is also exported standalone, taking a `SalesforceContext` (`{ instanceUrl, apiVersion, request }`)
as its first argument. The client satisfies that interface, so the two styles mix:

```ts
import { createSalesforceClient, discoverRequiredFields } from "@dacodes/salesforce";

const sf = await createSalesforceClient(connection);
const required = await discoverRequiredFields(sf, "Opportunity");
```

## Caching

There is none yet: every method call is a live request. Where a wizard page needs several views of one object,
call `describeObject` once and derive from it rather than calling three discovery methods that each re-describe.

A describe cache — in-memory, or backed by a state store so it survives across invocations — is the open design
question here. It needs an invalidation story for when an org's schema changes.

## Development

```bash
npm install
npm run typecheck
npm run build
```

## License

ISC
