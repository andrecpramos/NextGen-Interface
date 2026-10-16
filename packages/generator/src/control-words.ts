/**
 * The words that tell a control's job and who may use it (ADR-042), shared by the two readers of controls:
 * `controls.ts` (TSX, through the TypeScript AST) and `markup.ts` (Vue, Svelte and Angular templates, as
 * text). One vocabulary, so a framework never decides differently what counts as a task. Per-language
 * vocabulary in the generator, not the engine, for the app's two supported languages.
 */

/**
 * Calls that do nothing a visitor would name as a task: state, navigation, event plumbing, a dialog's own
 * open and close, a refresh. A handler made only of these is not an action.
 */
export const INERT_CALL =
  /^(set[A-Z]\w*|setState|navigate|push|replace|back|forward|goBack|go|goTo\w*|navigateTo\w*|routeTo\w*|redirect|preventDefault|stopPropagation|stopImmediatePropagation|(open|close|show|hide|toggle)(Dialog|Modal|Sheet|Drawer|Panel|Menu|Popover|Form|Filters?)?|on(Select|Change|Toggle|Back|Next|Prev\w*|Open\w*|Close|\w+Change)|refetch|invalidateQueries|reset(Form|Field|Filters?|Search|Selection)?|log|warn|error|info|debug|focus|blur|select|scroll\w*|changeLanguage|t|getValues|clearErrors)$/;

/** A handler passed by name that, by its name, only shows, closes, moves or selects. */
export const INERT_HANDLER =
  /^(set[A-Z]\w*|(handle)?(open|close|show|hide|toggle)([A-Z]\w*)?|navigate\w*|goTo\w*|goBack|on(Select|Change|Toggle|Back|Next|Prev\w*|Open\w*|Close|\w+Change)|refetch|reset(Form|Field|Filters?|Search|Selection)?)$/;

/**
 * Text that is about who may do something. Broad on purpose: what matches it and cannot be read leaves a
 * control out, which costs a word of matching; a miss would name a control to a role that may not have it.
 * Whose an item is counts too — `article.author.username === user?.username` (a public SvelteKit app):
 * "Delete Article" is its author's, and a registry cannot say so.
 */
const ABOUT_WHO_WORDS =
  /\bcannot\b|role|permission|\bperms?\b|admin|allowed|authori[sz]|abilit|polic(y|ies)|entitle|privilege|capabilit|\bauthor|\bowner|createdBy|ownedBy/i;
/**
 * The camelCase flags — `canEdit`, `isAdmin`, `isMine` — case-sensitive. Read case-insensitively, `can…`
 * matched `CANCELLED`, `cancel`, `candidate`: on a real app, `isCancelled = status === 'CANCELLED'`
 * dropped every attendance control and "Reopen" as if they were behind a permission (2026-10-16).
 */
const ABOUT_WHO_FLAGS = /\bcan[A-Z_]\w*|\bcan\s*\(|\bis(Owner|Staff|Manager|Coach|Guardian|Parent|Player|Medical|Finance|Director|Admin|Mine|Own|Super\w*)\b/;

/** Is this condition's text about who the visitor is — a role, a permission, whose the item is? */
export function aboutWho(text: string): boolean {
  return ABOUT_WHO_FLAGS.test(text) || ABOUT_WHO_WORDS.test(text);
}

/**
 * Lone words every form and dialog has, and the few phrases that only page through, filter, retry or undo.
 * They say nothing about what a screen is for, and "Cancelar" in a dialog is not "cancel the session".
 */
const CHROME = new Set([
  'cancel', 'cancelar', 'close', 'fechar', 'back', 'voltar', 'ok', 'okay', 'confirm', 'confirmar', 'yes', 'sim',
  'no', 'nao', 'next', 'seguinte', 'proximo', 'previous', 'anterior', 'prev', 'continue', 'continuar', 'done',
  'concluido', 'apply', 'aplicar', 'reset', 'repor', 'limpar', 'clear', 'retry', 'refresh', 'save', 'guardar',
  'gravar', 'submit', 'submeter', 'skip', 'saltar', 'dismiss', 'ignorar', 'undo', 'anular', 'redo', 'refazer',
  'ver mais', 'mostrar mais', 'carregar mais', 'load more', 'show more', 'see more', 'see all', 'ver todos',
  'ver tudo', 'try again', 'tentar novamente', 'go back', 'limpar filtro', 'limpar filtros', 'clear filter',
  'clear filters', 'clear all', 'limpar tudo', 'recomecar', 'restart', 'start over',
]);

/**
 * "← Voltar à biblioteca", "Back to sessions", "Sign out": a way out of the screen or the session, whatever
 * its handler calls. "View Provenance", "Ver modalidades": looking, not doing. "Fotografia anterior", "Next
 * photo": paging through. Found rehearsing on real apps (2026-10-16), and never a task a visitor asks for.
 */
const LEAVES = /^(voltar|regressar|back to|go back|return to|sign out|log out|logout|sair|terminar sessao|encerrar sessao)\b/;
const LOOKS = /^(view|ver|see|show|mostrar|abrir|open)\b/;
const PAGES = /^(previous|prev|next|anterior|seguinte|proxim[oa])\b|\b(anterior|seguinte|previous|next|proxim[oa])$/;
/** Leaving the session, wherever the label says it: "Or click here to logout." (a public Vue app). */
const LOGS_OUT = /\b(sign out|log out|logout|logoff|terminar sessao|encerrar sessao)\b/;

/** A control's name that names no task: a lone word every dialog has, a way out, looking, paging, or no word at all. */
export function isChrome(label: string): boolean {
  const flat = label.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
  return flat.length < 2 || CHROME.has(flat) || LEAVES.test(flat) || LOOKS.test(flat) || PAGES.test(flat) || LOGS_OUT.test(flat);
}
