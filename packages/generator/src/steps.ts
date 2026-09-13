import type { GuidedStep, StepAnchor } from '@nextgen/core-capability';

import { translate, type Translations } from './labels.ts';
import type { FormField } from './types.ts';

/**
 * Guided steps from the form a page renders (WP-27).
 *
 * *"Take me there and tell me what to do."* Navigation existed; guidance did
 * not. The generator already reads the component tree, which is what makes this
 * tractable — PLAN.md's note on WP-27 is that reading from source lets the anchor
 * be *derived* rather than guessed.
 *
 * ## Deliberately a template, not a model
 *
 * Every step is one sentence from a fixed template per control kind, in the
 * application's primary language. No model runs, at build time or at run time.
 * That keeps guidance reproducible and auditable (Rule 9), and it means the only
 * adopter text in a step is the field's own label — quoted, never interpreted
 * (Rule 15). A model could write friendlier prose; it could also write a step
 * for a field that is not there.
 *
 * ## The anchor carries both D-3 signals
 *
 * `label` + `role` for semantic matching at run time (primary), and a `selector`
 * captured from source as the fallback — `#id` when the control has one,
 * `tag[name="…"]` otherwise. `packages/embed`'s resolver refuses the selector if it
 * finds a control whose name contradicts `label`, so a stale selector degrades to
 * text instead of pointing at the wrong field.
 */

type Kind = 'fill' | 'choose' | 'tick' | 'press';

/** Templates per language. `{label}` is the field's own label, quoted. */
const TEMPLATES: Readonly<Record<string, Readonly<Record<Kind, string>>>> = {
  en: {
    fill: 'Fill in “{label}”.',
    choose: 'Choose an option for “{label}”.',
    tick: 'Tick “{label}” if it applies.',
    press: 'Press “{label}” when you are done.',
  },
  pt: {
    fill: 'Preencha “{label}”.',
    choose: 'Escolha uma opção em “{label}”.',
    tick: 'Marque “{label}” se se aplicar.',
    press: 'Carregue em “{label}” quando terminar.',
  },
};

/** The ARIA role the runtime resolver will compute for this control. Must agree with `roleOf` in packages/embed/src/anchor.ts. */
function roleFor(field: FormField): string {
  const type = (field.type ?? '').toLowerCase();
  if (field.tag === 'textarea') return 'textbox';
  if (field.tag === 'select') return 'combobox';
  if (field.tag === 'button') return 'button';
  if (type === 'checkbox') return 'checkbox';
  if (type === 'radio') return 'radio';
  if (type === 'submit' || type === 'button') return 'button';
  return 'textbox';
}

function kindFor(role: string): Kind {
  if (role === 'combobox') return 'choose';
  if (role === 'checkbox' || role === 'radio') return 'tick';
  if (role === 'button') return 'press';
  return 'fill';
}

function selectorFor(field: FormField): string | undefined {
  if (field.id) return `#${field.id}`;
  if (field.name) return `${field.tag}[name="${field.name}"]`;
  return undefined;
}

/** The label a user will actually see: the literal, or the translated key. */
function visibleLabel(field: FormField, dictionary: Translations | undefined): string | null {
  if (field.label?.trim()) return field.label.trim();
  if (field.labelKey && dictionary) {
    const text = translate(dictionary, field.labelKey);
    if (text?.trim()) return text.trim();
  }
  return null;
}

/**
 * Steps for one page, in the order its fields appear.
 *
 * A field whose label cannot be resolved to text is dropped: a step that cannot
 * name its field cannot be matched semantically, and one anchored by selector
 * alone is the D-3 option the validator warns about.
 */
export function stepsFor(
  fields: readonly FormField[],
  dictionary: Translations | undefined,
  language: string,
): GuidedStep[] {
  const templates = TEMPLATES[language.split('-')[0]!.toLowerCase()] ?? TEMPLATES.en!;
  const out: GuidedStep[] = [];
  for (const field of fields) {
    const label = visibleLabel(field, dictionary);
    if (!label) continue;
    const role = roleFor(field);
    const selector = selectorFor(field);
    const anchor: StepAnchor = { label, role, ...(selector ? { selector } : {}) };
    out.push({ text: templates[kindFor(role)].replace('{label}', label), anchor });
  }
  return out;
}

/** Spread-ready: `{ steps }` when there are any, nothing otherwise. */
export function stepsEntry(
  fields: readonly FormField[],
  dictionary: Translations | undefined,
  language: string,
): { readonly steps?: readonly GuidedStep[] } {
  const steps = stepsFor(fields, dictionary, language);
  return steps.length > 0 ? { steps } : {};
}
