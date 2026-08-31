import 'server-only';

import mammoth from 'mammoth';
import { extractText, getDocumentProxy } from 'unpdf';

/**
 * Turn an uploaded file into either plain text or base64 image bytes, so
 * `module.capture`'s pipeline can reason over it. Both libraries are pure
 * JS/WASM — no native build step, which this repo's install (`--ignore-scripts`)
 * depends on (see CLAUDE.md).
 *
 * Images are not OCR'd here — the vision-capable model reads the bytes
 * directly (`CompletionRequest.images`), which is the one code path for
 * "understand an image" rather than a second, inconsistent one.
 */

export type ExtractedContent =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'image'; readonly base64: string };

const MAX_DOCUMENT_CHARS = 20000;

export async function extractFromFile(file: File): Promise<ExtractedContent> {
  const type = file.type;

  if (type.startsWith('image/')) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    return { kind: 'image', base64: Buffer.from(bytes).toString('base64') };
  }

  if (type === 'application/pdf') {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const pdf = await getDocumentProxy(bytes);
    const { text } = await extractText(pdf, { mergePages: true });
    return { kind: 'text', text: text.slice(0, MAX_DOCUMENT_CHARS) };
  }

  if (
    type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    file.name.toLowerCase().endsWith('.docx')
  ) {
    const buffer = Buffer.from(await file.arrayBuffer());
    const { value } = await mammoth.extractRawText({ buffer });
    return { kind: 'text', text: value.slice(0, MAX_DOCUMENT_CHARS) };
  }

  // Plain text / markdown / anything else: read as-is.
  const text = await file.text();
  return { kind: 'text', text: text.slice(0, MAX_DOCUMENT_CHARS) };
}
