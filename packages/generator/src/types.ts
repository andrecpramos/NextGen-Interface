import type { Capability, RegistryFile } from '@nextgen/core-capability';

/**
 * What the generator reads, and what it refuses to say.
 *
 * The shape of this file is the shape of Rule 16 and Rule 17. Everything here
 * describes *the adopter's* application; nothing here is written back into it.
 */

/** A backend role name, exactly as the target application spells it. */
export type RoleName = string;

/**
 * Why a discovered route did not become a capability.
 *
 * Every skip is recorded and reported. A generator that silently drops routes
 * is indistinguishable from one that cannot find them, and the difference
 * decides whether an adopter trusts the output (WP-25 acceptance: "skipped-
 * capability report exists and is legible").
 */
export type SkipReason =
  | 'unresolved-roles'
  | 'declared-legacy'
  | 'dev-only'
  | 'bookmark-redirect'
  | 'no-component'
  | 'duplicate-route'
  | 'no-roles';

export interface SkippedRoute {
  readonly path: string;
  readonly reason: SkipReason;
  /** The evidence, quoted from the app's own source — so a human can check it. */
  readonly detail: string;
}

/**
 * A route as found in the application's route table, before any judgement about
 * whether it should be offered to a user.
 *
 * `roles: null` means "the guard could not be resolved", which is never treated
 * as "open to everyone". Rule 17 has a zero-tolerance kill criterion, so an
 * unreadable guard drops the route.
 */
export interface DiscoveredRoute {
  readonly path: string;
  readonly component: string | null;
  /** Absolute path to the component's source file, when the import resolved. */
  readonly componentFile: string | null;
  /** `features/<feature>/pages/X.tsx` — the real information architecture. */
  readonly feature: string | null;
  readonly roles: readonly RoleName[] | null;
  /** The named role set the route referenced, e.g. `ROUTE_ROLES.squadManage`. */
  readonly roleKey: string | null;
  /** Registered only under a development-build guard. */
  readonly devOnly: boolean;
  /** Leading comment on the route entry, verbatim. Untrusted (Rule 15). */
  readonly comment: string | null;
}

/** What reading a page component told us about it. */
export interface PageFacts {
  /**
   * The component renders nothing but a redirect — every return is a
   * `<Navigate>`. A user sent here never arrives anywhere.
   */
  readonly isPureRedirect: boolean;
  /** Redirect targets found in the body, for explaining a skip. */
  readonly redirectTargets: readonly string[];
  /** i18n keys the page renders, in source order — its own vocabulary. */
  readonly i18nKeys: readonly string[];
  /** Literal heading/title text found in the body. Untrusted (Rule 15). */
  readonly headings: readonly string[];
  /** Leading block comment on the default export — why the page exists. */
  readonly doc: string | null;
}

/** A label a manifest attached to a route, with the reason it was recorded. */
export interface ManifestEntry {
  readonly path: string;
  readonly labelKey: string | null;
  /** Prose written by a developer about this route. Untrusted (Rule 15). */
  readonly reason: string | null;
}

/**
 * A capability plus the roles that may reach it.
 *
 * This is the *master* artefact, not a shipped one: `roles` never survives into
 * a registry a browser receives. See `emit.ts` for why.
 */
export type AnnotatedCapability = Capability & { readonly roles: readonly RoleName[] };

export interface GeneratorOutput {
  /** One entry per role, each a plain `RegistryFile` with no role annotation. */
  readonly registries: ReadonlyMap<RoleName, RegistryFile>;
  /** Every capability with its role set — for review, diffing and audit. */
  readonly master: readonly AnnotatedCapability[];
  readonly boundaries: readonly Capability[];
  readonly skipped: readonly SkippedRoute[];
  readonly domainDescription: string;
  readonly roles: readonly RoleName[];
}

/**
 * Where the target application keeps the things the generator reads.
 *
 * Paths are relative to `appRoot`. Everything is read-only: the generator
 * opens no file for writing anywhere under `appRoot` (Rule 16).
 */
export interface GeneratorConfig {
  /** The application's source root, e.g. `<repo>/frontend/src`. */
  readonly appRoot: string;
  /** The React Router route table. */
  readonly routesFile: string;
  /**
   * The module declaring the named role sets the route table references.
   * Absent in an application with no roles at all: every visitor then receives
   * the same registry, named for the single audience it serves.
   */
  readonly permissionsFile?: string;
  /** The exported object mapping a role-set name to its roles. */
  readonly roleSetExport: string;
  /** The exported array naming every role the application has. */
  readonly allRolesExport: string;
  /**
   * Hand-maintained navigation manifests — a far richer signal than JSX,
   * because a developer wrote them for humans (PLAN.md §7.2).
   */
  readonly manifests: readonly string[];
  /** `i18n/locales/<lang>/<namespace>.json`. */
  readonly localesDir: string | null;
  /**
   * Languages to resolve labels in. **The first is the application's own
   * language**, and it decides the language of every title and description in
   * the registry.
   *
   * This is not cosmetic. The document stage 2 embeds is title + description +
   * examples, and the hashing embedder matches lexically: an English
   * description in a Portuguese application cannot be reached by a Portuguese
   * question. Measured on the pilot target — with `en` first, "o que é o centro
   * clínico" scored `competition.matches_detail` above `medical.centre`.
   */
  readonly languages: readonly string[];
  /**
   * What this application is, in one or two sentences. Supplied only when the
   * adopter wants to override the generated one (WP-16, D-2).
   */
  readonly domainDescription?: string;
}
