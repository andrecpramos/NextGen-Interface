// @nextgen/ui
// Shared design system: sphere states, confirmation cards, trace viewer.
//
// Widgets render; they do not decide.
//
// Nothing in this package imports the engine. Every component takes a view
// model from `./types.ts` and hands events back out — which is what keeps the
// design system usable from a browser bundle, where `node:sqlite` cannot go,
// and what stops a widget from ever acquiring an opinion about policy.

export { Sphere, SphereStatus, type SphereProps } from './Sphere.tsx';
export { Blob, type BlobProps } from './Blob.tsx';
export { Composer, type ComposerProps } from './Composer.tsx';
export { Answer, type AnswerProps } from './Answer.tsx';
export { ConfirmationCard, type ConfirmationCardProps } from './ConfirmationCard.tsx';
export { NavDrawer, type NavDrawerProps } from './NavDrawer.tsx';
export { TracePanel, type TracePanelProps } from './TracePanel.tsx';

// WP-27, D-3. Where a guided step points — semantic match first, the build-time
// selector as a fallback that is refused when it contradicts the label, and text
// whenever it is not sure. Pure logic over a two-method DOM interface.
export {
  resolveAnchor,
  resolveSteps,
  accessibleName,
  type AnchorNode,
  type AnchorRoot,
  type AnchorResult,
  type ResolvedStep,
} from './anchor.ts';

// Where the blob docks. Pure logic over a two-method DOM interface, same
// reasoning as anchor.ts — testable without a browser, and importable by a
// script tag that must not drag React in (see packages/embed/src/blob.ts,
// which imports this by path rather than through this index for that reason).
export { chooseDockSide, type DockContext, type DockNode, type DockSide } from './dock.ts';

export {
  SPHERE_LABELS,
  type SphereState,
  type Tone,
  type AnswerRow,
  type AnswerView,
  type ParamView,
  type ConfirmView,
  type TraceView,
  type NavItem,
} from './types.ts';
