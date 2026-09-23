// Holds `nextgen.d.ts` — the hand-written types an adopter is handed — to the real exports.
//
// Compiled by this package's typecheck and never run. Each line assigns a real export to the declared
// type: if the widget changes so that what the declaration promises is no longer true — an option
// removed or renamed, a result that no longer has a method — this file stops compiling. A declaration
// may say *less* than the source (it leaves out what adopters do not call), never something false.

import type * as Declared from '../nextgen.d.ts';
import * as Real from './index.ts';

export const start: typeof Declared.start = Real.start;
export const StartErrorClass: typeof Declared.StartError = Real.StartError;
export const errorEvent: typeof Declared.ERROR_EVENT = Real.ERROR_EVENT;
export const learnEvent: typeof Declared.LEARN_EVENT = Real.LEARN_EVENT;
export const turnEvent: typeof Declared.TURN_EVENT = Real.TURN_EVENT;

// And the other way for the shapes an adopter builds and passes in: what the declaration lets them
// write must be what the widget accepts.
export const companion = (c: Declared.Companion): Real.Companion => c;
export const lesson = (l: Real.Lesson): Declared.Lesson => l;
export const decide = (d: Declared.Decide): Real.Decide => d;

// Assignability forgives a declared property the source does not have — an option that was renamed
// would still "check". So every declared key must exist in the source too.
type Only<D, R> = [Exclude<keyof D, keyof R>] extends [never] ? true : { readonly declaredButNotReal: Exclude<keyof D, keyof R> };
export const startOptions: Only<Declared.StartOptions, Real.StartOptions> = true;
export const companionKeys: Only<Declared.Companion, Real.Companion> = true;
export const mountedKeys: Only<Declared.MountedAssistant, Real.MountedAssistant> = true;
export const lessonKeys: Only<Declared.Lesson, Real.Lesson> = true;
