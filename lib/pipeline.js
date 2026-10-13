/**
 * The CourseNotes pipeline.
 *
 *   Stage A  scan      — discover and classify input files          (scan.js)
 *   Stage B  parse     — extract structure, images, formulas        (python-bridge.js, parsers.js)
 *            normalise — one document model with locators           (document.js)
 *   Stage C  knowledge — chapters, key points, glossary, formulas   (knowledge.js)
 *   Stage D  retrieve  — external evidence through `ctx.web`        (retrieve.js)
 *   Stage E  generate  — note files + machine-readable brief        (generate.js)
 *   Stage F  check     — coverage and Markdown structure            (coverage.js)
 *   Stage G  output    — write files, publish assets, report        (this file)
 *
 * The pipeline never throws for an expected per-file failure: a bad file is
 * recorded in the run report and the remaining files still produce notes.
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
import {
  buildBrief,
  buildSavePrompt,
  buildChapterPrompt,
  renderCourseReadme,
  renderNotes,
  unwrapModelMarkdown,
  TODO_MARKER,
} from './generate.js';
import {
  checkCoverage,
  checkNoteStructure,
  loadNoteTexts,
  renderCoverageMarkdown,
  summariseCoverage,
} from './coverage.js';
import { publishAssets } from './files.js';
import { createLogger, formatBytes, toPosix, truncate, uniqueBy } from './util.js';

export const PIPELINE_VERSION = '1.0.0';

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

/**
 * Run the whole pipeline.
 *
 * @param {object} request
 * @param {string[]} request.inputPaths
 * @param {object}   request.options     normalised config (see config.js)
 * @param {string}   [request.cwd]
 * @param {object}   request.workspace   node or harness workspace
 * @param {object}   [request.deps]      `{ web, llm, agentDefaultModel, model }`
 * @param {AbortSignal} [request.signal]
 * @param {object}   [request.logger]
 * @param {boolean}  [request.authorWithLlm]
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

  const report = {
    pipeline: 'CourseNotes',
    version: PIPELINE_VERSION,
    runId,
    startedAt: new Date().toISOString(),
    cwd,
    outputDir,
    workDir,
    options: { ...options },
    stages: {},
    documents: [],
    knowledge: null,
    retrieval: null,
    coverage: null,
    outputs: { files: [], brief: null, assets: null },
    errors: [],
    warnings: [],
    limitations: [],
    model: request.deps?.model ?? null,
    usedLlm: false,
  };

  /* ---------------------------------------------------------------- Stage A */
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

  const filesToParse = parseableFiles(scan);
  if (filesToParse.length === 0) {
    report.limitations.push('没有任何可解析的文件；请检查 input_paths 指向的文件格式。');
    await writeWorkArtifacts(workspace, workDir, report, logger);
    report.finishedAt = new Date().toISOString();
    report.elapsedMs = Date.now() - startedAt;
    return report;
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
  if (knowledge.counts.chapters === 0) {
    report.limitations.push('未能从材料中识别出任何章节：请检查课件是否包含标题层级或编号。');
  }

  /* ---------------------------------------------------------------- Stage D */
  logger.info('stage D: external retrieval');
  const retrieval = await runRetrieval(
    { web: request.deps?.web },
    knowledge,
    {
      enableWebSearch: options.enableWebSearch && request.deps?.web !== undefined,
      maxSearches: options.maxSearches,
      maxFetches: options.maxFetches,
      extraSearchKeywords: options.extraSearchKeywords,
      includeExamples: options.includeExamples,
      signal: request.signal,
    },
    logger,
  );
  report.retrieval = {
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

  /* ------------------------------------------------------------ Stage E + G */
  logger.info('stage E: generating note files');
  const retrievalIndex = new Map();
  for (const result of retrieval.results) {
    const chapter = result.chapterIndex ?? 0;
    const list = retrievalIndex.get(chapter) ?? [];
    for (const source of result.sources) list.push({ ...source, reason: result.reason });
    retrievalIndex.set(chapter, list);
  }
  const genericSources = retrieval.sources.filter((source) => source.trust >= 3);
  const retrievalFor = (chapterIndex) => {
    const specific = retrievalIndex.get(chapterIndex) ?? [];
    const merged = uniqueBy([...specific, ...genericSources], (source) => source.url);
    return merged.slice(0, 12);
  };

  const renderContext = {
    courseName,
    runId,
    documents,
    scan,
    knowledge,
    retrieval,
    options,
    outputDir,
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

  // Coverage is computed over the notes as they exist on disk, so the note
  // files must be written first.
  const writeResults = [];
  for (const file of rendered.files) {
    writeResults.push({ ...file, target: path.join(outputDir, file.path) });
  }
  const writeOutcome = [];
  for (const file of writeResults) {
    const outcome = await workspace.writeText(file.target, file.content);
    writeOutcome.push({ file: file.path, ...outcome, chars: file.content.length });
    if (!outcome.ok) {
      report.errors.push({
        stage: 'output',
        code: outcome.code ?? 'WRITE_FAILED',
        message: `写入 ${file.target} 失败：${outcome.message}`,
      });
    }
  }
  const written = writeOutcome.filter((outcome) => outcome.ok);

  /* ---------------------------------------------------------------- Stage F */
  let coverage = null;
  let structureIssues = [];
  if (written.length > 0) {
    logger.info('stage F: coverage and structure check');
    const notes = loadNoteTexts(outputDir).filter((note) =>
      rendered.files.some((file) => path.basename(file.path) === note.name),
    );
    for (const note of notes) {
      const structure = checkNoteStructure(note.text, note.path);
      structureIssues.push(...structure.issues);
    }
    if (options.coverageCheck) {
      coverage = checkCoverage(knowledge, notes);
      report.coverage = {
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
      report.stages.coverage = {
        summary: summariseCoverage(coverage),
        ratio: coverage.ratio,
        missing: coverage.missing,
        partial: coverage.partial,
      };
    }
  } else {
    report.limitations.push('没有成功写入任何笔记文件，覆盖率检查未执行。');
  }

  /* ---------------------------------------------------- optional LLM authoring */
  if (request.authorWithLlm && written.length > 0) {
    const authored = await authorChaptersWithLlm(
      request.deps,
      renderContext,
      rendered,
      report,
      logger,
    );
    if (authored) {
      report.usedLlm = true;
      for (const file of authored.files) {
        const outcome = await workspace.writeText(path.join(outputDir, file.path), file.content);
        if (!outcome.ok) {
          report.errors.push({
            stage: 'author',
            code: outcome.code ?? 'WRITE_FAILED',
            message: `LLM 补全后写入 ${file.path} 失败：${outcome.message}`,
          });
        }
      }
      if (options.coverageCheck) {
        const notes = loadNoteTexts(outputDir);
        coverage = checkCoverage(knowledge, notes);
        report.coverage = {
          ...report.coverage,
          totalKeyPoints: coverage.totalKeyPoints,
          covered: coverage.covered,
          partial: coverage.partial,
          missing: coverage.missing,
          ratio: coverage.ratio,
          effectiveRatio: coverage.effectiveRatio,
          byChapter: coverage.byChapter,
          missingPointIds: coverage.missingPoints.map((point) => point.id),
          afterLlmAuthoring: true,
        };
      }
    }
  }

  /* ----------------------------------------------------------------- reports */
  const brief = buildBrief(renderContext);
  const readme = renderCourseReadme({ ...renderContext, coverage });
  const coverageMarkdown = coverage ? renderCoverageMarkdown(coverage, structureIssues) : null;
  const runReportMarkdown = renderRunReport({ ...report, coverage, structureIssues });

  const extraFiles = [
    { path: 'README.md', content: readme },
    { path: 'knowledge.json', content: JSON.stringify(sanitiseKnowledge(knowledge), null, 1) },
    { path: 'run-report.md', content: runReportMarkdown },
    { path: '.coursenotes/note-brief.md', content: brief.text },
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

  // The machine-readable report must describe every file the run wrote, so it
  // is serialised last, after the complete write list is known.
  const runReportJson = {
    ...report,
    briefText: undefined,
    writtenFiles: writeOutcome.map((outcome) => ({
      path: outcome.file,
      ok: outcome.ok,
      chars: outcome.chars,
      code: outcome.code,
    })),
    noteFiles: rendered.files.map((file) => file.path),
    chapterFiles: [...rendered.chapterFiles.entries()].map(([index, file]) => ({ index, file })),
  };
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

  await writeWorkArtifacts(workspace, workDir, report, logger, {
    knowledge,
    documents,
    retrieval,
    brief,
  });

  report.outputs = {
    files: writeOutcome.map((outcome) => ({
      path: outcome.file,
      ok: outcome.ok,
      chars: outcome.chars,
      code: outcome.code,
    })),
    noteFiles: rendered.files.map((file) => file.path),
    brief: path.join(workDir, 'note-brief.md'),
    artifacts: {
      knowledgeJson: 'knowledge.json',
      runReport: 'run-report.json',
      coverageReport: coverage ? 'coverage-report.md' : null,
    },
    assets,
  };
  report.brief = {
    text: brief.text,
    truncated: brief.truncated,
    savePrompt: buildSavePrompt(renderContext, brief),
  };

  report.finishedAt = new Date().toISOString();
  report.elapsedMs = Date.now() - startedAt;
  logger.info('pipeline done', {
    ms: report.elapsedMs,
    notes: rendered.files.length,
    errors: report.errors.length,
  });
  return report;
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
  if (extra.brief) {
    files.push({ name: 'note-brief.md', content: extra.brief.text });
  }
  for (const file of files) {
    const outcome = await workspace.writeText(path.join(workDir, file.name), file.content);
    if (!outcome.ok) logger?.warn('work artifact not written', { file: file.name, code: outcome.code });
  }
}

function sanitiseKnowledge(knowledge) {
  return {
    counts: knowledge.counts,
    chapters: knowledge.chapters.map((chapter) => ({
      index: chapter.index,
      title: chapter.title,
      documents: chapter.documents,
      outline: chapter.outline,
      points: chapter.points,
      formulas: chapter.formulas,
      figures: chapter.figures,
      locators: chapter.locators,
    })),
    keyPoints: knowledge.keyPoints.map((point) => ({
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
    })),
    glossary: knowledge.glossary,
    formulas: knowledge.formulas,
    dependencies: knowledge.dependencies,
  };
}

/* ---------------------------------------------------------------- LLM authoring */

async function authorChaptersWithLlm(deps, renderContext, rendered, report, logger) {
  const llm = deps?.llm;
  if (!llm || typeof llm.stream !== 'function') {
    report.warnings.push({
      stage: 'author',
      code: 'llm-unavailable',
      message: '未启用 LLM 补全：ctx.llm 不可用。笔记保留 TODO 标记，需由 Agent 或用户补全。',
    });
    return null;
  }
  const model = deps.model;
  if (!model?.provider || !model?.model) {
    report.warnings.push({
      stage: 'author',
      code: 'llm-model-unknown',
      message: '未启用 LLM 补全：无法确定 provider/model（agentDefaultModel 与配置均未提供）。',
    });
    return null;
  }

  const files = [];
  for (const noteFile of rendered.files) {
    const chapter = rendered.chapterFiles
      ? [...rendered.chapterFiles.entries()].find(([, name]) => name === noteFile.path)?.[0]
      : undefined;
    const chapterObject = renderContext.knowledge.chapters.find(
      (item) => item.index === chapter || noteFile.path.includes(`Chapter_${String(item.index).padStart(2, '0')}`),
    );
    if (!chapterObject) continue;
    const { system, user } = buildChapterPrompt(renderContext, chapterObject, noteFile.content);
    try {
      logger.info('authoring chapter with llm', { chapter: chapterObject.index });
      const text = await streamCompletion(llm, {
        provider: model.provider,
        model: model.model,
        reasoningEffort: model.reasoningEffort,
        system,
        user,
        signal: deps.signal,
      });
      const unwrapped = unwrapModelMarkdown(text);
      if (unwrapped.length < 200) {
        report.warnings.push({
          stage: 'author',
          code: 'llm-output-too-short',
          message: `第 ${chapterObject.index} 章的 LLM 输出过短（${unwrapped.length} 字符），已保留骨架版本。`,
        });
        continue;
      }
      files.push({ path: noteFile.path, content: unwrapped.endsWith('\n') ? unwrapped : `${unwrapped}\n` });
    } catch (error) {
      report.warnings.push({
        stage: 'author',
        code: 'llm-authoring-failed',
        message: `第 ${chapterObject.index} 章 LLM 补全失败：${error.message}`,
      });
    }
  }
  if (files.length === 0) return null;
  files.push({
    path: 'authoring-report.md',
    content: renderAuthoringReport(files, report, model),
  });
  return { files };
}

async function streamCompletion(llm, { provider, model, reasoningEffort, system, user, signal }) {
  let text = '';
  let failure = null;
  for await (const chunk of llm.stream({
    provider,
    model,
    ...(reasoningEffort ? { reasoningEffort } : {}),
    system,
    messages: [{ role: 'user', content: [{ type: 'text', text: user }] }],
    ...(signal ? { signal } : {}),
  })) {
    if (chunk.type === 'text-delta') text += chunk.text;
    else if (chunk.type === 'finish') {
      if (chunk.reason.kind === 'error') failure = chunk.reason.failure;
      if (chunk.reason.kind === 'aborted') failure = chunk.reason.failure ?? { message: 'aborted', code: 'ABORTED' };
    }
  }
  if (failure) throw new Error(`${failure.code ?? 'LLM_ERROR'}: ${failure.message ?? ''}`);
  return text;
}

function renderAuthoringReport(files, report, model) {
  const lines = [
    '# LLM 补全报告 / LLM Authoring Report',
    '',
    `- provider/model: \`${model.provider}/${model.model}\``,
    `- 生成时间 / generated at: ${new Date().toISOString()}`,
    `- 补全章节 / chapters authored: ${files.filter((file) => file.path.startsWith('Chapter_')).length}`,
    '',
    '| 文件 / File | 字符数 / chars | 剩余 TODO |',
    '| --- | --- | --- |',
  ];
  for (const file of files) {
    const todos = (file.content.match(new RegExp(TODO_MARKER, 'g')) ?? []).length;
    lines.push(`| ${file.path} | ${file.content.length} | ${todos} |`);
  }
  lines.push('');
  lines.push('> LLM 补全后仍需人工或 Agent 复核：覆盖率报告只反映知识点是否出现，不保证解释正确。');
  if (report.warnings.filter((warning) => warning.stage === 'author').length > 0) {
    lines.push('');
    lines.push('## 警告 / Warnings');
    for (const warning of report.warnings.filter((item) => item.stage === 'author')) {
      lines.push(`- [${warning.code}] ${warning.message}`);
    }
  }
  return lines.join('\n');
}

/* ---------------------------------------------------------------- run report */

export function renderRunReport(report) {
  const out = [];
  out.push('# CourseNotes 处理报告 / Processing Report');
  out.push('');
  out.push(`- 运行编号 / Run: \`${report.runId}\``);
  out.push(`- 开始 / Started: ${report.startedAt}`);
  out.push(`- 结束 / Finished: ${report.finishedAt ?? '—'}`);
  out.push(`- 耗时 / Elapsed: ${((report.elapsedMs ?? 0) / 1000).toFixed(1)} s`);
  out.push(`- 输出目录 / Output: \`${toPosix(report.outputDir)}\``);
  out.push(`- 过程目录 / Work dir: \`${toPosix(report.workDir)}\``);
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
  if (report.retrieval?.sources?.length > 0) {
    out.push('');
    out.push('| # | 来源 / Source | 类型 | 可信度 |');
    out.push('| --- | --- | --- | --- |');
    for (const source of report.retrieval.sources.slice(0, 30)) {
      out.push(`| ${source.index} | [${(source.title || source.url).slice(0, 70)}](${source.url}) | ${source.type} | ${source.trust} |`);
    }
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
    '覆盖率是词元重合度指标，改写但等义的内容可能被判为“部分覆盖”；它不代表讲解正确性。',
  );
  if (!report.usedLlm) {
    limitations.push(
      '本次运行未启用 LLM 补全：笔记文件中由模型撰写的段落保留 `' +
        TODO_MARKER +
        '` 标记，需由 Agent 或人工补全。',
    );
  }
  for (const limitation of limitations) out.push(`- ${limitation}`);
  out.push('');
  return out.join('\n');
}

export { loadNoteTexts };
