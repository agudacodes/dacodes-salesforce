/**
 * Connection plumbing: turning a Prismatic connection into credentials, and
 * making authenticated requests against the Salesforce REST API.
 */

import type {
  ApiVersion,
  SalesforceConnectionInput,
  SalesforceCredentials,
} from "./types.js";

/**
 * Thrown for any non-2xx Salesforce response. Carries the status and the parsed
 * body, because Salesforce returns its own `errorCode`/`message` pairs that say
 * far more than the status alone (`INVALID_SESSION_ID` vs. a genuine 401, for
 * instance).
 */
export class SalesforceApiError extends Error {
  readonly status: number;
  readonly statusText: string;
  readonly path: string;
  /** Parsed response body — usually `[{ errorCode, message }]`. */
  readonly body: unknown;
  /** Salesforce's own error code, when the body carried one. */
  readonly errorCode: string | undefined;

  constructor(args: {
    status: number;
    statusText: string;
    path: string;
    body: unknown;
  }) {
    super(
      `Salesforce request to ${args.path} failed with ${args.status} ${args.statusText}: ${formatErrorBody(args.body)}`,
    );
    this.name = "SalesforceApiError";
    this.status = args.status;
    this.statusText = args.statusText;
    this.path = args.path;
    this.body = args.body;
    this.errorCode = extractErrorCode(args.body);
  }
}

const extractErrorCode = (body: unknown): string | undefined => {
  const first = Array.isArray(body) ? body[0] : body;
  if (first && typeof first === "object" && "errorCode" in first) {
    const code = (first as { errorCode: unknown }).errorCode;
    return typeof code === "string" ? code : undefined;
  }
  return undefined;
};

const formatErrorBody = (body: unknown): string => {
  if (typeof body === "string") return body;
  try {
    return JSON.stringify(body);
  } catch {
    return String(body);
  }
};

/**
 * Pulls the access token and instance URL out of a Prismatic Salesforce OAuth
 * connection, or passes through explicit credentials.
 *
 * The instance URL is the per-org host (e.g. `https://acme.my.salesforce.com`)
 * and is the base for every raw REST request — it is not a fixed Salesforce
 * domain, which is why it has to come from the connection rather than a constant.
 */
export const getConnectionTokens = (
  connection: SalesforceConnectionInput,
): SalesforceCredentials => {
  if (!connection || typeof connection !== "object") {
    throw new Error(
      "Salesforce connection is missing. Pass the OAuth connection config var, or explicit { instanceUrl, accessToken } credentials.",
    );
  }

  if ("accessToken" in connection || "instanceUrl" in connection) {
    const { instanceUrl, accessToken } = connection as SalesforceCredentials;
    if (!accessToken || !instanceUrl) {
      throw new Error(
        "Salesforce credentials are incomplete: both instanceUrl and accessToken are required.",
      );
    }
    return { instanceUrl: stripTrailingSlash(instanceUrl), accessToken };
  }

  const accessToken = connection.token?.access_token;
  const instanceUrl = connection.token?.instance_url;
  if (!accessToken || !instanceUrl) {
    throw new Error(
      "Salesforce connection is missing access token or instance URL. Check that the OAuth connection config var is connected.",
    );
  }

  return { instanceUrl: stripTrailingSlash(instanceUrl), accessToken };
};

const stripTrailingSlash = (url: string): string => url.replace(/\/+$/, "");

/** Makes an authenticated request and returns the parsed JSON body. */
export type SalesforceRequest = <T>(
  path: string,
  init?: RequestInit,
) => Promise<T>;

/**
 * Builds the authenticated request function every method in this package uses.
 *
 * `path` may be absolute (`/services/data/v62.0/sobjects`) or a full URL —
 * Salesforce returns fully-qualified `nextRecordsUrl` values when paging, so
 * both have to work.
 */
export const createRequester = (
  credentials: SalesforceCredentials,
  fetchImpl: typeof fetch = fetch,
): SalesforceRequest => {
  const { instanceUrl, accessToken } = credentials;

  return async <T>(path: string, init: RequestInit = {}): Promise<T> => {
    const url = path.startsWith("http") ? path : `${instanceUrl}${path}`;

    const response = await fetchImpl(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        ...init.headers,
      },
    });

    if (!response.ok) {
      throw new SalesforceApiError({
        status: response.status,
        statusText: response.statusText,
        path,
        body: await readBody(response),
      });
    }

    // 204 on DELETE and some PATCHes — no body to parse.
    if (response.status === 204) return undefined as T;

    return (await readBody(response)) as T;
  };
};

const readBody = async (response: Response): Promise<unknown> => {
  const text = await response.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

/**
 * Resolves the newest API version the org supports, as a `v`-prefixed string
 * ready to drop into a path (e.g. `v62.0`).
 *
 * Pinning a version in code goes stale and eventually falls out of Salesforce's
 * three-release support window, so it is read from the org instead. This is an
 * unauthenticated-shaped endpoint but still requires the bearer token.
 */
export const resolveApiVersion = async (
  request: SalesforceRequest,
): Promise<string> => {
  const versions = await request<ApiVersion[]>("/services/data/");

  if (!Array.isArray(versions) || versions.length === 0) {
    throw new Error(
      "Salesforce returned no API versions from /services/data/ — cannot determine which version to call.",
    );
  }

  // The list is returned oldest-first; the last entry is the newest.
  const latest = versions[versions.length - 1];
  if (!latest?.version) {
    throw new Error(
      "Salesforce returned a malformed API version list from /services/data/.",
    );
  }

  return `v${latest.version}`;
};

/** Escapes a value for safe interpolation into a SOQL string literal. */
export const escapeSoql = (value: string): string =>
  value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");

/**
 * Guards a value used as an sObject or field API name. These are interpolated
 * into URL paths and SOQL, and Salesforce API names are always alphanumeric with
 * underscores (custom ones end in `__c`, namespaced ones contain `__`), so
 * anything else is either a bug or an injection attempt.
 */
export const assertApiName = (value: string, label: string): string => {
  if (typeof value !== "string" || !/^[A-Za-z][A-Za-z0-9_]*$/.test(value)) {
    throw new Error(
      `Invalid Salesforce ${label} "${value}". Expected an API name such as "Account" or "My_Field__c".`,
    );
  }
  return value;
};

/**
 * What every method in this package needs to talk to an org: a resolved API
 * version and an authenticated request function. `createSalesforceClient` builds
 * one and binds it into the client's methods.
 */
export interface SalesforceContext {
  instanceUrl: string;
  /** `v`-prefixed, e.g. `v62.0`. */
  apiVersion: string;
  request: SalesforceRequest;
}

/** Builds a versioned REST path, e.g. `dataPath(ctx, "/sobjects")`. */
export const dataPath = (ctx: SalesforceContext, suffix: string): string =>
  `/services/data/${ctx.apiVersion}${suffix}`;
