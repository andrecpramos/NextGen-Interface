#!/usr/bin/env node
// A release is one version, one changelog section and one license, everywhere.
//
// An adopter installs eight tarballs together, and `@nextgen/kit` depends on the other
// seven by exact version. A package left behind at an older version installs cleanly
// from its own tarball and then fails to resolve for the kit — or worse, resolves to
// the stale one. The release notes an adopter reads come from CHANGELOG.md, and a
// release whose section was never written publishes empty notes.
//
// WHAT IT CHECKS
//   1. Every publishable package (not `private`) carries the same version.
//   2. CHANGELOG.md has a non-empty `## <version>` section.
//   3. Every publishable package declares the root package's license and ships a
//      LICENSE file byte-identical to the root one.
//   With --tag vX.Y.Z (the release workflow):
//   4. The tag is exactly `v<version>`.
//   5. The section is not still marked "unreleased" — the date goes in before the tag.
//   With --notes <file>: writes that section's body to <file>, for the GitHub Release.
//
//   node tooling/scripts/check-release.mjs [--tag v0.1.0] [--notes notes.md]

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const argument = (name) => {
  const at = process.argv.indexOf(`--${name}`);
  return at === -1 ? null : (process.argv[at + 1] ?? null);
};
const TAG = argument('tag');
const NOTES = argument('notes');

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8').replace(/^﻿/, ''));
const problems = [];

const rootLicenseText = existsSync(join(ROOT, 'LICENSE')) ? readFileSync(join(ROOT, 'LICENSE'), 'utf8') : null;
if (rootLicenseText === null) problems.push('LICENSE is missing at the repository root');
const rootLicense = readJson(join(ROOT, 'package.json')).license;
if (!rootLicense) problems.push('the root package.json declares no `license`');

const packages = [];
for (const name of readdirSync(join(ROOT, 'packages'))) {
  const manifestPath = join(ROOT, 'packages', name, 'package.json');
  if (!existsSync(manifestPath)) continue;
  const manifest = readJson(manifestPath);
  if (manifest.private) continue;
  packages.push({ dir: name, manifest });

  if (manifest.license !== rootLicense) {
    problems.push(`${manifest.name}: license is ${JSON.stringify(manifest.license)}, the root declares ${JSON.stringify(rootLicense)}`);
  }
  const licensePath = join(ROOT, 'packages', name, 'LICENSE');
  if (!existsSync(licensePath)) {
    problems.push(`${manifest.name}: no LICENSE file in packages/${name}/ — the tarball would ship without one`);
  } else if (rootLicenseText !== null && readFileSync(licensePath, 'utf8') !== rootLicenseText) {
    problems.push(`${manifest.name}: packages/${name}/LICENSE differs from the root LICENSE — copy it again`);
  }
}

const versions = [...new Set(packages.map((p) => p.manifest.version))];
if (versions.length !== 1) {
  problems.push(`publishable packages disagree on the version: ${packages.map((p) => `${p.manifest.name}@${p.manifest.version}`).join(', ')}`);
}
const version = versions[0];

let section = null;
let heading = null;
const changelogPath = join(ROOT, 'CHANGELOG.md');
if (!existsSync(changelogPath)) {
  problems.push('CHANGELOG.md is missing');
} else if (version) {
  const lines = readFileSync(changelogPath, 'utf8').split('\n');
  const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const start = lines.findIndex((line) => new RegExp(`^## ${escaped}(\\s|$)`).test(line));
  if (start === -1) {
    problems.push(`CHANGELOG.md has no "## ${version}" section`);
  } else {
    heading = lines[start];
    const next = lines.findIndex((line, i) => i > start && /^## /.test(line));
    section = lines.slice(start + 1, next === -1 ? undefined : next).join('\n').trim();
    if (section.length === 0) problems.push(`CHANGELOG.md's "## ${version}" section is empty`);
  }
}

if (TAG !== null && version) {
  if (TAG !== `v${version}`) problems.push(`tag ${TAG} does not match the packages' version ${version} (expected v${version})`);
  if (heading && /unreleased/i.test(heading)) {
    problems.push(`CHANGELOG.md still says "${heading.slice(3)}" — replace "unreleased" with the release date before tagging`);
  }
}

if (problems.length > 0) {
  console.error(`\n  Release check FAILED — ${problems.length} problem(s).\n`);
  for (const problem of problems) console.error(`    ${problem}`);
  console.error('\n  Releasing is described in .claude/sdlc/branching.md, "Releasing".\n');
  process.exit(1);
}

if (NOTES !== null && section !== null) writeFileSync(NOTES, `${section}\n`);
console.log(
  `  Release OK — ${packages.length} package(s) at ${version}, a CHANGELOG section, and the ${rootLicense} LICENSE in each${TAG ? `; tag ${TAG} matches` : ''}.`,
);
