/**
 * Stage C — knowledge structure.
 *
 * Turns normalised documents into:
 *
 *   * `chapters`    — the course outline, one entry per top-level heading,
 *   * `keyPoints`   — atomic knowledge points with a type, a source locator
 *                     and the text they were derived from,
 *   * `glossary`    — bilingual terminology (中文 | English | 缩写 | 说明),
 *   * `formulas`    — formula candidates that must be explained in LaTeX,
 *   * `visionTasks` — figures whose knowledge content needs a multimodal read,
 *   * `dependencies`— prerequisite references detected between chapters.
 *
 * Everything is derived deterministically from the parsed material, so a run
 * is reproducible and the coverage check has a stable baseline.  No content is
 * invented: when a field cannot be determined it stays empty.
 */

import { dominantScript, hasCjk, normalizeWhitespace, uniqueBy } from './util.js';
import { unitLocators } from './cleanup.js';

const STOPWORD_HEADS = new Set([
  '这', '那', '其', '该', '此', '他们', '我们', '你们', '因此', '所以', '但是',
  '如果', '因为', '可以', '需要', '注意', '例如', '比如', '由于', '对于', '通过',
  'the', 'this', 'that', 'these', 'those', 'there', 'then', 'thus', 'here',
  'it', 'they', 'we', 'you', 'a', 'an', 'and', 'or', 'but', 'if', 'because',
  'so', 'note', 'e.g', 'i.e', 'see', 'also', 'when', 'while', 'where',
]);

const KNOWLEDGE_KINDS = [
  [/定义|是指|称为|叫做|又称|定义为|definition|is defined as|refers to|is called/i, 'definition'],
  [/定理|引理|推论|性质|公理|theorem|lemma|corollary|proposition|axiom|property/i, 'theorem'],
  [/公式|方程|表达式|formula|equation|expression|\$\$?/i, 'formula'],
  [/算法|流程|步骤|伪代码|algorithm|pseudocode|procedure|pipeline/i, 'algorithm'],
  [/架构|结构|模型|框架|网络|architecture|structure|model|framework|network diagram/i, 'architecture'],
  [/对比|比较|区别|不同|优于|versus|\bvs\.?\b|comparison|difference|advantage|disadvantage/i, 'comparison'],
  [/例如|举例|示例|例题|案例|example|for instance/i, 'example'],
  [/应用|场景|用途|application|use case|scenario/i, 'application'],
  [/实验|测量|数据集|结果|experiment|dataset|result|evaluation/i, 'experiment'],
  [/证明|推导|推导过程|derive|derivation|proof/i, 'derivation'],
];

export function classifyKnowledgeKind(text) {
  for (const [pattern, kind] of KNOWLEDGE_KINDS) {
    if (pattern.test(text)) return kind;
  }
  return 'concept';
}

/* ------------------------------------------------------------------ terminology */

/**
 * Words that only appear in a sentence, never inside a term name.  When the CJK
 * side of a "term (English)" pair contains one of these, the regex matched a
 * sentence fragment rather than a term — e.g. "传输层通过端口号（port number）"
 * or "与分用（demultiplexing）".  Guessing an English full name for such a
 * fragment is exactly the fabrication the specification forbids, so it is
 * dropped instead.
 */
const SENTENCE_CONNECTOR_RE =
  /(通过|实现|使用|利用|采用|基于|以及|并且|而且|但是|因此|由于|为了|如果|可以|需要|进行|产生|导致|属于|包括|分为|与之|其中)/;

function cleanCandidate(term) {
  return normalizeWhitespace(term)
    .replace(/^[\s("'“”‘’\[【]+/, '')
    .replace(/[\s)"'“”‘’\]】。，,;；:：]+$/, '')
    .trim();
}

function isPlausibleTerm(term) {
  if (term.length < 2 || term.length > 60) return false;
  if (/^\d+([.\-]\d+)*$/.test(term)) return false;
  // Parentheses, brackets and commas never belong to a term name; their
  // presence means a phrase was captured ("dL/dz 为 (n,1)").
  if (/[（()）[\]【】,，;；]/.test(term)) return false;
  if (hasCjk(term)) {
    if (SENTENCE_CONNECTOR_RE.test(term)) return false;
    // A term never ends in a sentence-final particle.
    if (/[的了地得和与或在是]$/.test(term)) return false;
    // A trailing single function character means a clause leaked in.
    return true;
  }
  // Latin-only terms must look like a noun phrase, not prose or notation.
  // Requiring an uppercase letter rejects unstyled variables ("dW", "dz").
  if (!/[A-Z]/.test(term)) return false;
  const words = term.split(/\s+/);
  if (words.length > 3) return false;
  if (words.length === 1 && term.length < 3) return false;
  if (/^(?:the|a|an|is|are|was|were|in|on|of|to|for|with|and|or)\b/i.test(term)) return false;
  return true;
}

function termKey(term) {
  const stripped = term.replace(/\s+/g, ' ').toLowerCase();
  if (hasCjk(stripped)) return `zh:${stripped}`;
  return `en:${stripped}`;
}

/**
 * Collect terminology pairs from a document.
 *
 * Patterns handled (bilingual materials use all of these):
 *   - 中文名称（English Full Name, ABBR）
 *   - 中文名称 (English Full Name)
 *   - English Full Name（中文名称）
 *   - English Full Name (ABBR)
 */
/** Connectives: a CJK term never starts with one, and they mark a boundary. */
const CJK_BOUNDARY = new Set([...'与和及或、']);

/**
 * Characters that make a CJK run a *phrase* rather than a term.
 *
 * `expandLeft` can only stop on a non-term character, and Chinese offers almost
 * none: in "实现复用（multiplexing）" the run reaching the parenthesis is
 * "实现复用", because the preceding "）" is what stops the scan.  Length is the
 * signal that separates the two — a term name is a short noun phrase, while a
 * run this long is a sentence fragment.  The character checks catch the short
 * failures ("的利用率"), the length check catches the long ones.
 */
const CJK_TERM_END_CHARS = new Set([...'实现使用采用利用得到产生导致进行以及并且包括属于需要可以应当处理计算']);

/**
 * Characters that end a phrase rather than a term.  A CJK term does not end in
 * a possessive/attributive particle or a preposition, so a run that does is a
 * *modifier phrase*: in "停等协议（Stop-and-Wait）的利用率：" the text before the
 * parenthesis cannot be split at 的 without losing "利用率", so the whole run is
 * rejected instead of being reported as a term.
 */
const CJK_TERM_TAIL = new Set([...'的地得所之的']);

/** Maximum length of a CJK term name; longer runs are sentence fragments. */
const CJK_TERM_MAX = 8;

/** Characters that may appear inside a (possibly multi-word) term. */
function isTermChar(ch) {
  return /[A-Za-z0-9 .\-+/&'·_]/.test(ch) || hasCjk(ch);
}

/**
 * CJK sentence punctuation.  It is *not* part of a term and, critically, a
 * leftward scan must stop on it — otherwise scanning backwards from a pair
 * walks into the previous sentence and produces a run such as
 * "改变了 NLP。随机梯度下降".
 */
const CJK_PUNCTUATION = new Set([...'。，、；：！？…（）《》〈〉「」『』【】·—～']);

/** Cross-script punctuation is always a boundary. */
function isBoundaryChar(ch) {
  return CJK_PUNCTUATION.has(ch) || /["'“”‘’()\[\]{}<>|/\\]/.test(ch);
}

/**
 * A CJK run that must *not* be part of a term name: sentence connectors, the
 * connective 为 used in variable definitions ("dW 为 (n,m)"), and the noun
 * suffixes 方/式/法/量/数/率 that only appear in prose.
 */
const CJK_RUN_EXCLUDE = /(通过|实现|使用|利用|采用|基于|以及|并且|而且|但是|因此|由于|为了|如果|可以|需要|进行|产生|导致|属于|包括|分为|与之|其中|为|是|的)/;

/** Sentence punctuation ends a term run just as whitespace does. */
const CJK_RUN_BOUNDARY = new Set([...'。，、；：！？…（）《》〈〉「」『』【】·—～']);

/** Expand a CJK run leftwards from `end`, stopping at any boundary. */
function expandCjkLeft(text, end) {
  let start = end;
  while (start > 0) {
    const ch = text[start - 1];
    if (!hasCjk(ch) || CJK_RUN_BOUNDARY.has(ch) || CJK_BOUNDARY.has(ch)) break;
    start -= 1;
  }
  return text.slice(start, end);
}

/** Expand a CJK run rightwards from `start`, stopping at any boundary. */
function expandCjkRight(text, start) {
  let end = start;
  while (end < text.length) {
    const ch = text[end];
    if (!hasCjk(ch) || CJK_RUN_BOUNDARY.has(ch) || CJK_BOUNDARY.has(ch)) break;
    end += 1;
  }
  return text.slice(start, end);
}

/**
 * Expand leftwards from `end` (exclusive), accepting CJK or Latin runs.
 *
 * A plain `([\u3400-\u9fff]+)` capture cannot be used: the engine may start the
 * match anywhere, so it happily begins *inside* a sentence and returns
 * fragments such as "实现复用" or "与分用" for "实现复用（multiplexing）与分用
 * （demultiplexing）".  Scanning outwards from the parenthesis gives the tightest
 * run ending exactly there, which is what a term is.
 */
function expandLeft(text, end) {
  const cjkEnd = (() => {
    let index = end;
    while (index > 0 && /\s/.test(text[index - 1])) index -= 1;
    return index;
  })();
  const cjkRun = expandCjkLeft(text, cjkEnd);
  if (cjkRun !== '') {
    if (CJK_RUN_EXCLUDE.test(cjkRun)) return '';
    if (cjkRun.length > CJK_TERM_MAX) return '';
    if (cjkRun.length > 1 && CJK_TERM_END_CHARS.has(cjkRun[cjkRun.length - 1])) return '';
    if (CJK_TERM_TAIL.has(cjkRun[cjkRun.length - 1])) return '';
    return cjkRun;
  }
  // Latin run: scan back over term characters, stopping at punctuation.
  let start = end;
  let blocked = false;
  while (start > 0) {
    const ch = text[start - 1];
    if (isBoundaryChar(ch)) break;
    if (CJK_TERM_TAIL.has(ch)) {
      blocked = true;
      break;
    }
    if (!isTermChar(ch)) break;
    if (hasCjk(ch) && CJK_BOUNDARY.has(ch)) break;
    start -= 1;
  }
  const run = text.slice(start, end).trim();
  if (blocked) return '';
  if (/[（()）[\]【】,，;；]/.test(run)) return '';
  return run;
}

/**
 * Expand rightwards from `start` (inclusive) while characters are term-like.
 * A CJK run stops at any sentence punctuation, so "改变了 NLP" ends at the
 * following "。".
 */
function expandRight(text, start) {
  let end = start;
  while (end < text.length && /\s/.test(text[end])) end += 1;
  const cjkRun = expandCjkRight(text, end);
  if (cjkRun !== '') return cjkRun;
  let cursor = start;
  while (cursor < text.length) {
    const ch = text[cursor];
    if (isBoundaryChar(ch)) break;
    if (!isTermChar(ch)) break;
    if (hasCjk(ch) && CJK_BOUNDARY.has(ch)) break;
    cursor += 1;
  }
  return text.slice(start, cursor).trim();
}

/**
 * Collect terminology pairs from a document.
 *
 * Patterns handled (bilingual materials use all of these):
 *   - 中文名称（English Full Name, ABBR）
 *   - 中文名称 (English Full Name)
 *   - English Full Name（中文名称）
 *   - English Full Name (ABBR)
 */
export function collectTerminology(text) {
  const source = String(text ?? '');
  const entries = [];

  const consider = (inner, runBefore, after) => {
    const inside = cleanCandidate(inner);
    if (inside === '') return;

    // "中文（English, ABBR）"
    if (hasCjk(runBefore) && !hasCjk(inside) && /[A-Za-z]/.test(inside)) {
      const comma = inside.match(/^(.*?)\s*[,，]\s*([A-Z][A-Za-z0-9-]{1,12})$/);
      const en = cleanCandidate(comma ? comma[1] : inside);
      const abbr = comma ? cleanCandidate(comma[2]) : '';
      if (isPlausibleTerm(runBefore) && /[A-Za-z]/.test(en)) {
        entries.push({ zh: runBefore, en, abbr, pattern: 'zh(en, abbr)' });
        return;
      }
    }
    // "English（中文）"
    if (hasCjk(inside) && !hasCjk(runBefore) && /[A-Za-z]/.test(runBefore)) {
      if (isPlausibleTerm(inside) && /[A-Za-z]/.test(runBefore)) {
        entries.push({ zh: inside, en: runBefore, abbr: '', pattern: 'en(zh)' });
        return;
      }
    }
    // "English（ABBR）" / "English Full Name (ABBR)"
    if (
      !hasCjk(inside) &&
      !hasCjk(runBefore) &&
      /[A-Za-z]/.test(runBefore) &&
      // An abbreviation is uppercase-led; a lowercase-led token is a variable
      // or a notation fragment ("dW 为 (n,1)"), not an abbreviation.
      /^[A-Z][A-Z0-9]{1,11}$/.test(inside)
    ) {
      if (isPlausibleTerm(runBefore)) {
        entries.push({ zh: '', en: runBefore, abbr: inside, pattern: 'en(abbr)' });
        return;
      }
    }
    // "中文（中文别称）" — a synonym at the end of a clause, still useful.
    if (hasCjk(inside) && hasCjk(runBefore) && after.trim() === '') {
      if (isPlausibleTerm(runBefore) && isPlausibleTerm(inside)) {
        entries.push({ zh: runBefore, en: '', abbr: '', pattern: 'zh(zh)' });
      }
    }
  };

  // A composite match — "(optional preceding run) + ( … ) + (optional following
  // run)" — is used instead of iterating the parentheses alone.  Two details
  // matter: the leading run is *lazy* so it stops at the immediately preceding
  // term instead of swallowing an earlier "( … )" pair, and matching a bare
  // parenthesis would let the engine consume a preceding pair and then resume
  // past it, dropping that pair entirely ("实现复用（multiplexing）与分用
  // （demultiplexing）" lost 复用 that way).
  const pattern =
    /([\u3400-\u9fffA-Za-z0-9 .\-+/&'·_]*?)\s*[（(]([^（）()]{1,90})[)）]\s*([\u3400-\u9fffA-Za-z0-9 .\-+/&'·_]*)/g;

  for (const match of source.matchAll(pattern)) {
    /*
     * Locate the bracket that this match actually used.
     *
     * Deriving the offset from the capture lengths is unreliable: the optional
     * trailing run may be empty, and re-encoding `match.index + match[0].length
     * - match[3].length - 1` then lands on the *inner* text ("CNN") instead of
     * the parenthesis.  Searching the match for the last bracket that is not
     * followed by inner text is exact and cheap.
     *
     * The preceding run is deliberately re-scanned with `expandLeft` rather than
     * read from the lazy `match[1]`: leftmost-first matching starts that group as
     * early as possible, so it can hold text from an earlier sentence.
     */
    const openOffset = lastOpeningBracket(match[0]);
    const openParenIndex = openOffset >= 0 ? match.index + openOffset : match.index;
    const before = expandLeft(source, openParenIndex);
    const after = expandRight(source, openParenIndex + match[2].length + 2);
    consider(match[2], before, after);
  }
  return entries;
}

/** Offset of the bracket that opened the parenthetical inside one match. */
function lastOpeningBracket(matched) {
  for (let index = matched.length - 1; index >= 0; index -= 1) {
    const ch = matched[index];
    if ((ch === '(' || ch === '（') && matched[index + 1] !== ')' && matched[index + 1] !== '）') {
      return index;
    }
  }
  return -1;
}

export function mergeGlossary(rawEntries) {
  const byKey = new Map();
  for (const entry of rawEntries) {
    const key = entry.zh !== '' ? termKey(entry.zh) : termKey(entry.en);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, { ...entry, occurrences: 1, locators: entry.locator ? [entry.locator] : [] });
      continue;
    }
    existing.occurrences += 1;
    if (entry.locator && !existing.locators.includes(entry.locator)) {
      existing.locators.push(entry.locator);
    }
    if (existing.en === '' && entry.en !== '') existing.en = entry.en;
    if (existing.zh === '' && entry.zh !== '') existing.zh = entry.zh;
    if (existing.abbr === '' && entry.abbr !== '') existing.abbr = entry.abbr;
  }
  return [...byKey.values()];
}

/* ------------------------------------------------------------------ chapters */

function isHeading(unit) {
  return unit.kind === 'heading';
}

function numericPrefixDepth(text) {
  const match = String(text ?? '').match(/^\s*(\d+(?:\.\d+)*)[.、)]?\s+/);
  if (!match) return null;
  return match[1].split('.').length;
}

function normalizeTitle(text) {
  return normalizeWhitespace(text)
    .replace(/^\s*(?:\d+(?:\.\d+)*)[.、)]?\s+/, '')
    .replace(/[。.：:]\s*$/, '')
    .trim();
}

function nextLevel(stack, level, threshold) {
  void stack;
  void threshold;
  return Math.max(2, level);
}

/**
 * Assemble the course outline from all documents.
 *
 * Level rules, in priority order:
 *
 *   1. A numeric prefix decides the level: `3` → chapter, `3.1` → section,
 *      `3.1.2` → subsection.  This is the only reliable signal in slide decks
 *      where every slide title is the same style.
 *   2. Otherwise the parser's inferred heading level is used, shifted so that
 *      the first heading level seen in a document behaves as a chapter.
 *
 * A document that never reaches chapter level still gets one chapter named
 * after the document, so a flat lecture deck produces a real outline instead
 * of dumping every point into a single "prelude" bucket.
 *
 * When two documents carry the same chapter title the material is merged into
 * one chapter and both source documents are recorded, which is what keeps a
 * multi-file lecture coherent.
 */
export function assembleChapters(documents, options = {}) {
  const threshold = Math.max(1, Math.min(6, options.chapterHeadingLevel ?? 1));
  const chapters = [];
  const byTitle = new Map();
  const docChapters = new Map();

  for (const doc of documents) {
    if (doc.units.length === 0) continue;
    let docChapter = null;
    let currentSection = null;
    let hasChapterLevelHeading = false;

    const ensureDocChapter = () => {
      if (docChapter) return docChapter;
      const heading = doc.units.find((unit) => unit.kind === 'heading');
      docChapter = createChapter(chapters, byTitle, docChapterTitle(doc, heading), {
        fromDocument: true,
      });
      docChapter.documents.push(doc.id);
      docChapters.set(doc.id, docChapter);
      return docChapter;
    };

    // A stub ending in a colon introduces the next unit; carrying it forward
    // keeps "停等协议（Stop-and-Wait）的利用率：" from becoming a title of its own.
    let pendingLeadIn = '';

    for (const unit of doc.units) {
      if (!isHeading(unit)) {
        const chapter = docChapter ?? ensureDocChapter();
        const annotated = {
          ...unit,
          sectionTitle: currentSection ? currentSection.title : '',
          chapterIndex: chapter.index,
        };
        chapter.units.push(annotated);
        if (unit.kind === 'table' && Array.isArray(unit.rows)) {
          const point = buildTablePoint(unit, doc, currentSection);
          if (pendingLeadIn !== '') {
            point.title = `${pendingLeadIn}${point.title}`.slice(0, 160);
            pendingLeadIn = '';
          }
          chapter.points.push(point);
        } else if (unit.text && unit.text !== '') {
          const text = unit.text;
          // A stub that introduces the next unit is not a knowledge point on
          // its own: it becomes the title prefix of whatever follows.
          if (isTitleLeadIn(text)) {
            pendingLeadIn = normalizeWhitespace(text);
          } else {
            const point = buildPoint(
              unit,
              doc,
              currentSection,
              options.maxUnitChars ?? 4000,
              pendingLeadIn,
            );
            pendingLeadIn = '';
            if (point) chapter.points.push(point);
          }
        }
        continue;
      }
      pendingLeadIn = '';

      const depth = numericPrefixDepth(unit.text);
      const level = depth ?? unit.level ?? 2;
      const title = normalizeTitle(unit.text) || unit.text;

      if (level <= threshold) {
        hasChapterLevelHeading = true;
        const chapter = getOrCreateChapter(chapters, byTitle, title);
        if (!chapter.documents.includes(doc.id)) chapter.documents.push(doc.id);
        chapter.locators.push(`${doc.name} ${unit.locator}`);
        chapter.outline.push({ title, level: 1, document: doc.id, locator: unit.locator });
        chapter.units.push({ ...unit, kind: 'heading', level: 1, sectionTitle: '' });
        if (!docChapter) docChapters.set(doc.id, chapter);
        docChapter = chapter;
        currentSection = null;
        continue;
      }

      const chapter = docChapter ?? ensureDocChapter();
      void hasChapterLevelHeading;
      const sectionLevel = Math.max(2, level - threshold + 1);
      currentSection = { title, level: sectionLevel, document: doc.id, locator: unit.locator };
      chapter.outline.push(currentSection);
      chapter.units.push({ ...unit, kind: 'heading', level: sectionLevel, sectionTitle: title });
    }

    // Formulas and figures belong to the chapter the document ended in.
    const owningChapter = docChapter ?? chapters[0] ?? null;
    if (owningChapter) {
      for (const formula of doc.formulas) {
        owningChapter.formulas.push({ ...formula, document: doc.id });
      }
      for (const task of doc.visionTasks) {
        owningChapter.figures.push({ ...task, document: doc.id });
      }
    }
  }

  for (const chapter of chapters) {
    chapter.points = dedupePoints(chapter.points);
    chapter.locators = uniqueBy(chapter.locators, (value) => value);
  }

  /*
   * Give every knowledge point a globally unique id.
   *
   * Per-chapter numbering ("K001" in every chapter) reads as a collision in
   * reports, in `knowledge.json` and in the note brief.  The note markers, the
   * coverage lookup and the cross-chapter tests then all Key off one namespace,
   * so nothing has to reason about which chapter an id belongs to.
   */
  let nextId = 1;
  for (const chapter of chapters) {
    for (const point of chapter.points) {
      point.id = `K${String(nextId).padStart(3, '0')}`;
      nextId += 1;
    }
  }
  return chapters;
}

/** Derive a chapter title for a document without top-level headings. */
function docChapterTitle(doc, firstHeading) {
  if (firstHeading) {
    const depth = numericPrefixDepth(firstHeading.text);
    // "1.1 OSI 参考模型" without a "1 ..." parent: "1" is the real chapter.
    if (depth !== null && depth > 1) {
      const match = String(firstHeading.text).match(/^\s*(\d+)/);
      if (match) return `第 ${match[1]} 章`;
    }
  }
  return normalizeTitle(String(doc.name).replace(/\.[^.]+$/, '')) || doc.name;
}

function getOrCreateChapter(chapters, byTitle, title) {
  const key = titleKey(title);
  if (byTitle.has(key)) return byTitle.get(key);
  const chapter = createChapter(chapters, byTitle, title);
  return chapter;
}

function createChapter(chapters, byTitle, title, extra = {}) {
  const chapter = {
    index: chapters.length + 1,
    title,
    level: 1,
    outline: [],
    points: [],
    units: [],
    documents: [],
    formulas: [],
    figures: [],
    locators: [],
    ...extra,
  };
  chapters.push(chapter);
  byTitle.set(titleKey(title), chapter);
  return chapter;
}

function titleKey(title) {
  return normalizeWhitespace(title)
    .toLowerCase()
    .replace(/[\s_\-–—.、，,：:]+/g, '');
}

/**
 * A "lead-in" unit introduces the next one: a stub ending in a colon, e.g.
 *
 *   停等协议（Stop-and-Wait）的利用率：
 *   $$U = \frac{T_{transmit}}{T_{transmit} + 2 T_{prop}}$$
 *
 * On its own the stub makes a meaningless knowledge-point title, so it is
 * carried forward and prepended to the next unit's title instead.
 *
 * Two things are deliberately excluded:
 *   - a **heading** such as `## 3.2 可靠传输：` is a title, not a lead-in;
 *   - maths and markup (`$$…$$`, `图 3-1：`) carry their own meaning.
 */
export function isTitleLeadIn(text) {
  const value = normalizeWhitespace(text);
  if (value === '' || value.length > 90) return false;
  if (!/[：:]\s*$/.test(value)) return false;
  if (/^\s*#{1,6}\s/.test(value)) return false;
  if (/\$|\\[a-zA-Z]/.test(value)) return false;
  // A lead-in is a stub, not a question or a complete sentence.
  if (/[。！？!?；;]\s*$/.test(value.replace(/[：:]\s*$/, ''))) return false;
  return true;
}

function buildPoint(unit, doc, section, maxUnitChars, leadIn = '') {
  const text = unit.text ?? '';
  if (text.length < 2) return null;
  const firstSentence = text.split(/(?<=[。！？!?;；])\s*/).find((part) => part.trim() !== '') ?? text;
  const rawTitle = firstSentence.length > 60 ? `${firstSentence.slice(0, 58)}…` : firstSentence;
  const title = leadIn === '' ? rawTitle.trim() : `${leadIn} ${rawTitle.trim()}`.trim();
  const terms = collectTerminology(text);
  return {
    id: '',
    title: title.slice(0, 160),
    titleFull: text.length > maxUnitChars ? text.slice(0, maxUnitChars) : text,
    kind: classifyKnowledgeKind(text),
    script: dominantScript(text),
    document: doc.id,
    documentName: doc.name,
    // A merged option group carries every page it spanned.
    locator: unitLocators(unit).join(' + '),
    section: section ? section.title : '',
    page: unit.page,
    mathLike: Boolean(unit.mathLike),
    terms: terms.map((entry) => ({
      zh: entry.zh,
      en: entry.en,
      abbr: entry.abbr,
    })),
    sourceText: text.length > maxUnitChars ? text.slice(0, maxUnitChars) : text,
  };
}

function buildTablePoint(unit, doc, section) {
  const rows = Array.isArray(unit.rows) ? unit.rows : [];
  const header = rows[0]?.join(' / ') ?? '表格';
  return {
    id: '',
    title: `表格：${header}`.slice(0, 80),
    titleFull: rows.map((row) => row.join(' | ')).join('\n'),
    kind: 'table',
    script: 'unknown',
    document: doc.id,
    documentName: doc.name,
    locator: unit.locator,
    section: section ? section.title : '',
    page: unit.page,
    mathLike: false,
    terms: [],
    sourceText: rows.map((row) => row.join(' | ')).join('\n'),
    rows,
  };
}

function dedupePoints(points) {
  const seen = new Set();
  const out = [];
  for (const point of points) {
    const key = `${point.kind}:${normalizeWhitespace(point.title).toLowerCase().slice(0, 80)}`;
    if (seen.has(key)) {
      const existing = out.find((item) => item.key === key);
      if (existing && !existing.locators) existing.locators = [existing.locator];
      if (existing && point.locator && !existing.locators.includes(point.locator)) {
        existing.locators.push(point.locator);
      }
      continue;
    }
    seen.add(key);
    point.key = key;
    out.push(point);
  }
  out.forEach((point, index) => {
    point.id = `K${String(index + 1).padStart(3, '0')}`;
  });
  return out;
}

/* ------------------------------------------------------------------ glossary */

export function buildGlossary(documents, chapters) {
  const raw = [];
  for (const doc of documents) {
    for (const unit of doc.units) {
      const text = unit.kind === 'table' && Array.isArray(unit.rows)
        ? unit.rows.map((row) => row.join(' | ')).join('\n')
        : unit.text ?? '';
      if (text === '') continue;
      for (const entry of collectTerminology(text)) {
        raw.push({ ...entry, locator: `${doc.name} ${unit.locator}` });
      }
    }
  }
  const merged = mergeGlossary(raw);
  merged.sort((a, b) => {
    if (b.occurrences !== a.occurrences) return b.occurrences - a.occurrences;
    return String(a.zh || a.en).localeCompare(String(b.zh || b.en));
  });
  void chapters;
  return merged.map((entry, index) => ({
    index: index + 1,
    zh: entry.zh,
    en: entry.en,
    abbr: entry.abbr,
    occurrences: entry.occurrences,
    locators: entry.locators.slice(0, 5),
    note:
      entry.zh === ''
        ? '英文术语（材料中未给出中文译名，需在笔记中确认译法）'
        : entry.en === ''
          ? '中文术语（材料中未给出英文全称，需核实后再补）'
          : '',
  }));
}

/* ------------------------------------------------------------------ formulas */

export function collectFormulas(documents) {
  const all = [];
  for (const doc of documents) {
    for (const formula of doc.formulas) {
      all.push({ ...formula, document: doc.id, documentName: doc.name });
    }
  }
  return uniqueBy(all, (item) => `${item.text}::${item.locator}::${item.document}`);
}

/* ------------------------------------------------------------------ dependencies */

/**
 * Detect prerequisite references between chapters, e.g. a chapter that opens
 * with "回顾上一讲的梯度下降" depends on the chapter titled 梯度下降.
 */
export function detectDependencies(chapters) {
  const edges = [];
  for (const chapter of chapters) {
    const head = chapter.units.slice(0, 12).map((unit) => unit.text ?? '').join(' ');
    for (const other of chapters) {
      if (other === chapter) continue;
      const key = titleKey(other.title);
      if (key.length < 2) continue;
      const lookback = /回顾|复习|之前|前面|上一讲|上一章|前置|recall|previous|earlier|as before|introduced in/i;
      if (!lookback.test(head)) continue;
      if (head.includes(other.title) || titleKey(head).includes(key)) {
        edges.push({ from: chapter.index, to: other.index, reason: '文中提到先修内容' });
      }
    }
  }
  return edges;
}

/* ------------------------------------------------------------------ entry */

export function extractKnowledge(documents, options = {}) {
  const chapters = assembleChapters(documents, options);
  const glossary = buildGlossary(documents, chapters);
  const formulas = collectFormulas(documents);
  const dependencies = detectDependencies(chapters);
  const keyPoints = chapters.flatMap((chapter) =>
    chapter.points.map((point) => ({ ...point, chapterIndex: chapter.index, chapterTitle: chapter.title })),
  );
  return {
    chapters,
    keyPoints,
    glossary,
    formulas,
    dependencies,
    counts: {
      chapters: chapters.length,
      keyPoints: keyPoints.length,
      glossary: glossary.length,
      formulas: formulas.length,
      dependencies: dependencies.length,
    },
  };
}

export { uniqueBy, hasCjk };
