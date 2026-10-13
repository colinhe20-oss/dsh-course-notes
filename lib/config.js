/**
 * CourseNotes plugin configuration: declared schema, defaults and normalisation.
 *
 * The schema is declared with the harness' own `schemastery` when it is
 * resolvable at runtime; otherwise the plugin still works because every value
 * is normalised by hand below.  Tunable values live here so users can change
 * them in the profile's `cordis.patch.yml` instead of editing code.
 */

export const DEFAULTS = Object.freeze({
  /** Default output directory. Empty = `<cwd>/course-notes-output`. */
  outputDir: '',
  /** Working directory for extracted assets. Empty = `<outputDir>/.coursenotes`. */
  workDir: '',
  /** Default output language. */
  language: 'bilingual',
  /** Default explanation depth. */
  detailLevel: 'comprehensive',
  /** Enable the external-retrieval stage when a web provider is registered. */
  enableWebSearch: true,
  /** Maximum search queries issued per run. */
  maxSearches: 12,
  /** Maximum pages fetched per run. */
  maxFetches: 8,
  /** Treat image-only content as a vision task for a multimodal model. */
  enableOcr: true,
  /** Explicit OCR command template; empty = auto-detect tesseract. */
  ocrCommand: '',
  /** Include worked examples in the generated material. */
  includeExamples: true,
  /** Include self-assessment questions. */
  includeExercises: true,
  /** Emit one Markdown file per chapter plus a README index. */
  splitByChapter: true,
  /** Run the coverage check at the end of a pipeline run. */
  coverageCheck: true,
  /** Ordering of discovered files. */
  fileOrder: 'natural',
  /** Explicit file order (file names or paths), used by `fileOrder: explicit`. */
  explicitOrder: [],
  /** Maximum characters of a source document kept per unit. */
  maxUnitChars: 4000,
  /** Maximum number of characters of source text embedded in a brief. */
  briefCharBudget: 60000,
  /** Per-file input ceiling; larger files are reported and skipped. */
  maxFileBytes: 200 * 1024 * 1024,
  /** Python interpreter used by the parsing backend; empty = auto-detect. */
  pythonPath: '',
  /** Extra search keywords always added to generated queries. */
  extraSearchKeywords: [],
  /** Depth of heading levels treated as chapter boundaries. */
  chapterHeadingLevel: 1,
  /** Path to the parser backend; empty = shipped backend. */
  parserScript: '',
  /** Log verbosity: silent | error | warn | info | debug. */
  logLevel: 'info',
});

function asBoolean(value, fallback) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const lowered = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(lowered)) return true;
    if (['false', '0', 'no', 'off'].includes(lowered)) return false;
  }
  return fallback;
}

function asInt(value, fallback, min, max) {
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  let out = Math.trunc(parsed);
  if (typeof min === 'number') out = Math.max(min, out);
  if (typeof max === 'number') out = Math.min(max, out);
  return out;
}

function asString(value, fallback = '') {
  if (value === undefined || value === null) return fallback;
  return String(value);
}

function asStringArray(value) {
  if (Array.isArray(value)) return value.map((item) => String(item)).filter((item) => item !== '');
  if (typeof value === 'string' && value.trim() !== '') {
    return value.split(',').map((item) => item.trim()).filter((item) => item !== '');
  }
  return [];
}

function oneOf(value, allowed, fallback) {
  const lowered = asString(value, '').trim().toLowerCase();
  return allowed.includes(lowered) ? lowered : fallback;
}

/** Normalise a raw config row (from cordis.patch.yml) into a full config. */
export function normalizeConfig(raw) {
  const input = raw && typeof raw === 'object' ? raw : {};
  const pick = (key) => (key in input ? input[key] : DEFAULTS[key]);
  return {
    outputDir: asString(pick('outputDir'), DEFAULTS.outputDir).trim(),
    workDir: asString(pick('workDir'), DEFAULTS.workDir).trim(),
    language: oneOf(pick('language'), ['bilingual', 'zh', 'en'], DEFAULTS.language),
    detailLevel: oneOf(
      pick('detailLevel'),
      ['concise', 'standard', 'comprehensive'],
      DEFAULTS.detailLevel,
    ),
    enableWebSearch: asBoolean(pick('enableWebSearch'), DEFAULTS.enableWebSearch),
    maxSearches: asInt(pick('maxSearches'), DEFAULTS.maxSearches, 0, 200),
    maxFetches: asInt(pick('maxFetches'), DEFAULTS.maxFetches, 0, 100),
    enableOcr: asBoolean(pick('enableOcr'), DEFAULTS.enableOcr),
    ocrCommand: asString(pick('ocrCommand'), DEFAULTS.ocrCommand).trim(),
    includeExamples: asBoolean(pick('includeExamples'), DEFAULTS.includeExamples),
    includeExercises: asBoolean(pick('includeExercises'), DEFAULTS.includeExercises),
    splitByChapter: asBoolean(pick('splitByChapter'), DEFAULTS.splitByChapter),
    coverageCheck: asBoolean(pick('coverageCheck'), DEFAULTS.coverageCheck),
    fileOrder: oneOf(
      pick('fileOrder'),
      ['natural', 'name', 'explicit', 'mtime'],
      DEFAULTS.fileOrder,
    ),
    explicitOrder: asStringArray(pick('explicitOrder')),
    maxUnitChars: asInt(pick('maxUnitChars'), DEFAULTS.maxUnitChars, 200, 200000),
    briefCharBudget: asInt(pick('briefCharBudget'), DEFAULTS.briefCharBudget, 2000, 400000),
    maxFileBytes: asInt(pick('maxFileBytes'), DEFAULTS.maxFileBytes, 1024, 8 * 1024 * 1024 * 1024),
    pythonPath: asString(pick('pythonPath'), DEFAULTS.pythonPath).trim(),
    extraSearchKeywords: asStringArray(pick('extraSearchKeywords')),
    chapterHeadingLevel: asInt(pick('chapterHeadingLevel'), DEFAULTS.chapterHeadingLevel, 1, 6),
    parserScript: asString(pick('parserScript'), DEFAULTS.parserScript).trim(),
    logLevel: oneOf(
      pick('logLevel'),
      ['silent', 'error', 'warn', 'info', 'debug'],
      DEFAULTS.logLevel,
    ),
  };
}

/** Merge a tool call's arguments over the plugin config. */
export function mergeOptions(config, args = {}) {
  const merged = { ...config };
  const map = {
    output_dir: 'outputDir',
    work_dir: 'workDir',
    language: 'language',
    detail_level: 'detailLevel',
    enable_web_search: 'enableWebSearch',
    enable_ocr: 'enableOcr',
    include_examples: 'includeExamples',
    include_exercises: 'includeExercises',
    split_by_chapter: 'splitByChapter',
    coverage_check: 'coverageCheck',
    file_order: 'fileOrder',
    explicit_order: 'explicitOrder',
    max_searches: 'maxSearches',
    max_fetches: 'maxFetches',
    max_unit_chars: 'maxUnitChars',
    brief_char_budget: 'briefCharBudget',
    python_path: 'pythonPath',
    extra_search_keywords: 'extraSearchKeywords',
    chapter_heading_level: 'chapterHeadingLevel',
  };
  for (const [argKey, configKey] of Object.entries(map)) {
    if (args[argKey] !== undefined) merged[configKey] = args[argKey];
  }
  return normalizeConfig(merged);
}
