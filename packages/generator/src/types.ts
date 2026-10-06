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
 * decides whether an adopter trusts the output: the skipped-capability report
 * must exist and be legible.
 */
export type SkipReason =
  | 'unresolved-roles'
  | 'declared-legacy'
  | 'dev-only'
  | 'bookmark-redirect'
  | 'no-component'
  | 'duplicate-route'
  | 'no-roles'
  /** Discovery found the route but could not read its path or component. */
  | 'unreadable-route'
  /** A catch-all (`[...slug]`, a Remix `$` splat) serving pages that come from content, not code. */
  | 'catch-all'
  /** The same screen as a route that picks its own parameter and redirects to it: declared once, there. */
  | 'reached-through-resolver'
  /** Only redirects to a screen that is declared at its own address: an old name for it, not a place. */
  | 'redirect-alias';

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
  /**
   * The file this route was written in, for a route whose component is not imported from anywhere — it
   * may be declared right beside the route table (`function MainPage() {…}`). Absent when
   * `componentFile` resolved, or there is no component.
   */
  readonly routedIn?: string;
  /** `features/<feature>/pages/X.tsx` — the real information architecture. */
  readonly feature: string | null;
  readonly roles: readonly RoleName[] | null;
  /** The named role set the route referenced, e.g. `ROUTE_ROLES.squadManage`. */
  readonly roleKey: string | null;
  /**
   * Where a `<Navigate to="…" />` written straight into the route table sends the user, as
   * far as it is known at build time. Absent for a route that renders a page.
   */
  readonly redirectTo?: string | null;
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
  /**
   * The i18n keys the page renders as its own heading — its page header's `title`, or
   * its `<h1>` — in source order. What a user reads at the top of the screen.
   */
  readonly titleKeys: readonly string[];
  /**
   * For a page that is one tab of a shared layout: the layout's own heading, which names the
   * section the tab belongs to. Set only when the page is read through that layout (`readScreen`).
   */
  readonly sectionTitleKeys?: readonly string[];
  /** Literal heading/title text found in the body. Untrusted (Rule 15). */
  readonly headings: readonly string[];
  /** Leading block comment on the default export — why the page exists. */
  readonly doc: string | null;
  /**
   * The form controls the page renders, in source order. What guided
   * steps are generated from. Labels are untrusted adopter text (Rule 15).
   */
  readonly fields: readonly FormField[];
  /**
   * The title the page declares for itself — Next.js `metadata.title`, a Remix
   * `meta` title — when it is a string literal. Untrusted (Rule 15).
   */
  readonly title: string | null;
  /**
   * ADR-020's **inferred** tier: a condition this page's own code
   * appeared to enforce before its form would submit. Every candidate found is
   * here, whether or not it was confident enough to ship — see
   * `InferredCandidate.recognized` and `inferred-rules.ts`'s own header for why
   * that split exists at all.
   */
  readonly inferredCandidates: readonly InferredCandidate[];
  /**
   * Controls on the page whose only job is to show something — `onClick={() => setOpen(true)}`, a
   * `DialogTrigger` — named as the page names them (ADR-031). What the widget may press for a visitor
   * who asked to start what they open. Untrusted (Rule 15); absent where the page is not read as TSX.
   */
  readonly openers?: readonly { readonly label: string | null; readonly labelKey: string | null }[];
}

/** Which shape of imperative guard an inferred candidate came from. */
export type InferredPattern = 'disabled-submit' | 'guard-message';

/**
 * One condition read from a handler or a `disabled` expression, before it is
 * known whether it is confident enough to ship (ADR-020).
 *
 * `recognized: false` never reaches a registry — it is only ever written to
 * `review/INFERRED.md`, for a human to read. `statement` is `null` until it is
 * known to be needed: `disabled-submit` phrases from a template once a label
 * is resolvable (`inferredRulesEntry`), so it carries none here; `guard-message`
 * already found its statement verbatim in the source, so it carries it now.
 */
export interface InferredCandidate {
  readonly pattern: InferredPattern;
  /** The `FormField` this was matched to (its `name`, or its `id`) — null when nothing matched. */
  readonly field: string | null;
  readonly statement: string | null;
  readonly recognized: boolean;
  /** The raw source text this came from, quoted for `review/INFERRED.md`. Untrusted (Rule 15). */
  readonly detail: string;
  readonly line: number;
}

/** One control a guided step can point at, as read from the page's JSX. */
export interface FormField {
  /** `input`, `select`, `textarea` or `button`, lower-cased. */
  readonly tag: string;
  /** Literal label text, when the source spells it out. */
  readonly label: string | null;
  /** The i18n key, when the label is `t('…')`. Resolved against locales later. */
  readonly labelKey: string | null;
  readonly id: string | null;
  readonly name: string | null;
  readonly type: string | null;
  /**
   * What constrains this control — ADR-020's **read** tier: a native
   * HTML attribute, or a validation schema bound through the form. Always an
   * array, possibly empty; see `field-rules.ts` for what is read and why.
   */
  readonly rules: readonly FieldRule[];
}

/**
 * One constraint on a form control, read rather than inferred (ADR-020).
 *
 * `line` is 1-based, in the same file the control itself was read from — the
 * page component. `field-rules.ts` is the only place these are produced.
 */
export interface FieldRule {
  readonly kind: 'required' | 'min' | 'max' | 'minLength' | 'maxLength' | 'pattern' | 'email' | 'enum';
  readonly value?: string | number;
  /** For `kind: 'enum'` — the values a `z.enum([...])` / `yup.oneOf([...])` declares. */
  readonly values?: readonly string[];
  readonly line: number;
}

/** A label a manifest attached to a route, with the reason it was recorded. */
export interface ManifestEntry {
  readonly path: string;
  readonly labelKey: string | null;
  /**
   * The label of the nav group the entry sits in, when a nav config nests it:
   * `{ label: 'nav.squad', items: [{ label: 'nav.overview', route: '/squad' }] }`.
   * What the application's own command palette writes before the item's label.
   */
  readonly groupLabelKey?: string | null;
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
  /**
   * An inferred-tier candidate (ADR-020) found but not confident enough
   * to ship — `review/INFERRED.md`, never a registry. What *did* ship the same
   * way is indistinguishable from a `read`-tier rule except for its `tier`
   * field on the capability that carries it; there is no separate list for it.
   */
  readonly reviewInferred: readonly ReviewInferredEntry[];
  readonly domainDescription: string;
  readonly roles: readonly RoleName[];
}

/** A found-but-not-shipped inferred candidate, for a human to read (ADR-020). */
export interface ReviewInferredEntry {
  readonly route: string;
  readonly pattern: InferredPattern;
  /** `<file>:<line>`, in the adopter's own tree. */
  readonly source: string;
  readonly detail: string;
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
  /**
   * How the application declares its routes. Default `react-router`, where
   * `routesFile` is its route table. For a router declared by a folder layout,
   * `routesFile` is that folder, relative to `appRoot`:
   *   - `next`: the `app` or `pages` folder (`.` when `appRoot` is it); both are read when both exist
   *   - `remix`: `routes` — Remix v2, or React Router 7 `flatRoutes()`
   *   - `sveltekit`: `routes`, with `appRoot` the `src` folder
   *   - `nuxt`: `pages`, with `appRoot` the `app` folder (Nuxt 4), or `.` with `appRoot` the `pages` folder (Nuxt 3)
   *   - `vue-router`, `angular`: like `react-router`, the route table in code (`router/index.ts`, `app/app.routes.ts`)
   */
  readonly router?: 'react-router' | 'vue-router' | 'angular' | 'next' | 'remix' | 'sveltekit' | 'nuxt';
  /** The route table (`react-router`), or the routes folder (every other router). */
  readonly routesFile: string;
  /**
   * Roles the application enforces in code the generator cannot read — a
   * middleware, a layout, a loader — declared by path prefix:
   * `{ "/admin": ["ADMIN"] }`. The longest prefix matching at a segment boundary
   * wins, and replaces whatever discovery found for that route.
   */
  readonly routeRoles?: Readonly<Record<string, readonly RoleName[]>>;
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
   * because a developer wrote them for humans.
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
   * question. Measured on a real app — with `en` first, "o que é a pauta
   * de avaliação" scored `classes.detail` above `grades.report`.
   */
  readonly languages: readonly string[];
  /**
   * What this application is, in one or two sentences. Supplied only when the
   * adopter wants to override the generated one.
   */
  readonly domainDescription?: string;
  /**
   * The adopter's own account of their app — what each screen is for, what is on it, what their
   * users call it (`knowledge.ts`). A path relative to this config file. Optional, and the
   * single biggest lever on whether an ordinary question reaches the right screen.
   */
  readonly knowledge?: string;
}
