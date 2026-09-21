import { describe, expect, it } from 'vitest';

import { ACCEPT, ATTACH_EVENT, checkAttachment, kindOf, LIMITS, offerFiles, safeName, sizeText, thumbnail } from './attach.ts';

/**
 * What a visitor may attach, and what happens to it.
 *
 * A file the visitor picks is untrusted input that never leaves their device: it is not sent to the router,
 * to a trace or to a model — the assistant has no use for it, and this product's promise is that nothing
 * is sent anywhere. It is shown back to them and handed to the host page, which may want it. Every limit
 * here is declared (Rule 13), because `accept` is a hint to a file picker and is not enforced on a paste or a drop.
 */

const file = (name: string, type = '', size = 1000) => ({ name, type, size });

describe('checkAttachment — what is let in', () => {
  it('lets in photos and documents, by type or by extension', () => {
    for (const f of [
      file('photo.jpg', 'image/jpeg'),
      file('IMG_0042.HEIC', ''), // a phone often reports no type at all
      file('scan.png', 'image/png'),
      file('receipt.pdf', 'application/pdf'),
      file('notes.txt', 'text/plain'),
      file('squad.csv', 'text/csv'),
      file('certificate.docx', ''),
      file('sheet.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
    ]) {
      expect(checkAttachment(f, 0), f.name).toBeNull();
    }
  });

  it('turns away what a page could run: an executable, a script, an SVG', () => {
    for (const f of [file('setup.exe', 'application/x-msdownload'), file('run.js', 'text/javascript'), file('logo.svg', 'image/svg+xml'), file('page.html', 'text/html'), file('archive.zip', 'application/zip')]) {
      expect(checkAttachment(f, 0), f.name).toBe('unsupported');
    }
  });

  it('turns away the empty and the enormous, at the declared limit', () => {
    expect(checkAttachment(file('empty.pdf', 'application/pdf', 0), 0)).toBe('empty');
    expect(checkAttachment(file('ok.pdf', 'application/pdf', LIMITS.bytes), 0)).toBeNull();
    expect(checkAttachment(file('big.pdf', 'application/pdf', LIMITS.bytes + 1), 0)).toBe('too-large');
  });

  it('turns away a fifth file when four is the limit, whatever it is', () => {
    expect(checkAttachment(file('a.png', 'image/png'), LIMITS.files - 1)).toBeNull();
    expect(checkAttachment(file('a.png', 'image/png'), LIMITS.files)).toBe('too-many');
  });

  it('says so in the order that is most useful: the file itself first, the count last', () => {
    expect(checkAttachment(file('x.exe', 'application/x-msdownload'), LIMITS.files)).toBe('unsupported');
  });

  it('declares its limits, and the file picker is told the same types', () => {
    expect(LIMITS.files).toBe(4);
    expect(LIMITS.bytes).toBe(15 * 1024 * 1024);
    expect(ACCEPT).toMatch(/image\/\*/);
    expect(ACCEPT).toMatch(/pdf/);
    expect(ACCEPT).not.toMatch(/svg|html|exe|zip/);
  });
});

describe('what is shown of a file', () => {
  it('tells a photo from a document', () => {
    expect(kindOf(file('a.jpg', 'image/jpeg'))).toBe('image');
    expect(kindOf(file('a.heic', ''))).toBe('image');
    expect(kindOf(file('a.pdf', 'application/pdf'))).toBe('pdf');
    expect(kindOf(file('a.docx', ''))).toBe('document');
    expect(kindOf(file('a.csv', 'text/csv'))).toBe('document');
  });

  it('writes a size a person reads', () => {
    expect(sizeText(512)).toBe('512 B');
    expect(sizeText(2048)).toBe('2 KB');
    expect(sizeText(1.5 * 1024 * 1024)).toBe('1.5 MB');
    expect(sizeText(15 * 1024 * 1024)).toBe('15 MB');
  });

  it('shows a name without the path a phone or a browser may put in front of it, and never a very long one', () => {
    expect(safeName('C:\\fakepath\\photo.jpg')).toBe('photo.jpg');
    expect(safeName('/var/mobile/tmp/photo.jpg')).toBe('photo.jpg');
    expect(safeName('a\u0000b\u202ec.pdf')).toBe('abc.pdf');
    const long = `${'x'.repeat(200)}.pdf`;
    const shown = safeName(long);
    expect(shown.length).toBeLessThanOrEqual(48);
    expect(shown.endsWith('.pdf')).toBe(true);
    expect(shown).toContain('…');
    expect(safeName('')).toBe('file');
  });
});

describe('offerFiles — the hand-off to the page', () => {
  const window = (onEvent?: (event: { type: string; detail: unknown; preventDefault(): void }) => void) => {
    const seen: { type: string; detail: unknown }[] = [];
    class CustomEvent {
      type: string;
      detail: unknown;
      cancelable: boolean;
      defaultPrevented = false;
      constructor(type: string, init: { detail?: unknown; cancelable?: boolean } = {}) {
        this.type = type;
        this.detail = init.detail;
        this.cancelable = Boolean(init.cancelable);
      }
      preventDefault(): void {
        if (this.cancelable) this.defaultPrevented = true;
      }
    }
    return {
      seen,
      view: {
        CustomEvent,
        dispatchEvent(event: CustomEvent) {
          seen.push({ type: event.type, detail: event.detail });
          onEvent?.(event);
          return !event.defaultPrevented;
        },
      } as unknown as Window & typeof globalThis,
    };
  };
  const detail = { files: [file('a.png', 'image/png')] as unknown as readonly File[], utterance: 'here', route: '/x' };

  it('offers them as a cancelable event named for the product, carrying the files, the words and the page', () => {
    const { view, seen } = window();
    offerFiles(view, detail);
    expect(seen).toEqual([{ type: ATTACH_EVENT, detail }]);
    expect(ATTACH_EVENT).toBe('nextgen:attach');
  });

  it('is true only when the page took them', () => {
    expect(offerFiles(window((e) => e.preventDefault()).view, detail)).toBe(true);
    expect(offerFiles(window().view, detail)).toBe(false);
  });

  it('is false, and harmless, where there is no page to offer them to', () => {
    expect(offerFiles({} as unknown as Window & typeof globalThis, detail)).toBe(false);
  });
});

describe('thumbnail', () => {
  it('is nothing where the browser cannot decode an image on its own, and never throws', async () => {
    const doc = { createElement: () => ({}) } as unknown as Document;
    expect(await thumbnail(file('a.png', 'image/png') as unknown as File, doc, {} as unknown as Window & typeof globalThis)).toBeNull();
  });

  it('is nothing for a document', async () => {
    const view = { createImageBitmap: () => Promise.reject(new Error('should not be asked')) } as unknown as Window & typeof globalThis;
    expect(await thumbnail(file('a.pdf', 'application/pdf') as unknown as File, {} as unknown as Document, view)).toBeNull();
  });

  it('is nothing when the image cannot be decoded (a HEIC in a browser that cannot read it)', async () => {
    const view = { createImageBitmap: () => Promise.reject(new Error('cannot decode')) } as unknown as Window & typeof globalThis;
    expect(await thumbnail(file('a.heic', '') as unknown as File, {} as unknown as Document, view)).toBeNull();
  });

  it('draws a small square and closes the bitmap it made', async () => {
    let closed = false;
    const drawn: number[][] = [];
    const bitmap = { width: 400, height: 200, close: () => (closed = true) };
    const canvas = { width: 0, height: 0, getContext: () => ({ drawImage: (_b: unknown, ...args: number[]) => drawn.push(args) }) };
    const view = { createImageBitmap: async () => bitmap } as unknown as Window & typeof globalThis;
    const doc = { createElement: () => canvas } as unknown as Document;
    const result = await thumbnail(file('a.png', 'image/png') as unknown as File, doc, view, 96);
    expect(result).toBe(canvas);
    expect(canvas.width).toBe(96);
    expect(canvas.height).toBe(96);
    // A 2:1 photo is cropped to the middle, not squashed: 200×200 out of the centre.
    expect(drawn[0]).toEqual([100, 0, 200, 200, 0, 0, 96, 96]);
    expect(closed).toBe(true);
  });
});
