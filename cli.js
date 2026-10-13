#!/usr/bin/env node
/**
 * CourseNotes offline CLI.
 *
 * Runs the exact same pipeline the plugin tool runs, but without the Harness
 * host, so it can be used from a shell, from CI, or by the test suite:
 *
 *   node cli.js "C:\课件\第3章.pptx" "C:\课件\讲义" --out "C:\notes"
 *   node cli.js --probe
 *   node cli.js "C:\课件" --out out --json run.json --no-web
 *
 * The offline runner has no `ctx.web` and no `ctx.llm`, so external retrieval and
 * model authoring both report themselves as not performed rather than pretending.
 * A retrieval provider can be supplied through `--web-endpoint` (an HTTP JSON
 * endpoint) — see README "Offline mode".  Model authoring is Harness-only by
 * design: the CLI's job is the deterministic half of the pipeline plus a
 * `scaffold_created` run that an agent or a human finishes from the writing
 * brief.
 */

import fs from 'node:fs';
import path from 'node:path';

import { normalizeConfig } from './lib/config.js';
import { runPipeline, COMPLETION_STATES } from './lib/pipeline.js';
import { createNodeWorkspace } from './lib/files.js';
import { createLogger, toPosix } from './lib/util.js';
import { resolvePython, pythonCapabilities, BACKEND_SCRIPT } from './lib/python-bridge.js';
import { scanInputs, describeScan } from './lib/scan.js';

const USAGE = `CourseNotes CLI

用法 / Usage:
  node cli.js <path...> [options]
  node cli.js --probe [--input <path>...]

选项 / Options:
  --out <dir>            输出目录（默认 <cwd>/course-notes-output）
  --work <dir>           过程目录（默认 <out>/.coursenotes）
  --language <v>         bilingual | zh | en（默认 bilingual）
  --detail <v>           concise | standard | comprehensive（默认 comprehensive）
  --mode <v>             auto | scaffold（离线 CLI 只支持 scaffold：没有 ctx.llm）
  --no-web               关闭外部检索
  --web-endpoint <url>   离线检索端点：POST {query} -> {sources:[{url,title,snippet}]}
  --ocr / --no-ocr       图片按视觉任务处理（默认 --ocr）
  --no-exercises         不生成自测题
  --no-examples          不生成示例小节
  --single-file          合并为单个 Markdown 而不是每章一个文件
  --no-coverage          跳过覆盖率与质量检查
  --order <v>            natural | name | explicit | mtime
  --stages <list>        只运行这些阶段（逗号分隔）：scan,parse,knowledge,retrieve,generate,check,output
  --python <path>        Python 解释器路径
  --max-searches <n>     最大检索查询数
  --max-fetches <n>      最大抓取页数
  --chunk-chars <n>      单块提示词预算（0 = 由模型上下文推导；CLI 无模型时无效果）
  --evidence-per-point <n>  每个知识点最多附加多少条外部证据
  --json <file>          额外写出机器可读的运行报告
  --probe                只做环境自检，不生成笔记
  --help                 显示本帮助
`;

function parseArgs(argv) {
  const options = {
    inputs: [],
    flags: {},
  };
  const takesValue = new Set([
    '--out', '--work', '--language', '--detail', '--web-endpoint', '--order',
    '--python', '--max-searches', '--max-fetches', '--json', '--input',
    '--brief-budget', '--chapter-level', '--mode', '--stages', '--chunk-chars',
    '--evidence-per-point',
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      options.flags.help = true;
      continue;
    }
    if (arg === '--probe') {
      options.flags.probe = true;
      continue;
    }
    if (arg === '--no-web') {
      options.flags.web = false;
      continue;
    }
    if (arg === '--no-ocr') {
      options.flags.ocr = false;
      continue;
    }
    if (arg === '--no-exercises') {
      options.flags.exercises = false;
      continue;
    }
    if (arg === '--no-examples') {
      options.flags.examples = false;
      continue;
    }
    if (arg === '--single-file') {
      options.flags.splitByChapter = false;
      continue;
    }
    if (arg === '--no-coverage') {
      options.flags.coverage = false;
      continue;
    }
    if (takesValue.has(arg)) {
      const value = argv[index + 1];
      if (value === undefined) throw new Error(`${arg} requires a value`);
      const key = arg.slice(2);
      if (key === 'input') options.inputs.push(value);
      else options.flags[key] = value;
      index += 1;
      continue;
    }
    if (arg.startsWith('--')) throw new Error(`unknown option: ${arg}`);
    options.inputs.push(arg);
  }
  return options;
}

function configFromFlags(flags) {
  const raw = {};
  if (flags.out) raw.outputDir = flags.out;
  if (flags.work) raw.workDir = flags.work;
  if (flags.language) raw.language = flags.language;
  if (flags.detail) raw.detailLevel = flags.detail;
  if (flags.mode) raw.mode = flags.mode;
  if (flags.web === false) raw.enableWebSearch = false;
  if (flags.ocr === false) raw.enableOcr = false;
  if (flags.exercises === false) raw.includeExercises = false;
  if (flags.examples === false) raw.includeExamples = false;
  if (flags.splitByChapter === false) raw.splitByChapter = false;
  if (flags.coverage === false) raw.coverageCheck = false;
  if (flags.order) raw.fileOrder = flags.order;
  if (flags.python) raw.pythonPath = flags.python;
  if (flags['max-searches']) raw.maxSearches = Number(flags['max-searches']);
  if (flags['max-fetches']) raw.maxFetches = Number(flags['max-fetches']);
  if (flags['brief-budget']) raw.briefCharBudget = Number(flags['brief-budget']);
  if (flags['chapter-level']) raw.chapterHeadingLevel = Number(flags['chapter-level']);
  if (flags['chunk-chars']) raw.chunkChars = Number(flags['chunk-chars']);
  if (flags['evidence-per-point']) raw.evidencePerPoint = Number(flags['evidence-per-point']);
  return normalizeConfig(raw);
}

/** Parse `--stages a,b` into the canonical stage list the pipeline expects. */
const STAGE_ALIASES = {
  scan: 'scan', parse: 'parse', knowledge: 'knowledge', retrieve: 'retrieve',
  retrieval: 'retrieve', web: 'retrieve', search: 'retrieve',
  generate: 'generate', notes: 'generate', check: 'check', coverage: 'check',
  output: 'output', write: 'output',
};
const STAGE_ORDER = ['scan', 'parse', 'knowledge', 'retrieve', 'generate', 'check', 'output'];

function stagesFromFlags(value) {
  if (value === undefined) return null;
  const requested = String(value)
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter((item) => item !== '');
  const resolved = [];
  for (const item of requested) {
    const stage = STAGE_ALIASES[item];
    if (!stage) {
      throw new Error(`unknown stage "${item}"; supported: ${Object.keys(STAGE_ALIASES).join(', ')}`);
    }
    if (!resolved.includes(stage)) resolved.push(stage);
  }
  if (resolved.length === 0) return null;
  return STAGE_ORDER.filter((stage) => resolved.includes(stage));
}

/** Minimal HTTP search adapter for offline/CI runs. */
function httpWebAdapter(endpoint) {
  const search = async (request, signal) => {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ op: 'search', query: request.query, maxResults: request.maxResults ?? 5 }),
      signal,
    });
    if (!response.ok) {
      const error = new Error(`web endpoint returned HTTP ${response.status}`);
      error.code = 'WEB_PROVIDER_ERROR';
      throw error;
    }
    const payload = await response.json();
    return {
      content: payload.content ?? '',
      sources: (payload.sources ?? []).map((source) => ({
        url: source.url,
        title: source.title ?? '',
        snippet: source.snippet ?? '',
        publishedAt: source.publishedAt ?? '',
      })),
      truncated: Boolean(payload.truncated),
    };
  };
  const fetchImpl = async (request, signal) => {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ op: 'fetch', url: request.url }),
      signal,
    });
    if (!response.ok) {
      const error = new Error(`web endpoint returned HTTP ${response.status}`);
      error.code = 'WEB_PROVIDER_ERROR';
      throw error;
    }
    const payload = await response.json();
    return {
      url: request.url,
      statusCode: payload.statusCode ?? 200,
      body: payload.body ?? { kind: 'text', content: '' },
      truncated: Boolean(payload.truncated),
    };
  };
  return { search, fetch: fetchImpl };
}

async function probe(config, inputs, cwd) {
  const lines = ['# CourseNotes 环境自检 / Environment probe', ''];
  lines.push(`- 插件路径 / Plugin dir: \`${toPosix(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')))}\``);
  lines.push(`- 解析后端 / Parser backend: \`${toPosix(BACKEND_SCRIPT)}\``);
  lines.push(`- 后端存在 / present: ${fs.existsSync(BACKEND_SCRIPT) ? 'yes' : 'NO'}`);
  lines.push('');
  const python = resolvePython(config.pythonPath);
  lines.push('## Python 后端 / Python backend');
  lines.push('');
  if (python.ok) {
    const capabilities = pythonCapabilities(python.command);
    lines.push(`- ✅ \`${toPosix(python.command)}\` (Python ${python.version})`);
    lines.push(`- 版本确认 / version check: ${capabilities.ok ? capabilities.version : capabilities.error}`);
  } else {
    lines.push(`- ❌ ${python.reason}`);
    for (const attempt of python.attempts ?? []) {
      lines.push(`  - \`${toPosix(attempt.command)}\`: ${attempt.ok ? 'ok' : attempt.reason}`);
    }
  }
  lines.push('');
  if (inputs.length > 0) {
    const scan = scanInputs({ inputPaths: inputs, cwd, order: config.fileOrder, maxFileBytes: config.maxFileBytes });
    lines.push('## 输入扫描 / Input scan');
    lines.push('');
    lines.push('```text');
    lines.push(describeScan(scan));
    lines.push('```');
  }
  return { ok: python.ok, text: lines.join('\n') };
}

async function main() {
  const argv = process.argv.slice(2);
  let parsed;
  try {
    parsed = parseArgs(argv);
  } catch (error) {
    process.stderr.write(`${error.message}\n\n${USAGE}`);
    process.exit(2);
  }
  if (parsed.flags.help || (parsed.inputs.length === 0 && !parsed.flags.probe)) {
    process.stdout.write(USAGE);
    process.exit(parsed.flags.help ? 0 : 2);
  }

  const cwd = process.cwd();
  let config = configFromFlags(parsed.flags);
  let requestedStages;
  try {
    requestedStages = stagesFromFlags(parsed.flags.stages);
  } catch (error) {
    process.stderr.write(`${error.message}\n\n${USAGE}`);
    process.exit(2);
  }
  /*
   * There is no `ctx.llm` in an offline run, so `auto` would only ever degrade to
   * `scaffold` — with a reported reason, but after the user asked for something
   * the CLI cannot do.  Saying so up front is better than a run that quietly
   * produces a scaffold.
   */
  if (config.mode === 'auto') {
    process.stderr.write(
      '提示 / note: 离线 CLI 没有 ctx.llm，--mode auto 会降级为 scaffold（运行报告会写明原因）。\n' +
        'To author with a model, run CourseNotes inside DeepSeek Harness, or use the writing brief produced here.\n',
    );
    config = { ...config, mode: 'scaffold' };
  }
  const wantsVerbose = process.env.COURSE_NOTES_VERBOSE === '1';
  const logger = createLogger(
    wantsVerbose ? 'debug' : config.logLevel,
    wantsVerbose || process.env.COURSE_NOTES_LOGS === '1'
      ? (line) => process.stderr.write(`${line}\n`)
      : null,
  );

  if (parsed.flags.probe) {
    const result = await probe(config, parsed.inputs, cwd);
    process.stdout.write(`${result.text}\n`);
    process.exit(result.ok ? 0 : 1);
  }

  const web = parsed.flags['web-endpoint'] ? httpWebAdapter(parsed.flags['web-endpoint']) : undefined;
  const report = await runPipeline({
    inputPaths: parsed.inputs,
    options: config,
    cwd,
    workspace: createNodeWorkspace(),
    deps: { web },
    logger,
    requestedStages,
  });

  const quality = report.quality;
  const stdout = [
    `CourseNotes ${report.runId} — ${report.courseName}`,
    `状态 / Completion: ${report.completion} — ${COMPLETION_STATES[report.completion] ?? ''}`,
    report.completionReason ? `依据 / Reason: ${report.completionReason}` : '',
    `输出 / Output: ${toPosix(report.outputDir)}`,
    `解析 / Parsed: ${report.stages?.parse?.summary?.parsedCount ?? 0}/${report.documents.length}`,
    `章节 / Chapters: ${report.knowledge?.counts?.chapters ?? 0}　知识点 / Key points: ${report.knowledge?.counts?.keyPoints ?? 0}`,
    report.coverage
      ? `覆盖率 / Coverage: ${(report.coverage.ratio * 100).toFixed(1)}%（covered ${report.coverage.covered}, partial ${report.coverage.partial}, missing ${report.coverage.missing}）`
      : '覆盖率 / Coverage: （未执行）',
    quality
      ? `质量 / Quality: 全维度通过 ${quality.points.complete}/${quality.points.total}；双语 ${quality.points.bilingualOk}/${quality.points.total}；公式解释 ${quality.formulas.explained}/${quality.formulas.total}；引用异常 ${quality.citations.checkable ? quality.citations.unknown.length : 'n/a'}`
      : '',
    report.evidence
      ? `证据映射 / Evidence: ${report.evidence.pointsWithEvidence}/${report.evidence.points} 个知识点有外部证据（可引用 URL ${report.evidence.allowlistedUrls} 个）`
      : '',
    report.vision?.stats?.total > 0 ? `视觉任务 / Vision: ${report.vision.stats.total} 个（待解读 ${report.vision.stats.total - (report.vision.applied?.count ?? 0)}）` : '',
    report.retrieval?.summary ?? '',
    report.errors.length > 0 ? `错误 / Errors: ${report.errors.length}（详见 run-report.md）` : '',
    `笔记文件 / Note files:`,
    ...(report.outputs?.noteFiles ?? []).map((file) => `  - ${toPosix(file)}`),
  ]
    .filter((line) => line !== '')
    .join('\n');
  process.stdout.write(`${stdout}\n`);

  if (parsed.flags.json) {
    fs.writeFileSync(parsed.flags.json, JSON.stringify({ ...report, brief: report.brief }, null, 1), 'utf8');
    process.stdout.write(`运行报告 / run report: ${toPosix(parsed.flags.json)}\n`);
  }
  // Exit status reflects *usable notes*, not merely "no exception": a run whose
  // output could not be written is a failure even though the pipeline completed.
  process.exit(report.completion === 'failed' || report.errors.length > 0 ? 1 : 0);
}

main().catch((error) => {
  process.stderr.write(`CourseNotes CLI failed: ${error?.stack ?? error}\n`);
  process.exit(1);
});
