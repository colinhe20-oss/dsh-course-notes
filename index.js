/**
 * CourseNotes — a DeepSeek Harness plugin that turns course materials into
 * structured, source-traceable bilingual study notes.
 *
 * Registered tools
 *   * `generate_course_notes`   — run the whole pipeline (or a subset of stages)
 *   * `check_notes_coverage`    — coverage, multi-dimensional quality and Markdown structure
 *   * `probe_course_notes`      — environment/readiness diagnostics
 *   * `read_course_notes_report`— read a previous run's artifacts
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
 *   * **No tool here may fall back to `node:fs` when `ctx.fs` refuses a write.**
 *     A native fallback turns a sandbox denial into a successful write, which is
 *     exactly the bypass the Harness permission model exists to prevent.  See
 *     `lib/files.js` and {@link relocateWorkspace}.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { DEFAULTS, mergeOptions, normalizeConfig } from './lib/config.js';
import { createLogger, formatBytes, toPosix, truncate } from './lib/util.js';
import { runPipeline, renderRunReport, PIPELINE_VERSION } from './lib/pipeline.js';
import { createHarnessWorkspace, createNodeWorkspace, probeWritable, WRITE_PROBE_FILE } from './lib/files.js';
import {
  checkCoverage,
  checkNoteStructure,
  checkQuality,
  loadNoteTexts,
  renderCoverageMarkdown,
  renderQualityMarkdown,
  summariseCoverage,
  summariseQuality,
} from './lib/coverage.js';
import { resolvePython, BACKEND_SCRIPT, pythonCapabilities, pythonDiscoveryReport } from './lib/python-bridge.js';
import { scanInputs, describeScan } from './lib/scan.js';
import { validateCitations } from './lib/evidence.js';

export const name = 'course-notes';
export const inject = ['tools'];
export { DEFAULTS as defaultConfig };

/** Build revision marker: bumped to force a fresh module generation on reload. */
export const BUILD = '1.1.0+20261014a';

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
 * `ctx.fs` is used whenever the seam is present, so every write is subject to the
 * session's sandbox policy and appears in the workspace-change record.  The
 * `node:fs` workspace exists for the offline CLI and for tests only — it is never
 * selected as a *fallback* from a Harness run, because doing so would defeat the
 * policy the seam enforces.
 */
function workspaceFor(ctx, logger, options = {}) {
  const fsSeam = ctx.get?.('fs');
  if (fsSeam && typeof fsSeam.writeText === 'function' && typeof fsSeam.resolve === 'function') {
    return {
      workspace: createHarnessWorkspace(
        { fs: fsSeam },
        {
          cwd: options.cwd,
          maxBinaryBytes: options.maxBinaryBytes,
        },
      ),
      kind: 'harness',
    };
  }
  if (options.requireHarness) {
    return { workspace: null, kind: 'unavailable' };
  }
  logger?.debug('ctx.fs unavailable; using the node workspace (CLI/test mode)');
  return { workspace: createNodeWorkspace(), kind: 'node' };
}

/**
 * Find a permitted output directory for a run whose requested directory the
 * sandbox refused.
 *
 * v1.0 answered an `FS_SANDBOX_DENIED` by re-running the whole pipeline against a
 * `node:fs` workspace, which wrote the files the sandbox had just refused.  Here
 * the retry keeps the *same* `ctx.fs` seam and only changes the path, and it
 * proves the candidate is writable with the same primitive the real write uses
 * *before* committing to it.  If no candidate is permitted, nothing is written
 * and the caller reports the denial.
 *
 * The proof leaves a one-byte marker behind (there is no delete primitive in the
 * seam).  That is deliberate and is named so a reader of the output directory can
 * tell what it is; it is also what makes the relocation auditable afterwards.
 *
 * @returns {Promise<{dir: string|null, marker: string|null, tried: object[]}>}
 */
async function findPermittedOutputDir(workspace, cwd, requested) {
  const candidates = [
    path.join(cwd, 'course-notes-output'),
    path.join(cwd, '.coursenotes-output'),
  ].filter((dir) => path.resolve(dir) !== path.resolve(requested ?? ''));
  const tried = [];
  for (const dir of candidates) {
    const probe = await probeWritable(workspace, dir);
    tried.push({ dir, ok: probe.ok, code: probe.code, message: probe.message });
    if (probe.ok) return { dir, marker: path.join(dir, WRITE_PROBE_FILE), tried };
  }
  return { dir: null, marker: null, tried };
}

/**
 * Decide which provider/model authors the notes.
 *
 * Precedence: the session's selected model first (that is what the user is
 * already talking to), then an explicit `llmProvider` + `llmModel` pair from the
 * plugin config or the environment.  Both halves of the explicit pair are
 * required — a provider without a model is a configuration error, not a
 * half-usable selection — and the result is validated again by
 * `runAuthoringStage`, which reports why authoring was skipped.
 */
function resolveModel(ctx, config) {
  const selection = ctx.get?.('agentDefaultModel')?.currentSelection?.();
  if (selection?.provider && selection?.model) {
    return { provider: selection.provider, model: selection.model, source: 'session' };
  }
  const provider = config.llmProvider || process.env.COURSE_NOTES_LLM_PROVIDER || '';
  const model = config.llmModel || process.env.COURSE_NOTES_LLM_MODEL || '';
  if (provider && model) return { provider, model, source: 'config' };
  return null;
}

function cwdFromExec(exec) {
  return exec?.agent?.session?.header?.cwd ?? process.cwd();
}

/**
 * Is this error code a permission refusal?
 *
 * A refusal must be treated differently from every other failure: it is the one
 * case where retrying into a different directory can succeed.  The codes come
 * from two vocabularies — the Harness filesystem seam (`FS_SANDBOX_DENIED`) and
 * the host operating system (`EACCES` / `EPERM` / `EROFS`) — so both are matched.
 * They are never matched on message text.
 */
function isDenied(code) {
  return (
    code === 'FS_SANDBOX_DENIED' ||
    code === 'EACCES' ||
    code === 'EPERM' ||
    code === 'EROFS'
  );
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
      'Pipeline: scan -> parse -> knowledge points -> external retrieval with evidence mapping ->',
      'chunked LLM authoring (verified per chunk, repaired locally) -> coverage/quality check -> files.',
      'mode="auto" (default) authors every knowledge point with ctx.llm when a model is resolvable and falls',
      'back to a scaffold with an explicit reason when it is not; mode="scaffold" builds structure, evidence',
      'and a writing brief only. The result reports an explicit completion state (verified / notes_authored /',
      'scaffold_created / partial / parsed / failed) — written files alone are never reported as success.',
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
        mode: {
          type: 'string',
          enum: ['auto', 'scaffold'],
          description:
            'auto (default): build structure then author every knowledge point with ctx.llm. ' +
            'scaffold: structure + retrieval evidence + writing brief only, leaving COURSENOTES:TODO markers.',
        },
        enable_web_search: { type: 'boolean', description: 'Use the Harness web service for supplementary material.' },
        enable_ocr: {
          type: 'boolean',
          description: 'Treat image-only content as a vision task (the caller reads the extracted figures).',
        },
        include_examples: { type: 'boolean', description: 'Include worked examples in the generated material.' },
        include_exercises: { type: 'boolean', description: 'Include self-assessment questions.' },
        split_by_chapter: { type: 'boolean', description: 'One Markdown file per chapter plus a README index.' },
        coverage_check: { type: 'boolean', description: 'Run the coverage and quality check.' },
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
          description:
            'Run only these stages: scan, parse, knowledge, retrieve, generate, check, output. ' +
            'A stage that is not listed is genuinely not executed; stages whose inputs were not produced are not run either and are reported as skipped.',
        },
        max_searches: { type: 'integer', description: 'Maximum external search queries.' },
        max_fetches: { type: 'integer', description: 'Maximum pages fetched for detail.' },
        brief_char_budget: { type: 'integer', description: 'Budget of the returned note-writing brief, in characters.' },
        chunk_chars: {
          type: 'integer',
          description:
            'Character budget for one generation chunk. 0 (default) derives it from the model context window. ' +
            'A chapter is split into as many chunks as this budget needs, so no knowledge point is dropped.',
        },
        max_points_per_chunk: {
          type: 'integer',
          description: 'Maximum knowledge points per generation chunk. Default: 12.',
        },
        llm_max_attempts: {
          type: 'integer',
          description: 'Attempts per LLM call before a chunk is reported as failed. Default: 3.',
        },
        author_with_llm: {
          type: 'boolean',
          description:
            'Deprecated alias for mode: true = auto, false = scaffold. Kept for compatibility.',
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
          completion: {
            type: 'string',
            enum: ['parsed', 'scaffold_created', 'notes_authored', 'verified', 'partial', 'failed'],
          },
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
              writtenNoteFiles: { type: 'array', items: { type: 'string' } },
              knowledgeJson: { type: 'string' },
              coverageReport: { type: 'string' },
              runReport: { type: 'string' },
              parseReport: { type: 'string' },
              evidence: { type: 'string' },
              visionTasks: { type: 'string' },
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
      if (args?.output_dir !== undefined) options.outputDir = String(args.output_dir);
      if (args?.author_with_llm !== undefined) {
        options.mode = args.author_with_llm === true ? 'auto' : 'scaffold';
      }
      const stages = normalizeStages(args?.stages);
      const cwd = cwdFromExec(exec);
      const logger = loggerFor(ctx, options);
      const { workspace, kind } = workspaceFor(ctx, logger, {
        cwd,
        maxBinaryBytes: options.maxHarnessAssetBytes,
      });

      const selection = resolveModel(ctx, options);
      const authoring = options.mode === 'auto';
      const deps = {
        ...contextDeps(ctx, logger),
        model: authoring ? selection : null,
        signal: exec?.signal,
      };

      logger.info('generate_course_notes started', {
        inputs: inputPaths.length,
        stages: stages ?? 'all',
        mode: options.mode,
        workspace: kind,
      });

      const runOnce = (dir, runWorkspace) =>
        runPipeline({
          inputPaths,
          options: dir === options.outputDir ? options : { ...options, outputDir: dir },
          cwd,
          workspace: runWorkspace,
          deps,
          runId: undefined,
          logger,
          requestedStages: stages,
        });

      let report = await runOnce(options.outputDir, workspace);
      report.workspaceKind = kind;

      /*
       * A refused write is retried into a directory the sandbox permits — with the
       * same `ctx.fs` seam, never with `node:fs`.  The relocation is reported; when
       * no permitted directory exists, the run stops with the denial visible
       * instead of quietly writing somewhere the user did not ask for.
       *
       * The trigger is a *refused note write*, not `noteFiles.length === 0`: the
       * note list describes what the run intended to produce, so it is non-empty
       * even when every write was denied.  Guarding on it meant a fully denied run
       * reported success with a note list that did not exist on disk.
       */
      const denied = report.errors.filter((error) => isDenied(error.code));
      const refusedNotes = report.outputs?.refusedNoteFiles ?? [];
      const writtenNotes = report.outputs?.writtenNoteFiles ?? [];
      let relocated = null;
      if (denied.length > 0 && refusedNotes.length > 0 && writtenNotes.length === 0) {
        if (kind !== 'harness') {
          report.errors.push({
            stage: 'output',
            code: 'OUTPUT_DIR_UNAVAILABLE',
            message: `输出目录不可写（${denied[0].message}），且当前为 CLI/Node 模式，没有可用的沙箱内备选目录。`,
          });
        } else {
          const candidate = await findPermittedOutputDir(workspace, cwd, options.outputDir);
          if (!candidate.dir) {
            report.errors.push({
              stage: 'output',
              code: 'OUTPUT_DIR_UNAVAILABLE',
              message:
                `原输出目录被沙箱拒绝（${denied[0].message}），且没有找到可写入的备选目录。` +
                `已尝试：${candidate.tried.map((item) => `${item.dir}(${item.code ?? 'denied'})`).join(', ')}。` +
                '请在具备写权限的模式下重跑，或把输出目录改到会话工作区内。',
            });
          } else {
            logger.warn('output directory denied; retrying inside the workspace', { dir: candidate.dir });
            const retry = await runOnce(candidate.dir, workspace);
            retry.workspaceKind = kind;
            retry.relocatedFrom = options.outputDir !== '' ? options.outputDir : undefined;
            retry.relocationMarker = candidate.marker;
            retry.warnings.unshift({
              stage: 'output',
              code: 'output-relocated',
              message:
                `原输出目录被沙箱拒绝写入（${denied[0].message}），已改写到具备写权限的目录 ${toPosix(candidate.dir)}。` +
                '如需写入原目录，请在具备写权限的模式下重跑，或先扩展可写根。',
            });
            relocated = { from: options.outputDir, to: candidate.dir, tried: candidate.tried };
            report = retry;
          }
        }
      }

      const noteFiles = report.outputs?.noteFiles ?? [];
      const writtenNoteFiles = report.outputs?.writtenNoteFiles ?? [];
      const outputUnavailable = report.errors.some((error) => error.code === 'OUTPUT_DIR_UNAVAILABLE');
      const summary = [
        `CourseNotes ${report.runId}（${PIPELINE_VERSION}）：状态 ${report.completion}，`,
        `解析 ${report.stages?.parse?.summary?.parsedCount ?? 0}/${report.documents.length} 个文件，`,
        `章节 ${report.knowledge?.chapters?.length ?? 0}，知识点 ${report.knowledge?.counts?.keyPoints ?? 0}，`,
        outputUnavailable
          ? `笔记输出失败：${writtenNoteFiles.length}/${noteFiles.length} 个笔记文件写入成功。`
          : `输出 ${writtenNoteFiles.length} 个笔记文件到 ${toPosix(report.outputDir)}。`,
        report.coverage ? `${summariseCoverage(report.coverage)}。` : '',
        report.quality ? `${summariseQuality(report.quality)}。` : '',
        report.authoring?.attempted
          ? `分块撰写 ${report.authoring.chunks?.length ?? 0} 块 / 已撰写 ${report.authoring.authoredPointCount}/${report.authoring.totalPoints} 个知识点。`
          : report.authoring?.skippedReason ?? '',
        report.retrieval?.performed
          ? `外部检索 ${report.retrieval.resultCount} 条查询 / ${report.retrieval.sourceCount} 个来源；证据映射 ${report.evidence?.pointsWithEvidence ?? 0}/${report.evidence?.points ?? 0} 个知识点。`
          : report.retrieval?.summary ?? '',
        report.vision?.stats?.total > 0 ? report.vision.summary : '',
        report.errors.length > 0 ? `\n⚠ ${report.errors.length} 个错误，详见 run-report.md。` : '',
        relocated ? `\n⚠ 输出目录已被迁移到 ${toPosix(relocated.to)}，详见报告。` : '',
      ]
        .filter((part) => part !== '')
        .join('');

      /*
       * Optional fields are omitted, never `undefined`: the registry requires the
       * returned body to be lossless JSON and rejects `undefined` members.
       *
       * `noteFiles` lists the intended files; `writtenNoteFiles` lists the ones a
       * reader can actually open.  A caller that shows the first as "produced"
       * would claim notes that do not exist, so both are returned explicitly.
       */
      const artifacts = {
        outputDir: toPosix(report.outputDir),
        workDir: toPosix(report.workDir),
        noteFiles: noteFiles.map((file) => toPosix(file)),
        writtenNoteFiles: writtenNoteFiles.map((file) => toPosix(file)),
        knowledgeJson: 'knowledge.json',
        runReport: 'run-report.md',
        parseReport: 'run-report.md',
      };
      if (report.coverage) artifacts.coverageReport = 'coverage-report.md';
      if (report.evidence) artifacts.evidence = '.coursenotes/evidence.json';
      if (report.vision) artifacts.visionTasks = '.coursenotes/vision-results.json';

      return jsonSafe({
        // `ok` means "the caller has usable notes", so it is decided by writes that
        // succeeded — not by the absence of error objects.
        ok: writtenNoteFiles.length > 0 && !outputUnavailable,
        completion: report.completion,
        summary,
        brief: buildToolBrief(
          report,
          stageEnabled(stages, 'output') && stageEnabled(stages, 'generate'),
        ),
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
  lines.push(`- 状态 / Completion: **\`${report.completion}\`** — ${report.completionReason ?? ''}`);
  lines.push(
    `- 文件写入 / Writes: ${report.sandboxed ? 'Harness ctx.fs（沙箱策略生效）' : 'Node fs（CLI 模式）'}`,
  );
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
  if (report.authoring?.attempted) {
    lines.push(
      `- 分块撰写 / Authoring: ${report.authoring.plan?.tasks ?? 0} 个分块（每块 ${report.authoring.chunkChars} 字符），已撰写 ${report.authoring.authoredPointCount}/${report.authoring.totalPoints} 个知识点${
        report.authoring.repairedPoints?.length > 0 ? `，局部补全 ${report.authoring.repairedPoints.length} 个` : ''
      }`,
    );
    if (report.authoring.pointIdsNotAuthored?.length > 0) {
      lines.push(
        `  - ⚠ 未撰写 / not authored: ${report.authoring.pointIdsNotAuthored.slice(0, 20).join(', ')}${report.authoring.pointIdsNotAuthored.length > 20 ? ' …' : ''}`,
      );
    }
    if (report.authoring.chaptersNotPlanned?.length > 0) {
      lines.push(`  - ⚠ 未进入分块计划的章节 / chapters never planned: ${report.authoring.chaptersNotPlanned.join(', ')}`);
    }
  } else if (report.authoring?.skippedReason) {
    lines.push(`- 未执行模型撰写 / Authoring skipped: ${report.authoring.skippedReason}`);
  }
  if (report.coverage) lines.push(`- ${summariseCoverage(report.coverage)}`);
  if (report.quality) lines.push(`- ${summariseQuality(report.quality)}`);
  lines.push(`- 检索 / Retrieval: ${report.retrieval?.summary ?? '—'}`);
  if (report.evidence) {
    lines.push(
      `- 证据映射 / Evidence: ${report.evidence.pointsWithEvidence}/${report.evidence.points} 个知识点有外部证据，${report.evidence.evidenceItems} 条摘录，可引用 URL ${report.evidence.allowlistedUrls} 个`,
    );
  }
  if (report.vision?.stats?.total > 0) lines.push(`- ${report.vision.summary}`);
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
  if (includeBrief && report.completion !== 'verified') {
    lines.push('');
    lines.push('## 未完成时的下一步 / When the run is not `verified`');
    lines.push(
      '- 笔记中仍带 `COURSENOTES:TODO` 标记的位置需要补全；补全后重新运行 `check_notes_coverage` 复核。',
    );
    lines.push(
      '- 图表（`图表解读 / Figures to Interpret` 小节）需要具备视觉能力的 Agent 读取图片后，把结果写入 `.coursenotes/vision-results.json`（格式见该文件内的 `pending` 字段），再重跑。',
    );
    lines.push(
      '- 需要更细的原文时读取 `knowledge.json`；需要检索证据原文时读取 `.coursenotes/evidence.json`。',
    );
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
      'problems (unbalanced fences, broken relative links, unclosed formulas). It also reports multi-dimensional',
      'quality: structure, authored content, bilingual completeness, formula rendering/explanation, and citation',
      'validity against the run\'s evidence index. Every number is textual; none of them measures whether an',
      'explanation is correct.',
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
      const config2 = normalizeConfig({ ...config, ...(args?.language ? { language: args.language } : {}) });
      /*
       * Rebuild the point list from `chapters`, which carries the per-chapter
       * point lists.  A flat `keyPoints` array loses the chapter association, and
       * the note files are matched by chapter-qualified key.
       */
      const chapterList = Array.isArray(knowledge.chapters) ? knowledge.chapters : [];
      const fromChapters = chapterList.flatMap((chapter) =>
        (chapter.points ?? []).map((point) => ({
          ...point,
          chapterIndex: chapter.index,
          chapterTitle: chapter.title,
          chapterKey: `Chapter_${String(chapter.index).padStart(2, '0')}`,
          terms: point.terms ?? [],
          sourceText: point.sourceText ?? '',
        })),
      );
      const fromFlat = (knowledge.keyPoints ?? []).map((point) => ({
        ...point,
        chapterIndex: point.chapterIndex ?? 0,
        chapterTitle: point.chapterTitle ?? '',
        terms: point.terms ?? [],
        sourceText: point.sourceText ?? '',
      }));
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

      /*
       * The evidence index is optional here: `check_notes_coverage` is also used
       * on hand-written notes and on runs from older versions.  When it is
       * present, citation validity becomes a real check; when it is not, the
       * report says the check could not run rather than reporting zero problems.
       */
      const evidence = readEvidenceIndex(notesDir, fs);
      const citations = validateCitations(notes, evidence);
      const quality = checkQuality(normalised, notes, {
        language: config2.language,
        evidenceIndex: evidence,
        citations,
      });
      const markdown = `${renderCoverageMarkdown(coverage, structureIssues)}\n${renderQualityMarkdown(quality)}`;
      let reportPath;
      if (args?.write_report !== false) {
        const logger = loggerFor(ctx, config2);
        const { workspace } = workspaceFor(ctx, logger, { cwd: path.dirname(knowledgePath) });
        const target = path.join(notesDir, 'coverage-report.md');
        const outcome = await workspace.writeText(target, markdown);
        if (outcome.ok) reportPath = target;
        else {
          logger.warn('coverage report not written', { code: outcome.code, message: outcome.message });
          structureIssues.push({
            severity: 'warn',
            code: outcome.code ?? 'write-failed',
            message: `coverage-report.md 未写入：${outcome.message}`,
          });
        }
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
        summary: `${summariseCoverage(coverage)}；${summariseQuality(quality)}；结构问题 ${structureIssues.length} 项；术语 ${coverage.glossary.present}/${coverage.glossary.total} 出现在笔记中。`,
        report: markdown,
      });
      if (reportPath) result.reportPath = toPosix(reportPath);
      return result;
    },
  };
}

/** Read the run's evidence index when it exists next to the notes. */
function readEvidenceIndex(dir, fs) {
  for (const candidate of [
    path.join(dir, '.coursenotes', 'evidence.json'),
    path.join(dir, 'evidence.json'),
  ]) {
    try {
      if (!fs.existsSync(candidate)) continue;
      const parsed = JSON.parse(fs.readFileSync(candidate, 'utf8'));
      if (Array.isArray(parsed?.sources)) return { sources: parsed.sources };
    } catch {
      /* a corrupt sidecar must not break the check: fall through to "no index" */
    }
  }
  return null;
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
    mode: config.mode,
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
    chunkChars: config.chunkChars,
    maxPointsPerChunk: config.maxPointsPerChunk,
    chunkStrategy: config.chunkStrategy,
    llmMaxAttempts: config.llmMaxAttempts,
    llmRetryBackoffMs: config.llmRetryBackoffMs,
    llmProvider: config.llmProvider ?? '',
    llmModel: config.llmModel ?? '',
    maxHarnessAssetBytes: config.maxHarnessAssetBytes,
    evidencePerPoint: config.evidencePerPoint,
    evidenceCharBudget: config.evidenceCharBudget,
    evidenceExcerptChars: config.evidenceExcerptChars,
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
export { runPipeline, renderRunReport, checkCoverage, checkQuality, loadNoteTexts, createNodeWorkspace, createHarnessWorkspace, formatBytes };

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
