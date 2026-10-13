/**
 * Stage B (part 2) — normalisation.
 *
 * Turns both parsing routes (the Python backend report and the Node-native
 * parsers) into one document model with:
 *
 *   * `units`      — an ordered list of content elements carrying locators,
 *   * `images`     — image records with a path relative to the output root,
 *   * `formulas`   — formula candidates that must be explained in LaTeX,
 *   * `visionTasks`— images whose knowledge content a multimodal model must read,
 *   * `warnings`   — explicit statements of what could not be extracted.
 *
 * The model is deliberately JSON-only so it can be written to `.coursenotes/`
 * for stage-by-stage reruns.
 */

import path from 'node:path';
import { mergeOptionUnits } from './cleanup.js';
import {
  dominantScript,
  hasCjk,
  hasLatin,
  normalizeWhitespace,
  slugify,
  toPosix,
  truncate,
} from './util.js';

const AUDIENCE_PATTERNS = [
  [/作业|homework|hw\d|assignment|习题|答案|solution/i, 'assignment'],
  [/实验|lab\b|实验报告|practical/i, 'lab'],
  [/复习|提纲|总结|summary|review|cheat\s*sheet/i, 'review'],
  [/论文|paper|文献|survey/i, 'paper'],
  [/syllabus|教学大纲|课程安排|schedule/i, 'syllabus'],
  [/slide|课件|讲义|lecture|chapter|第\s*\d+\s*[讲章]|ch\s*\d+/i, 'lecture'],
];

const GENRE_TO_ZH = {
  lecture: '课件/讲义',
  assignment: '作业/习题',
  lab: '实验材料',
  review: '复习提纲',
  paper: '论文/文献',
  syllabus: '教学大纲',
  notes: '笔记/资料',
};

export function classifyGenre(fileName) {
  const base = path.basename(String(fileName ?? ''));
  for (const [pattern, genre] of AUDIENCE_PATTERNS) {
    if (pattern.test(base)) return genre;
  }
  return 'notes';
}

export function genreLabel(genre) {
  return GENRE_TO_ZH[genre] ?? '资料';
}

const GENERIC_ROOT_NAMES = new Set([
  'documents', 'downloads', 'desktop', 'workspace', 'default-workspace', 'files',
  'temp', 'tmp', 'home', 'users', 'materials', 'material', 'course', 'courses',
  '课件', '资料', '课程', '新建文件夹', 'test', 'tests', 'fixture', 'fixtures',
  'sample', 'samples', 'demo', 'input', 'inputs', 'data', 'output', 'outputs',
  'src', 'dist', 'build', 'out',
]);

/** Strip trailing generic words from a folder name (e.g. "cs-fixtures" → "cs"). */
function stripGenericSuffix(name) {
  let value = name;
  for (let round = 0; round < 3; round += 1) {
    const next = value.replace(
      /[\s_-]*(?:fixtures?|samples?|tests?|testdata|data|docs?|materials?|课件|资料|测试|示例)$/i,
      '',
    );
    if (next === value || next === '') break;
    value = next;
  }
  return value.trim();
}

/** Guess a course name from the input roots and file names. */
export function inferCourseName(scan, inputPaths = []) {
  // A named folder the user pointed at is the strongest signal.
  for (const root of inputPaths) {
    const base = path.basename(String(root).replace(/[\\/]+$/, ''));
    if (base === '' || /^[A-Za-z]:$/.test(base)) continue;
    const candidates = [base, stripGenericSuffix(base)];
    for (const candidate of candidates) {
      if (candidate.length < 2 || candidate.length > 60) continue;
      const lowered = candidate.toLowerCase();
      if (GENERIC_ROOT_NAMES.has(lowered) || GENERIC_ROOT_NAMES.has(candidate)) continue;
      return candidate;
    }
  }

  const candidates = [];
  for (const record of scan.files) {
    const base = path.basename(record.name, path.extname(record.name));
    const beforeKeyword = base.split(
      /(?:第\s*[0-9一二三四五六七八九十]+\s*[讲章节课]|lecture|chapter|ch\b|slide|hw\b|作业|实验|复习)/i,
    )[0];
    const cleaned = beforeKeyword.replace(/[\s_\-–—.]+$/g, '').trim();
    if (cleaned.length >= 2) candidates.push(cleaned);
  }
  const counts = new Map();
  for (const candidate of candidates) {
    counts.set(candidate, (counts.get(candidate) ?? 0) + 1);
  }
  if (counts.size > 0) {
    const [best] = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0].length - a[0].length);
    if (best[0].length >= 2) return best[0];
  }
  for (const root of inputPaths) {
    const base = path.basename(String(root).replace(/[\\/]+$/, ''));
    if (base !== '' && !/^[A-Za-z]:$/.test(base)) return base;
  }
  return '课程';
}

function toUnit(kind, fields, options) {
  const text = normalizeWhitespace(fields.text ?? '');
  const unit = {
    kind,
    text: options.maxUnitChars > 0 ? truncate(text, options.maxUnitChars) : text,
    locator: fields.locator ?? '',
    sourceId: options.sourceId,
    sourceName: options.sourceName,
    position: options.position,
    script: dominantScript(text),
  };
  if (fields.level !== undefined) unit.level = fields.level;
  if (fields.listItem) {
    unit.listItem = true;
    unit.listIndent = fields.listIndent ?? 0;
  }
  if (fields.quote) unit.quote = true;
  if (fields.mathLike) unit.mathLike = true;
  if (fields.language) unit.language = fields.language;
  if (fields.fontSize !== undefined) unit.fontSize = fields.fontSize;
  if (fields.paragraph !== undefined) unit.paragraph = fields.paragraph;
  return unit;
}

function normalizeImageRecord(record, options) {
  return {
    kind: 'image',
    file: record.file ?? null,
    externalPath: record.externalPath ?? null,
    caption: normalizeWhitespace(record.caption ?? ''),
    locator: record.locator ?? '',
    sourceId: options.sourceId,
    sourceName: options.sourceName,
    sha1: record.sha1 ?? '',
    bytes: record.bytes ?? 0,
    visionRequired: record.file !== null && record.bytes > 0,
  };
}

/** Normalise one Python backend document. */
export function normalizePythonDocument(report, record, options) {
  const { maxUnitChars } = options;
  const context = {
    sourceId: options.sourceId,
    sourceName: options.sourceName,
    maxUnitChars,
  };
  const units = [];
  const images = [];
  const formulas = [];
  const visionTasks = [];
  const warnings = [];

  for (const warning of report.warnings ?? []) {
    warnings.push({
      code: warning.code ?? 'parser-warning',
      message: warning.message ?? '',
      severity: warning.severity ?? 'warning',
      locator: warning.locator,
      sourceName: context.sourceName,
    });
  }

  /*
   * Asset links are relative to the *note file*, which lives directly in the
   * output directory alongside `assets/`.  The backend reports image files
   * relative to its work directory (e.g. `assets/foo.png`), so the note-facing
   * path is exactly that string — no `..` needed.  `publishAssets()` copies the
   * work-dir `assets/` tree into `<outputDir>/assets/`, so the link resolves.
   */
  const pathOf = (file) => (file ? toPosix(file) : null);
  /**
   * Merge an image record, keyed by content hash so the same figure embedded in
   * several slides or paragraphs is only stored once.  The record arrives from
   * the Python backend with a `file` relative to the work directory; note files
   * live one level above `assets/`, hence the `..` prefix.
   */
  const collectImages = (list, position) => {
    for (const item of list ?? []) {
      if (item.sha1 && images.some((existing) => existing.sha1 === item.sha1)) continue;
      const normalised = normalizeImageRecord(item, context);
      normalised.assetPath = pathOf(item.file);
      normalised.position = position;
      images.push(normalised);
    }
  };

  if (report.format === 'pptx' && Array.isArray(report.slides)) {
    for (const slide of report.slides) {
      collectImages(slide.images, slide.index);
      for (const el of slide.elements ?? []) {
        if (el.kind === 'table') {
          units.push(
            toUnit('table', { locator: el.locator ?? `slide ${slide.index}` }, context),
          );
          units[units.length - 1].rows = el.rows ?? [];
          continue;
        }
        units.push(
          toUnit(
            el.kind === 'heading' ? 'heading' : 'text',
            {
              text: el.text,
              locator: el.locator ?? `slide ${slide.index}`,
              level: el.level,
              mathLike: el.math_like,
            },
            context,
          ),
        );
      }
      if (slide.notes) {
        units.push(toUnit('text', { text: slide.notes, locator: `slide ${slide.index} notes` }, context));
      }
    }
  } else if (report.format === 'docx' && Array.isArray(report.elements)) {
    let position = 0;
    for (const el of report.elements) {
      position += 1;
      if (el.kind === 'table') {
        const unit = toUnit('table', { locator: el.locator ?? `table ${position}` }, context);
        unit.rows = el.rows ?? [];
        units.push(unit);
        continue;
      }
      units.push(
        toUnit(
          el.kind === 'heading' ? 'heading' : 'text',
          {
            text: el.text,
            locator: el.locator ?? `paragraph ${position}`,
            level: el.level,
            mathLike: el.math_like,
            paragraph: el.paragraph,
          },
          context,
        ),
      );
    }
    // Word documents report their pictures as a document-level list.
    collectImages(report.images, null);
  } else if (Array.isArray(report.pages)) {
    for (const page of report.pages) {
      collectImages(page.images, page.index);
      for (const el of page.elements ?? []) {
        const unit = toUnit(
          el.kind === 'heading' ? 'heading' : 'text',
          {
            text: el.text,
            locator: el.locator ?? `page ${page.index}`,
            level: el.level,
            mathLike: el.math_like,
            fontSize: el.font_size,
          },
          context,
        );
        unit.page = page.index;
        units.push(unit);
      }
      for (const table of page.tables ?? []) {
        const unit = toUnit('table', { locator: table.locator ?? `page ${page.index}` }, context);
        unit.rows = table.rows ?? [];
        unit.page = page.index;
        units.push(unit);
      }
    }
  }

  for (const candidate of report.formula_candidates ?? []) {
    formulas.push({
      text: normalizeWhitespace(candidate.text ?? ''),
      locator: candidate.locator ?? '',
      sourceName: context.sourceName,
      confidence: candidate.math_font ? 'high' : 'medium',
      reason: candidate.math_font
        ? 'typeset with a mathematical font'
        : 'contains mathematical symbols or an equation pattern',
      latex: null,
    });
  }

  for (const task of report.vision_tasks ?? []) {
    const asset = pathOf(task.image);
    visionTasks.push({
      image: asset,
      locator: task.locator ?? '',
      sourceName: context.sourceName,
      priority: task.priority ?? 'normal',
      reason:
        task.reason ??
        'figure/diagram: explain the knowledge it encodes, not only its labels',
    });
  }

  const cleaned = mergeOptionUnits(units);

  return {
    id: options.sourceId,
    name: options.sourceName,
    path: record.path,
    relative: record.relative,
    format: report.format,
    kind: record.kind,
    genre: classifyGenre(record.name),
    supported: report.ok !== false,
    needsVision: Boolean(report.needs_vision),
    metadata: report.metadata ?? {},
    text: collectDocumentText(cleaned.units),
    units: cleaned.units,
    images,
    formulas,
    visionTasks,
    tables: cleaned.units.filter((unit) => unit.kind === 'table').length,
    warnings,
    cleanup: { mergedOptions: cleaned.mergedOptions, mergedGroups: cleaned.mergedGroups },
    stats: {
      unitCount: cleaned.units.length,
      headingCount: cleaned.units.filter((unit) => unit.kind === 'heading').length,
      tableCount: cleaned.units.filter((unit) => unit.kind === 'table').length,
      imageCount: images.length,
      formulaCount: formulas.length,
      charCount: cleaned.units.reduce((sum, unit) => sum + (unit.text?.length ?? 0), 0),
      pageCount: report.page_count ?? report.slide_count ?? undefined,
    },
  };
}

/** Normalise one Node-native parse result. */
export function normalizeNodeDocument(parsed, record, options) {
  const context = {
    sourceId: options.sourceId,
    sourceName: options.sourceName,
    maxUnitChars: options.maxUnitChars,
  };
  const units = [];
  const images = [];
  const formulas = [];

  for (const el of parsed.elements ?? []) {
    if (el.kind === 'table') {
      const unit = toUnit('table', { locator: el.locator ?? 'table' }, context);
      unit.rows = el.rows ?? [];
      units.push(unit);
      continue;
    }
    if (el.kind === 'code') {
      const unit = toUnit('code', { text: el.text, locator: el.locator ?? 'code' }, context);
      unit.language = el.language ?? '';
      if (el.outputs) unit.outputs = truncate(el.outputs, options.maxUnitChars);
      units.push(unit);
      continue;
    }
    units.push(
      toUnit(el.kind === 'heading' ? 'heading' : 'text', {
        text: el.text,
        locator: el.locator ?? '',
        level: el.level,
        listItem: el.listItem,
        listIndent: el.listIndent,
        quote: el.quote,
      }, context),
    );
  }

  for (const image of parsed.images ?? []) {
    images.push({
      kind: 'image',
      file: null,
      externalPath: image.externalPath ?? null,
      caption: normalizeWhitespace(image.caption ?? ''),
      locator: image.locator ?? '',
      sourceId: context.sourceId,
      sourceName: context.sourceName,
      sha1: '',
      bytes: 0,
      visionRequired: false,
    });
  }

  for (const unit of units) {
    const text = unit.text ?? '';
    if (/\$\$?[^$]+\$\$?/.test(text) || /\\frac|\\sum|\\int|\\partial|\\nabla/.test(text)) {
      for (const match of text.matchAll(/\$\$?([^$]+)\$\$?/g)) {
        formulas.push({
          text: match[1].trim(),
          locator: unit.locator,
          sourceName: context.sourceName,
          confidence: 'high',
          reason: 'inline LaTeX math in a text source',
          latex: match[1].trim(),
        });
      }
    }
  }

  const cleaned = mergeOptionUnits(units);

  return {
    id: options.sourceId,
    name: options.sourceName,
    path: record.path,
    relative: record.relative,
    format: parsed.format,
    kind: record.kind,
    genre: classifyGenre(record.name),
    supported: true,
    needsVision: false,
    metadata: parsed.metadata ?? {},
    text: collectDocumentText(cleaned.units),
    units: cleaned.units,
    images,
    formulas,
    visionTasks: [],
    tables: cleaned.units.filter((unit) => unit.kind === 'table').length,
    warnings: (parsed.warnings ?? []).map((warning) => ({
      ...warning,
      sourceName: context.sourceName,
    })),
    cleanup: { mergedOptions: cleaned.mergedOptions, mergedGroups: cleaned.mergedGroups },
    stats: {
      unitCount: cleaned.units.length,
      headingCount: cleaned.units.filter((unit) => unit.kind === 'heading').length,
      tableCount: cleaned.units.filter((unit) => unit.kind === 'table').length,
      imageCount: images.length,
      formulaCount: formulas.length,
      charCount: cleaned.units.reduce((sum, unit) => sum + (unit.text?.length ?? 0), 0),
    },
  };
}

/** A failed document still occupies a slot in the run report. */
export function failureDocument(record, warning, options) {
  return {
    id: options.sourceId,
    name: options.sourceName,
    path: record.path,
    relative: record.relative,
    format: record.extension.replace('.', ''),
    kind: record.kind,
    genre: classifyGenre(record.name),
    supported: false,
    needsVision: false,
    metadata: {},
    text: '',
    units: [],
    images: [],
    formulas: [],
    visionTasks: [],
    tables: 0,
    warnings: [{ ...warning, sourceName: options.sourceName }],
    stats: {
      unitCount: 0,
      headingCount: 0,
      tableCount: 0,
      imageCount: 0,
      formulaCount: 0,
      charCount: 0,
    },
  };
}

function collectDocumentText(units) {
  return units
    .map((unit) => {
      if (unit.kind === 'table' && Array.isArray(unit.rows)) {
        return unit.rows.map((row) => row.join(' | ')).join('\n');
      }
      if (unit.kind === 'code') {
        return `\`\`\`${unit.language ?? ''}\n${unit.text ?? ''}\n\`\`\``;
      }
      if (unit.kind === 'heading') {
        return `${'#'.repeat(Math.min(6, Math.max(1, unit.level ?? 1)))} ${unit.text ?? ''}`;
      }
      return unit.text ?? '';
    })
    .filter((value) => value !== '')
    .join('\n');
}

/** Aggregate counters used by reports and briefs. */
export function summariseDocuments(documents) {
  const summary = {
    documentCount: documents.length,
    parsedCount: documents.filter((doc) => doc.supported).length,
    failedCount: documents.filter((doc) => !doc.supported).length,
    charCount: 0,
    unitCount: 0,
    tableCount: 0,
    imageCount: 0,
    formulaCount: 0,
    visionTaskCount: 0,
    warningCount: 0,
    genres: {},
    formats: {},
    scripts: { cjk: 0, latin: 0, mixed: 0, unknown: 0 },
  };
  for (const doc of documents) {
    summary.charCount += doc.stats.charCount;
    summary.unitCount += doc.stats.unitCount;
    summary.tableCount += doc.stats.tableCount;
    summary.imageCount += doc.stats.imageCount;
    summary.formulaCount += doc.stats.formulaCount;
    summary.visionTaskCount += doc.visionTasks.length;
    summary.warningCount += doc.warnings.length;
    summary.genres[doc.genre] = (summary.genres[doc.genre] ?? 0) + 1;
    summary.formats[doc.format] = (summary.formats[doc.format] ?? 0) + 1;
    const script = dominantScript(doc.text.slice(0, 20000));
    summary.scripts[script] = (summary.scripts[script] ?? 0) + 1;
  }
  return summary;
}

/** Build the deterministic document id used in reports and filenames. */
export function documentId(record, index) {
  return `D${String(index + 1).padStart(2, '0')}-${slugify(record.name.replace(/\.[^.]+$/, ''), 'doc')}`;
}

export { hasCjk, hasLatin };
