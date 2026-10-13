/**
 * Stage E and G (part) — Markdown note production.
 *
 * Two things are produced, and the difference matters:
 *
 *   * **`brief`** — a machine-readable, bounded digest of the extracted
 *     knowledge (outline, knowledge points with locators and source text,
 *     glossary, formulas, figures, retrieval evidence).  This is what an agent
 *     reads to write a real bilingual note without re-reading the slides.
 *     Written to `.coursenotes/<run>/note-brief.md` *and* returned to the model.
 *
 *   * **`notes`** — Markdown note files on disk.  Their structure is always
 *     complete and faithful to the material (every chapter, every knowledge
 *     point, every formula and figure, every glossary row, with the required
 *     bilingual explanation scaffold).  Prose that only a model can author is
 *     marked with an explicit `<!-- COURSENOTES:TODO -->` placeholder instead
 *     of being faked.
 *
 * If an LLM is available (`ctx.llm`), `authorChaptersWithLlm` in pipeline.js
 * replaces those placeholders with real bilingual explanations, one chapter at
 * a time, so a long course never depends on a single oversized completion.
 *
 * Convention for every renderer in this file: `context` is the render context
 * (`{ courseName, options, knowledge, retrieval, retrievalFor, ... }`).
 * `options` never carries functions.
 */

import { formatBytes, slugifyKeepCjk, toPosix, truncate, neutralizeUntrustedText, uniqueBy } from './util.js';
import { summariseRetrieval } from './retrieve.js';
import { genreLabel } from './document.js';

export const TODO_MARKER = '<!-- COURSENOTES:TODO -->';

/**
 * Machine-readable boundary around one knowledge point's section.
 *
 * Coverage needs to know which part of a note belongs to which knowledge point,
 * and whether that part has been authored yet.  A heading-title guess is too
 * fragile (titles get trimmed, duplicated, or reworded), so every point writes
 * an explicit id marker instead.
 */
export function pointMarkerStart(id) {
  return `<!-- COURSENOTES:POINT ${id} START -->`;
}

export function pointMarkerEnd(id) {
  return `<!-- COURSENOTES:POINT ${id} END -->`;
}

const KIND_LABEL = {
  definition: '定义',
  theorem: '定理/性质',
  formula: '公式',
  algorithm: '算法',
  architecture: '模型/架构',
  comparison: '对比',
  example: '示例',
  application: '应用',
  experiment: '实验',
  derivation: '推导',
  table: '表格',
  concept: '概念',
};

const LANGUAGE_HEADINGS = {
  bilingual: { zh: '中文讲解 / Chinese Explanation', en: '英文讲解 / English Explanation' },
  zh: { zh: '中文讲解', en: '' },
  en: { zh: '', en: 'English Explanation' },
};

const RETRIEVAL_LABEL = {
  formula: '公式推导',
  terminology: '术语权威定义',
  concept: '背景补充',
  example: '例题与应用',
  verification: '事实核查',
};

/* --------------------------------------------------------------- primitives */

function heading(level, text) {
  return `${'#'.repeat(Math.max(1, Math.min(6, level)))} ${text}`;
}

function esc(text) {
  return String(text ?? '').replace(/\r/g, '').trim();
}

export function tableToMarkdown(rows, limit = 40) {
  if (!Array.isArray(rows) || rows.length === 0) return '';
  const width = Math.max(...rows.map((row) => row.length));
  const pad = (row) => {
    const copy = [...row];
    while (copy.length < width) copy.push('');
    return copy.map((cell) => String(cell ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' '));
  };
  const head = pad(rows[0]);
  const lines = [`| ${head.join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`];
  for (const row of rows.slice(1, limit + 1)) {
    lines.push(`| ${pad(row).join(' | ')} |`);
  }
  if (rows.length - 1 > limit) {
    lines.push('');
    lines.push(`*表格共 ${rows.length} 行，此处列出前 ${limit} 行 / table truncated to ${limit} rows.*`);
  }
  return lines.join('\n');
}

function glossaryTable(entries) {
  const lines = [
    '| 中文术语 | English Full Name | Abbreviation | 简要解释 |',
    '| --- | --- | --- | --- |',
  ];
  for (const entry of entries) {
    lines.push(
      `| ${esc(entry.zh) || '—'} | ${esc(entry.en) || '—'} | ${esc(entry.abbr) || '—'} | ${esc(entry.note) || ''} |`,
    );
  }
  return lines.join('\n');
}

function sourceLine(point) {
  const parts = [point.documentName, point.locator];
  if (point.section) parts.push(point.section);
  return parts.filter((part) => part !== undefined && part !== '').join(' · ');
}

/* --------------------------------------------------------------- note files */

function renderKeyPoint(point, index, context) {
  const options = context.options;
  const language = LANGUAGE_HEADINGS[options.language] ?? LANGUAGE_HEADINGS.bilingual;
  const pointId = point.id ?? `K${String(index).padStart(3, '0')}`;
  const out = [pointMarkerStart(pointId), heading(3, `${index}. ${esc(point.title)}`)];
  out.push(`**类型 / Kind**: ${KIND_LABEL[point.kind] ?? point.kind}　**来源 / Source**: ${sourceLine(point)}`);
  out.push('');

  out.push('**术语定义 / Definition**');
  out.push('');
  if (point.terms.length > 0) {
    out.push(
      point.terms
        .map(
          (term) =>
            `- ${esc(term.zh) || '—'}（${esc(term.en) || '待补充 English full name'}${term.abbr ? `, ${term.abbr}` : ''}）`,
        )
        .join('\n'),
    );
  } else {
    out.push(`- ${TODO_MARKER} 从材料中未能自动识别术语对，请依据来源文本补充术语、英文全称与缩写。`);
  }
  out.push('');

  if (language.zh !== '') {
    out.push(heading(4, language.zh));
    out.push('');
    out.push('**材料原文依据 / Material evidence**');
    out.push('');
    out.push('```text');
    out.push(neutralizeUntrustedText(truncate(point.sourceText, options.maxUnitChars)));
    out.push('```');
    out.push('');
    out.push(
      `${TODO_MARKER} 在此写出中文详细讲解：概念是什么 → 为什么需要 → 如何工作 → 数学/技术原理 → 示例 → 应用 → 常见误区。不得压缩为要点罗列。`,
    );
    out.push('');
  }
  if (language.en !== '') {
    out.push(heading(4, language.en));
    out.push('');
    out.push(
      `${TODO_MARKER} Write the full English explanation here with the same technical content, definitions and conclusions as the Chinese section. It must not be a translation of the headings only.`,
    );
    out.push('');
  }

  if (point.kind === 'formula' || point.mathLike) {
    out.push(heading(4, '数学原理 / Mathematical Principles'));
    out.push('');
    out.push('$$');
    out.push('\\text{（替换为材料中的公式 / replace with the formula from the material）}');
    out.push('$$');
    out.push('');
    out.push(
      `${TODO_MARKER} 逐项说明：① 每个变量与符号的含义、量纲与取值范围；② 公式成立的条件与前提；③ 必要的推导步骤；④ 直观意义；⑤ 一个完整的数值计算示例。`,
    );
    out.push('');
  }

  if (
    options.includeExamples &&
    (point.kind === 'example' || point.kind === 'application' || point.kind === 'experiment')
  ) {
    out.push(heading(4, '实例 / Examples'));
    out.push('');
    out.push(
      `${TODO_MARKER} 依据材料中的例子给出完整过程与结果；若材料只有结论，请给出可复算的细节或明确标注材料未给出。`,
    );
    out.push('');
  }

  if (options.includeExercises) {
    out.push(heading(4, '易错点 / Common Misconceptions'));
    out.push('');
    out.push(`${TODO_MARKER} 列出 1–3 条本知识点的常见误解与区分要点。`);
    out.push('');
  }

  out.push('**来源 / References**');
  out.push('');
  out.push(`- [课件内容] ${sourceLine(point)}`);
  out.push('');
  out.push(pointMarkerEnd(pointId));
  out.push('');
  return out.join('\n');
}

function renderChapter(chapter, context) {
  const options = context.options;
  const out = [];
  out.push(heading(2, `第 ${chapter.index} 章 / Chapter ${chapter.index}　${esc(chapter.title)}`));
  out.push('');

  out.push(heading(3, '章节概述 / Chapter Overview'));
  out.push('');
  const documents = uniqueBy(
    chapter.units.map((unit) => unit.sourceName).filter((value) => value !== undefined),
    (value) => value,
  );
  out.push(`- 原始课件 / Source files: ${documents.join('、') || '—'}`);
  out.push(`- 知识点数量 / Knowledge points: ${chapter.points.length}`);
  out.push(`- 公式候选 / Formula candidates: ${chapter.formulas.length}`);
  out.push(`- 图表待解读 / Figures needing vision: ${chapter.figures.length}`);
  out.push('');
  out.push(`${TODO_MARKER} 用 3–6 句写出本章概述：本章解决什么问题、与前后章的关系、学完后应具备的能力。`);
  out.push('');

  out.push(heading(3, '本章学习目标 / Learning Objectives'));
  out.push('');
  out.push(`${TODO_MARKER} 依据本章知识点写出 3–6 条可检验的学习目标（能推导/能实现/能对比/能判断）。`);
  out.push('');

  out.push(heading(3, '知识结构 / Knowledge Outline'));
  out.push('');
  if (chapter.outline.length > 0) {
    for (const node of chapter.outline) {
      out.push(`${'  '.repeat(Math.max(0, (node.level ?? 1) - 1))}- ${esc(node.title)}`);
    }
  } else {
    out.push('- （材料未提供标题层级 / no heading hierarchy in the material）');
  }
  out.push('');

  out.push(heading(3, '详细知识点 / Detailed Knowledge Points'));
  out.push('');
  if (chapter.points.length === 0) {
    out.push('（本章未提取到知识点，请检查原始文件是否被正确解析。）');
    out.push('');
  }
  chapter.points.forEach((point, index) => {
    out.push(renderKeyPoint(point, index + 1, context));
  });

  if (chapter.formulas.length > 0) {
    out.push(heading(3, '公式清单 / Formula Checklist'));
    out.push('');
    for (const formula of chapter.formulas) {
      out.push(
        `- \`${esc(formula.text).slice(0, 200)}\` — ${formula.sourceName} · ${formula.locator}（识别依据：${formula.reason}）`,
      );
    }
    out.push('');
    out.push(`${TODO_MARKER} 为以上每个公式补全 LaTeX 表示、变量定义、成立条件、推导与数值示例。`);
    out.push('');
  }

  if (chapter.figures.length > 0) {
    out.push(heading(3, '图表解读 / Figures to Interpret'));
    out.push('');
    for (const figure of chapter.figures) {
      const source = `${figure.sourceName} · ${figure.locator}`;
      if (figure.image) {
        // A real Markdown image embed, so the figure renders in Obsidian /
        // VS Code and the relative link is checkable.
        const caption = figure.caption || `figure from ${figure.sourceName} ${figure.locator}`;
        out.push(`![${caption}](${toPosix(figure.image)})`);
        out.push('');
      } else {
        out.push(`**（图片未导出 / not exported）**`);
        out.push('');
      }
      out.push(`> 来源 / Source: ${source}　优先级 / priority: ${figure.priority}`);
      out.push(`> 任务 / Task: ${figure.reason}`);
      out.push('');
      out.push(
        `${TODO_MARKER} 解读上图：说明它编码的知识（时序、数据流、坐标与单位、曲线含义、公式变量、算法步骤），而不是只抄写图中文字。无法可靠识别的内容必须标注，不得编造。`,
      );
      out.push('');
    }
  }

  out.push(heading(3, '本章总结 / Chapter Summary'));
  out.push('');
  out.push(`${TODO_MARKER} 用要点+一句话结论总结本章，并指出与后续章节的衔接。`);
  out.push('');

  out.push(heading(3, '术语表 / Glossary'));
  out.push('');
  const chapterGlossary = [];
  const seen = new Set();
  for (const point of chapter.points) {
    for (const term of point.terms) {
      const key = `${term.zh}::${term.en}`;
      if (seen.has(key)) continue;
      seen.add(key);
      chapterGlossary.push({ zh: term.zh, en: term.en, abbr: term.abbr, note: '' });
    }
  }
  out.push(
    chapterGlossary.length > 0
      ? glossaryTable(chapterGlossary)
      : '（本章未自动识别到术语对，请依据来源文本补充。）',
  );
  out.push('');

  out.push(heading(3, '重点与难点 / Key Points and Difficulties'));
  out.push('');
  out.push(`${TODO_MARKER} 标注本章重点与难点，并说明难在哪里（概念抽象/推导繁琐/易混淆/需要先修知识）。`);
  out.push('');

  if (options.includeExercises) {
    out.push(heading(3, '自测题 / Self-Assessment Questions'));
    out.push('');
    out.push(`${TODO_MARKER} 生成 3–5 道可自测的问题（含答案要点），覆盖本章核心知识点。`);
    out.push('');
  }

  out.push(heading(3, '参考资料 / References'));
  out.push('');
  const references = context.retrievalFor(chapter.index);
  if (references.length > 0) {
    for (const source of references) {
      out.push(
        `- [${esc(source.title) || source.url}](${source.url})${source.type ? ` — ${source.type}` : ''}`,
      );
    }
  } else {
    out.push('- （本次运行未获取到可引用的外部来源。/ No external reference was retrieved in this run.)');
  }
  out.push('');

  return out.join('\n');
}

export function renderCourseReadme(context) {
  const {
    courseName, runId, documents, scan, knowledge, retrieval, options,
    chapterFiles, generatedAt, runtime, coverage,
  } = context;
  const out = [];
  out.push(heading(1, `${courseName} 课程笔记 / Course Notes`));
  out.push('');
  out.push('## 课程信息 / Course Info');
  out.push('');
  out.push(`- 课程名称 / Course: ${courseName}`);
  out.push(`- 生成时间 / Generated at: ${generatedAt}`);
  out.push(`- 运行编号 / Run id: \`${runId}\``);
  out.push(`- 输出语言 / Language: ${options.language}`);
  out.push(`- 详细程度 / Detail level: ${options.detailLevel}`);
  out.push(
    `- 解析后端 / Parsing backend: ${
      runtime?.interpreter
        ? `${toPosix(runtime.interpreter)} (Python ${runtime.pythonVersion ?? '?'})`
        : 'Node-native only'
    }`,
  );
  out.push('');

  out.push('### 原始课件 / Source Materials');
  out.push('');
  out.push('| # | 文件 / File | 格式 | 类型 | 大小 | 解析结果 |');
  out.push('| --- | --- | --- | --- | --- | --- |');
  const sizeByPath = new Map((scan?.files ?? []).map((record) => [record.path, record]));
  documents.forEach((doc, index) => {
    const sizeLabel = sizeByPath.get(doc.path)?.sizeLabel ?? formatBytes(doc.stats?.charCount ?? 0);
    out.push(
      `| ${index + 1} | ${doc.relative ?? doc.name} | ${doc.format} | ${genreLabel(doc.genre)} | ${sizeLabel} | ${
        doc.supported ? `OK（${doc.stats.charCount} 字符）` : '失败 / failed'
      } |`,
    );
  });
  out.push('');

  const unsupported = scan?.unsupported ?? [];
  if (unsupported.length > 0) {
    out.push('### 未能解析的文件 / Not Parsed');
    out.push('');
    for (const record of unsupported) {
      out.push(
        `- ${record.relative} — ${
          record.legacy
            ? `旧格式 / legacy：${record.conversionHint ?? ''}`
            : '不支持的格式 / unsupported format'
        }`,
      );
    }
    out.push('');
  }

  out.push(summariseRetrieval(retrieval));
  out.push('');
  out.push('## 学习目标 / Learning Objectives');
  out.push('');
  out.push(`${TODO_MARKER} 给出整门课程层面的学习目标。`);
  out.push('');
  out.push('## 知识结构 / Knowledge Outline');
  out.push('');
  for (const chapter of knowledge.chapters) {
    const file = chapterFiles?.get(chapter.index);
    out.push(
      `- [第 ${chapter.index} 章 ${chapter.title}](${file ?? '#'}) — ${chapter.points.length} 个知识点${
        chapter.formulas.length > 0 ? `，${chapter.formulas.length} 个公式` : ''
      }${chapter.figures.length > 0 ? `，${chapter.figures.length} 张待解读图表` : ''}`,
    );
  }
  out.push('');
  out.push('## 知识点覆盖率 / Knowledge Coverage');
  out.push('');
  if (coverage) {
    out.push(
      `- 提取知识点 / extracted: ${coverage.totalKeyPoints}；覆盖 / covered: ${coverage.covered}；部分覆盖 / partial: ${coverage.partial}；未覆盖 / missing: ${coverage.missing}`,
    );
    out.push(
      `- 覆盖率（内部完整性指标，不代表讲解正确性）/ coverage ratio: ${(coverage.ratio * 100).toFixed(1)}%`,
    );
    out.push('');
    out.push('详见 [覆盖率报告](coverage-report.md)。');
  } else {
    out.push('（本次运行未执行覆盖率检查 / coverage check not run）');
  }
  out.push('');
  out.push('## 关键术语表 / Glossary');
  out.push('');
  out.push(knowledge.glossary.length > 0 ? glossaryTable(knowledge.glossary) : '（未识别到术语对。）');
  out.push('');
  out.push('## 处理报告 / Processing Report');
  out.push('');
  out.push('- 详情见 [run-report.md](run-report.md) 与 [coverage-report.md](coverage-report.md)。');
  out.push('- 机器可读摘要见 `run-report.json`，知识点清单见 `knowledge.json`。');
  out.push('');
  return out.join('\n');
}

/* --------------------------------------------------------------- the brief */

export function buildBrief(context) {
  const { courseName, runId, documents, knowledge, retrieval, options, chapterFiles, generatedAt } = context;
  const budget = options.briefCharBudget;
  const lines = [];
  let used = 0;
  const push = (text) => {
    if (used + text.length > budget) return false;
    lines.push(text);
    used += text.length;
    return true;
  };

  push('# CourseNotes 笔记撰写简报 / Note-writing brief');
  push('');
  push(`- 课程 / Course: ${courseName}`);
  push(`- 运行 / Run: ${runId}（${generatedAt}）`);
  push(`- 语言 / Language: ${options.language}　详细程度 / Detail: ${options.detailLevel}`);
  push(`- 输出目录 / Output: ${toPosix(context.outputDir)}`);
  push('- 笔记文件 / Note files:');
  for (const [index, file] of chapterFiles ?? []) push(`  - 第 ${index} 章 → ${toPosix(file)}`);
  push('');

  push('## 1. 源材料清单 / Source materials');
  for (const doc of documents) {
    push(
      `- [${doc.id}] ${doc.relative ?? doc.name} — ${doc.format}/${genreLabel(doc.genre)}，${
        doc.supported
          ? `${doc.stats.unitCount} 个内容单元、${doc.stats.charCount} 字符、${doc.stats.tableCount} 表格、${doc.stats.imageCount} 图、${doc.stats.formulaCount} 公式候选`
          : `解析失败：${doc.warnings.map((warning) => warning.code).join(',')}`
      }`,
    );
    for (const warning of doc.warnings.slice(0, 4)) {
      push(`  - ⚠ ${warning.code}: ${warning.message}`);
    }
  }
  push('');

  push('## 2. 知识结构 / Knowledge structure');
  push(
    `章节 ${knowledge.chapters.length} 个，知识点 ${knowledge.keyPoints.length} 个，术语 ${knowledge.glossary.length} 条，公式候选 ${knowledge.formulas.length} 个。`,
  );
  push('');
  for (const chapter of knowledge.chapters) {
    if (!push(`### 第 ${chapter.index} 章 ${chapter.title}（知识点 ${chapter.points.length}）`)) break;
    if (chapter.outline.length > 0) {
      push(`大纲：${chapter.outline.map((node) => node.title).join(' / ')}`);
    }
    for (const point of chapter.points) {
      if (!push(`- [${point.id}] (${KIND_LABEL[point.kind] ?? point.kind}) ${point.title}`)) {
        push('  （简报已达字符预算上限，其余知识点请读取 knowledge.json）');
        break;
      }
      push(`  来源：${sourceLine(point)}`);
      const body = neutralizeUntrustedText(String(point.sourceText ?? '').replace(/\s*\n\s*/g, ' '));
      if (!push(`  原文：${body.slice(0, 700)}`)) break;
    }
    for (const formula of chapter.formulas) {
      push(
        `- [公式] \`${formula.text.slice(0, 160)}\` — ${formula.sourceName} · ${formula.locator}（${formula.reason}）`,
      );
    }
    for (const figure of chapter.figures) {
      push(
        `- [图表] ${figure.image ?? '(未导出)'} — ${figure.sourceName} · ${figure.locator}（${figure.reason}）`,
      );
    }
    push('');
  }

  push('## 3. 术语表 / Glossary');
  for (const entry of knowledge.glossary.slice(0, 200)) {
    push(
      `- ${entry.zh || '—'} | ${entry.en || '—'} | ${entry.abbr || '—'} | 出现 ${entry.occurrences} 次${
        entry.note ? ` | ${entry.note}` : ''
      }`,
    );
  }
  push('');

  push('## 4. 外部补充证据 / External evidence');
  push(summariseRetrieval(retrieval));
  push('');
  for (const result of retrieval?.results ?? []) {
    push(`### ${RETRIEVAL_LABEL[result.reason] ?? result.reason}｜主题：${result.topic ?? ''}`);
    push(`查询 / query: \`${result.query}\``);
    if (result.answer) push(`摘要 / summary: ${result.answer.slice(0, 1200)}`);
    for (const source of result.sources) {
      push(
        `- [${source.type}] [${source.title || source.url}](${source.url})${
          source.snippet ? ` — ${source.snippet.slice(0, 220)}` : ''
        }`,
      );
    }
    push('');
  }
  for (const item of retrieval?.fetchResults ?? []) {
    push(`#### 已抓取 / fetched: [${item.title || item.url}](${item.url}) (HTTP ${item.statusCode}, ${item.type})`);
    push('```text');
    push(item.text.slice(0, 2500));
    push('```');
    push('');
  }
  for (const error of retrieval?.errors ?? []) {
    push(`- ⚠ 检索失败 ${error.query ?? error.url}: ${error.code} ${error.message}`);
  }
  push('');

  push('## 5. 撰写要求 / Writing requirements');
  push('- 逐章补全每个知识点，禁止把详细课件压缩成只有标题和定义的短笔记。');
  push('- 每个核心知识点都要有实质性中文讲解与对应英文讲解（英文不得只翻译标题）。');
  push('- 术语首次出现使用：中文名称（English Full Name, ABBREVIATION）；不确定的全称不要臆造。');
  push('- 公式给 LaTeX、变量含义、成立条件、推导步骤、直观意义与一个计算示例。');
  push('- 图表必须解读其知识内容（时序/数据流/坐标含义/算法步骤），不能只抄图中文字。');
  push('- 区分 [课件内容] / [扩展讲解] / [推导说明]，外部补充内容必须给出真实可访问链接。');
  push('- 无法识别或无法验证的内容必须显式标注，不得编造 URL、页码、作者或结论。');
  push('- 补全笔记后调用 check_notes_coverage 复核覆盖率。');
  push('');

  return { text: lines.join('\n'), truncated: used >= budget };
}

/* --------------------------------------------------------------- file naming */

export function chapterFileName(chapter, options) {
  void options;
  const slug = slugifyKeepCjk(chapter.title, `chapter-${chapter.index}`);
  return `Chapter_${String(chapter.index).padStart(2, '0')}_${slug}.md`;
}

/**
 * Render every note file for a run.
 *
 * @returns {{files: Array<{path: string, content: string}>, chapterFiles: Map<number,string>, single: string|null}}
 */
export function renderNotes(context) {
  const { knowledge, options } = context;
  const rendered = [];
  const chapterFiles = new Map();

  if (options.splitByChapter) {
    for (const chapter of knowledge.chapters) {
      const file = chapterFileName(chapter, options);
      chapterFiles.set(chapter.index, file);
      rendered.push({ path: file, content: `${renderChapter(chapter, context)}\n` });
    }
  } else {
    const single = `${slugifyKeepCjk(context.courseName, 'Course')}_Notes.md`;
    const parts = [`# ${context.courseName}\n`];
    for (const chapter of knowledge.chapters) {
      parts.push(renderChapter(chapter, context));
    }
    chapterFiles.set(1, single);
    rendered.push({ path: single, content: parts.join('\n') });
  }
  return {
    files: rendered,
    chapterFiles,
    single: options.splitByChapter ? null : rendered[0]?.path ?? null,
  };
}

/* --------------------------------------------------------------- LLM authoring */

/**
 * Build the messages for one chapter's LLM authoring call.  The prompt pins the
 * required section structure so the model cannot silently drop chapters, and
 * explicitly requires the bilingual sections.
 */
export function buildChapterPrompt(context, chapter, existingNote, referenceBudget = 8000) {
  const options = context.options;
  const references = context
    .retrievalFor(chapter.index)
    .map((source) => `- [${source.type}] ${source.title || source.url} — ${source.url}`)
    .join('\n');
  const system = [
    'You are the authoring stage of CourseNotes, a study-note generator for university courses.',
    'You receive ONE chapter of already-extracted course material, with source locators, and must return the chapter notes as Markdown.',
    'Rules:',
    '1. Never omit a knowledge point. Keep every heading that already exists in the draft.',
    '2. Every core knowledge point gets BOTH a substantive Chinese explanation and a substantive English explanation with the same technical content.',
    '3. First mention of a term uses: 中文名称（English Full Name, ABBREVIATION）. Never invent an expansion you are unsure of.',
    '4. Formulas: LaTeX + variable meanings + validity conditions + derivation + intuition + one worked numeric example.',
    '5. Explain figures by their knowledge content (timing, data flow, axes, algorithm steps), never just their labels.',
    '6. Mark provenance as [课件内容] / [扩展讲解] / [推导说明]. Only cite URLs given to you; never invent citations.',
    '7. If something cannot be determined, say so explicitly instead of guessing.',
    '8. Output Markdown only, starting with the chapter heading.',
  ].join('\n');
  const user = [
    `课程 / Course: ${context.courseName}`,
    `章节 / Chapter ${chapter.index}: ${chapter.title}`,
    `语言 / Language: ${options.language}; 详细程度 / detail level: ${options.detailLevel}`,
    '',
    '## 已有草稿（必须保留其结构并补全全部 TODO 标记）/ Existing draft (keep the structure, fill every TODO marker)',
    '```markdown',
    truncate(existingNote, referenceBudget),
    '```',
    '',
    '## 可用外部来源（只能引用这些 URL）/ Allowed external references (only these URLs)',
    references || '(none retrieved)',
    '',
    '## 输出要求 / Output',
    'Return ONLY the complete Markdown for this chapter.',
  ].join('\n');
  return { system, user };
}

/** Strip code fences a model may wrap around its Markdown answer. */
export function unwrapModelMarkdown(text) {
  const value = String(text ?? '').trim();
  const fence = value.match(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/);
  return fence ? fence[1].trim() : value;
}

/* --------------------------------------------------------------- save prompt */

export function buildSavePrompt(context, brief) {
  const lines = [];
  lines.push('CourseNotes 已解析课程材料并生成结构完整的笔记骨架。请按以下步骤补全为最终笔记：');
  lines.push('');
  lines.push(`1. 输出目录：\`${toPosix(context.outputDir)}\`；逐章文件：`);
  for (const [index, file] of context.chapterFiles) lines.push(`   - 第 ${index} 章 → \`${file}\``);
  lines.push(`2. 每个笔记文件中带有 \`${TODO_MARKER}\` 的位置都需要由你写出真实内容：`);
  lines.push('   - 中文讲解与英文讲解都必须完整、实质，覆盖同样的技术事实；');
  lines.push('   - 公式补 LaTeX + 变量 + 条件 + 推导 + 直观意义 + 数值示例；');
  lines.push('   - 图表用 read 工具读取图片后解释其知识内容，识别不了就标注；');
  lines.push('   - 外部补充内容只使用简报中给出的真实链接，禁止编造引用。');
  lines.push('3. 全部 TODO 写完后，调用 `check_notes_coverage` 复核知识点覆盖率，并补齐未覆盖项。');
  lines.push('4. 需要更细的原文时，读取 `knowledge.json` 或 `note-brief.md`（完整版）。');
  lines.push('');
  lines.push(`简报字符数：${brief.text.length}${brief.truncated ? '（已截断，完整版见 note-brief.md）' : ''}`);
  return lines.join('\n');
}
