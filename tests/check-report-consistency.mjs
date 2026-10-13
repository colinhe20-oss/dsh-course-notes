// Check that a run directory's reports describe the same run.
//
// This is the guard for the v1.0 defect where `run-report.json` and
// `coverage-report.md` were serialised at different moments and shipped
// disagreeing coverage numbers.  Every assertion here compares one artifact
// against another; nothing is compared against a hard-coded expectation, because
// the point is *internal* consistency, not a frozen snapshot.
//
// Run: node tests/check-report-consistency.mjs [dir ...]
//   (no arguments = every directory under docs/ that contains a run-report.json)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  checkCoverage,
  checkNoteStructure,
  checkQuality,
  loadNoteTexts,
} from '../lib/coverage.js';
import { validateCitations } from '../lib/evidence.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

const problems = [];
const notes = [];

function ok(message) {
  notes.push(`  ok   ${message}`);
}

function fail(message) {
  problems.push(message);
  notes.push(`  FAIL ${message}`);
}

function discoverRunDirs() {
  const docsDir = path.join(ROOT, 'docs');
  if (!fs.existsSync(docsDir)) return [];
  return fs
    .readdirSync(docsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(docsDir, entry.name))
    .filter((dir) => fs.existsSync(path.join(dir, 'run-report.json')));
}

/** Recompute coverage/quality from the shipped files, then compare with the JSON. */
function checkDirectory(dir) {
  const label = path.relative(ROOT, dir) || dir;
  notes.push(`\n${label}`);
  /*
   * A snapshot that is not a real run cannot be checked for internal consistency,
   * and pretending otherwise would train the reader to ignore failures.  The
   * opt-out is an explicit file next to the sample, so it is a decision someone
   * made, not a silent skip.
   */
  const optOut = path.join(dir, 'CONSISTENCY-NA.md');
  if (fs.existsSync(optOut)) {
    notes.push('  --   CONSISTENCY-NA.md present; this snapshot is not a run and is not checked');
    return;
  }
  let report;
  try {
    report = JSON.parse(fs.readFileSync(path.join(dir, 'run-report.json'), 'utf8'));
  } catch (error) {
    fail(`${label}: run-report.json is not valid JSON (${error.message})`);
    return;
  }

  /* 1. Knowledge points in the JSON exist, and the note files exist.  */
  const knowledgePath = path.join(dir, 'knowledge.json');
  if (!fs.existsSync(knowledgePath)) {
    fail(`${label}: run-report.json exists but knowledge.json does not`);
    return;
  }
  const knowledge = JSON.parse(fs.readFileSync(knowledgePath, 'utf8'));
  const chapterList = Array.isArray(knowledge.chapters) ? knowledge.chapters : [];
  const points = chapterList.flatMap((chapter) =>
    (chapter.points ?? []).map((point) => ({
      ...point,
      chapterIndex: chapter.index,
      chapterTitle: chapter.title,
      chapterKey: `Chapter_${String(chapter.index).padStart(2, '0')}`,
      terms: point.terms ?? [],
      sourceText: point.sourceText ?? '',
    })),
  );
  const normalised = {
    keyPoints: points.length > 0 ? points : knowledge.keyPoints ?? [],
    chapters: chapterList,
    glossary: knowledge.glossary ?? [],
    formulas: knowledge.formulas ?? [],
  };

  const noteFiles = (report.noteFiles ?? []).filter((name) => !/\.coursenotes[\\/]/.test(name));
  for (const name of noteFiles) {
    if (!fs.existsSync(path.join(dir, name))) fail(`${label}: run-report.json lists ${name}, which does not exist`);
  }
  if (noteFiles.length === 0) {
    fail(`${label}: run-report.json lists no note files`);
    return;
  }
  ok(`${noteFiles.length} note file(s) listed and present`);

  const loaded = loadNoteTexts(dir);
  if (loaded.length === 0) {
    fail(`${label}: no note Markdown could be loaded for the consistency check`);
    return;
  }

  /* 2. Coverage: recompute from the notes and compare with the JSON. */
  const coverage = checkCoverage(normalised, loaded);
  const claimed = report.coverage;
  if (!claimed) {
    fail(`${label}: run-report.json has no coverage block, so consistency cannot be checked`);
  } else {
    const checks = [
      ['totalKeyPoints', coverage.totalKeyPoints],
      ['covered', coverage.covered],
      ['partial', coverage.partial],
      ['missing', coverage.missing],
    ];
    for (const [field, actual] of checks) {
      if (claimed[field] !== actual) {
        fail(`${label}: coverage.${field} is ${claimed[field]} in run-report.json but ${actual} recomputed`);
      }
    }
    if (Math.abs((claimed.ratio ?? -1) - coverage.ratio) > 0.001) {
      fail(
        `${label}: coverage.ratio is ${claimed.ratio} in run-report.json but ${coverage.ratio} recomputed`,
      );
    }
    if (!problems.some((problem) => problem.startsWith(`${label}: coverage.`))) {
      ok(`coverage in run-report.json matches a recomputation (ratio ${coverage.ratio})`);
    }
  }

  /* 3. coverage-report.md must carry the same ratio as the JSON. */
  const coverageMdPath = path.join(dir, 'coverage-report.md');
  if (!fs.existsSync(coverageMdPath)) {
    fail(`${label}: run-report.json exists but coverage-report.md does not`);
  } else {
    const markdown = fs.readFileSync(coverageMdPath, 'utf8');
    const claimedRatio = report.coverage?.ratio;
    if (typeof claimedRatio === 'number') {
      const expected = `${(claimedRatio * 100).toFixed(1)}%`;
      if (!markdown.includes(expected)) {
        fail(
          `${label}: coverage-report.md does not state the ${expected} ratio that run-report.json claims`,
        );
      } else {
        ok(`coverage-report.md and run-report.json agree on ${expected}`);
      }
    }
    const claimedPoints = report.coverage?.totalKeyPoints;
    if (typeof claimedPoints === 'number' && !markdown.includes(`**${claimedPoints}**`)) {
      fail(`${label}: coverage-report.md does not state the ${claimedPoints} extracted points from the JSON`);
    }
  }

  /* 4. Every written file reported as successful really exists. */
  const written = report.writtenFiles;
  if (Array.isArray(written)) {
    let missing = 0;
    for (const entry of written) {
      if (entry.ok === false) continue;
      if (!fs.existsSync(path.join(dir, entry.path))) missing += 1;
    }
    if (missing > 0) fail(`${label}: ${missing} file(s) reported as written are absent`);
    else ok(`${written.filter((entry) => entry.ok !== false).length} written file(s) verified on disk`);
  } else {
    notes.push('  --   no writtenFiles list in this report (older format)');
  }

  /* 5. Markdown structure of the notes must be sound. */
  const structureIssues = [];
  for (const note of loaded) structureIssues.push(...checkNoteStructure(note.text, note.path).issues);
  const errors = structureIssues.filter((issue) => issue.severity === 'error');
  if (errors.length > 0) {
    fail(`${label}: ${errors.length} Markdown structure error(s): ${errors.map((issue) => issue.code).join(', ')}`);
  } else {
    ok('no Markdown structure errors in the note files');
  }

  /* 6. Citation validity, when the run shipped an evidence index. */
  const evidencePath = path.join(dir, '.coursenotes', 'evidence.json');
  if (fs.existsSync(evidencePath)) {
    const evidence = JSON.parse(fs.readFileSync(evidencePath, 'utf8'));
    const citations = validateCitations(loaded, evidence);
    if (citations.unknown.length > 0) {
      fail(`${label}: ${citations.unknown.length} citation(s) do not match the shipped evidence index`);
    } else {
      ok(`${citations.cited.length} citation(s) all match the shipped evidence index`);
    }
  } else {
    notes.push('  --   no .coursenotes/evidence.json in this sample (v1.0 format)');
  }

  /* 7. A `verified` claim must be backed by a clean quality measurement. */
  const quality = checkQuality(normalised, loaded, { language: report.options?.language ?? 'bilingual' });
  if (report.completion) {
    if (report.completion === 'verified') {
      if (quality.points.complete !== quality.points.total) {
        fail(
          `${label}: claims completion=verified but only ${quality.points.complete}/${quality.points.total} points pass every dimension`,
        );
      } else if (quality.structure.remainingTodoMarkers > 0) {
        fail(`${label}: claims completion=verified but ${quality.structure.remainingTodoMarkers} placeholder(s) remain`);
      } else {
        ok('completion=verified is backed by a clean quality measurement');
      }
    } else {
      ok(`completion=${report.completion} is not a success claim (no consistency requirement)`);
    }
  } else {
    notes.push('  --   no completion state in this report (older format)');
  }
}

const targets = process.argv.slice(2).map((dir) => path.resolve(ROOT, dir));
const dirs = targets.length > 0 ? targets : discoverRunDirs();
if (dirs.length === 0) {
  console.log('no run directories with a run-report.json were found');
  process.exit(0);
}
for (const dir of dirs) checkDirectory(dir);

console.log(notes.join('\n'));
if (problems.length > 0) {
  console.error(`\nreport consistency FAILED: ${problems.length} problem(s)`);
  for (const problem of problems) console.error(`- ${problem}`);
  process.exit(1);
}
console.log(`\nreport consistency OK (${dirs.length} directory/ies)`);
