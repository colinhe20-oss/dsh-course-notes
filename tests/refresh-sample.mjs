// Refresh the shipped sample run so its authored chapter matches the current
// knowledge-point id scheme (globally unique K001..Knnn instead of per-chapter
// restart), then re-derive its coverage report.
//
// Run: node tests/refresh-sample.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { checkCoverage, loadNoteTexts, renderCoverageMarkdown, summariseCoverage } from '../lib/coverage.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SAMPLE = path.resolve(HERE, '..', 'docs', 'sample-run');
const CHAPTER = path.join(SAMPLE, 'Chapter_01_第 2 讲 神经网络基础.md');

const knowledge = JSON.parse(fs.readFileSync(path.join(SAMPLE, 'knowledge.json'), 'utf8'));

// The authored chapter is chapter 1; map its old per-chapter ids onto the
// globally unique ids by position within that chapter.
const chapter1 = knowledge.chapters.find((chapter) => chapter.index === 1);
if (!chapter1) throw new Error('sample-run has no chapter 1');

let text = fs.readFileSync(CHAPTER, 'utf8');
const oldIds = [...text.matchAll(/COURSENOTES:POINT (K\d+) START/g)].map((match) => match[1]);
if (oldIds.length !== chapter1.points.length) {
  throw new Error(
    `chapter 1 has ${chapter1.points.length} knowledge points but the note carries ${oldIds.length} markers`,
  );
}

let renamed = 0;
oldIds.forEach((oldId, index) => {
  const newId = chapter1.points[index].id;
  if (oldId === newId) return;
  const before = text;
  text = text.split(`COURSENOTES:POINT ${oldId} START`).join(`COURSENOTES:POINT ${newId} START`);
  text = text.split(`COURSENOTES:POINT ${oldId} END`).join(`COURSENOTES:POINT ${newId} END`);
  if (text !== before) renamed += 1;
});
fs.writeFileSync(CHAPTER, text, 'utf8');
console.log(`renamed ${renamed} marker pairs in ${path.basename(CHAPTER)}`);

// Re-derive coverage against the whole directory.
const notes = loadNoteTexts(SAMPLE);
const points = knowledge.chapters.flatMap((chapter) =>
  (chapter.points ?? []).map((point) => ({
    ...point,
    chapterIndex: chapter.index,
    chapterTitle: chapter.title,
  })),
);
const coverage = checkCoverage(
  { keyPoints: points, chapters: knowledge.chapters, glossary: knowledge.glossary, formulas: knowledge.formulas },
  notes,
);
fs.writeFileSync(path.join(SAMPLE, 'coverage-report.md'), renderCoverageMarkdown(coverage, []), 'utf8');
console.log(summariseCoverage(coverage));
for (const chapter of coverage.byChapter) {
  console.log(`  ch${chapter.chapterIndex} ${chapter.covered}/${chapter.total}  ${chapter.chapterTitle}`);
}
