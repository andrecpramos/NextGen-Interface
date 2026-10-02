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
//      the one deliberate exception (ADR-006; the package that held it was deleted by
//      ADR-018 — see below). Every URL there must
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

/**
 * There is no longer a file permitted to name a remote host.
 *
 * Until ADR-018 there was one: `packages/core-voice/src/assets.ts`, which named the
 * hosts serving the Whisper and Piper binaries and pinned each by sha256. That package
 * is deleted — the voice an adopter's users get is the Web Speech API, on-device,
 * downloading nothing — so the exception has no subject and is removed rather than left
 * pointing at a path that does not exist. It had already gone vacuous: the gate reported
 * "0 hash-pinned asset(s)" and passed, which is precisely the failure mode this
 * repository has been bitten by twice.
 *
 * If something ever needs to download an asset again, re-adding the exception is a
 * deliberate act with an ADR behind it, not a constant someone quietly edits.
 */
const ASSET_MANIFEST = null;

const LOOPBACK = /^(127\.0\.0\.1|localhost|\[::1\]|::1)(:\d+)?$/i;

/**
 * A URL with a host that could actually be resolved.
 *
 * The character class is deliberately strict rather than "anything up to the
 * next slash". The looser version flagged the since-removed `apps/web/lib/voice.ts`, where the
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
for (const group of ['packages', 'apps']) {
  const base = join(ROOT, group);
  let dirs;
  try {
    dirs = readdirSync(base, { withFileTypes: true });
  } catch {
    continue;
  }
  for (const d of dirs) if (d.isDirectory()) roots.push(join(base, d.name));
}

const violations = [];
let literals = 0;

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

  Loopback is fine; nothing else is. No package downloads an asset any more
  (ADR-018), so there is no longer an exception for a pinned manifest. If one is
  genuinely needed again, add it deliberately — with the sha256 pin and an ADR —
  rather than widening this gate to make a failure go away.
`);
  process.exit(1);
}

console.log(
  `  Rule 8 OK — ${literals} URL literal(s) scanned, no remote host named outside loopback.`,
);
