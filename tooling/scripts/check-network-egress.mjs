#!/usr/bin/env node
// Rule 8: the device is the source of truth.
//
// The register carried this as "verified by inspection" — a convention — with
// the proposal that "a check that runtime packages reference no non-loopback
// host outside the asset manifest would keep it that way". This is that check.
//
// WHY IT MATTERS HERE SPECIFICALLY
//   The product's claim is local inference: the model runs on the device, and
//   an adopter installing this is not handing their users' utterances to a
//   third party. That claim is falsified by a single fetch to a remote host, and
//   nothing but reading has been stopping one from appearing.
//
// WHAT IS ALLOWED
//   1. Loopback. `http://127.0.0.1:11434` is Ollama on the same machine.
//   2. The asset manifest, and only it — on-demand model downloads, which are
//      the one deliberate exception (ADR-006 / core-voice). Every URL there must
//      sit beside a `sha256`, which is the actual safety property: a host that
//      is compromised, or a mirror that is not what it claims, cannot substitute
//      a different binary. An allowlisted host with no hash would be a weaker
//      guarantee than this file pretends to give.
//
// WHAT THIS CANNOT SEE, and both matter
//   - `OLLAMA.host` is `process.env.OLLAMA_HOST || 'http://127.0.0.1:11434'`.
//     The default is loopback; the environment can point it anywhere. That is a
//     deployment concern rather than a source one, and no static check reaches
//     it.
//   - A host assembled at run time from parts. Deliberately not chased: a
//     defence that only stops the obvious spelling is worth having as long as
//     nobody believes it stops the determined one.
//
// Only STRING LITERALS are examined, never comments — a URL in a doc comment is
// documentation, not a request, and failing on those would train people to
// stop writing them.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';

const ROOT = new URL('../..', import.meta.url).pathname
  .replace(/^\/([A-Za-z]:)/, '$1')
  .replace(/\/$/, '');

/** The one file permitted to name a remote host, and only beside a hash. */
const ASSET_MANIFEST = 'packages/core-voice/src/assets.ts';

const LOOPBACK = /^(127\.0\.0\.1|localhost|\[::1\]|::1)(:\d+)?$/i;

/**
 * A URL with a host that could actually be resolved.
 *
 * The character class is deliberately strict rather than "anything up to the
 * next slash". The looser version flagged `apps/web/lib/voice.ts`, where the
 * string is an error message telling the user that microphone access needs a
 * secure context — *"(https://, or localhost)"* — and the comma after the scheme
 * was read as a hostname. A gate whose first finding is a sentence about
 * browser permissions teaches people to ignore it.
 */
const URL_IN_STRING = /\bhttps?:\/\/([a-zA-Z0-9._-]+(?::\d+)?|\[[0-9a-fA-F:]+\](?::\d+)?)/g;

/** Reject a "host" with no dot that is not a known loopback spelling. */
const isPlausibleHost = (host) =>
  host.includes('.') || host.startsWith('[') || LOOPBACK.test(host);

const SKIP_DIRS = new Set(['node_modules', 'dist', 'generated', '.next', 'coverage']);

const walk = (dir) => {
  let out = [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name) || e.name.startsWith('.')) continue;
      out = out.concat(walk(p));
    } else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) && !/\.d\.ts$/.test(e.name)) {
      out.push(p);
    }
  }
  return out;
};

const roots = [];
for (const group of ['packages', 'apps', 'services']) {
  const base = join(ROOT, group);
  let dirs;
  try {
    dirs = readdirSync(base, { withFileTypes: true });
  } catch {
    continue;
  }
  for (const d of dirs) if (d.isDirectory()) roots.push(join(base, d.name));
}

/** Does the object literal containing this node declare a `sha256`? */
function hasSiblingHash(node) {
  for (let n = node.parent; n; n = n.parent) {
    if (ts.isObjectLiteralExpression(n)) {
      const hashed = n.properties.some(
        (p) =>
          (ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) &&
          ts.isIdentifier(p.name) &&
          p.name.text === 'sha256',
      );
      if (hashed) return true;
    }
  }
  return false;
}

const violations = [];
let literals = 0;
let manifestUrls = 0;

for (const file of roots.flatMap(walk)) {
  const text = readFileSync(file, 'utf8');
  if (!/https?:\/\//.test(text)) continue;

  const rel = file.slice(ROOT.length + 1).replace(/\\/g, '/');
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);

  const visit = (node) => {
    const isLiteral =
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node);

    if (isLiteral) {
      const value = node.text;
      for (const m of value.matchAll(URL_IN_STRING)) {
        const host = m[1];
        if (!isPlausibleHost(host)) continue;
        literals++;
        if (LOOPBACK.test(host)) continue;

        const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
        if (rel === ASSET_MANIFEST) {
          manifestUrls++;
          if (!hasSiblingHash(node)) {
            violations.push({
              file: rel,
              line: line + 1,
              host,
              why: 'in the asset manifest but not pinned by a sha256',
            });
          }
          continue;
        }
        violations.push({
          file: rel,
          line: line + 1,
          host,
          why: 'a remote host outside the asset manifest',
        });
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(sf);
}

if (violations.length > 0) {
  console.error(`\n  Rule 8 FAILED — ${violations.length} remote host reference(s).\n`);
  for (const v of violations) {
    console.error(`    ${v.file}:${v.line}  ${v.host}`);
    console.error(`      ${v.why}`);
  }
  console.error(`
  This product's claim is that inference is local — the device is the source of
  truth. One request to a remote host falsifies that for every adopter.

  Loopback is fine. A model asset that must be downloaded belongs in
  ${ASSET_MANIFEST}, pinned by sha256 so a compromised
  host cannot substitute a different binary.
`);
  process.exit(1);
}

console.log(
  `  Rule 8 OK — ${literals} URL literal(s), ${manifestUrls} hash-pinned asset(s), no unpinned remote host.`,
);
