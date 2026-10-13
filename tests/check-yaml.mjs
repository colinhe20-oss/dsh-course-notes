// Dependency-free sanity check for the bundle patch and the CI workflow.
//
// These files are load-bearing: a malformed `cordis.patch.yml` makes the bundle
// fail to install, and a broken workflow file fails on GitHub only after a push.
// Neither repository has a YAML library available, so this checks the invariants
// that actually break them: tabs (illegal in YAML indentation), trailing
// whitespace, inconsistent indentation, CRLF contamination, and — for the patch
// file — the expected `- insert:` shape with an `id` and a `name`.
//
// Run: node tests/check-yaml.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const problems = [];
const note = (file, line, message) => problems.push(`${file}:${line} ${message}`);

function scan(file) {
  const text = fs.readFileSync(path.join(root, file), 'utf8');
  const lines = text.split('\n');
  lines.forEach((line, index) => {
    const lineNo = index + 1;
    if (/\t/.test(line)) note(file, lineNo, 'tab character (illegal in YAML indentation)');
    if (/[ \t]+$/.test(line)) note(file, lineNo, 'trailing whitespace');
    if (/\r/.test(line)) note(file, lineNo, 'CR character (file must be LF)');
    if (line.length > 200) note(file, lineNo, `line too long (${line.length} chars)`);
    const indent = line.match(/^ */)[0].length;
    if (indent % 2 !== 0) note(file, lineNo, `odd indentation (${indent} spaces)`);
  });
  if (text.trim() === '') note(file, 0, 'file is empty');
  return { text, lines };
}

/* ------------------------------------------------- cordis.patch.yml */

const patchFile = 'cordis.patch.yml';
const patch = scan(patchFile);
const patchLines = patch.lines.filter((line) => line.trim() !== '' && !/^\s*#/.test(line));
if (!patchLines.some((line) => /^-\s*insert:\s*$/.test(line))) {
  note(patchFile, 0, 'missing top-level "- insert:" list entry');
}
if (!patchLines.some((line) => /^\s*-\s*id:\s*\S+/.test(line))) {
  note(patchFile, 0, 'no "- id:" row inside the insert list');
}
if (!patchLines.some((line) => /^\s*name:\s*\S+/.test(line))) {
  note(patchFile, 0, 'no "name:" field for the inserted plugin');
}
const patchIds = [...patch.text.matchAll(/^\s*-?\s*id:\s*([^\s#]+)/gm)].map((m) => m[1]);
const patchNames = [...patch.text.matchAll(/^\s*name:\s*['"]?([^\s'"#]+)/gm)].map((m) => m[1]);
if (patchIds.length !== patchNames.length) {
  note(patchFile, 0, `id/name count mismatch (${patchIds.length} ids, ${patchNames.length} names)`);
}

/* ------------------------------------------------- .github/workflows/ci.yml */

const ciFile = '.github/workflows/ci.yml';
const ci = scan(ciFile);
if (!/^name:\s*\S+/m.test(ci.text)) note(ciFile, 0, 'missing workflow "name:"');
if (!/^on:\s*$/m.test(ci.text) && !/^on:\s*\S+/m.test(ci.text)) note(ciFile, 0, 'missing "on:" trigger');
if (!/^jobs:\s*$/m.test(ci.text)) note(ciFile, 0, 'missing "jobs:" block');
if (!/runs-on:\s*\S+/.test(ci.text)) note(ciFile, 0, 'no "runs-on:" runner');
if (!/uses:\s*actions\/checkout@/.test(ci.text)) note(ciFile, 0, 'no checkout step');

/* ------------------------------------------------- plugin identity */

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const insertedName = patchNames[0] ?? '';
if (pkg.name !== insertedName) {
  note(patchFile, 0, `inserted name "${insertedName}" != package.json name "${pkg.name}" (the loader would not resolve the bundle)`);
}
if (pkg.dsh?.bundle?.patch !== './cordis.patch.yml') {
  note('package.json', 0, `dsh.bundle.patch must point at ./cordis.patch.yml (found ${pkg.dsh?.bundle?.patch})`);
}
if (pkg.private === true) note('package.json', 0, 'still marked private');
if (pkg.license !== 'MIT') note('package.json', 0, `license is "${pkg.license}"`);

console.log(`checked ${patchFile}, ${ciFile}, package.json`);
console.log(`plugin id/name pairs: ${patchIds.map((id, i) => `${id}=${patchNames[i] ?? '?'}`).join(', ')}`);
if (problems.length === 0) {
  console.log('\nYAML/IDENTITY OK');
  process.exit(0);
}
console.log(`\nPROBLEMS (${problems.length}):`);
for (const problem of problems) console.log(`   ${problem}`);
process.exit(1);
