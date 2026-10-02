// What a visitor may attach to what they say, and what happens to it.
//
// A photo or a file is untrusted input, and it never leaves the visitor's device: it is not sent to the
// router, to a trace or to a model — the assistant has no use for it, and this product's promise is that
// nothing is sent anywhere. It is shown back to them, and it is handed to the page the assistant sits in
// (`nextgen:attach`), which may want it: an upload form, an inbox, a claim. Whether the page does anything
// with it is the page's business, and the visitor is told which.
//
// Every limit is declared (Rule 13). `accept` on a file input is a hint to a picker, not a check: a paste
// or a drop bypasses it, so nothing here relies on it.

/** Declared, not discovered: what one message may carry. */
export const LIMITS = { files: 4, bytes: 15 * 1024 * 1024 } as const;

/** What a file picker is told to offer. The real check is `checkAttachment`. */
export const ACCEPT = 'image/*,application/pdf,.pdf,.txt,.csv,.doc,.docx,.xls,.xlsx,.rtf';

/** The cancelable event a page takes to receive what was attached (`event.preventDefault()` says it did). */
export const ATTACH_EVENT = 'nextgen:attach';

export interface AttachDetail {
  readonly files: readonly File[];
  /** What the visitor typed with them; empty when they sent only the files. */
  readonly utterance: string;
  /** The page they were on. */
  readonly route: string;
}

/** The little a file needs to be judged by: a real `File`, or anything shaped like one. */
export interface Attachable {
  readonly name: string;
  readonly type: string;
  readonly size: number;
}

export type Rejection = 'unsupported' | 'empty' | 'too-large' | 'too-many';

const IMAGE_EXT = /\.(?:jpe?g|png|webp|gif|heic|heif|avif|bmp)$/i;
const DOCUMENT_EXT = /\.(?:pdf|txt|csv|docx?|xlsx?|rtf|odt|ods)$/i;
/** Whatever else a type or a name claims, these are things a page could run or unpack. */
const DENIED_EXT = /\.(?:exe|msi|bat|cmd|sh|js|mjs|jar|apk|dll|scr|html?|svgz?|zip|rar|7z|tar|gz)$/i;
const DOCUMENT_TYPES = new Set([
  'application/pdf',
  'text/plain',
  'text/csv',
  'application/rtf',
  'application/msword',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);

function isAllowed(file: Attachable): boolean {
  const type = file.type.toLowerCase();
  if (type === 'image/svg+xml' || DENIED_EXT.test(file.name)) return false;
  return type.startsWith('image/') || DOCUMENT_TYPES.has(type) || IMAGE_EXT.test(file.name) || DOCUMENT_EXT.test(file.name);
}

/**
 * Why `file` may not be attached, or null. `already` is how many are attached. The file itself is judged
 * before the count, so a visitor told "too many" is not then told their fifth file was fine.
 */
export function checkAttachment(file: Attachable, already: number): Rejection | null {
  if (!isAllowed(file)) return 'unsupported';
  if (file.size <= 0) return 'empty';
  if (file.size > LIMITS.bytes) return 'too-large';
  if (already >= LIMITS.files) return 'too-many';
  return null;
}

export type FileKind = 'image' | 'pdf' | 'document' | 'file';

export function kindOf(file: Attachable): FileKind {
  const type = file.type.toLowerCase();
  if (type.startsWith('image/') || IMAGE_EXT.test(file.name)) return 'image';
  if (type === 'application/pdf' || /\.pdf$/i.test(file.name)) return 'pdf';
  if (DOCUMENT_TYPES.has(type) || DOCUMENT_EXT.test(file.name)) return 'document';
  return 'file';
}

export function sizeText(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace(/\.0$/, '')} MB`;
}

/**
 * A name a person can read: the last part of whatever path a phone or a browser put in front of it, with
 * no control or direction-overriding characters (a name is untrusted text, and one that reverses the
 * writing direction is a way to make `photo.exe` look like `exe.otohp`), and cut in the middle when long.
 */
export function safeName(name: string): string {
  const last = name.split(/[\\/]/).pop() ?? '';
  // eslint-disable-next-line no-control-regex
  const clean = last.replace(/[\u0000-\u001f\u007f-\u009f‎‏‪-‮⁦-⁩]/g, '').trim();
  if (!clean) return 'file';
  const max = 48;
  if (clean.length <= max) return clean;
  const dot = clean.lastIndexOf('.');
  const extension = dot > 0 && clean.length - dot <= 6 ? clean.slice(dot) : '';
  return `${clean.slice(0, max - extension.length - 1)}…${extension}`;
}

/** Offer what was attached to the page. True when the page took it (`preventDefault`). */
export function offerFiles(view: Window & typeof globalThis, detail: AttachDetail): boolean {
  const Event = view.CustomEvent;
  if (typeof Event !== 'function') return false;
  const event = new Event<AttachDetail>(ATTACH_EVENT, { detail, cancelable: true });
  view.dispatchEvent(event);
  return event.defaultPrevented;
}

/**
 * A small square picture of a photo, or null. Drawn to a canvas by the browser's own decoder — a `blob:`
 * or `data:` URL in an `<img>` is exactly what a strict Content-Security-Policy refuses, and a canvas is
 * not — and never for a document, and never a reason for anything to fail: a browser that cannot decode
 * the image (a HEIC anywhere but Safari) simply gets the file's icon instead.
 */
export async function thumbnail(file: File, doc: Document, view: Window & typeof globalThis, size = 96): Promise<HTMLCanvasElement | null> {
  if (kindOf(file) !== 'image' || typeof view.createImageBitmap !== 'function') return null;
  let bitmap: ImageBitmap;
  try {
    bitmap = await view.createImageBitmap(file);
  } catch {
    return null;
  }
  try {
    const canvas = doc.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext('2d');
    if (!context) return null;
    // The middle of the picture, not the picture squashed.
    const side = Math.min(bitmap.width, bitmap.height);
    context.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, size, size);
    return canvas;
  } catch {
    return null;
  } finally {
    bitmap.close?.();
  }
}
