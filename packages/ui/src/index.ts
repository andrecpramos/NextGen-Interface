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
export { Composer, type ComposerProps } from './Composer.tsx';
export { Answer, type AnswerProps } from './Answer.tsx';
export { ConfirmationCard, type ConfirmationCardProps } from './ConfirmationCard.tsx';
export { NavDrawer, type NavDrawerProps } from './NavDrawer.tsx';
export { TracePanel, type TracePanelProps } from './TracePanel.tsx';

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
