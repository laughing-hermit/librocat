/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as account from "../account.js";
import type * as agents from "../agents.js";
import type * as ai from "../ai.js";
import type * as apps from "../apps.js";
import type * as attachments from "../attachments.js";
import type * as auth from "../auth.js";
import type * as authCleanup from "../authCleanup.js";
import type * as billing from "../billing.js";
import type * as concepts from "../concepts.js";
import type * as crons from "../crons.js";
import type * as dashboard from "../dashboard.js";
import type * as demo from "../demo.js";
import type * as demoPdf from "../demoPdf.js";
import type * as dev from "../dev.js";
import type * as email from "../email.js";
import type * as errors from "../errors.js";
import type * as fetchGuard from "../fetchGuard.js";
import type * as fetching from "../fetching.js";
import type * as fileCatalog from "../fileCatalog.js";
import type * as fileProbe from "../fileProbe.js";
import type * as files from "../files.js";
import type * as funnel from "../funnel.js";
import type * as http from "../http.js";
import type * as identity from "../identity.js";
import type * as importZip from "../importZip.js";
import type * as imports from "../imports.js";
import type * as indexation from "../indexation.js";
import type * as jev from "../jev.js";
import type * as judgeCases from "../judgeCases.js";
import type * as libro from "../libro.js";
import type * as limits from "../limits.js";
import type * as mcp from "../mcp.js";
import type * as membership from "../membership.js";
import type * as metered from "../metered.js";
import type * as migrations from "../migrations.js";
import type * as model from "../model.js";
import type * as officeText from "../officeText.js";
import type * as people from "../people.js";
import type * as pictures from "../pictures.js";
import type * as probe from "../probe.js";
import type * as reference from "../reference.js";
import type * as report from "../report.js";
import type * as signing from "../signing.js";
import type * as size from "../size.js";
import type * as sources from "../sources.js";
import type * as stripe from "../stripe.js";
import type * as team from "../team.js";
import type * as teamCover from "../teamCover.js";
import type * as workspaces from "../workspaces.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  account: typeof account;
  agents: typeof agents;
  ai: typeof ai;
  apps: typeof apps;
  attachments: typeof attachments;
  auth: typeof auth;
  authCleanup: typeof authCleanup;
  billing: typeof billing;
  concepts: typeof concepts;
  crons: typeof crons;
  dashboard: typeof dashboard;
  demo: typeof demo;
  demoPdf: typeof demoPdf;
  dev: typeof dev;
  email: typeof email;
  errors: typeof errors;
  fetchGuard: typeof fetchGuard;
  fetching: typeof fetching;
  fileCatalog: typeof fileCatalog;
  fileProbe: typeof fileProbe;
  files: typeof files;
  funnel: typeof funnel;
  http: typeof http;
  identity: typeof identity;
  importZip: typeof importZip;
  imports: typeof imports;
  indexation: typeof indexation;
  jev: typeof jev;
  judgeCases: typeof judgeCases;
  libro: typeof libro;
  limits: typeof limits;
  mcp: typeof mcp;
  membership: typeof membership;
  metered: typeof metered;
  migrations: typeof migrations;
  model: typeof model;
  officeText: typeof officeText;
  people: typeof people;
  pictures: typeof pictures;
  probe: typeof probe;
  reference: typeof reference;
  report: typeof report;
  signing: typeof signing;
  size: typeof size;
  sources: typeof sources;
  stripe: typeof stripe;
  team: typeof team;
  teamCover: typeof teamCover;
  workspaces: typeof workspaces;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  betterAuth: import("../betterAuth/_generated/component.js").ComponentApi<"betterAuth">;
  rateLimiter: import("@convex-dev/rate-limiter/_generated/component.js").ComponentApi<"rateLimiter">;
};
