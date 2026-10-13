// Audit the bundled sample runs: are they genuine, and do their numbers agree
// with the files they ship with?
//
// Run: node tests/audit-samples.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function audit(dir) {
  const full = path.join(root, dir);
  if (!fs.existsSync(full)) {
    console.log(`\n=== ${dir}: MISSING`);
    return;
  }
  const files = fs.readdirSync(full).filter((name) => fs.statSync(path.join(full, name)).isFile());
  console.log(`\n=== ${dir} (${files.length} files)`);
  for (const name of files) {
    const size = fs.statSync(path.join(full, name)).size;
    console.log(`   ${String(Math.round(size / 1024)).padStart(4)} KiB  ${name}`);
  }

  const reportPath = path.join(full, 'run-report.json');
  if (fs.existsSync(reportPath)) {
    const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    console.log(`   report.courseName = ${JSON.stringify(report.courseName ?? report.course ?? null)}`);
    const documents = report.documents ?? report.files ?? [];
    console.log(`   report documents = ${Array.isArray(documents) ? documents.length : 'n/a'}`);
    if (Array.isArray(documents)) {
      for (const doc of documents.slice(0, 8)) {
        console.log(`      - ${doc.name ?? doc.path ?? '?'} [${doc.format ?? '?'}] ${doc.status ?? ''}`);
      }
    }
  }

  const chapterFiles = files.filter((name) => /^Chapter_.*\.md$/.test(name));
  let chars = 0;
  let todos = 0;
  let englishBlocks = 0;
  for (const name of chapterFiles) {
    const text = fs.readFileSync(path.join(full, name), 'utf8');
    chars += text.length;
    todos += (text.match(/COURSENOTES:TODO/g) ?? []).length;
    englishBlocks += (text.match(/\*\*English Explanation\*\*/g) ?? []).length;
  }
  console.log(`   chapters = ${chapterFiles.length}, total chars = ${chars}`);
  console.log(`   remaining TODO markers = ${todos}`);
  console.log(`   legacy English Explanation blocks = ${englishBlocks}`);

  const coveragePath = path.join(full, 'coverage-report.md');
  if (fs.existsSync(coveragePath)) {
    const text = fs.readFileSync(coveragePath, 'utf8');
    const ratio = text.match(/覆盖率 \/ Coverage ratio: \*\*([\d.]+)%/);
    const points = text.match(/Extracted knowledge points: \*\*(\d+)\*\*/);
    console.log(`   coverage report: points=${points?.[1] ?? '?'} ratio=${ratio?.[1] ?? '?'}%`);
  }
}

for (const dir of ['docs/sample-run', 'docs/sample-run-real-pdf']) audit(dir);

/* Does the fixture generator produce the material these samples claim? */
const fixtureScript = fs.readFileSync(path.join(root, 'tests/make_fixtures.py'), 'utf8');
const fixtureNames = [...new Set([...fixtureScript.matchAll(/fixture[_-]?[a-zA-Z0-9]*/g)].map((m) => m[0]))];
console.log(`\nfixtures referenced by tests/make_fixtures.py: ${fixtureNames.slice(0, 14).join(', ')}`);
for (const keyword of ['神经网络', 'Transport', '传输层', '概述']) {
  console.log(`   make_fixtures.py contains ${JSON.stringify(keyword)}: ${fixtureScript.includes(keyword)}`);
}
