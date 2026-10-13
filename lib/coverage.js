/**
 * Stage F — coverage and quality checking.
 *
 * The coverage check compares two lists that are produced independently:
 *
 *   * **A — extracted knowledge points** (`knowledge.json`, from the parsed
 *     material), and
 *   * **B — knowledge points present in the final notes** (read back from the
 *     Markdown files on disk).
 *
 * A point counts as *covered* when the note text actually contains its
 * distinctive content, not merely its chapter title.  Matching is done on
 * normalised lexical overlap plus the point's bilingual terminology, because a
 * faithful note rarely repeats a slide sentence verbatim.
 *
 * Coverage is an internal completeness indicator only.  It says nothing about
 * whether the explanations are correct, and the report says so.
 */

import fs from 'node:fs';
import path from 'node:path';
import { normalizeWhitespace, hasCjk, uniqueBy } from './util.js';

const COVERED_THRESHOLD = 0.55;
const PARTIAL_THRESHOLD = 0.25;

/**
 * Remove fenced code blocks from note text.
 *
 * This matters: the generated scaffold embeds each knowledge point's *source
 * text* inside a ```text fence as "material evidence".  If coverage were
 * measured against the raw file, every point would score 100% purely because
 * its own source text was copied in — the metric would be meaningless.  Only
 * what was actually written *around* the source blocks counts as coverage.
 */
export function stripFencedBlocks(text) {
  const value = String(text ?? '');
  const out = [];
  let inFence = false;
  for (const line of value.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (!inFence) out.push(line);
  }
  return out.join('\n');
}

/** Count the authoring placeholders a note still carries. */
export function countTodoMarkers(text) {
  return (String(text ?? '').match(/COURSENOTES:TODO/g) ?? []).length;
}

/**
 * Slice out the authored body of each knowledge point section.
 *
 * Notes carry `<!-- COURSENOTES:POINT K001 START -->` / `... END -->` markers
 * around each knowledge point section.  Within such a section, the blocks
 * between ```text fences hold the raw material excerpt ("material evidence")
 * and the "来源 / References" tail repeats the point's own locator; neither is
 * authored prose, so both are excluded.  What remains is exactly the text a
 * model or a human wrote for that point.
 *
 * Keys are `chapterKey::pointId`.  Knowledge-point ids restart at K001 in every
 * chapter, so keying by the bare id would let a later chapter silently shadow an
 * earlier one and report finished work as missing.
 */
export function slicePointSections(notes) {
  const sections = new Map();
  for (const note of notes) {
    const chapterKey = note.chapterKey ?? chapterKeyOf(note.name ?? '');
    const pattern = /<!--\s*COURSENOTES:POINT\s+([A-Za-z0-9_-]+)\s+START\s*-->([\s\S]*?)<!--\s*COURSENOTES:POINT\s+\1\s+END\s*-->/g;
    for (const match of note.text.matchAll(pattern)) {
      const id = match[1];
      const body = stripFencedBlocks(match[2]);
      const authored = body
        .split('\n')
        .filter((line) => {
          const trimmed = line.trim();
          if (/^\*\*来源 \/ References\*\*/.test(trimmed)) return false;
          if (/^- \[课件内容\]/.test(trimmed)) return false;
          if (/^\*\*来源 \/ Source\*\*/.test(trimmed)) return false;
          if (/^#{2,4}\s/.test(trimmed)) return false;
          return true;
        })
        .join('\n');
      const record = {
        id,
        chapterKey,
        full: match[2],
        authored,
        todoCount: countTodoMarkers(match[2]),
        authoredTokens: tokenize(authored),
      };
      // Two keys per section: the chapter-qualified one (robust when ids repeat
      // across chapters) and the bare id (used when ids are globally unique).
      sections.set(`${chapterKey}::${id}`, record);
      if (!sections.has(id)) sections.set(id, record);
    }
  }
  return sections;
}

/** Split text into comparable tokens: CJK bigrams + Latin words. */
export function tokenize(text) {
  const value = String(text ?? '').toLowerCase();
  const tokens = new Set();
  const latin = value.match(/[a-z][a-z0-9_+#.-]{2,}/g) ?? [];
  for (const word of latin) {
    if (word.length < 3) continue;
    tokens.add(word);
  }
  const cjkRuns = value.match(/[\u3400-\u9fff]{2,}/g) ?? [];
  for (const run of cjkRuns) {
    for (let index = 0; index < run.length - 1; index += 1) {
      tokens.add(run.slice(index, index + 2));
    }
    if (run.length <= 8) tokens.add(run);
  }
  return tokens;
}

/**
 * Canonical atom set of a formula, blind to notation.
 *
 * `tokenize` cannot match a formula written in LaTeX against the same formula
 * taken from a PDF's text layer: `\|x - y\|_\infty` yields the "word" `infty`
 * while the baseline's `||x - y||_inf` yields `x`, `y`, `inf`, so the two share
 * almost nothing.  This function reduces both notations to the same atoms, so
 * the test measures what it claims to measure — is this formula present? —
 * regardless of how the note renders it.
 *
 * A *set* rather than a character sequence is used deliberately: character
 * overlap is far too permissive, because a fabricated formula drawn from the
 * same alphabet ("g(x) = 7 * exp(sinh(13*zeta)) + 99") trivially contains most
 * of the characters of any real one and would be reported as present.
 */
/**
 * Canonical names for structural commands.
 *
 * Plain ASCII names are used deliberately: the atom pipeline lower-cases its
 * input and later strips everything outside `[a-z0-9]`, so a sentinel built
 * from a control character survives one step and is then silently deleted,
 * which is how `\lfloor` turned into the meaningless token "floor" and stopped
 * matching.  The `zz` prefix keeps these names from colliding with real
 * variables.
 */
const CANONICAL_SENTINEL = {
  '\\lfloor': 'zzlfloor',
  '\\rfloor': 'zzrfloor',
  '\\lceil': 'zzlceil',
  '\\rceil': 'zzrceil',
  '\\infty': 'zzinfty',
  '\\to': 'zzto',
  '\\partial': 'zzpartial',
  '\\nabla': 'zznabla',
  '\\sum': 'zzsum',
  '\\prod': 'zzprod',
  '\\int': 'zzint',
  '\\sqrt': 'zzsqrt',
  '\\frac': 'zzfrac',
  '\\cdot': 'zztimes',
  '\\times': 'zztimes',
  '\\oplus': 'zzoplus',
  '\\otimes': 'zzotimes',
};

/** Greek letters: the LaTeX spelling and the ASCII spelling must coincide. */
const GREEK = [
  'epsilon', 'varepsilon', 'lambda', 'theta', 'delta', 'sigma', 'alpha', 'beta',
  'gamma', 'mu', 'eta', 'rho', 'phi', 'varphi', 'psi', 'omega', 'tau', 'pi',
];

/** Atoms that must appear for a formula to count as present. */
const OPERATOR_ATOMS = new Set([
  'zzlfloor', 'zzrfloor', 'zzlceil', 'zzrceil', 'zzinfty',
  'zzsum', 'zzprod', 'zzint', 'zzsqrt', 'zzfrac',
  'zzpartial', 'zznabla', 'zzto', 'zztimes', 'zzoplus',
  'le', 'ge', 'ne', 'lt', 'gt', 'eq', 'max', 'min', 'argmin', 'argmax',
  'exp', 'log', 'ln', 'floor', 'ceil',
]);

export function formulaAtoms(text) {
  let value = String(text ?? '').toLowerCase();
  /*
   * Order matters.  Every substitution that *recognises* a command must run
   * before the catch-all `.replace(/\\[a-z]+/g, ' ')`, otherwise `\le` and
   * `\infty` are erased before the comparison and infinity mappings can see
   * them — which silently turned the whole formula `f(x_bar) - f* <= L/(2p)`
   * into an empty atom set.
   */
  value = value.replace(/\\[a-z]+/g, (command) => CANONICAL_SENTINEL[command] ?? command);
  value = value
    .replace(/\\begin\{[^}]*\}|\\end\{[^}]*\}/g, ' ')
    .replace(/\\(?:bigl|bigr|Bigl|Bigr|left|right|quad|qquad|text|mathrm|operatorname|limits|mathbf|mathcal|mathbb)\b/g, ' ');
  // Comparison operators and set membership, in both plain and LaTeX spellings.
  value = value
    .replace(/\\le\b|\\leq\b|<=|=</g, ' le ')
    .replace(/\\ge\b|\\geq\b|>=|=>/g, ' ge ')
    .replace(/\\ne\b|\\neq\b|!=|≠/g, ' ne ')
    .replace(/\\approx\b|≈/g, ' approx ')
    .replace(/\\in\b|∈/g, ' zzin ');
  // Only now discard anything left of the form `\command`.
  value = value.replace(/\\[a-z]+/g, ' ');
  /*
   * `_` and `^` are *separators*, not letters.  Without this,
   * `\sum_{i=1}^{n}` first became the single token "zzsum" glued to its
   * subscript and then lost the canonical name entirely, so neither the
   * summation nor the subscript variables could ever match.
   */
  value = value.replace(/[_^]/g, ' ');
  // Plain-text spellings of mathematical objects.
  value = value
    .replace(/\b_?inf\b/g, ' zzinfty ')
    .replace(/\bis\s+an\s+element\s+of\b|\bin\b/g, ' zzin ')
    .replace(/→|->/g, ' zzto ')
    // Operators are padded on both sides: without the spaces, `2*b` collapses
    // into the single atom "zztimesb" and the operator is lost.
    .replace(/×|\*/g, ' zztimes ')
    .replace(/\bunion\b|∪/g, ' union ');
  // Unify Greek letter spellings that differ only by a leading backslash.
  for (const letter of GREEK) {
    value = value.split(`\\${letter}`).join(` ${letter} `);
  }
  /*
   * Plain-text spellings of the same structural objects.  A PDF text layer
   * writes `sum`, `floor`, `argmin`, `inf` and `epsilon` with no backslash,
   * while the LaTeX side produced canonical names; without this mapping the two
   * notations never meet and every formula that a note renders in LaTeX is
   * reported missing.
   */
  value = value
    .replace(/\barg\s*min\b/g, ' argmin ')
    .replace(/\barg\s*max\b/g, ' argmax ')
    .replace(/\bsum\b/g, ' zzsum ')
    .replace(/\bprod\b/g, ' zzprod ')
    .replace(/\bfrac\b/g, ' zzfrac ')
    .replace(/\bsqrt\b/g, ' zzsqrt ')
    .replace(/\bfloor\b/g, ' zzlfloor ')
    .replace(/\bceil\b/g, ' zzlceil ')
    .replace(/\bpartial\b/g, ' zzpartial ')
    .replace(/\bnabla\b/g, ' zznabla ')
    .replace(/\bcdot\b/g, ' zztimes ')
    .replace(/\s\*\s/g, ' zztimes ');
  value = value
    .replace(/[{}$]/g, ' ')
    .replace(/[^a-z0-9 ]+/g, ' ');
  const set = new Set();
  for (const token of value.split(' ')) {
    const atom = token.trim();
    if (atom === '') continue;
    if (atom.length >= 2 || /[0-9]/.test(atom) || /^[a-z]$/.test(atom)) set.add(atom);
  }
  return set;
}

/**
 * Is `formula` present in `noteText`?
 *
 * The comparison is done *per formula occurrence* rather than against the whole
 * document.  The notes contain hundreds of formulas, so atoms from unrelated
 * ones (a stray `theta`, a stray `f`) satisfy almost any target and the score
 * collapses; restricting the numerator to a single rendered formula is what
 * makes the test discriminating.
 *
 * A formula counts as present when some rendered formula in the notes
 *
 *   1. contains at least one of the target's *operator* atoms (a comparison, a
 *      sum, a floor, a transcendental function, ...), and
 *   2. covers at least {@link FORMULA_MATCH_THRESHOLD} of the target's atoms.
 *
 * Condition 1 is what keeps a fabricated formula drawn from the same alphabet
 * from being reported as present.
 */
export const FORMULA_MATCH_THRESHOLD = 0.7;

/**
 * Does the target carry any distinctive atom at all?
 *
 * A target made only of single letters and digits (`x = y + z`, `a = 2*b`)
 * matches spans by accident, because those symbols occur everywhere in a
 * mathematical document.  Requiring one atom of two or more characters is enough
 * to exclude that class: real terse formulas such as `L_P(h) = E_P[…]` still
 * contribute `lp` and `e`.  The discriminating work is done by the match
 * threshold — a fabricated formula scored 0.1–0.5 against real spans in
 * testing, far below it.
 */
function isSpecificFormula(target) {
  for (const atom of target) {
    if (OPERATOR_ATOMS.has(atom)) continue;
    if (/[a-z0-9]{2,}/.test(atom)) return true;
  }
  return false;
}

export function formulaPresent(formula, noteText) {
  const target = formulaAtoms(formula);
  if (target.size < 3) return false;
  if (!isSpecificFormula(target)) return false;

  const spans = formulaSpans(noteText);
  // Fall back to the whole text for notes that render no formulas at all.
  if (spans.length === 0) spans.push(String(noteText ?? ''));

  const targetOperators = [...target].filter((atom) => OPERATOR_ATOMS.has(atom));

  let best = 0;
  for (const span of spans) {
    if (span.length > 4000) continue;
    const atoms = formulaAtoms(span);
    if (atoms.size === 0) continue;
    if (targetOperators.length > 0 && !targetOperators.some((atom) => atoms.has(atom))) continue;
    let hit = 0;
    for (const atom of target) {
      if (atoms.has(atom)) hit += 1;
    }
    let ratio = hit / target.size;
    /*
     * An inline rendering often carries only *part* of the target: the note
     * writes `$\max(0, 1 - y'y)$` while the PDF baseline also includes the
     * left-hand side `phi_h(y = h_theta(x), y')`.  Such a span is recognisable
     * by its *precision* — nearly every atom it contains belongs to the target —
     * even though its recall is only partial.  Promoting that case is safe
     * because a span assembled from unrelated atoms cannot be almost entirely
     * contained in the target.
     */
    if (ratio >= 0.5 && ratio < FORMULA_MATCH_THRESHOLD) {
      let spanAtomsInTarget = 0;
      for (const atom of atoms) if (target.has(atom)) spanAtomsInTarget += 1;
      const precision = spanAtomsInTarget / atoms.size;
      if (precision >= 0.85) ratio = FORMULA_MATCH_THRESHOLD;
    }
    if (ratio > best) best = ratio;
    if (best >= FORMULA_MATCH_THRESHOLD) return true;
  }
  return best >= FORMULA_MATCH_THRESHOLD;
}

/**
 * Extract the individual formulas from a Markdown note.
 *
 * Handles `$$…$$` display blocks, `$…$` inline spans, and — because not every
 * note is LaTeX — single lines that look like a formula on their own.
 */
export function formulaSpans(text) {
  const spans = [];
  const value = String(text ?? '');
  for (const match of value.matchAll(/\$\$([\s\S]{1,600}?)\$\$/g)) spans.push(match[1]);
  for (const match of value.matchAll(/(?<!\$)\$([^$\n]{1,300}?)\$(?!\$)/g)) spans.push(match[1]);
  if (spans.length === 0) {
    for (const line of value.split('\n')) {
      if (line.length <= 200 && /[=<>≤≥∑∈]/.test(line)) spans.push(line);
    }
  }
  return spans;
}

function similarity(pointTokens, noteTokens) {
  if (pointTokens.size === 0) return 0;
  let hit = 0;
  for (const token of pointTokens) {
    if (noteTokens.has(token)) hit += 1;
  }
  return hit / pointTokens.size;
}

/** Files that live beside the notes but are not note content. */
const NON_NOTE_FILES = new Set([
  'coverage-report.md',
  'readme.md',
  'run-report.md',
  'authoring-report.md',
  'references.md',
  'glossary.md',
  'index.md',
]);

/**
 * Load every Markdown file under a directory (two levels of nesting included).
 *
 * `chapterKey` is the `Chapter_NN` prefix of the file name when present.  It
 * matters because knowledge-point ids restart at K001 in every chapter, so a
 * point id is only unique together with its chapter.
 */
export function loadNoteTexts(noteDir) {
  const files = [];
  const walk = (dir, depth) => {
    if (depth > 2) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'assets' || entry.name === '.coursenotes') continue;
        walk(full, depth + 1);
      } else if (/\.(md|markdown)$/i.test(entry.name)) {
        if (NON_NOTE_FILES.has(entry.name.toLowerCase())) continue;
        try {
          files.push({
            path: full,
            name: entry.name,
            chapterKey: chapterKeyOf(entry.name),
            text: fs.readFileSync(full, 'utf8'),
          });
        } catch {
          /* unreadable note files are reported by the caller */
        }
      }
    }
  };
  walk(noteDir, 0);
  return files;
}

/** "Chapter_03_第三章 传输层.md" → "Chapter_03"; anything else → the file name. */
export function chapterKeyOf(fileName) {
  const match = String(fileName).match(/^(Chapter[_-]?\d+)/i);
  if (match) return match[1];
  return String(fileName).replace(/\.(md|markdown)$/i, '');
}

/** Structural checks that are cheap but catch the most damaging regressions. */
export function checkNoteStructure(text, fileName) {
  const issues = [];
  const lines = String(text ?? '').split('\n');
  const headings = lines.filter((line) => /^#{1,6}\s+\S/.test(line));
  const fenceCount = lines.filter((line) => /^\s*```/.test(line)).length;
  if (headings.length === 0) {
    issues.push({ severity: 'error', code: 'no-heading', message: `${fileName}: 没有任何 Markdown 标题` });
  }
  if (fenceCount % 2 !== 0) {
    issues.push({ severity: 'error', code: 'unbalanced-fence', message: `${fileName}: 代码块围栏数量为奇数（${fenceCount}），Markdown 结构可能损坏` });
  }
  const tableLines = lines.filter((line) => /^\s*\|.*\|\s*$/.test(line));
  if (tableLines.length > 0) {
    const separator = lines.findIndex((line) => /^\s*\|?\s*:?-{2,}/.test(line));
    if (separator === -1) {
      issues.push({ severity: 'warn', code: 'table-without-separator', message: `${fileName}: 检测到表格但缺少分隔行` });
    }
  }
  const todoCount = (text.match(/COURSENOTES:TODO/g) ?? []).length;
  const dollarCount = (text.match(/\$\$/g) ?? []).length;
  if (dollarCount % 2 !== 0) {
    issues.push({ severity: 'warn', code: 'unbalanced-math', message: `${fileName}: $$ 块数量为奇数（${dollarCount}），公式可能未闭合` });
  }
  const internal = [...String(text).matchAll(/\]\((?!https?:|mailto:|#)([^)]+)\)/g)].map((match) => match[1]);
  const brokenLinks = [];
  const baseDir = path.dirname(fileName);
  for (const target of internal) {
    const clean = target.split('#')[0];
    if (clean === '') continue;
    const resolved = path.resolve(baseDir, decodeURIComponent(clean));
    if (!fs.existsSync(resolved)) brokenLinks.push(target);
  }
  if (brokenLinks.length > 0) {
    issues.push({
      severity: 'warn',
      code: 'broken-internal-link',
      message: `${path.basename(fileName)}: 内部链接指向不存在的文件 — ${brokenLinks.slice(0, 5).join(', ')}`,
    });
  }
  return { issues, headingCount: headings.length, todoCount, charCount: text.length };
}

/**
 * Compare extracted knowledge points with the notes' actual content.
 *
 * @param {object} knowledge       `extractKnowledge` result
 * @param {{path: string, name: string, text: string}[]} notes
 * @returns {object} structured coverage report
 */
export function checkCoverage(knowledge, notes) {
  const sections = slicePointSections(notes);
  const authoredAll = notes.map((note) => stripFencedBlocks(note.text)).join('\n\n');
  const globalTokens = tokenize(authoredAll);
  const structureText = notes.map((note) => note.text).join('\n\n').toLowerCase();
  /*
   * Headings and tables are part of the *structure* a point must appear in, but
   * they are deliberately excluded from the per-point "authored prose" scope
   * (see `slicePointSections`).  A separate token set over the structure keeps
   * the presence test meaningful for notes that carry no POINT markers, where
   * section resolution falls back to a whole-document scope.
   */
  const structureTokens = tokenize(structureText);
  const totalTodos = notes.reduce((sum, note) => sum + countTodoMarkers(note.text), 0);

  const results = [];
  for (const point of knowledge.keyPoints) {
    /*
     * Resolve the point's own section.
     *
     * Point ids are globally unique (`assembleChapters` renumbers them), so the
     * bare id is normally enough.  The chapter-qualified key is still tried
     * first for robustness: notes produced by an older run, or reorganised by
     * hand, may carry per-chapter ids where `K001` appears in several files —
     * a bare-id lookup would then score this point against another chapter's
     * section and report finished work as missing.
     */
    const fallbackChapterKey = `Chapter_${String(point.chapterIndex).padStart(2, '0')}`;
    const candidates = [
      point.chapterKey ? `${point.chapterKey}::${point.id}` : null,
      `${fallbackChapterKey}::${point.id}`,
      point.id,
    ].filter(Boolean);
    let section = null;
    for (const key of candidates) {
      if (sections.has(key)) {
        section = sections.get(key);
        break;
      }
    }
    if (!section) {
      // Fall back to a scan for an unclaimed section with this id, which keeps
      // hand-written or partially reorganised note sets measurable.
      for (const candidate of sections.values()) {
        if (candidate.id !== point.id) continue;
        if (candidate.claimed) continue;
        section = candidate;
        break;
      }
    }
    /*
     * Last resort for notes that carry no POINT markers at all (hand-written or
     * reformatted notes): pick the unclaimed section that best matches this
     * point, by title first and by source text second.  Without this the scope
     * degrades to the entire note set, which inflates the score of every point
     * that shares vocabulary with any other point.
     */
    if (!section && sections.size > 0) {
      const probe = tokenize(`${point.title} ${String(point.sourceText ?? '').slice(0, 400)}`);
      let best = null;
      let bestScore = 0;
      for (const candidate of sections.values()) {
        if (candidate.claimed) continue;
        const score = similarity(probe, candidate.authoredTokens);
        if (score > bestScore) {
          bestScore = score;
          best = candidate;
        }
      }
      // Only accept a confident match; a weak one would attach the point to an
      // unrelated section and misreport its status.
      if (best && bestScore >= 0.45) section = best;
    }
    if (section) section.claimed = true;

    const scope = section ? section.authoredTokens : globalTokens;
    const noteTokens = scope;

    const titleTokens = tokenize(`${point.title} ${point.section ?? ''}`);
    const bodyTokens = tokenize(String(point.sourceText ?? '').slice(0, 1500));
    const termText = (point.terms ?? [])
      .map((term) => `${term.zh} ${term.en} ${term.abbr}`)
      .join(' ');
    const termTokens = tokenize(termText);

    const titleScore = similarity(titleTokens, noteTokens);
    const bodyScore = similarity(bodyTokens, noteTokens);
    const termScore = termTokens.size > 0 ? similarity(termTokens, noteTokens) : null;

    /*
     * "Is this point represented in the notes at all?"
     *
     * A literal substring test on the first 40 characters is far too brittle:
     * a bilingual heading ("第 1.1.1 节 一般最小化问题 / General Formulation")
     * shares long runs with the baseline title but is not a substring of it, so
     * every such point was forced to `missing` no matter how thoroughly it was
     * written.  Token-set overlap against the *whole* notes (not just the
     * point's own section) answers the intended question robustly.
     */
    const headingPresent =
      titleTokens.size === 0 ||
      similarity(titleTokens, structureTokens) >= 0.5 ||
      similarity(titleTokens, noteTokens) >= 0.5 ||
      (point.title.length >= 6 &&
        structureText.includes(point.title.toLowerCase().slice(0, 12)));

    const scored =
      0.15 + 0.25 * titleScore + 0.35 * bodyScore + (termScore === null ? 0.1 : 0.25 * termScore);
    /*
     * The amount of prose actually available for this point.
     *
     * It must come from the *effective* scope, not only from a POINT-marked
     * section: a hand-written note that carries no markers is scored against the
     * whole document, and reading the character count from `section` alone would
     * leave it at zero and force every such point to `missing` no matter how
     * complete the note is.
     */
    const authoredChars = section
      ? section.authored.replace(/\s/g, '').length
      : authoredAll.replace(/\s/g, '').length;
    const pendingTodo = section ? section.todoCount > 0 : false;

    // A section that still carries an authoring placeholder has not been
    // written yet, whatever else the page contains.
    let score = scored;
    let status = score >= COVERED_THRESHOLD ? 'covered' : score >= PARTIAL_THRESHOLD ? 'partial' : 'missing';
    if (!headingPresent || pendingTodo || authoredChars < 40) {
      status = 'missing';
      score = Math.min(score, PARTIAL_THRESHOLD - 0.01);
    }

    results.push({
      id: point.id,
      chapterIndex: point.chapterIndex,
      chapterTitle: point.chapterTitle,
      title: point.title,
      kind: point.kind,
      locator: point.locator,
      documentName: point.documentName,
      score: Number(score.toFixed(3)),
      titleScore: Number(titleScore.toFixed(3)),
      bodyScore: Number(bodyScore.toFixed(3)),
      termScore: termScore === null ? null : Number(termScore.toFixed(3)),
      headingPresent,
      sectionFound: Boolean(section),
      authoredChars,
      pendingTodo,
      status,
    });
  }

  const glossary = knowledge.glossary.map((entry) => {
    const hit = [entry.zh, entry.en, entry.abbr]
      .filter((value) => value !== '')
      .some((value) => authoredAll.toLowerCase().includes(value.toLowerCase()));
    return { ...entry, presentInNotes: hit };
  });

  const covered = results.filter((item) => item.status === 'covered');
  const partial = results.filter((item) => item.status === 'partial');
  const missing = results.filter((item) => item.status === 'missing');

  const byChapter = knowledge.chapters.map((chapter) => {
    const items = results.filter((item) => item.chapterIndex === chapter.index);
    return {
      chapterIndex: chapter.index,
      chapterTitle: chapter.title,
      total: items.length,
      covered: items.filter((item) => item.status === 'covered').length,
      partial: items.filter((item) => item.status === 'partial').length,
      missing: items.filter((item) => item.status === 'missing').length,
      ratio: items.length === 0 ? 1 : Number((items.filter((item) => item.status === 'covered').length / items.length).toFixed(3)),
    };
  });

  /*
   * Formula coverage is decided by notation-aware matching (`formulaPresent`),
   * not by word overlap: a formula rendered as LaTeX in the notes shares almost
   * no "words" with the same formula taken from a PDF text layer, so the token
   * score systematically under-reports exactly the items a reader would consider
   * most thoroughly written.  The legacy token score is kept as a secondary
   * signal for formulas that carry prose.
   */
  const formulaCoverage = (knowledge.formulas ?? []).map((formula) => {
    const present = formulaPresent(formula.text, authoredAll) || formulaPresent(formula.text, structureText);
    const tokens = tokenize(formula.text);
    const tokenScore = tokens.size === 0 ? 0 : similarity(tokens, globalTokens);
    const score = present ? Math.max(1, tokenScore) : tokenScore;
    return {
      text: formula.text.slice(0, 160),
      locator: formula.locator,
      documentName: formula.documentName,
      score: Number(score.toFixed(3)),
      matchedBy: present ? 'notation' : 'tokens',
      status: present ? 'covered' : score >= 0.5 ? 'covered' : score >= 0.2 ? 'partial' : 'missing',
    };
  });

  const coveredRatio = results.length === 0 ? 1 : covered.length / results.length;
  const effectiveRatio =
    results.length === 0 ? 1 : (covered.length + 0.5 * partial.length) / results.length;
  const structurallyPresent = results.filter((item) => item.headingPresent).length;

  return {
    generatedAt: new Date().toISOString(),
    noteFiles: notes.map((note) => ({ name: note.name, charCount: note.text.length })),
    totalKeyPoints: results.length,
    covered: covered.length,
    partial: partial.length,
    missing: missing.length,
    ratio: Number(coveredRatio.toFixed(3)),
    effectiveRatio: Number(effectiveRatio.toFixed(3)),
    thresholds: { covered: COVERED_THRESHOLD, partial: PARTIAL_THRESHOLD },
    scaffolding: {
      // How complete the *structure* is, versus how complete the *prose* is.
      // A run that has not been authored yet shows 100% here and a low
      // `ratio` above — which is exactly the distinction the acceptance
      // criteria ask for.
      keyPointsWithSections: structurallyPresent,
      keyPointsMissingSections: results.length - structurallyPresent,
      sectionRatio: results.length === 0 ? 1 : Number((structurallyPresent / results.length).toFixed(3)),
      remainingTodoMarkers: totalTodos,
      authored: totalTodos === 0,
    },
    byChapter,
    glossary: {
      total: glossary.length,
      present: glossary.filter((entry) => entry.presentInNotes).length,
      absent: glossary.filter((entry) => !entry.presentInNotes).map((entry) => ({
        zh: entry.zh,
        en: entry.en,
        abbr: entry.abbr,
        occurrences: entry.occurrences,
      })),
    },
    formulas: {
      total: formulaCoverage.length,
      covered: formulaCoverage.filter((item) => item.status === 'covered').length,
      partial: formulaCoverage.filter((item) => item.status === 'partial').length,
      missing: formulaCoverage.filter((item) => item.status === 'missing').length,
      items: formulaCoverage,
    },
    detail: results,
    missingPoints: missing,
    partialPoints: partial,
  };
}

export function renderCoverageMarkdown(coverage, structureIssues = []) {
  const out = [];
  out.push('# 知识点覆盖率报告 / Knowledge Coverage Report');
  out.push('');
  out.push(`生成时间 / Generated at: ${coverage.generatedAt}`);
  out.push('');
  out.push('> 覆盖率只反映“提取到的知识点是否在笔记中出现”，**不代表讲解的正确性**。');
  out.push('> Coverage only reports whether extracted knowledge points appear in the notes;');
  out.push('> it is **not** a measure of correctness.');
  out.push('');
  out.push('## 汇总 / Summary');
  out.push('');
  out.push(`- 提取知识点 / Extracted knowledge points: **${coverage.totalKeyPoints}**`);
  out.push(`- 已覆盖 / Covered: **${coverage.covered}**`);
  out.push(`- 部分覆盖 / Partially covered: **${coverage.partial}**`);
  out.push(`- 未覆盖 / Not covered: **${coverage.missing}**`);
  out.push(`- 覆盖率 / Coverage ratio: **${(coverage.ratio * 100).toFixed(1)}%**（加权：${(coverage.effectiveRatio * 100).toFixed(1)}%）`);
  out.push(`- 判定阈值 / Thresholds: covered ≥ ${coverage.thresholds.covered}, partial ≥ ${coverage.thresholds.partial}`);
  out.push('');
  out.push('### 结构完整度 vs 内容完整度 / Scaffold vs authored content');
  out.push('');
  out.push(
    `- 已生成小节的知识点 / key points that have their own section: **${coverage.scaffolding.keyPointsWithSections}/${coverage.totalKeyPoints}**（${(coverage.scaffolding.sectionRatio * 100).toFixed(1)}%）`,
  );
  out.push(
    `- 尚未由模型撰写的位置 / remaining authoring markers (\`COURSENOTES:TODO\`): **${coverage.scaffolding.remainingTodoMarkers}**`,
  );
  if (!coverage.scaffolding.authored) {
    out.push('');
    out.push(
      '> ⚠ 笔记骨架已完整生成，但讲解正文尚未撰写。上面的“覆盖率”衡量的是**正文内容**是否覆盖知识点，因此此时偏低是预期结果：请先按 `note-brief.md` 补全全部 TODO，再重新运行本检查。',
    );
    out.push(
      '> The note skeleton is complete but the explanatory prose has not been written yet. The coverage',
    );
    out.push('> ratio above measures *authored content*, so a low value here is expected until the TODO');
    out.push('> markers are filled in from `note-brief.md`.');
  }
  out.push('');
  out.push('> 覆盖率只反映“提取到的知识点是否在笔记中出现”，**不代表讲解的正确性**。');
  out.push('> Coverage only reports whether extracted knowledge points appear in the notes;');
  out.push('> it is **not** a measure of correctness.');
  out.push('');
  out.push(
    '> 说明：笔记中作为“材料原文依据”嵌入的代码块不计入覆盖统计，只有正文散文计入；否则每个知识点都会因原文被复制而自动“覆盖”。',
  );
  out.push('');
  out.push('## 分章覆盖 / Per-chapter coverage');
  out.push('');
  out.push('| 章 / Chapter | 知识点 | 已覆盖 | 部分 | 未覆盖 | 覆盖率 |');
  out.push('| --- | --- | --- | --- | --- | --- |');
  for (const chapter of coverage.byChapter) {
    out.push(
      `| 第 ${chapter.chapterIndex} 章 ${chapter.chapterTitle} | ${chapter.total} | ${chapter.covered} | ${chapter.partial} | ${chapter.missing} | ${(chapter.ratio * 100).toFixed(1)}% |`,
    );
  }
  out.push('');
  out.push('## 术语覆盖 / Glossary coverage');
  out.push('');
  out.push(`- 术语总数 / Total terms: ${coverage.glossary.total}；出现在笔记中 / present in notes: ${coverage.glossary.present}`);
  if (coverage.glossary.absent.length > 0) {
    out.push('');
    out.push('未在笔记中出现的术语 / Terms absent from the notes:');
    out.push('');
    for (const entry of coverage.glossary.absent.slice(0, 50)) {
      out.push(`- ${entry.zh || '—'} | ${entry.en || '—'} | ${entry.abbr || '—'}（材料中出现 ${entry.occurrences} 次）`);
    }
  }
  out.push('');
  out.push('## 公式覆盖 / Formula coverage');
  out.push('');
  out.push(`- 公式候选 / candidates: ${coverage.formulas.total}；已覆盖 ${coverage.formulas.covered}；部分 ${coverage.formulas.partial}；未覆盖 ${coverage.formulas.missing}`);
  out.push('');
  if (coverage.formulas.items.length > 0) {
    out.push('| # | 公式 / Formula | 来源 | 匹配度 | 状态 |');
    out.push('| --- | --- | --- | --- | --- |');
    coverage.formulas.items.forEach((item, index) => {
      out.push(
        `| ${index + 1} | \`${item.text.replace(/\|/g, '\\|').slice(0, 80)}\` | ${item.documentName} · ${item.locator} | ${item.score} | ${item.status} |`,
      );
    });
    out.push('');
  }
  if (coverage.missingPoints.length > 0) {
    out.push('## 未覆盖知识点 / Uncovered knowledge points');
    out.push('');
    out.push('| ID | 章 | 知识点 | 来源 | 匹配度 |');
    out.push('| --- | --- | --- | --- | --- |');
    for (const point of coverage.missingPoints) {
      out.push(
        `| ${point.id} | ${point.chapterIndex} | ${point.title.replace(/\|/g, '\\|').slice(0, 80)} | ${point.documentName} · ${point.locator} | ${point.score} |`,
      );
    }
    out.push('');
    out.push('处理要求 / Required action: 逐一补全，或在此说明无法补全的原因（例如材料本身缺失、需要付费文献、图片无法识别）。');
    out.push('');
  }
  if (coverage.partialPoints.length > 0) {
    out.push('## 部分覆盖知识点 / Partially covered knowledge points');
    out.push('');
    out.push('| ID | 章 | 知识点 | 来源 | 匹配度 |');
    out.push('| --- | --- | --- | --- | --- |');
    for (const point of coverage.partialPoints) {
      out.push(
        `| ${point.id} | ${point.chapterIndex} | ${point.title.replace(/\|/g, '\\|').slice(0, 80)} | ${point.documentName} · ${point.locator} | ${point.score} |`,
      );
    }
    out.push('');
  }
  out.push('## 笔记文件 / Note files');
  out.push('');
  for (const note of coverage.noteFiles) {
    out.push(`- ${note.name}（${note.charCount} 字符）`);
  }
  out.push('');
  if (structureIssues.length > 0) {
    out.push('## Markdown 结构问题 / Markdown structure issues');
    out.push('');
    for (const issue of structureIssues) {
      out.push(`- [${issue.severity}] ${issue.code}: ${issue.message}`);
    }
    out.push('');
  }
  out.push('## 覆盖方法说明 / Method note');
  out.push('');
  out.push(
    '匹配使用 CJK 二元组与英文词的词元重合度，并优先采信标题原样出现。因此“改写但等义”的讲解可能被判为部分覆盖，属于保守估计。该指标仅用于内部完整性核查。',
  );
  out.push('');
  return out.join('\n');
}

export function summariseCoverage(coverage) {
  const scaffold = coverage.scaffolding
    ? `，结构小节 ${coverage.scaffolding.keyPointsWithSections}/${coverage.totalKeyPoints}，剩余 TODO ${coverage.scaffolding.remainingTodoMarkers}`
    : '';
  return `覆盖率 ${(coverage.ratio * 100).toFixed(1)}%（已覆盖 ${coverage.covered}/${coverage.totalKeyPoints}，部分覆盖 ${coverage.partial}，未覆盖 ${coverage.missing}${scaffold}）`;
}

export { hasCjk, normalizeWhitespace, uniqueBy };
