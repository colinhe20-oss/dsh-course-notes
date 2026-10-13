/**
 * The CourseNotes pipeline.
 *
 *   Stage A  scan      — discover and classify input files          (scan.js)
 *   Stage B  parse     — extract structure, images, formulas        (python-bridge.js, parsers.js)
 *            normalise — one document model with locators           (document.js)
 *   Stage C  knowledge — chapters, key points, glossary, formulas   (knowledge.js)
 *   Stage D  retrieve  — external evidence through `ctx.web`        (retrieve.js)
 *            evidence  — knowledge point ↔ excerpt mapping          (evidence.js)
 *            vision    — figure tasks + capability detection        (vision.js)
 *   Stage E  generate  — deterministic note scaffolds               (generate.js)
 *            author    — chunked LLM authoring + repair             (chunk.js, authoring.js)
 *   Stage F  check     — coverage, quality, Markdown structure      (coverage.js)
 *   Stage G  output    — write files, publish assets, one report    (this file)
 *
 * ## Two invariants this file exists to keep
 *
 * **1. One run state, one report.**  Every report file (`README.md`,
 * `run-report.md`, `run-report.json`, `coverage-report.md`, the brief) is
 * rendered from the *same* final `report` object, after the last stage has
 * finished.  v1.0 wrote `coverage-report.md` before LLM authoring and
 * `run-report.json` at a third moment, so `docs/sample-run` shipped a JSON ratio
 * that disagreed with its own Markdown.
 *
 * **2. Completion is a state, not an inference.**  Writing the files is not the
 * same as producing a finished note.  {@link COMPLETION_STATES} names the
 * possibilities, and the pipeline decides between them from measured facts: how
 * many knowledge points have authored prose, how many still carry a placeholder,
 * and how many dimension failures the quality check found.
 *
 * A run never throws for an expected per-file failure: a bad file is recorded in
 * the run report and the remaining files still produce notes.
 */

import fs from 'node:fs';
import path from 'node:path';
import { scanInputs, parseableFiles, pythonFiles, nodeFiles, describeScan } from './scan.js';
import { parseNodeFile } from './parsers.js';
import {
  documentId,
  failureDocument,
  inferCourseName,
  normalizeNodeDocument,
  normalizePythonDocument,
  summariseDocuments,
} from './document.js';
import { runParserBackend, resolvePython } from './python-bridge.js';
import { extractKnowledge } from './knowledge.js';
import { runRetrieval, summariseRetrieval } from './retrieve.js';
import { buildEvidenceIndex, validateCitations, EVIDENCE_LIMITS } from './evidence.js';
import {
  buildVisionTasks,
  applyVisionResults,
  detectVisionCapability,
  summariseVision,
  visionByPoint,
  VISION_RESULTS_FILE,
} from './vision.js';
import {
  buildBrief,
  buildSavePrompt,
  renderCourseReadme,
  renderNotes,
  TODO_MARKER,
} from './generate.js';
import {
  authorNotes,
  createModelRunner,
  chunkBudgetFromContext,
  DEFAULT_MAX_ATTEMPTS,
} from './authoring.js';
import {
  checkCoverage,
  checkNoteStructure,
  checkQuality,
  loadNoteTexts,
  renderCoverageMarkdown,
  renderQualityMarkdown,
  summariseCoverage,
  summariseQuality,
} from './coverage.js';
import { publishAssets, createHarnessWorkspace, createNodeWorkspace, bytesToBinaryString } from './files.js';
import { createLogger, formatBytes, toPosix, truncate, uniqueBy } from './util.js';

export const PIPELINE_VERSION = '1.1.0';

/**
 * Explicit completion states.  `verified` is the only one that means "the notes
 * exist and every knowledge point was measured as written".
 */
export const COMPLETION_STATES = Object.freeze({
  parsed: '材料已解析，但尚未建立知识结构。',
  scaffold_created: '笔记骨架已生成，正文尚未撰写（保留 COURSENOTES:TODO 标记）。',
  notes_authored: '全部知识点已由模型撰写，但尚未通过质量检查。',
  verified: '全部知识点已撰写并通过质量检查（结构+内容+双语+公式+引用）。',
  partial: '部分知识点已撰写或部分阶段失败，结果不完整。',
  failed: '本次运行未能产出可用笔记文件。',
});

/** Ordering used when several states apply: the weakest link wins. */
const STATE_SEVERITY = ['failed', 'partial', 'scaffold_created', 'parsed', 'notes_authored', 'verified'];

export const STAGE_ORDER = ['scan', 'parse', 'knowledge', 'retrieve', 'generate', 'check', 'output'];

function nowId() {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');
  return `run-${stamp}`;
}

function resolveDirs(options, cwd) {
  const outputDir = options.outputDir !== '' ? path.resolve(cwd, options.outputDir) : path.join(cwd, 'course-notes-output');
  const workDir = options.workDir !== ''
    ? path.resolve(cwd, options.workDir)
    : path.join(outputDir, '.coursenotes');
  return { outputDir, workDir };
}

const ALL_STAGES = new Set(STAGE_ORDER);

function stageOn(requestedStages, stage) {
  if (!requestedStages) return true;
  return requestedStages.includes(stage);
}

/**
 * Run the whole pipeline.
 *
 * @param {object} request
 * @param {string[]} request.inputPaths
 * @param {object}   request.options          normalised config (see config.js)
 * @param {string}   [request.cwd]
 * @param {object}   request.workspace        node or harness workspace
 * @param {object}   [request.deps]           `{ web, llm, logger, model }`
 * @param {AbortSignal} [request.signal]
 * @param {object}   [request.logger]
 * @param {boolean}  [request.authorWithLlm]
 * @param {string[]} [request.requestedStages] restrict execution to these stages
 * @param {Function} [request.onProgress]
 * @returns {Promise<object>} run report
 */
export async function runPipeline(request) {
  const startedAt = Date.now();
  const cwd = request.cwd ?? process.cwd();
  const options = request.options;
  const logger = request.logger ?? createLogger(options.logLevel);
  const workspace = request.workspace;
  const runId = request.runId ?? nowId();
  const { outputDir } = resolveDirs(options, cwd);
  const workDir = path.join(resolveDirs(options, cwd).workDir, runId);
  const requestedStages = normalizeRequestedStages(request.requestedStages);
  const stages = {
    scan: stageOn(requestedStages, 'scan'),
    parse: stageOn(requestedStages, 'parse'),
    knowledge: stageOn(requestedStages, 'knowledge'),
    retrieve: stageOn(requestedStages, 'retrieve'),
    generate: stageOn(requestedStages, 'generate'),
    check: stageOn(requestedStages, 'check'),
    output: stageOn(requestedStages, 'output'),
  };

  const report = {
    pipeline: 'CourseNotes',
    version: PIPELINE_VERSION,
    runId,
    startedAt: new Date().toISOString(),
    cwd,
    outputDir,
    workDir,
    workspaceKind: workspace?.kind ?? 'node',
    sandboxed: Boolean(workspace?.sandboxed),
    requestedStages: requestedStages ?? [...STAGE_ORDER],
    executedStages: [],
    completion: 'failed',
    completionReason: '',
    options: { ...options },
    stages: {},
    documents: [],
    knowledge: null,
    retrieval: null,
    evidence: null,
    vision: null,
    authoring: null,
    coverage: null,
    quality: null,
    outputs: { files: [], noteFiles: [], assets: null, brief: null, artifacts: {} },
    errors: [],
    warnings: [],
    limitations: [],
    model: request.deps?.model ?? null,
    usedLlm: false,
  };

  /* ---------------------------------------------------------------- Stage A */
  if (!stages.scan) {
    report.limitations.push('本次运行未请求 scan 阶段，流水线在此停止。');
    report.completion = 'failed';
    report.completionReason = 'scan stage not requested';
    return finaliseReport(report, startedAt, logger);
  }
  logger.info('stage A: scanning inputs');
  const scan = scanInputs({
    inputPaths: request.inputPaths,
    cwd,
    order: options.fileOrder,
    explicitOrder: options.explicitOrder,
    recursive: true,
    maxFileBytes: options.maxFileBytes,
  });
  report.stages.scan = {
    roots: scan.scannedRoots,
    totalFiles: scan.files.length,
    parseable: parseableFiles(scan).length,
    unsupported: scan.unsupported.length,
    skipped: scan.skipped.length,
    errors: scan.errors,
    listing: describeScan(scan),
  };
  report.scanListing = describeScan(scan);
  report.executedStages.push('scan');

  if (scan.errors.length > 0) {
    for (const error of scan.errors) report.errors.push({ stage: 'scan', ...error });
  }
  for (const record of scan.unsupported) {
    report.warnings.push({
      stage: 'scan',
      code: record.legacy ? 'legacy-format' : 'unsupported-format',
      message: `${record.relative}: ${record.legacy ? `旧格式无法直接解析，建议：${record.conversionHint}` : '不支持的格式，已跳过'}`,
    });
  }

  const courseName = inferCourseName(scan, request.inputPaths);
  report.courseName = courseName;
  options.courseName = courseName;

  const filesToParse = parseableFiles(scan);
  if (filesToParse.length === 0) {
    report.limitations.push('没有任何可解析的文件；请检查 input_paths 指向的文件格式。');
    report.completion = 'failed';
    report.completionReason = 'no parseable input file';
    await writeWorkArtifacts(workspace, workDir, report, logger);
    return finaliseReport(report, startedAt, logger);
  }
  if (!stages.parse) {
    report.limitations.push('本次运行未请求 parse 阶段，后续阶段无法执行。');
    report.completion = 'parsed';
    report.completionReason = 'parse stage not requested';
    await writeWorkArtifacts(workspace, workDir, report, logger);
    return finaliseReport(report, startedAt, logger);
  }

  /* ---------------------------------------------------------------- Stage B */
  logger.info('stage B: parsing', { files: filesToParse.length });
  const documents = [];
  const byPath = new Map(filesToParse.map((record) => [record.path, record]));

  const pyFiles = pythonFiles(scan);
  let runtime = { available: false, skipped: pyFiles.length === 0 };
  if (pyFiles.length > 0) {
    const backend = runParserBackend({
      files: pyFiles.map((record) => record.path),
      workDir,
      pythonPath: options.pythonPath,
      parserScript: options.parserScript,
      extractImages: true,
      logger,
    });
    runtime = backend.runtime;
    if (!backend.ok) {
      const python = resolvePython(options.pythonPath);
      report.errors.push({
        stage: 'parse',
        code: 'PYTHON_BACKEND_UNAVAILABLE',
        message: backend.error ?? '解析后端不可用',
        attempts: python.attempts?.map((attempt) => ({
          command: attempt.command,
          reason: attempt.reason,
        })),
      });
      report.limitations.push(
        `PDF/PPTX/DOCX/图片 解析未执行（${backend.error ?? '后端不可用'}）：这些文件的知识点无法进入笔记。`,
      );
      for (const record of pyFiles) {
        documents.push(
          failureDocument(
            record,
            {
              code: 'parser-backend-unavailable',
              message: `解析后端不可用，此文件未被解析：${backend.error ?? ''}`,
              severity: 'error',
            },
            { sourceId: documentId(record, documents.length), sourceName: record.name },
          ),
        );
      }
    } else {
      for (const doc of backend.documents) {
        const record = byPath.get(path.normalize(doc.source_path)) ?? {
          path: doc.source_path,
          name: doc.source_name,
          relative: path.basename(doc.source_path),
          extension: path.extname(doc.source_path).toLowerCase(),
          kind: doc.format,
          sizeLabel: formatBytes(doc.size_bytes ?? 0),
        };
        const sourceId = documentId(record, documents.length);
        if (doc.ok === false) {
          documents.push(
            failureDocument(
              record,
              (doc.warnings ?? [])[0] ?? {
                code: 'parse-failed',
                message: '解析失败',
                severity: 'error',
              },
              { sourceId, sourceName: record.name },
            ),
          );
          continue;
        }
        documents.push(
          normalizePythonDocument(doc, record, {
            sourceId,
            sourceName: record.name,
            maxUnitChars: options.maxUnitChars,
          }),
        );
      }
    }
  }

  for (const record of nodeFiles(scan)) {
    const sourceId = documentId(record, documents.length);
    try {
      const parsed = parseNodeFile(record);
      documents.push(
        normalizeNodeDocument(parsed, record, {
          sourceId,
          sourceName: record.name,
          maxUnitChars: options.maxUnitChars,
        }),
      );
    } catch (error) {
      report.errors.push({
        stage: 'parse',
        code: 'NODE_PARSE_FAILED',
        message: `${record.relative}: ${error.message}`,
      });
      documents.push(
        failureDocument(
          record,
          {
            code: 'parse-failed',
            message: `解析失败：${error.message}`,
            severity: 'error',
          },
          { sourceId, sourceName: record.name },
        ),
      );
    }
  }

  report.documents = documents.map((doc) => ({
    id: doc.id,
    name: doc.name,
    relative: doc.relative,
    format: doc.format,
    genre: doc.genre,
    supported: doc.supported,
    needsVision: doc.needsVision,
    stats: doc.stats,
    warnings: doc.warnings,
    visionTaskCount: doc.visionTasks.length,
    images: doc.images.map((image) => ({
      assetPath: image.assetPath,
      locator: image.locator,
      caption: image.caption,
    })),
  }));
  report.stages.parse = {
    runtime,
    summary: summariseDocuments(documents),
    documents: documents.length,
    failed: documents.filter((doc) => !doc.supported).length,
  };
  report.executedStages.push('parse');
  for (const doc of documents) {
    if (!doc.supported) {
      report.errors.push({
        stage: 'parse',
        code: 'DOCUMENT_NOT_PARSED',
        message: `${doc.relative}: ${doc.warnings.map((warning) => warning.message).join('; ') || '未解析'}`,
      });
    }
  }

  /* ---------------------------------------------------------------- Stage C */
  if (!stages.knowledge) {
    report.limitations.push('本次运行未请求 knowledge 阶段，后续阶段无法执行。');
    report.completion = 'parsed';
    report.completionReason = 'knowledge stage not requested';
    await writeWorkArtifacts(workspace, workDir, report, logger, { documents });
    return finaliseReport(report, startedAt, logger);
  }
  logger.info('stage C: extracting knowledge structure');
  const knowledge = extractKnowledge(documents, {
    chapterHeadingLevel: options.chapterHeadingLevel,
    maxUnitChars: options.maxUnitChars,
  });
  report.knowledge = {
    counts: knowledge.counts,
    chapters: knowledge.chapters.map((chapter) => ({
      index: chapter.index,
      title: chapter.title,
      points: chapter.points.length,
      formulas: chapter.formulas.length,
      figures: chapter.figures.length,
    })),
    glossary: knowledge.glossary.length,
  };
  report.stages.knowledge = knowledge.counts;
  report.executedStages.push('knowledge');
  if (knowledge.counts.chapters === 0) {
    report.limitations.push('未能从材料中识别出任何章节：请检查课件是否包含标题层级或编号。');
  }
  if (knowledge.counts.keyPoints === 0) {
    report.limitations.push('未能提取到任何知识点：笔记只会包含章节骨架。');
  }

  /* ---------------------------------------------------------------- Stage D */
  let retrieval = {
    enabled: false,
    performed: false,
    reason: 'stage-not-requested',
    plan: { queries: [], total: 0 },
    results: [],
    fetchResults: [],
    sources: [],
    errors: [],
  };
  const webService = request.deps?.web;
  if (stages.retrieve) {
    logger.info('stage D: external retrieval');
    const webAvailable = Boolean(webService && typeof webService.search === 'function');
    /*
     * `enableWebSearch` (what the user asked for) and "is a web provider
     * registered" (what the deployment can do) are two different facts.  v1.0
     * folded them into one boolean and then reported "disabled by config" for a
     * missing provider; they are tracked separately here so the summary can say
     * which one actually applied.
     */
    retrieval = await runRetrieval(
      { web: webService },
      knowledge,
      {
        enableWebSearch: options.enableWebSearch,
        serviceAvailable: webAvailable,
        maxSearches: options.maxSearches,
        maxFetches: options.maxFetches,
        extraSearchKeywords: options.extraSearchKeywords,
        includeExamples: options.includeExamples,
        signal: request.signal,
      },
      logger,
    );
    report.executedStages.push('retrieve');
  }
  report.retrieval = {
    configured: options.enableWebSearch,
    serviceAvailable: Boolean(webService && typeof webService.search === 'function'),
    enabled: retrieval.enabled,
    performed: retrieval.performed,
    reason: retrieval.reason,
    summary: summariseRetrieval(retrieval),
    planTotal: retrieval.plan.total,
    queryCount: retrieval.plan.queries.length,
    resultCount: retrieval.results.length,
    fetchCount: retrieval.fetchResults.length,
    sourceCount: retrieval.sources.length,
    errorCount: retrieval.errors.length,
    errors: retrieval.errors,
    sources: retrieval.sources.slice(0, 60),
  };
  if (!retrieval.performed) {
    report.limitations.push(summariseRetrieval(retrieval));
  }

  /* ------------------------------------------------- evidence + vision tasks */
  const evidenceIndex = buildEvidenceIndex(knowledge, retrieval, {
    perPoint: options.evidencePerPoint,
    totalChars: options.evidenceCharBudget,
    excerptChars: options.evidenceExcerptChars,
    retrievedAt: new Date().toISOString(),
  });
  report.evidence = { ...evidenceIndex.stats };
  report.stages.evidence = evidenceIndex.stats;

  const vision = buildVisionTasks(documents, knowledge, { enableOcr: options.enableOcr });
  const visionResults = readVisionResults(workspace, outputDir, logger);
  if (visionResults) {
    const applied = applyVisionResults(vision.tasks, visionResults);
    vision.applied = { count: applied.applied, unknown: applied.unknown, unresolved: applied.unresolved };
    if (applied.unknown.length > 0) {
      report.warnings.push({
        stage: 'vision',
        code: 'vision-result-unmatched',
        message: `${applied.unknown.length} 条视觉解读无法对应到任何视觉任务：${applied.unknown
          .slice(0, 3)
          .map((item) => item.taskId ?? item.image ?? '?')
          .join(', ')}`,
      });
    }
  }
  const visionCapability = detectVisionCapability(request.deps?.model, request.deps?.llm);
  const visionByFigure = new Map();
  for (const task of vision.tasks) {
    if (task.image) visionByFigure.set(task.image, task);
    if (task.sourceName && task.locator) visionByFigure.set(`${task.sourceName}::${task.locator}`, task);
  }
  /*
   * Interpretations are also indexed by knowledge point, and are attached to the
   * point records themselves.
   *
   * Without this, a figure's interpretation reached only the chapter's 「图表解读」
   * section: the knowledge-point list that the chunk planner reads (and that
   * `knowledge.json` publishes) still said "figure, no interpretation", so the
   * authoring prompt had to describe a figure the plugin already knew something
   * about.  Storing it on the point closes that loop, and `visionByPoint` is what
   * the chunk prompt uses to find it.
   */
  const visionByPointIndex = visionByPoint(vision.tasks);
  /*
   * `extractKnowledge` builds `keyPoints` by spreading each chapter's points, so the
   * top-level list and `chapter.points` hold *different objects*.  The chunk planner
   * reads `chapter.points`; `knowledge.json` publishes `keyPoints`.  Attaching to
   * only one of them is how the interpretation reached the published record and not
   * the prompt (and, in an earlier revision, the other way round) — so both are
   * updated, and the duplicate-object trap is stated here rather than rediscovered.
   */
  let interpretationsAttached = 0;
  const attachTo = (point) => {
    const interpreted = visionByPointIndex.get(point.id) ?? [];
    if (interpreted.length === 0) return false;
    point.visionInterpretations = interpreted.map((task) => ({
      taskId: task.id,
      kind: task.kind,
      image: task.image,
      locator: task.locator,
      interpretation: task.interpretation,
      confidence: task.confidence,
      unresolved: task.unresolved,
    }));
    return true;
  };
  for (const point of knowledge.keyPoints ?? []) {
    if (attachTo(point)) interpretationsAttached += 1;
  }
  for (const chapter of knowledge.chapters ?? []) {
    for (const point of chapter.points ?? []) {
      if (!(point.visionInterpretations?.length > 0)) attachTo(point);
    }
  }
  report.vision = {
    stats: vision.stats,
    capability: visionCapability,
    summary: summariseVision(vision, visionCapability),
    tasks: vision.tasks.map((task) => ({
      id: task.id,
      kind: task.kind,
      label: task.label,
      image: task.image,
      locator: task.locator,
      sourceName: task.sourceName,
      pointIds: task.pointIds,
      status: task.status,
    })),
    applied: vision.applied ?? { count: 0, unknown: [], unresolved: 0 },
    pointsWithInterpretation: interpretationsAttached,
    resultsFile: VISION_RESULTS_FILE,
  };
  report.stages.vision = vision.stats;
  if (vision.stats.total > 0 && vision.applied?.count === 0) {
    report.limitations.push(summariseVision(vision, visionCapability));
  }

  /* -------------------------------------------------- Stage E: scaffold + G */
  if (!stages.generate) {
    report.limitations.push('本次运行未请求 generate 阶段：只输出了解析与知识结构结果。');
    report.completion = 'parsed';
    report.completionReason = 'generate stage not requested';
    await writeWorkArtifacts(workspace, workDir, report, logger, { knowledge, documents, retrieval, evidenceIndex });
    return finaliseReport(report, startedAt, logger);
  }

  logger.info('stage E: generating note scaffolds');
  const retrievalFor = (chapterIndex) => {
    const specific = [];
    for (const result of retrieval.results) {
      if ((result.chapterIndex ?? 0) !== chapterIndex) continue;
      for (const source of result.sources) specific.push({ ...source, reason: result.reason });
    }
    const generic = retrieval.sources.filter((source) => source.trust >= 3);
    return uniqueBy([...specific, ...generic], (source) => source.url).slice(0, 12);
  };

  const renderContext = {
    courseName,
    runId,
    documents,
    scan,
    knowledge,
    retrieval,
    evidenceIndex,
    vision,
    visionByFigure,
    options,
    outputDir,
    // The README states which parser produced the content; leaving this out made
    // every run claim "Node-native only" even when the Python backend had parsed
    // the PDFs, PPTX and DOCX.
    runtime: report.stages.parse?.runtime ?? null,
    generatedAt: new Date().toISOString(),
    retrievalFor,
  };

  const assets = await publishAssets(workspace, workDir, outputDir, logger);
  report.outputs.assets = {
    dir: assets.dir,
    copied: assets.copied,
    failures: assets.failures,
  };
  if (assets.failures.length > 0) {
    report.warnings.push({
      stage: 'output',
      code: 'asset-copy-failed',
      message: `${assets.failures.length} 个图片资源复制失败：${assets.failures
        .slice(0, 3)
        .map((failure) => `${failure.file}(${failure.code})`)
        .join(', ')}`,
    });
  }

  const rendered = renderNotes(renderContext);
  renderContext.chapterFiles = rendered.chapterFiles;
  report.executedStages.push('generate');

  /* ------------------------------------------------ Stage E2: LLM authoring */
  const authoring = await runAuthoringStage({
    request,
    options,
    knowledge,
    rendered,
    report,
    renderContext,
    evidenceIndex,
    retrieval,
    vision,
    logger,
  });
  report.authoring = authoring.summary;
  report.usedLlm = authoring.usedLlm;

  // The authored content replaces the scaffold's point bodies; everything else
  // (headings, ordering, markers, formula checklist, figures, glossary,
  // references) stays deterministic.
  const finalFiles = authoring.files.length > 0 ? authoring.files : rendered.files;
  if (authoring.files.length > 0) {
    renderContext.authoredFiles = authoring.files;
  }

  /* -------------------------------------------------------------- Stage G */
  const writeOutcome = [];
  for (const file of finalFiles) {
    const target = path.join(outputDir, file.path);
    const outcome = await workspace.writeText(target, file.content);
    writeOutcome.push({ file: file.path, ...outcome, chars: file.content.length });
    if (!outcome.ok) {
      report.errors.push({
        stage: 'output',
        code: outcome.code ?? 'WRITE_FAILED',
        message: `写入 ${target} 失败：${outcome.message}`,
      });
    }
  }
  const written = writeOutcome.filter((outcome) => outcome.ok);
  report.usedLlm = authoring.usedLlm;

  /* ---------------------------------------------------------------- Stage F */
  const notes = written
    .filter((outcome) => isNoteFile(outcome.file))
    .map((outcome) => ({
      name: path.basename(outcome.file),
      path: path.join(outputDir, outcome.file),
      chapterKey: chapterKeyOfFile(outcome.file),
      text: finalFiles.find((file) => file.path === outcome.file)?.content ?? '',
    }))
    .filter((note) => note.text !== '');

  let coverage = null;
  let quality = null;
  const structureIssues = [];
  if (stages.check && written.length > 0) {
    logger.info('stage F: coverage, quality and structure check');
    for (const note of notes) {
      structureIssues.push(...checkNoteStructure(note.text, note.path).issues);
    }
    if (options.coverageCheck) {
      coverage = checkCoverage(knowledge, notes);
      quality = checkQuality(knowledge, notes, {
        language: options.language,
        evidenceIndex,
        citations: validateCitations(notes, evidenceIndex),
      });
      report.coverage = coverageSummary(coverage);
      report.stages.coverage = {
        summary: summariseCoverage(coverage),
        ratio: coverage.ratio,
        missing: coverage.missing,
        partial: coverage.partial,
      };
      report.quality = qualitySummary(quality);
      report.stages.quality = { summary: summariseQuality(quality) };
    }
    report.executedStages.push('check');
  } else if (written.length === 0) {
    report.limitations.push('没有成功写入任何笔记文件，覆盖率检查未执行。');
  } else if (!stages.check) {
    report.limitations.push('本次运行未请求 check 阶段：覆盖率与质量检查未执行。');
  }

  /* --------------------------------------------------- completion + reports */
  const brief = buildBrief(renderContext);
  const completion = decideCompletion({ report, coverage, quality, authoring, written, knowledge });
  report.completion = completion.state;
  report.completionReason = completion.reason;
  renderContext.completion = completion.state;
  renderContext.completionReason = completion.reason;

  const readme = renderCourseReadme({
    ...renderContext,
    coverage,
    quality,
    authoring: report.authoring,
  });
  const coverageMarkdown = coverage
    ? `${renderCoverageMarkdown(coverage, structureIssues)}\n${quality ? renderQualityMarkdown(quality) : ''}`
    : null;

  const runReportMarkdown = renderRunReport({ ...report, coverage, structureIssues });

  const extraFiles = [
    { path: 'README.md', content: readme },
    { path: 'knowledge.json', content: JSON.stringify(sanitiseKnowledge(knowledge), null, 1) },
    { path: 'run-report.md', content: runReportMarkdown },
    { path: '.coursenotes/note-brief.md', content: brief.text },
    { path: '.coursenotes/evidence.json', content: JSON.stringify(serialiseEvidence(evidenceIndex), null, 1) },
    { path: `.coursenotes/${path.basename(VISION_RESULTS_FILE)}`, content: JSON.stringify(serialiseVision(vision), null, 1) },
  ];
  if (coverageMarkdown) extraFiles.push({ path: 'coverage-report.md', content: coverageMarkdown });

  for (const file of extraFiles) {
    const outcome = await workspace.writeText(path.join(outputDir, file.path), file.content);
    writeOutcome.push({ file: file.path, ...outcome, chars: file.content.length });
    if (!outcome.ok) {
      report.errors.push({
        stage: 'output',
        code: outcome.code ?? 'WRITE_FAILED',
        message: `写入 ${file.path} 失败：${outcome.message}`,
      });
    }
  }

  await writeWorkArtifacts(workspace, workDir, report, logger, {
    knowledge,
    documents,
    retrieval,
    brief,
    evidenceIndex,
  });

  report.outputs = {
    files: writeOutcome.map((outcome) => ({
      path: outcome.file,
      ok: outcome.ok,
      chars: outcome.chars,
      code: outcome.code,
    })),
    /*
     * `noteFiles` is the list of note files this run *intends* to produce — it is
     * what the artifacts block and the sample listings are built from, and it is
     * populated even when a write was refused.  `writtenFiles` is the subset that
     * actually landed on disk.  Keeping both, explicitly named, is what stops a
     * caller from reporting notes that do not exist: an earlier revision guarded
     * its sandbox-relocation retry on `noteFiles.length === 0`, which is never
     * true, so a fully denied run reported success with a note list that was not
     * on disk.
     */
    noteFiles: finalFiles.map((file) => file.path),
    writtenNoteFiles: writeOutcome
      .filter((outcome) => outcome.ok && isNoteFile(outcome.file))
      .map((outcome) => outcome.file),
    refusedNoteFiles: writeOutcome
      .filter((outcome) => !outcome.ok && isNoteFile(outcome.file))
      .map((outcome) => ({ path: outcome.file, code: outcome.code })),
    brief: path.join(workDir, 'note-brief.md'),
    artifacts: {
      knowledgeJson: 'knowledge.json',
      runReport: 'run-report.json',
      coverageReport: coverage ? 'coverage-report.md' : null,
      evidence: '.coursenotes/evidence.json',
      visionTasks: VISION_RESULTS_FILE,
    },
    assets,
  };
  report.brief = {
    text: brief.text,
    truncated: brief.truncated,
    savePrompt: buildSavePrompt(renderContext, brief),
  };
  report.executedStages.push('output');

  // The machine-readable report is serialised from the SAME state as every other
  // report, and written last so the complete write list is known.
  const runReportJson = {
    ...report,
    writtenFiles: writeOutcome.map((outcome) => ({
      path: outcome.file,
      ok: outcome.ok,
      chars: outcome.chars,
      code: outcome.code,
    })),
    noteFiles: finalFiles.map((file) => file.path),
    chapterFiles: [...rendered.chapterFiles.entries()].map(([index, file]) => ({ index, file })),
  };
  delete runReportJson.brief;
  const reportJsonOutcome = await workspace.writeText(
    path.join(outputDir, 'run-report.json'),
    JSON.stringify(runReportJson, null, 1),
  );
  writeOutcome.push({
    file: 'run-report.json',
    ...reportJsonOutcome,
    chars: JSON.stringify(runReportJson).length,
  });
  if (!reportJsonOutcome.ok) {
    report.errors.push({
      stage: 'output',
      code: reportJsonOutcome.code ?? 'WRITE_FAILED',
      message: `写入 run-report.json 失败：${reportJsonOutcome.message}`,
    });
  }

  return finaliseReport(report, startedAt, logger);
}

function normalizeRequestedStages(value) {
  if (!Array.isArray(value) || value.length === 0) return null;
  const filtered = STAGE_ORDER.filter((stage) => value.includes(stage));
  if (filtered.length === 0) return null;
  if (filtered.length === STAGE_ORDER.length) return null;
  return filtered;
}

function chapterKeyOfFile(file) {
  const base = path.basename(String(file));
  const match = base.match(/^(Chapter[_-]?\d+)/i);
  return match ? match[1] : base.replace(/\.(md|markdown)$/i, '');
}

/** Is this output path a note file (as opposed to a report or a sidecar)? */
function isNoteFile(file) {
  return /\.(md|markdown)$/i.test(file) && !/\.coursenotes[\\/]/i.test(file);
}

/**
 * Decide the run's completion state from measured facts.
 *
 * The rule that matters: a run is `verified` only when every knowledge point was
 * measured complete on every dimension.  Writing the files, or having a model
 * produce *some* prose, is not enough.
 *
 * A file that could not be parsed is a *material* loss, not a cosmetic one: the
 * knowledge points inside it never existed, so coverage cannot see them and no
 * amount of authoring brings them back.  Such a run can never be `verified`,
 * however clean the chapters it did produce look — otherwise a broken PDF would
 * be silently downgraded into "a shorter course".
 */
function decideCompletion({ report, coverage, quality, authoring, written, knowledge }) {
  if (written.length === 0) {
    return { state: 'failed', reason: '没有成功写入任何笔记文件 / no note file could be written' };
  }
  const totalPoints = knowledge?.counts?.keyPoints ?? 0;
  const failedWrites = report.outputs?.files?.filter((file) => !file.ok).length ?? 0;
  const failedDocuments = (report.documents ?? []).filter((doc) => !doc.supported);
  const backendDown = report.errors.some((error) => error.code === 'PYTHON_BACKEND_UNAVAILABLE');
  /** Prefixes the state when something the notes depend on is missing. */
  const losses = [];
  if (failedDocuments.length > 0) {
    losses.push(
      `${failedDocuments.length} 个文件未解析（${failedDocuments
        .slice(0, 4)
        .map((doc) => doc.relative ?? doc.name)
        .join(', ')}${failedDocuments.length > 4 ? '…' : ''}）`,
    );
  }
  if (backendDown) losses.push('解析后端不可用');
  if (failedWrites > 0) losses.push(`${failedWrites} 个文件写入失败`);
  const lossNote = losses.length > 0 ? `；${losses.join('；')}` : '';

  if (!authoring?.usedLlm) {
    if (totalPoints === 0) {
      return { state: 'parsed', reason: '未提取到知识点，只生成了章节骨架 / no knowledge point was extracted' };
    }
    if (losses.length > 0) {
      return {
        state: 'partial',
        reason: `正文未由模型撰写且${losses.join('；')} / prose was not authored and material was lost`,
      };
    }
    return {
      state: 'scaffold_created',
      reason: authoring?.summary?.skippedReason ?? '正文未由模型撰写 / the explanatory prose was not authored',
    };
  }

  const authoredPoints = authoring.summary?.authoredPointCount ?? 0;
  const failedPoints = authoring.summary?.pointIdsNotAuthored ?? [];
  const remainingTodos = authoring.summary?.remainingTodos ?? 0;
  if (authoredPoints < totalPoints || failedPoints.length > 0 || remainingTodos > 0 || failedWrites > 0) {
    return {
      state: 'partial',
      reason:
        `${authoredPoints}/${totalPoints} 个知识点已撰写` +
        (failedPoints.length > 0 ? `，未完成：${failedPoints.slice(0, 8).join(', ')}${failedPoints.length > 8 ? '…' : ''}` : '') +
        (remainingTodos > 0 ? `，仍有 ${remainingTodos} 处 COURSENOTES:TODO 未撰写` : '') +
        (failedWrites > 0 ? `，${failedWrites} 个文件写入失败` : ''),
    };
  }
  if (losses.length > 0) {
    return {
      state: 'partial',
      reason: `全部已提取的知识点均已撰写，但材料不完整：${losses.join('；')}`,
    };
  }
  if (!quality) {
    return {
      state: 'notes_authored',
      reason: '全部知识点已撰写，但未执行质量检查 / quality check was not run',
    };
  }
  if (quality.points.complete === quality.points.total && quality.citations.unknown.length === 0) {
    return {
      state: 'verified',
      reason: `全部 ${totalPoints} 个知识点通过结构/内容/双语/公式/引用检查`,
    };
  }
  return {
    state: 'partial',
    reason:
      `全维度通过 ${quality.points.complete}/${quality.points.total}` +
      (quality.citations.unknown.length > 0 ? `，${quality.citations.unknown.length} 条引用无法对应检索结果` : '') +
      lossNote,
  };
}

/* ------------------------------------------------------------ LLM authoring */

async function runAuthoringStage({
  request,
  options,
  knowledge,
  rendered,
  report,
  renderContext,
  evidenceIndex,
  retrieval,
  vision,
  logger,
}) {
  const skipped = (reason, code = 'authoring-skipped') => {
    report.warnings.push({ stage: 'author', code, message: reason });
    return {
      usedLlm: false,
      files: [],
      summary: {
        attempted: false,
        skippedReason: reason,
        authoredPointCount: 0,
        totalPoints: knowledge?.counts?.keyPoints ?? 0,
        pointIdsNotAuthored: [],
        metrics: null,
        chunks: [],
        failures: [],
        citations: { checkable: false, unknown: [] },
      },
      plan: null,
    };
  };

  if (options.mode !== 'auto') {
    return skipped('mode=scaffold：只生成骨架与简报，正文由调用方（Agent/人工）撰写。', 'authoring-disabled-by-mode');
  }
  const llm = request.deps?.llm;
  const model = request.deps?.model;
  if (!llm || typeof llm.stream !== 'function') {
    return skipped('未启用 LLM 撰写：ctx.llm 不可用，笔记保留 COURSENOTES:TODO 标记。', 'llm-unavailable');
  }
  if (!model?.provider || !model?.model) {
    return skipped(
      '未启用 LLM 撰写：无法确定 provider/model（agentDefaultModel 与配置均未提供）。',
      'llm-model-unknown',
    );
  }
  if ((knowledge?.counts?.keyPoints ?? 0) === 0) {
    return skipped('未提取到知识点，无需撰写正文。', 'no-knowledge-points');
  }

  // Context budget: an explicit `chunkChars` wins, otherwise derive it from the
  // model's real context window.  A model without published context metadata gets
  // the conservative default rather than an unbounded prompt.
  let chunkChars = options.chunkChars;
  let contextWindow = null;
  if (!chunkChars || chunkChars <= 0) {
    try {
      const info = typeof llm.resolveModelInfo === 'function'
        ? await llm.resolveModelInfo(model.provider, model.model)
        : null;
      contextWindow = info?.context?.contextWindow ?? info?.contextWindow ?? null;
      chunkChars = chunkBudgetFromContext(contextWindow);
    } catch (error) {
      logger?.warn('could not resolve model context window', { message: error.message });
      chunkChars = chunkBudgetFromContext(null);
    }
  }
  options.chunkChars = chunkChars;

  const runner = createModelRunner(llm, model, {
    maxAttempts: options.llmMaxAttempts ?? DEFAULT_MAX_ATTEMPTS,
    backoffMs: options.llmRetryBackoffMs ?? 400,
    signal: request.signal,
    logger,
  });

  const scaffolds = new Map(rendered.files.map((file) => [file.path, file.content]));
  logger.info('authoring notes with llm', {
    provider: model.provider,
    model: model.model,
    chunkChars,
    contextWindow,
    files: scaffolds.size,
  });

  const result = await authorNotes({
    knowledge,
    chapterFiles: rendered.chapterFiles,
    scaffolds,
    options,
    model,
    runner,
    evidenceIndex,
    retrieval,
    logger,
    signal: request.signal,
    onProgress: request.onProgress,
  });

  if (result.failures.length > 0) {
    for (const failure of result.failures.slice(0, 20)) {
      report.warnings.push({
        stage: 'author',
        code: failure.kind,
        message: failure.message,
      });
    }
  }
  const authoredIds = new Set(result.mergedPointIds);
  const allIds = (knowledge.keyPoints ?? []).map((point) => point.id);
  const notAuthored = allIds.filter((id) => !authoredIds.has(id));

  // A single-file run must still author every chapter: verify per file that the
  // chapters it holds were all attempted.  v1.0 authored only chapter 1 here.
  const chapterCounts = new Map(
    (knowledge.chapters ?? []).map((chapter) => [chapter.index, (chapter.points ?? []).length]),
  );
  const plannedChapters = new Set(result.plan.tasks.map((task) => task.chapterIndex));
  const unplannedChapters = [...chapterCounts.keys()].filter((index) => !plannedChapters.has(index));

  return {
    usedLlm: result.mergedPointIds.length > 0,
    files: result.files,
    plan: result.plan,
    summary: {
      attempted: true,
      skippedReason: null,
      provider: model.provider,
      model: model.model,
      contextWindow,
      chunkChars,
      strategy: options.chunkStrategy,
      plan: result.plan.stats,
      chunks: result.chunks,
      sections: result.sections,
      sectionsAuthored: result.mergedSectionIds.length,
      sectionsTotal: result.totalSections,
      metrics: result.metrics,
      failures: result.failures,
      repairedPoints: result.repairedPoints,
      authoredPointCount: result.mergedPointIds.length,
      totalPoints: allIds.length,
      pointIdsNotAuthored: notAuthored,
      chaptersNotPlanned: unplannedChapters,
      remainingTodos: result.remainingTodos,
      citations: result.citations,
      retrievalPerformed: result.retrievalPerformed,
      visionTasksApplied: vision?.applied?.count ?? 0,
    },
  };
}

/* ------------------------------------------------------------------ reports */

function coverageSummary(coverage) {
  return {
    totalKeyPoints: coverage.totalKeyPoints,
    covered: coverage.covered,
    partial: coverage.partial,
    missing: coverage.missing,
    ratio: coverage.ratio,
    effectiveRatio: coverage.effectiveRatio,
    byChapter: coverage.byChapter,
    glossaryPresent: coverage.glossary.present,
    glossaryTotal: coverage.glossary.total,
    formulas: coverage.formulas,
    missingPointIds: coverage.missingPoints.map((point) => point.id),
  };
}

function qualitySummary(quality) {
  return {
    language: quality.language,
    points: {
      total: quality.points.total,
      complete: quality.points.complete,
      structureOk: quality.points.structureOk,
      contentOk: quality.points.contentOk,
      bilingualOk: quality.points.bilingualOk,
    },
    structure: quality.structure,
    content: quality.content,
    bilingual: quality.bilingual,
    formulas: {
      total: quality.formulas.total,
      rendered: quality.formulas.rendered,
      explained: quality.formulas.explained,
    },
    citations: quality.citations,
    semantic: quality.semantic,
    completeness: quality.completeness,
    incompletePoints: quality.points.detail
      .filter((point) => !point.complete)
      .map((point) => ({ id: point.id, missing: point.missingDimensions })),
  };
}

function serialiseEvidence(index) {
  return {
    stats: index.stats,
    sources: index.sources,
    points: [...index.byPoint.values()].map((record) => ({
      pointId: record.pointId,
      chapterIndex: record.chapterIndex,
      topic: record.topic,
      queries: record.queries,
      lectureEvidence: record.lectureEvidence.map((item) => ({
        documentName: item.documentName,
        locator: item.locator,
        section: item.section,
        chars: item.excerpt.length,
      })),
      retrievedEvidence: record.retrievedEvidence.map((item) => ({
        url: item.url,
        title: item.title,
        sourceType: item.sourceType,
        trust: item.trust,
        kind: item.kind,
        query: item.query,
        retrievedAt: item.retrievedAt,
        excerptChars: item.excerpt.length,
        omitted: item.omitted ?? null,
      })),
    })),
  };
}

function serialiseVision(vision) {
  return {
    results: vision.tasks
      .filter((task) => task.status === 'interpreted')
      .map((task) => ({
        taskId: task.id,
        image: task.image,
        locator: task.locator,
        interpretation: task.interpretation,
        confidence: task.confidence,
        unresolved: task.unresolved,
      })),
    pending: vision.tasks
      .filter((task) => task.status !== 'interpreted')
      .map((task) => ({
        taskId: task.id,
        kind: task.kind,
        image: task.image,
        locator: task.locator,
        sourceName: task.sourceName,
        question: task.question,
        pointIds: task.pointIds,
      })),
  };
}

/** Read `vision-results.json` from the output directory, when present. */
function readVisionResults(workspace, outputDir, logger) {
  const target = path.join(outputDir, VISION_RESULTS_FILE);
  try {
    if (!fs.existsSync(target)) return null;
    return JSON.parse(fs.readFileSync(target, 'utf8'));
  } catch (error) {
    logger?.warn('vision-results.json could not be read', { message: error.message });
    return null;
  }
}

/** Emit the intermediate artifacts so any stage can be rerun or inspected. */
async function writeWorkArtifacts(workspace, workDir, report, logger, extra = {}) {
  const files = [
    { name: 'stage-scan.json', content: JSON.stringify(report.stages.scan ?? {}, null, 1) },
    { name: 'run.json', content: JSON.stringify({ ...report, brief: undefined }, null, 1) },
  ];
  if (extra.knowledge) {
    files.push({ name: 'knowledge.json', content: JSON.stringify(sanitiseKnowledge(extra.knowledge), null, 1) });
  }
  if (extra.documents) {
    files.push({
      name: 'documents.json',
      content: JSON.stringify(
        extra.documents.map((doc) => ({ ...doc, text: truncate(doc.text, 20000) })),
        null,
        1,
      ),
    });
  }
  if (extra.retrieval) {
    files.push({ name: 'retrieval.json', content: JSON.stringify(extra.retrieval, null, 1) });
  }
  if (extra.evidenceIndex) {
    files.push({ name: 'evidence.json', content: JSON.stringify(serialiseEvidence(extra.evidenceIndex), null, 1) });
  }
  if (report.authoring) {
    files.push({ name: 'authoring.json', content: JSON.stringify(report.authoring, null, 1) });
  }
  if (extra.brief) {
    files.push({ name: 'note-brief.md', content: extra.brief.text });
  }
  for (const file of files) {
    const outcome = await workspace.writeText(path.join(workDir, file.name), file.content);
    if (!outcome.ok) logger?.warn('work artifact not written', { file: file.name, code: outcome.code });
  }
}

function sanitiseKnowledge(knowledge) {
  const pointView = (point) => ({
    id: point.id,
    title: point.title,
    kind: point.kind,
    chapterIndex: point.chapterIndex,
    chapterTitle: point.chapterTitle,
    document: point.document,
    documentName: point.documentName,
    locator: point.locator,
    section: point.section,
    terms: point.terms,
    sourceText: point.sourceText,
    /*
     * An attached figure interpretation must survive this view.
     *
     * It did not: the pipeline attaches interpretations to the in-memory points and
     * then the planner reads the *sanitised* points, so the vision task existed,
     * the interpretation was ingested and stored on the point — and the authoring
     * prompt still described a figure the plugin already knew about. Two views of
     * the same data must not disagree about what is in it.
     */
    ...(point.visionInterpretations
      ? {
          visionInterpretations: point.visionInterpretations.map((item) => ({
            taskId: item.taskId,
            kind: item.kind,
            image: item.image,
            locator: item.locator,
            interpretation: item.interpretation,
            confidence: item.confidence,
            unresolved: item.unresolved,
          })),
        }
      : {}),
  });
  return {
    counts: knowledge.counts,
    chapters: knowledge.chapters.map((chapter) => ({
      index: chapter.index,
      title: chapter.title,
      documents: chapter.documents,
      outline: chapter.outline,
      points: (chapter.points ?? []).map(pointView),
      formulas: chapter.formulas,
      figures: chapter.figures,
      locators: chapter.locators,
    })),
    keyPoints: knowledge.keyPoints.map(pointView),
    glossary: knowledge.glossary,
    formulas: knowledge.formulas,
    dependencies: knowledge.dependencies,
  };
}

function finaliseReport(report, startedAt, logger) {
  report.finishedAt = new Date().toISOString();
  report.elapsedMs = Date.now() - startedAt;
  report.completionLabel = COMPLETION_STATES[report.completion] ?? report.completion;
  logger?.info('pipeline done', {
    ms: report.elapsedMs,
    completion: report.completion,
    errors: report.errors.length,
  });
  return report;
}

/* ---------------------------------------------------------------- run report */

export function renderRunReport(report) {
  const out = [];
  out.push('# CourseNotes 处理报告 / Processing Report');
  out.push('');
  out.push(`- 运行编号 / Run: \`${report.runId}\``);
  out.push(`- 插件版本 / Version: ${report.version}`);
  out.push(`- 开始 / Started: ${report.startedAt}`);
  out.push(`- 结束 / Finished: ${report.finishedAt ?? '—'}`);
  out.push(`- 耗时 / Elapsed: ${((report.elapsedMs ?? 0) / 1000).toFixed(1)} s`);
  out.push(`- 输出目录 / Output: \`${toPosix(report.outputDir)}\``);
  out.push(`- 过程目录 / Work dir: \`${toPosix(report.workDir)}\``);
  out.push(
    `- 文件写入 / File writes: ${report.sandboxed ? '通过 Harness ctx.fs（受沙箱策略约束，不回落原生 fs）' : 'Node fs（CLI 模式）'}`,
  );
  out.push('');
  out.push('## 完成状态 / Completion state');
  out.push('');
  out.push(`- 状态 / State: **\`${report.completion}\`** — ${report.completionLabel ?? ''}`);
  out.push(`- 依据 / Reason: ${report.completionReason ?? '—'}`);
  out.push(`- 已执行阶段 / Stages executed: ${(report.executedStages ?? []).join(' → ') || '—'}`);
  out.push('');
  out.push('> `verified` 是唯一表示“全部知识点都已写入且通过检查”的状态；文件生成成功不等于笔记完成。');
  out.push('> `verified` is the only state meaning every knowledge point was written and passed the checks.');
  out.push('');
  out.push('## 输入扫描 / Input scan');
  out.push('');
  out.push('```text');
  out.push(report.scanListing ?? '(none)');
  out.push('```');
  out.push('');
  out.push('## 解析结果 / Parsing');
  out.push('');
  const summary = report.stages?.parse?.summary;
  if (summary) {
    out.push(`- 文档 / documents: ${summary.documentCount}（成功 ${summary.parsedCount}，失败 ${summary.failedCount}）`);
    out.push(`- 内容 / content: ${summary.unitCount} 单元，${summary.charCount} 字符`);
    out.push(`- 结构 / structure: ${summary.tableCount} 表格，${summary.imageCount} 图，${summary.formulaCount} 公式候选`);
    out.push(`- 图表待解读 / figures needing vision: ${summary.visionTaskCount}`);
    out.push(`- 警告 / warnings: ${summary.warningCount}`);
  }
  const runtime = report.stages?.parse?.runtime;
  out.push(
    `- 解析后端 / backend: ${runtime?.available ? `${toPosix(runtime.interpreter)} (Python ${runtime.pythonVersion})，耗时 ${runtime.elapsedMs ?? '?'} ms` : '未运行 / not run'}`,
  );
  out.push('');
  if (report.documents?.length > 0) {
    out.push('| ID | 文件 / File | 格式 | 类型 | 单元 | 字符 | 表格 | 图 | 公式 | 状态 |');
    out.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
    for (const doc of report.documents) {
      out.push(
        `| ${doc.id} | ${doc.relative} | ${doc.format} | ${doc.genre} | ${doc.stats.unitCount} | ${doc.stats.charCount} | ${doc.stats.tableCount} | ${doc.stats.imageCount} | ${doc.stats.formulaCount} | ${doc.supported ? 'OK' : `失败（${doc.warnings.map((w) => w.code).join(',')}）`} |`,
      );
    }
    out.push('');
  }
  out.push('## 知识结构 / Knowledge structure');
  out.push('');
  const counts = report.stages?.knowledge;
  if (counts) {
    out.push(`- 章节 / chapters: ${counts.chapters}`);
    out.push(`- 知识点 / knowledge points: ${counts.keyPoints}`);
    out.push(`- 术语 / glossary terms: ${counts.glossary}`);
    out.push(`- 公式候选 / formula candidates: ${counts.formulas}`);
    out.push(`- 依赖关系 / dependencies: ${counts.dependencies}`);
  }
  out.push('');
  if (report.knowledge?.chapters?.length > 0) {
    out.push('| 章 / Chapter | 标题 | 知识点 | 公式 | 图表 |');
    out.push('| --- | --- | --- | --- | --- |');
    for (const chapter of report.knowledge.chapters) {
      out.push(`| ${chapter.index} | ${chapter.title} | ${chapter.points} | ${chapter.formulas} | ${chapter.figures} |`);
    }
    out.push('');
  }
  out.push('## 外部检索 / External retrieval');
  out.push('');
  out.push(report.retrieval?.summary ?? '（未执行）');
  out.push('');
  out.push(
    `- 配置开关 / \`enableWebSearch\`: ${report.retrieval?.configured === false ? 'false（用户关闭）' : 'true'}`,
  );
  out.push(
    `- Harness web 服务 / ctx.web: ${report.retrieval?.serviceAvailable ? '可用 / available' : '未注册 / not registered'}`,
  );
  if (report.retrieval?.sources?.length > 0) {
    out.push('');
    out.push('| # | 来源 / Source | 类型 | 可信度 |');
    out.push('| --- | --- | --- | --- |');
    for (const source of report.retrieval.sources.slice(0, 30)) {
      out.push(`| ${source.index} | [${(source.title || source.url).slice(0, 70)}](${source.url}) | ${source.type} | ${source.trust} |`);
    }
    out.push('');
  }
  if (report.evidence) {
    out.push('## 证据映射 / Evidence mapping');
    out.push('');
    out.push(
      `- 有外部证据的知识点 / points with external evidence: ${report.evidence.pointsWithEvidence}/${report.evidence.points}`,
    );
    out.push(`- 证据条目 / evidence excerpts: ${report.evidence.evidenceItems}（${report.evidence.externalChars} 字符进入提示词）`);
    out.push(`- 可引用 URL 白名单 / citable URLs: ${report.evidence.allowlistedUrls}`);
    out.push('');
  }
  if (report.vision) {
    out.push('## 多模态 / Multimodal');
    out.push('');
    out.push(`- ${report.vision.summary}`);
    out.push(
      `- 模型视觉能力 / model vision: ${report.vision.capability?.supported === true ? '支持 / supported' : report.vision.capability?.supported === false ? '不支持 / text-only' : '未知 / unknown'} — ${report.vision.capability?.reason ?? ''}`,
    );
    out.push(
      `- 结果文件 / results file: \`${report.vision.resultsFile}\`（已应用 ${report.vision.applied?.count ?? 0} 条）`,
    );
    out.push('');
  }
  if (report.authoring) {
    out.push('## 分块撰写 / Chunked authoring');
    out.push('');
    const authoring = report.authoring;
    if (!authoring.attempted) {
      out.push(`- 未执行 / not attempted: ${authoring.skippedReason}`);
    } else {
      out.push(`- 模型 / model: \`${authoring.provider}/${authoring.model}\``);
      out.push(
        `- 分块 / chunks: ${authoring.plan?.tasks ?? 0} 个任务覆盖 ${authoring.plan?.points ?? 0} 个知识点（每块预算 ${authoring.chunkChars} 字符${authoring.contextWindow ? `，模型上下文 ${authoring.contextWindow} tokens` : ''}）`,
      );
      out.push(`- 已撰写 / authored: ${authoring.authoredPointCount}/${authoring.totalPoints}`);
      if (authoring.pointIdsNotAuthored?.length > 0) {
        out.push(
          `- 未撰写 / not authored: ${authoring.pointIdsNotAuthored.slice(0, 40).join(', ')}${authoring.pointIdsNotAuthored.length > 40 ? ' …' : ''}`,
        );
      }
      if (authoring.repairedPoints?.length > 0) {
        out.push(`- 局部补全 / repaired after verification: ${authoring.repairedPoints.join(', ')}`);
      }
      const metrics = authoring.metrics;
      if (metrics) {
        out.push(
          `- 调用 / calls: ${metrics.calls}（重试 ${metrics.retries}，失败 ${metrics.failures}），提示词 ${metrics.promptChars} 字符 / 生成 ${metrics.completionChars} 字符，耗时 ${(metrics.elapsedMs / 1000).toFixed(1)} s`,
        );
        if (metrics.promptTokens || metrics.completionTokens) {
          out.push(`- tokens: 输入 ${metrics.promptTokens}，输出 ${metrics.completionTokens}`);
        }
      }
      out.push('');
      out.push('| 章 | 块 | 知识点 | 状态 | 字符 | 补全 |');
      out.push('| --- | --- | --- | --- | --- | --- |');
      for (const chunk of (authoring.chunks ?? []).slice(0, 200)) {
        out.push(
          `| ${chunk.chapterIndex} | ${chunk.chunkIndex} | ${chunk.pointIds.join(', ')} | ${chunk.status} | ${chunk.chars} | ${chunk.repairUsed ? '是' : '否'} |`,
        );
      }
    }
    out.push('');
  }
  if (report.quality) {
    out.push('## 多维质量 / Multi-dimensional quality');
    out.push('');
    const quality = report.quality;
    out.push(`- 全维度通过 / all dimensions: ${quality.points.complete}/${quality.points.total}（${(quality.completeness.ratio * 100).toFixed(1)}%）`);
    out.push(`- 结构 / structure: ${quality.points.structureOk}/${quality.points.total}`);
    out.push(`- 内容 / content: ${quality.points.contentOk}/${quality.points.total}`);
    out.push(`- 双语 / bilingual: ${quality.points.bilingualOk}/${quality.points.total}`);
    out.push(`- 公式 / formulas: 渲染 ${quality.formulas.rendered}/${quality.formulas.total}，解释 ${quality.formulas.explained}/${quality.formulas.total}`);
    out.push(
      `- 引用 / citations: ${quality.citations.checkable ? `${quality.citations.citedUrls} 条，异常 ${quality.citations.unknown.length} 条` : '未执行检索，无法核对'}`,
    );
    out.push(
      `- 语义检查 / semantic: ${quality.semantic?.judged ? `${quality.semantic.judge}（未经验证，不作为准确率）` : '未执行'}`,
    );
    out.push('');
  }
  if (report.coverage) {
    out.push('## 覆盖率 / Coverage');
    out.push('');
    out.push(
      `- 知识点 / key points: ${report.coverage.totalKeyPoints}；已覆盖 ${report.coverage.covered}；部分 ${report.coverage.partial}；未覆盖 ${report.coverage.missing}`,
    );
    out.push(`- 覆盖率 / ratio: ${(report.coverage.ratio * 100).toFixed(1)}%（加权 ${(report.coverage.effectiveRatio * 100).toFixed(1)}%）`);
    if (report.coverage.missingPointIds?.length > 0) {
      out.push(`- 未覆盖 ID / uncovered ids: ${report.coverage.missingPointIds.join(', ')}`);
    }
    out.push('');
  }
  out.push('## 输出文件 / Output files');
  out.push('');
  for (const file of report.outputs?.files ?? []) {
    out.push(`- ${file.ok ? '✅' : '❌'} ${file.path}（${file.chars} 字符${file.ok ? '' : `，${file.code}`}）`);
  }
  out.push('');
  if (report.errors?.length > 0) {
    out.push('## 错误 / Errors');
    out.push('');
    for (const error of report.errors) {
      out.push(`- [${error.stage}/${error.code ?? 'ERROR'}] ${error.message}`);
    }
    out.push('');
  }
  if (report.warnings?.length > 0) {
    out.push('## 警告 / Warnings');
    out.push('');
    for (const warning of report.warnings) {
      out.push(`- [${warning.stage}/${warning.code}] ${warning.message}`);
    }
    out.push('');
  }
  out.push('## 已知限制 / Known limitations');
  out.push('');
  const limitations = [...(report.limitations ?? [])];
  limitations.push(
    '覆盖率与质量分都由笔记文本统计得出，只说明“内容是否出现”，不代表讲解正确。',
  );
  if (report.completion !== 'verified') {
    limitations.push(
      `本次运行的状态是 \`${report.completion}\`，不是 \`verified\`；未完成的知识点保留 \`${TODO_MARKER}\` 标记，请在补全后重新运行 \`check_notes_coverage\`。`,
    );
  }
  for (const limitation of limitations) out.push(`- ${limitation}`);
  out.push('');
  return out.join('\n');
}

export { loadNoteTexts, bytesToBinaryString, createHarnessWorkspace, createNodeWorkspace, EVIDENCE_LIMITS, TODO_MARKER };
export default { runPipeline, renderRunReport, PIPELINE_VERSION, COMPLETION_STATES };
