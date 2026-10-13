/**
 * CourseNotes — a DeepSeek Harness plugin that turns course materials into
 * structured, source-traceable bilingual study notes.
 *
 * Registered tools
 *   * `generate_course_notes`   — run the whole pipeline (or a subset of stages)
 *   * `check_notes_coverage`    — coverage + Markdown structure check
 *   * `probe_course_notes`      — environment/readiness diagnostics
 *
 * Design notes that matter when extending this file:
 *   * `output.schema` is a *narrow* JSON Schema subset enforced by the tool
 *     registry — only `type`/`properties`/`required`/`additionalProperties`/
 *     `items`/`enum`/`const`/`oneOf` and annotations.  No `$ref`, no `format`,
 *     no numeric bounds.
 *   * `output.render(args, value)` must return `ContentBlock[]` and only
 *     `text` blocks survive to the model; an empty string block is dropped.
 *   * Raw `ctx.tools.register()` performs no argument validation, so every
 *     tool validates its own arguments and throws an actionable message.
 *   * `ctx.tools.register()`'s disposer is owned by the tools service; it is
 *     adopted in this plugin's own effect so plugin unload removes the tools.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { DEFAULTS, mergeOptions, normalizeConfig } from './lib/config.js';
import { createLogger, formatBytes, toPosix, truncate } from './lib/util.js';
import { runPipeline, renderRunReport, PIPELINE_VERSION } from './lib/pipeline.js';
import { createHarnessWorkspace, createNodeWorkspace } from './lib/files.js';
import { checkCoverage, checkNoteStructure, loadNoteTexts, renderCoverageMarkdown, summariseCoverage } from './lib/coverage.js';
import { resolvePython, BACKEND_SCRIPT, pythonCapabilities, pythonDiscoveryReport } from './lib/python-bridge.js';
import { scanInputs, describeScan } from './lib/scan.js';

export const name = 'course-notes';
export const inject = ['tools'];
export { DEFAULTS as defaultConfig };

/** Build revision marker: bumped to force a fresh module generation on reload. */
export const BUILD = '1.0.0+20261013d';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** Config is validated by hand (see lib/config.js): no schemastery import. */
function resolveConfig(raw) {
  return normalizeConfig(raw ?? {});
}

/* ------------------------------------------------------------------ helpers */

function asTextBlock(text) {
  const value = String(text ?? '');
  return value === '' ? [] : [{ type: 'text', text: value }];
}

/**
 * Strip `undefined` members so a tool result is guaranteed lossless JSON.
 *
 * The registry deep-freezes every returned body and rejects it with
 * `value is not lossless JSON` when any property holds `undefined` — which
 * silently turns a successful call into a failed one.  Building optional fields
 * conditionally is the primary fix; this is the safety net, applied to every
 * tool result so the guarantee does not depend on remembering it each time.
 *
 * Values that are not JSON at all (functions, symbols, class instances) are
 * reported rather than dropped, because silently losing data would be worse.
 */
export function jsonSafe(value, pathLabel = 'result') {
  if (value === undefined) return undefined; // dropped by the caller
  if (value === null) return null;
  const type = typeof value;
  if (type === 'string' || type === 'number' || type === 'boolean') return value;
  if (type === 'bigint') return Number(value);
  if (Array.isArray(value)) {
    return value
      .map((item, index) => jsonSafe(item, `${pathLabel}[${index}]`) ?? null)
      .filter(() => true);
  }
  if (type === 'object') {
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      const converted = jsonSafe(item, `${pathLabel}.${key}`);
      if (converted !== undefined) out[key] = converted;
    }
    return out;
  }
  throw new TypeError(`${pathLabel} is not JSON-serialisable (${type})`);
}

function requireString(args, key) {
  const value = args?.[key];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`"${key}" is required and must be a non-empty string`);
  }
  return value.trim();
}

function optionalStringArray(value, key) {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'string') {
    return value.split(',').map((item) => item.trim()).filter((item) => item !== '');
  }
  if (Array.isArray(value)) {
    return value.map((item) => String(item));
  }
  throw new Error(`"${key}" must be a string or an array of strings`);
}

function loggerFor(ctx, config) {
  const logger = createLogger(config.logLevel, null, 'course-notes');
  const forward = (level, line) => {
    const sink = ctx.logger?.[level];
    if (typeof sink === 'function') sink.call(ctx.logger, '%s', line);
  };
  return {
    lines: logger.lines,
    error: (...args) => {
      logger.error(...args);
      forward('error', logger.lines[logger.lines.length - 1]);
    },
    warn: (...args) => {
      logger.warn(...args);
      forward('warn', logger.lines[logger.lines.length - 1]);
    },
    info: (...args) => {
      logger.info(...args);
      forward('info', logger.lines[logger.lines.length - 1]);
    },
    debug: (...args) => {
      logger.debug(...args);
      forward('debug', logger.lines[logger.lines.length - 1]);
    },
  };
}

/**
 * Pick the workspace implementation.
 *
 * `ctx.fs` is used when it is present so writes honour the session's sandbox
 * policy and appear in the workspace-change record.  When a Harness write is
 * denied (for example an output directory outside the writable roots), the
 * run is retried into the session workspace and the relocation is reported
 * instead of being hidden.
 */
function workspaceFor(ctx, logger) {
  const fsSeam = ctx.get?.('fs');
  if (fsSeam && typeof fsSeam.writeText === 'function') {
    return { workspace: createHarnessWorkspace({ fs: fsSeam }), kind: 'harness' };
  }
  logger?.debug('ctx.fs unavailable; falling back to node fs');
  return { workspace: createNodeWorkspace(), kind: 'node' };
}

function resolveModel(deps, ctx, config) {
  const selection = ctx.get?.('agentDefaultModel')?.currentSelection?.();
  if (selection?.provider && selection?.model) return selection;
  if (config.llmProvider && config.llmModel) {
    return { provider: config.llmProvider, model: config.llmModel };
  }
  void deps;
  return null;
}

function cwdFromExec(exec) {
  return exec?.agent?.session?.header?.cwd ?? process.cwd();
}

function contextDeps(ctx, logger) {
  return {
    web: ctx.get?.('web'),
    llm: ctx.get?.('llm'),
    logger,
  };
}

/** Summarise which pipeline stages the caller asked for. */
const STAGE_ORDER = ['scan', 'parse', 'knowledge', 'retrieve', 'generate', 'check', 'output'];
const STAGE_ALIASES = {
  scan: 'scan',
  file_scan: 'scan',
  parse: 'parse',
  parsing: 'parse',
  extract: 'parse',
  knowledge: 'knowledge',
  keypoints: 'knowledge',
  retrieve: 'retrieve',
  retrieval: 'retrieve',
  web: 'retrieve',
  search: 'retrieve',
  generate: 'generate',
  notes: 'generate',
  check: 'check',
  coverage: 'check',
  output: 'output',
  write: 'output',
};

function normalizeStages(value) {
  if (value === undefined || value === null) return null;
  const list = optionalStringArray(value, 'stages');
  if (!list || list.length === 0) return null;
  const out = [];
  for (const item of list) {
    const key = STAGE_ALIASES[String(item).trim().toLowerCase()];
    if (!key) {
      throw new Error(
        `unknown stage "${item}"; supported: ${Object.keys(STAGE_ALIASES).join(', ')}`,
      );
    }
    if (!out.includes(key)) out.push(key);
  }
  // Keep the canonical order so a stage never runs before its input exists.
  return STAGE_ORDER.filter((stage) => out.includes(stage));
}

function stageEnabled(stages, stage) {
  return stages === null || stages.includes(stage);
}

/* ------------------------------------------------------------------ tool: generate */

function buildGenerateTool(ctx, config) {
  return {
    name: 'generate_course_notes',
    description: [
      'Generate structured bilingual (Chinese + English) Markdown study notes from course materials.',
      'Supports PDF, PPTX, DOCX, Markdown, plain text and images, given as files, folders or a mix.',
      'Pipeline: file scan -> content parsing (text, headings, tables, formulas, figures) -> knowledge-point',
      'extraction -> external retrieval via the Harness web service -> note generation -> coverage check.',
      'Returns a note-writing brief: the caller (or the plugin\'s own LLM stage) fills the generated',
      'skeletons where they carry a COURSENOTES:TODO marker. Nothing is fabricated: unreadable figures and',
      'unavailable retrieval are reported explicitly in run-report.md.',
    ].join(' '),
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['input_paths'],
      properties: {
        input_paths: {
          type: 'array',
          items: { type: 'string' },
          description: 'Files, folders or both. Windows paths are fine (e.g. "C:\\\\课件\\\\ch1.pptx").',
        },
        output_dir: {
          type: 'string',
          description: 'Where the notes are written. Defaults to the plugin config or <cwd>/course-notes-output.',
        },
        course_name: { type: 'string', description: 'Override the auto-detected course name.' },
        language: {
          type: 'string',
          enum: ['bilingual', 'zh', 'en'],
          description: 'Output language. Default: bilingual.',
        },
        detail_level: {
          type: 'string',
          enum: ['concise', 'standard', 'comprehensive'],
          description: 'Explanation depth. Default: comprehensive.',
        },
        enable_web_search: { type: 'boolean', description: 'Use the Harness web service for supplementary material.' },
        enable_ocr: {
          type: 'boolean',
          description: 'Treat image-only content as a vision task (the caller reads the extracted figures).',
        },
        include_examples: { type: 'boolean', description: 'Include worked examples in the generated material.' },
        include_exercises: { type: 'boolean', description: 'Include self-assessment questions.' },
        split_by_chapter: { type: 'boolean', description: 'One Markdown file per chapter plus a README index.' },
        coverage_check: { type: 'boolean', description: 'Run the knowledge-point coverage check.' },
        file_order: {
          type: 'string',
          enum: ['natural', 'name', 'explicit', 'mtime'],
          description: 'How to order discovered files. Default: natural.',
        },
        explicit_order: {
          type: 'array',
          items: { type: 'string' },
          description: 'File names in the order to process them, used with file_order="explicit".',
        },
        stages: {
          type: 'array',
          items: { type: 'string' },
          description: 'Run only these stages: scan, parse, knowledge, retrieve, generate, check, output.',
        },
        max_searches: { type: 'integer', description: 'Maximum external search queries.' },
        max_fetches: { type: 'integer', description: 'Maximum pages fetched for detail.' },
        brief_char_budget: { type: 'integer', description: 'Budget of the returned note-writing brief, in characters.' },
        author_with_llm: {
          type: 'boolean',
          description:
            'Also author chapter prose with the session model (ctx.llm). Off by default: the brief is usually cheaper and higher quality.',
        },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['ok', 'summary', 'brief', 'artifacts'],
        properties: {
          ok: { type: 'boolean' },
          summary: { type: 'string' },
          brief: { type: 'string' },
          artifacts: {
            type: 'object',
            additionalProperties: false,
            required: ['outputDir', 'noteFiles', 'workDir'],
            properties: {
              outputDir: { type: 'string' },
              workDir: { type: 'string' },
              noteFiles: { type: 'array', items: { type: 'string' } },
              knowledgeJson: { type: 'string' },
              coverageReport: { type: 'string' },
              runReport: { type: 'string' },
              parseReport: { type: 'string' },
            },
          },
        },
      },
      render: (_args, value) => asTextBlock(value.brief),
    },
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      const inputPaths = optionalStringArray(args?.input_paths, 'input_paths');
      if (!inputPaths || inputPaths.length === 0) {
        throw new Error('"input_paths" must contain at least one file or folder path');
      }
      const options = mergeOptions(config, args ?? {});
      options.outputDir = args?.output_dir !== undefined ? String(args.output_dir) : options.outputDir;
      const stages = normalizeStages(args?.stages);
      const cwd = cwdFromExec(exec);
      const logger = loggerFor(ctx, options);
      const { workspace, kind } = workspaceFor(ctx, logger);

      const selection = resolveModel(null, ctx, options);
      const deps = {
        ...contextDeps(ctx, logger),
        model: args?.author_with_llm === true ? selection : null,
        signal: exec?.signal,
      };

      logger.info('generate_course_notes started', {
        inputs: inputPaths.length,
        stages: stages ?? 'all',
        workspace: kind,
      });

      let report = await runPipeline({
        inputPaths,
        options: stages && !stageEnabled(stages, 'output')
          ? options
          : options,
        cwd,
        workspace,
        deps,
        runId: undefined,
        logger,
        authorWithLlm: args?.author_with_llm === true,
        requestedStages: stages,
      });
      report.workspaceKind = kind;

      // A denied Harness write (e.g. an output directory outside the writable
      // roots) is retried inside the session workspace and reported, never
      // silently swallowed.
      const denied = report.errors.filter(
        (error) => error.code === 'FS_SANDBOX_DENIED' || error.code === 'EACCES' || error.code === 'EPERM',
      );
      let relocated = null;
      if (denied.length > 0 && kind === 'harness') {
        const fallbackDir = path.join(cwd, 'course-notes-output');
        logger.warn('output directory denied; retrying inside the workspace', { fallbackDir });
        const retryOptions = { ...options, outputDir: fallbackDir };
        const retry = await runPipeline({
          inputPaths,
          options: retryOptions,
          cwd,
          workspace: createNodeWorkspace(),
          deps,
          logger,
          authorWithLlm: args?.author_with_llm === true,
        });
        retry.workspaceKind = 'node';
        retry.relocatedFrom = options.outputDir !== '' ? options.outputDir : undefined;
        retry.warnings.unshift({
          stage: 'output',
          code: 'output-relocated',
          message:
            `原输出目录被沙箱拒绝写入（${denied[0].message}），已改写会话工作区内的 course-notes-output 目录。` +
            '如需写入原目录，请在具备写权限的模式下重跑，或先扩展可写根。',
        });
        relocated = retry;
        report = retry;
      }

      const noteFiles = report.outputs?.noteFiles ?? [];
      const summary = [
        `CourseNotes ${report.runId}：解析 ${report.stages?.parse?.summary?.parsedCount ?? 0}/${report.documents.length} 个文件，`,
        `章节 ${report.knowledge?.chapters?.length ?? 0}，知识点 ${report.knowledge?.counts?.keyPoints ?? 0}，`,
        `输出 ${noteFiles.length} 个笔记文件到 ${toPosix(report.outputDir)}。`,
        report.coverage ? `${summariseCoverage(report.coverage)}。` : '',
        report.retrieval?.performed ? `外部检索 ${report.retrieval.resultCount} 条查询 / ${report.retrieval.sourceCount} 个来源。` : report.retrieval?.summary ?? '',
        report.errors.length > 0 ? `\n⚠ ${report.errors.length} 个错误，详见 run-report.md。` : '',
        relocated ? '\n⚠ 输出目录已被迁移，详见报告。' : '',
      ]
        .filter((part) => part !== '')
        .join('');

      // Optional fields are omitted, never `undefined`: the registry requires
      // the returned body to be lossless JSON and rejects `undefined` members.
      const artifacts = {
        outputDir: toPosix(report.outputDir),
        workDir: toPosix(report.workDir),
        noteFiles: noteFiles.map((file) => toPosix(file)),
        knowledgeJson: 'knowledge.json',
        runReport: 'run-report.md',
        parseReport: 'run-report.md',
      };
      if (report.coverage) artifacts.coverageReport = 'coverage-report.md';

      return jsonSafe({
        ok: report.errors.length === 0 && noteFiles.length > 0,
        summary,
        brief: buildToolBrief(report, stageEnabled(stages, 'output') && stageEnabled(stages, 'generate')),
        artifacts,
      });
    },
    presentCall(args) {
      const inputs = Array.isArray(args?.input_paths) ? args.input_paths.length : 0;
      return {
        card: 'generic',
        title: `generate_course_notes: ${inputs} 个输入路径`,
        kind: 'other',
      };
    },
  };
}

/** Compose the model-facing text: summary + artifacts + the writing brief. */
function buildToolBrief(report, includeBrief) {
  const lines = [];
  lines.push('# CourseNotes 运行结果 / Run result');
  lines.push('');
  lines.push(`- 运行 / Run: \`${report.runId}\`（CourseNotes ${PIPELINE_VERSION}）`);
  lines.push(`- 课程 / Course: ${report.courseName}`);
  lines.push(`- 输出目录 / Output: \`${toPosix(report.outputDir)}\``);
  lines.push(`- 过程目录 / Work dir: \`${toPosix(report.workDir)}\``);
  const parsed = report.stages?.parse?.summary;
  if (parsed) {
    lines.push(
      `- 解析 / Parsing: ${parsed.parsedCount}/${parsed.documentCount} 个文件，${parsed.unitCount} 单元，${parsed.tableCount} 表格，${parsed.imageCount} 图，${parsed.formulaCount} 公式候选`,
    );
  }
  if (report.knowledge?.counts) {
    lines.push(
      `- 知识结构 / Knowledge: ${report.knowledge.counts.chapters} 章，${report.knowledge.counts.keyPoints} 知识点，${report.knowledge.counts.glossary} 术语`,
    );
  }
  if (report.coverage) lines.push(`- ${summariseCoverage(report.coverage)}`);
  lines.push(`- 检索 / Retrieval: ${report.retrieval?.summary ?? '—'}`);
  if (report.outputs?.noteFiles?.length > 0) {
    lines.push('- 笔记文件 / Note files:');
    for (const file of report.outputs.noteFiles) lines.push(`  - ${toPosix(file)}`);
  }
  const failedFiles = (report.documents ?? []).filter((doc) => !doc.supported);
  if (failedFiles.length > 0) {
    lines.push('- ⚠ 未解析 / not parsed:');
    for (const doc of failedFiles) {
      lines.push(`  - ${doc.relative}: ${doc.warnings.map((warning) => warning.message).join('; ')}`);
    }
  }
  if (report.errors?.length > 0) {
    lines.push('');
    lines.push('## 错误 / Errors');
    for (const error of report.errors.slice(0, 12)) {
      lines.push(`- [${error.stage}/${error.code ?? 'ERROR'}] ${truncate(error.message, 300)}`);
    }
  }
  if (report.warnings?.length > 0) {
    lines.push('');
    lines.push('## 警告 / Warnings');
    for (const warning of report.warnings.slice(0, 8)) {
      lines.push(`- [${warning.stage}/${warning.code}] ${truncate(warning.message, 300)}`);
    }
  }
  if (report.limitations?.length > 0) {
    lines.push('');
    lines.push('## 本次运行的能力限制 / Capability limits of this run');
    for (const limitation of report.limitations) lines.push(`- ${limitation}`);
  }
  if (includeBrief && report.brief?.savePrompt) {
    lines.push('');
    lines.push(report.brief.savePrompt);
  }
  if (includeBrief && report.brief?.text) {
    lines.push('');
    lines.push('---');
    lines.push('');
    lines.push(report.brief.truncated ? '## 简报（已截断，完整版见 .coursenotes/note-brief.md）' : '## 简报 / Brief');
    lines.push('');
    lines.push(report.brief.text);
  }
  return lines.join('\n');
}

/* ------------------------------------------------------------------ tool: coverage */

function buildCoverageTool(ctx, config) {
  return {
    name: 'check_notes_coverage',
    description: [
      'Compare the knowledge points extracted from the course materials with the knowledge actually present in',
      'generated notes, and report covered / partially covered / uncovered items plus Markdown structure',
      'problems (unbalanced fences, broken relative links, unclosed formulas). Coverage is an internal',
      'completeness indicator and does not measure explanation correctness.',
    ].join(' '),
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['knowledge_json'],
      properties: {
        knowledge_json: {
          type: 'string',
          description: 'Path to knowledge.json produced by generate_course_notes.',
        },
        notes_dir: {
          type: 'string',
          description: 'Directory holding the note Markdown files. Defaults to the directory of knowledge_json.',
        },
        write_report: {
          type: 'boolean',
          description: 'Write coverage-report.md next to the notes. Default: true.',
        },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['ok', 'summary', 'report'],
        properties: {
          ok: { type: 'boolean' },
          summary: { type: 'string' },
          report: { type: 'string' },
          reportPath: { type: 'string' },
        },
      },
      render: (_args, value) => asTextBlock(value.report),
    },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const knowledgePath = requireString(args, 'knowledge_json');
      const fs = await import('node:fs');
      if (!fs.existsSync(knowledgePath)) {
        throw new Error(`knowledge_json not found: ${knowledgePath}`);
      }
      let knowledge;
      try {
        knowledge = JSON.parse(fs.readFileSync(knowledgePath, 'utf8'));
      } catch (error) {
        throw new Error(`knowledge_json is not valid JSON: ${error.message}`);
      }
      const notesDir = args?.notes_dir ? String(args.notes_dir) : path.dirname(knowledgePath);
      const notes = loadNoteTexts(notesDir);
      if (notes.length === 0) {
        throw new Error(`no Markdown note files found under ${notesDir}`);
      }
      // Rebuild from `chapters`, which carry the per-chapter point lists.  A
      // flat `keyPoints` array would lose the chapter association, and since
      // point ids restart at K001 per chapter, two chapters' K001 would then be
      // indistinguishable.
      const chapterList = Array.isArray(knowledge.chapters) ? knowledge.chapters : [];
      const fromChapters = chapterList.flatMap((chapter) =>
        (chapter.points ?? []).map((point) => ({
          ...point,
          chapterIndex: chapter.index,
          chapterTitle: chapter.title,
          terms: point.terms ?? [],
          sourceText: point.sourceText ?? '',
          chapterKey: `Chapter_${String(chapter.index).padStart(2, '0')}`,
        })),
      );
      const fromFlat = (knowledge.keyPoints ?? []).map((point) => ({
        ...point,
        chapterIndex: point.chapterIndex ?? 0,
        chapterTitle: point.chapterTitle ?? '',
        terms: point.terms ?? [],
        sourceText: point.sourceText ?? '',
      }));
      // Prefer the chapter-derived list; fall back to the flat list only when
      // the file has no chapter detail (e.g. a hand-written baseline).
      const points = fromChapters.length > 0 ? fromChapters : fromFlat;
      if (points.length === 0) {
        throw new Error(`knowledge_json contains no knowledge points: ${knowledgePath}`);
      }
      const normalised = {
        keyPoints: points,
        chapters: chapterList,
        glossary: knowledge.glossary ?? [],
        formulas: knowledge.formulas ?? [],
      };
      const coverage = checkCoverage(normalised, notes);
      const structureIssues = [];
      for (const note of notes) structureIssues.push(...checkNoteStructure(note.text, note.path).issues);
      const markdown = renderCoverageMarkdown(coverage, structureIssues);
      let reportPath;
      if (args?.write_report !== false) {
        const logger = loggerFor(ctx, normalizeConfig(config));
        const { workspace } = workspaceFor(ctx, logger);
        const target = path.join(notesDir, 'coverage-report.md');
        const outcome = await workspace.writeText(target, markdown);
        if (outcome.ok) reportPath = target;
        else logger.warn('coverage report not written', { code: outcome.code, message: outcome.message });
      }
      void exec;
      /*
       * Every tool's return value must be *lossless JSON*: the registry deep-
       * freezes the returned body and rejects it with `value is not lossless
       * JSON` when any property holds `undefined`.  Optional fields are
       * therefore omitted rather than set to `undefined`.
       */
      const result = jsonSafe({
        ok: true,
        summary: `${summariseCoverage(coverage)}；结构问题 ${structureIssues.length} 项；术语 ${coverage.glossary.present}/${coverage.glossary.total} 出现在笔记中；公式 ${coverage.formulas.covered}/${coverage.formulas.total} 已覆盖。`,
        report: markdown,
      });
      if (reportPath) result.reportPath = toPosix(reportPath);
      return result;
    },
  };
}

/* ------------------------------------------------------------------ tool: probe */

function buildProbeTool(ctx, config) {
  return {
    name: 'probe_course_notes',
    description: [
      'Diagnose CourseNotes readiness without generating notes: report the resolved Python parsing backend and',
      'its libraries, whether the Harness web service and llm service are available, which provider/model would',
      'be used for LLM authoring, the effective configuration, and optionally scan input paths to list which',
      'files are parseable.',
    ].join(' '),
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        input_paths: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional paths to scan for a support report.',
        },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['ok', 'report'],
        properties: {
          ok: { type: 'boolean' },
          report: { type: 'string' },
        },
      },
      render: (_args, value) => asTextBlock(value.report),
    },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const lines = ['# CourseNotes 环境自检 / Environment probe', ''];
      lines.push(`- 插件路径 / Plugin dir: \`${toPosix(HERE)}\``);
      lines.push(`- 解析后端 / Parser backend: \`${toPosix(BACKEND_SCRIPT)}\``);
      lines.push(`- 后端存在 / backend present: ${(await import('node:fs')).existsSync(BACKEND_SCRIPT) ? 'yes' : 'NO'}`);
      lines.push('');

      const python = resolvePython(config.pythonPath);
      lines.push('## Python 解析后端 / Python backend');
      lines.push('');
      if (python.ok) {
        lines.push(`- ✅ 可用 / available: \`${toPosix(python.command)}\` (Python ${python.version})`);
      } else {
        lines.push(`- ❌ 不可用 / unavailable: ${python.reason}`);
        lines.push('');
        lines.push('尝试过的解释器 / probed interpreters:');
        for (const attempt of python.attempts ?? []) {
          lines.push(`  - \`${toPosix(attempt.command)}\`: ${attempt.ok ? 'ok' : attempt.reason}`);
        }
        lines.push('');
        lines.push('修复方式 / How to fix: 安装 python 及 pymupdf/python-pptx/python-docx/Pillow，或在插件配置里设置 `pythonPath`。');
      }
      if (python.ok) {
        const capabilities = pythonCapabilities(python.command);
        lines.push(`- 版本确认 / version check: ${capabilities.ok ? capabilities.version : capabilities.error}`);
      }
      const discovery = pythonDiscoveryReport();
      lines.push('');
      lines.push('<details><summary>解释器探测详情 / interpreter discovery</summary>');
      lines.push('');
      lines.push(`- \`DSH_HOME\` env: ${discovery.dshHomeEnv ?? '（host 进程未设置 / not set in the host process）'}`);
      lines.push(`- home dir: \`${discovery.homeDir ?? '?'}\``);
      lines.push(`- 找到 DSH 自带解释器 / bundled interpreters found: ${discovery.bundledInterpreters.length}`);
      for (const bundled of discovery.bundledInterpreters) lines.push(`  - \`${toPosix(bundled)}\``);
      lines.push('- 搜索过的运行时根目录 / runtime roots searched:');
      for (const root of discovery.searchedRoots) {
        lines.push(`  - ${root.exists ? '✅' : '—'} \`${toPosix(root.root)}\``);
      }
      lines.push(`- PATH 候选 / PATH candidates: ${discovery.pathCandidates.map((entry) => `\`${entry}\``).join(', ') || '—'}`);
      lines.push('');
      lines.push('</details>');
      lines.push('');

      lines.push('## Harness 服务 / Harness services');
      lines.push('');
      const toolsService = ctx.get?.('tools');
      const web = ctx.get?.('web');
      const llm = ctx.get?.('llm');
      const fsSeam = ctx.get?.('fs');
      lines.push(`- tools: ${toolsService ? '✅' : '❌'}`);
      lines.push(`- web: ${web ? '✅ (search + fetch available)' : '❌ 外部检索将跳过'}`);
      lines.push(`- llm: ${llm ? '✅ (author_with_llm 可用)' : '❌ LLM 补全不可用'}`);
      lines.push(`- fs: ${fsSeam ? '✅ (写入遵循会话沙箱策略)' : '❌ 回退到 Node fs'}`);
      if (cfgDump(config).llmProvider) {
        lines.push(`- 配置的模型 / configured model: ${cfgDump(config).llmProvider}/${cfgDump(config).llmModel}`);
      }
      const selection = ctx.get?.('agentDefaultModel')?.currentSelection?.();
      lines.push(
        `- 会话默认模型 / session default model: ${selection ? `${selection.provider}/${selection.model}` : '未获取到 / unavailable'}`,
      );
      lines.push('');

      lines.push('## 生效配置 / Effective configuration');
      lines.push('');
      for (const [key, value] of Object.entries(cfgDump(config))) {
        lines.push(`- \`${key}\`: ${JSON.stringify(value)}`);
      }
      lines.push('');

      const targets = optionalStringArray(args?.input_paths, 'input_paths');
      let scanOk = true;
      if (targets && targets.length > 0) {
        const cwd = cwdFromExec(exec);
        const scan = scanInputs({
          inputPaths: targets,
          cwd,
          order: config.fileOrder,
          explicitOrder: config.explicitOrder,
          maxFileBytes: config.maxFileBytes,
        });
        lines.push('## 输入扫描 / Input scan');
        lines.push('');
        lines.push('```text');
        lines.push(describeScan(scan));
        lines.push('```');
        lines.push('');
        const parseable = scan.files.filter((record) => record.supported && record.readable);
        const screenshot = parseable.filter((record) => record.route === 'python');
        lines.push(
          `- 可解析 / parseable: ${parseable.length}（其中需 Python 后端 ${screenshot.length} 个）`,
        );
        lines.push(`- 不支持 / unsupported: ${scan.unsupported.length}；跳过 / skipped: ${scan.skipped.length}`);
        if (screenshot.length > 0 && !python.ok) {
          scanOk = false;
          lines.push('- ⚠ 存在需要 Python 后端的文件，但后端不可用：这些文件不会被解析。');
        }
        lines.push('');
      }

      lines.push('## 结论 / Verdict');
      lines.push('');
      const verdict = python.ok
        ? '环境就绪：可以直接调用 generate_course_notes。'
        : 'Python 后端不可用：PDF/PPTX/DOCX/图片 将无法解析，只能处理 Markdown/文本/HTML/CSV/Notebook。';
      lines.push(`- ${verdict}`);
      lines.push(`- 外部检索：${web ? '可用' : '不可用（笔记中会明确标注检索未执行）'}`);
      lines.push(`- LLM 补全：${llm && selection ? '可用' : '不可用（笔记保留 COURSENOTES:TODO 标记）'}`);
      lines.push('');
      return { ok: python.ok && scanOk, report: lines.join('\n') };
    },
  };
}

function cfgDump(config) {
  return {
    outputDir: config.outputDir,
    workDir: config.workDir,
    language: config.language,
    detailLevel: config.detailLevel,
    enableWebSearch: config.enableWebSearch,
    maxSearches: config.maxSearches,
    maxFetches: config.maxFetches,
    enableOcr: config.enableOcr,
    includeExamples: config.includeExamples,
    includeExercises: config.includeExercises,
    splitByChapter: config.splitByChapter,
    coverageCheck: config.coverageCheck,
    fileOrder: config.fileOrder,
    explicitOrder: config.explicitOrder,
    maxUnitChars: config.maxUnitChars,
    briefCharBudget: config.briefCharBudget,
    maxFileBytes: config.maxFileBytes,
    pythonPath: config.pythonPath,
    extraSearchKeywords: config.extraSearchKeywords,
    chapterHeadingLevel: config.chapterHeadingLevel,
    parserScript: config.parserScript,
    logLevel: config.logLevel,
    llmProvider: config.llmProvider ?? '',
    llmModel: config.llmModel ?? '',
  };
}

/* ------------------------------------------------------------------ tool: report */

function buildReportTool(ctx, config) {
  return {
    name: 'read_course_notes_report',
    description:
      'Read a CourseNotes run report (run-report.md, coverage-report.md, knowledge.json or note-brief.md) from a previous run directory.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['output_dir'],
      properties: {
        output_dir: { type: 'string', description: 'Directory produced by generate_course_notes.' },
        artifact: {
          type: 'string',
          enum: ['run-report.md', 'coverage-report.md', 'knowledge.json', 'note-brief.md'],
          description: 'Which artifact to read. Default: run-report.md.',
        },
        max_chars: { type: 'integer', description: 'Truncate the artifact to this many characters.' },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['ok', 'content'],
        properties: {
          ok: { type: 'boolean' },
          content: { type: 'string' },
          path: { type: 'string' },
        },
      },
      render: (_args, value) => asTextBlock(value.content),
    },
    isConcurrencySafe: () => true,
    async execute(args) {
      const outputDir = requireString(args, 'output_dir');
      const artifact = args?.artifact ? String(args.artifact) : 'run-report.md';
      const maxChars = Number.isFinite(args?.max_chars) ? Math.max(500, Number(args.max_chars)) : 40000;
      const relative = artifact === 'note-brief.md' ? path.join('.coursenotes', 'note-brief.md') : artifact;
      const target = path.join(outputDir, relative);
      const fs = await import('node:fs');
      if (!fs.existsSync(target)) {
        throw new Error(`artifact not found: ${target}（先运行 generate_course_notes，或检查 output_dir）`);
      }
      const raw = fs.readFileSync(target, 'utf8');
      const content =
        raw.length > maxChars
          ? `${raw.slice(0, maxChars)}\n…[truncated ${raw.length - maxChars} characters; read the file directly for the rest]`
          : raw;
      return { ok: true, content, path: toPosix(target) };
    },
  };
}

/* ------------------------------------------------------------------ plugin */

export function apply(ctx, rawConfig) {
  const config = resolveConfig(rawConfig);
  const logger = createLogger(config.logLevel, null, 'course-notes');
  logger.info('course-notes activated (backend=%s, language=%s)', BACKEND_SCRIPT, config.language);

  const definitions = [
    buildGenerateTool(ctx, config),
    buildCoverageTool(ctx, config),
    buildProbeTool(ctx, config),
    buildReportTool(ctx, config),
  ];

  for (const definition of definitions) {
    ctx.effect(() => {
      const dispose = ctx.tools.register(definition);
      return () => {
        if (typeof dispose === 'function') dispose();
      };
    }, `course-notes tool: ${definition.name}`);
  }

  logger.info('course-notes registered %d tools', definitions.length);
}

export default { name, inject, apply, defaultConfig: DEFAULTS };
export { runPipeline, renderRunReport, checkCoverage, loadNoteTexts, createNodeWorkspace, formatBytes };

/**
 * Programmatic access, deliberately *not* registered as a Cordis service.
 *
 * `ctx.set(name, value)` requires a matching `provide` declaration on the
 * plugin, and a service that no other plugin consumes is not worth widening
 * this plugin's contract for.  Tests, scripts and other code import the
 * pipeline functions directly instead:
 *
 *   import { runPipeline } from 'course-notes/lib/pipeline.js'
 */
export const courseNotes = {
  version: PIPELINE_VERSION,
  run: (request) =>
    runPipeline({ ...request, options: normalizeConfig(request.options ?? {}) }),
  renderRunReport,
  checkCoverage,
  loadNoteTexts,
};
