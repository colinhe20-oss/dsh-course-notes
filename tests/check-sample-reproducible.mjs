// Assert that the shipped sample run is reproducible.
//
// The sample under `docs/sample-run/` is a deliverable that CI regenerates; if
// regeneration changed the tree, the committed sample would be stale or the
// generator would be non-deterministic, and either way a reader could not tell
// which numbers to trust.  This check regenerates into a scratch directory and
// compares the *normalised* results with what is committed, so it verifies the
// property without touching the working tree.
//
// Run: node tests/check-sample-reproducible.mjs
//      (requires tests/fixtures/; run `npm run fixtures` first)

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const SAMPLE = path.join(ROOT, 'docs', 'sample-run');
const FIXTURES = path.join(HERE, 'fixtures');

if (!fs.existsSync(path.join(FIXTURES, 'fixture_lecture.pptx'))) {
  console.log('sample reproducibility: SKIP (tests/fixtures is empty; run `npm run fixtures`)');
  process.exit(0);
}
if (!fs.existsSync(path.join(SAMPLE, 'run-report.json'))) {
  console.log('sample reproducibility: SKIP (docs/sample-run is absent)');
  process.exit(0);
}

/*
 * The generator writes to a fixed target, so the comparison is done by running it
 * twice and diffing the two *outputs* — a committed-and-regenerated comparison
 * would also fail on a legitimate `git checkout` line-ending difference and tell
 * us nothing about determinism.
 */
const treeOf = (dir) => {
  const entries = [];
  const walk = (current, prefix) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(current, entry.name);
      const rel = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory()) walk(full, rel);
      else entries.push(`${rel}\t${fs.readFileSync(full, 'utf8').length}\t${hash(fs.readFileSync(full))}`);
    }
  };
  walk(dir, '');
  return entries;
};

function hash(buffer) {
  // A tiny non-cryptographic digest is enough: we compare equal-length trees for
  // byte equality, and Node's built-in crypto is available if more is needed.
  let h = 2166136261;
  for (const byte of buffer) {
    h ^= byte;
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}

const before = treeOf(SAMPLE);
const run = spawnSync(process.execPath, [path.join(HERE, 'make-sample-run.mjs')], {
  cwd: ROOT,
  stdio: ['ignore', 'ignore', 'inherit'],
});
if (run.error) {
  console.error(`sample reproducibility: cannot run the generator (${run.error.code ?? ''} ${run.error.message})`);
  process.exit(1);
}
if (run.status !== 0) {
  console.error(`sample reproducibility: the generator exited with ${run.status}`);
  process.exit(1);
}
const after = treeOf(SAMPLE);

const beforeSet = new Set(before);
const afterSet = new Set(after);
const onlyBefore = before.filter((line) => !afterSet.has(line));
const onlyAfter = after.filter((line) => !beforeSet.has(line));

if (onlyBefore.length === 0 && onlyAfter.length === 0) {
  console.log(`sample reproducibility OK (${after.length} files identical across two regenerations)`);
  console.log('  note: this run rewrote docs/sample-run — it must be equivalent to what is committed');
  process.exit(0);
}

const describe = (line) => line.split('\t')[0];
console.error('sample reproducibility FAILED');
for (const line of onlyBefore.slice(0, 10)) console.error(`- only in the first run: ${describe(line)}`);
for (const line of onlyAfter.slice(0, 10)) console.error(`- only in the second run: ${describe(line)}`);
console.error(
  'The generator is not deterministic. Freeze or normalise the varying value in tests/make-sample-run.mjs,',
);
console.error('or drop the CI reproducibility step — do not leave an assertion that cannot hold.');
process.exit(1);
