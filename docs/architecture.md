# CourseNotes 架构与数据模型

本文记录实现层面的设计取舍，供后续扩展（新格式、新检索源、新的撰写后端）参考。

## 1. 为什么要分成「骨架」和「正文」两步

一个面向专业课程的笔记生成器有两个互相冲突的要求：

- **完整性**：几百页课件里的知识点一个都不能丢；
- **教学深度**：每个知识点都要有概念 → 动机 → 原理 → 推导 → 示例 → 应用 → 常见误区。

如果让一次 LLM 调用同时满足两者，结果必然是：要么因为输出长度限制丢掉后面的章节，
要么把详细课件压成几十行标题。所以 CourseNotes 把工作拆开：

1. **确定性阶段（插件内，不调用 LLM）** 负责完整性：解析、知识点切分、章节重建、术语表、
   公式清单、图表任务、覆盖率基线。这些是纯函数，可复现、可测试、不消耗 token。
2. **撰写阶段（Agent 或 `ctx.llm`）** 负责深度：逐章读简报，写出中英双语正文。
   上下文由简报控制，章节之间互不挤占。

于是「完整性」不依赖模型是否听话，而「深度」不依赖解析器是否聪明。

## 2. 数据模型

### 2.1 统一文档模型（`lib/document.js`）

三种解析来源（Python 后端的 PDF/PPTX/DOCX/图片、Node 的文本类解析器、失败占位）
统一归一化为：

```ts
interface CourseDocument {
  id: string;            // D01-网络-ch1，用于所有引用
  name: string;          // 文件名
  relative: string;      // 相对输入根的路径
  format: string;        // pdf | pptx | docx | markdown | text | image | ...
  genre: string;         // lecture | assignment | lab | review | paper | syllabus | notes
  supported: boolean;
  needsVision: boolean;  // 整个文档只能靠视觉模型理解（例如单张图片）
  metadata: object;      // 标题/作者/页数等
  text: string;          // 拼接后的纯文本（用于全局检索与相似度）
  units: Unit[];         // 有序内容单元 —— 知识的真实载体
  images: ImageRecord[];
  formulas: FormulaCandidate[];
  visionTasks: VisionTask[];
  warnings: Warning[];   // 明确说明「什么没提取到」
  stats: { unitCount, headingCount, tableCount, imageCount, formulaCount, charCount, pageCount? };
}
```

`Unit` 是最小内容单位：`kind`（text/heading/table/code）、`text`、`locator`、`level`、
`page`、`sectionTitle`、`script`（cjk/latin/mixed）、`mathLike`、`rows`（表格）。
每个 unit 都带 **locator**（`page 12` / `slide 4` / `paragraph 8` / `line 30` / `cell 3`），
这是"笔记可溯源"要求的落点：知识点 → unit → locator → 课件位置。

### 2.2 知识点（`lib/knowledge.js`）

知识点不是"一个句子"，而是**带来源与类型的内容单元**：

```ts
interface KnowledgePoint {
  id: string;            // K001，笔记里的边界标记与覆盖率都用它对齐
  title: string;         // 首句截断，作为小节标题
  kind: string;          // definition|theorem|formula|algorithm|architecture|comparison|
                         // example|application|experiment|derivation|table|concept
  document: string; locator: string; section: string;
  terms: { zh, en, abbr }[];
  sourceText: string;    // 原文，写入笔记作为"材料原文依据"
  mathLike: boolean;
  chapterIndex: number; chapterTitle: string;
}
```

`kind` 由正则特征判定（`定义/是指/称为`、`定理/引理/性质`、`算法/伪代码`、`对比/区别/vs`…），
决定笔记里是否有"数学原理""实例"等小节，也决定检索阶段查什么。

### 2.3 章节（outline 组装）

层级判定优先级：

1. **数字编号优先**：`3` → 章，`3.1` → 节，`3.1.2` → 子节。
   幻灯片里每页标题样式相同，编号是唯一可靠信号。
2. **否则用解析器推断的 heading level**，并按"文档内首个标题层级 = 章"平移。

没有顶层标题的文档会得到**一个以文档名（或编号前缀）命名的章节**，
而不是把所有知识点倒进一个"总览"桶 —— 见 `docChapterTitle()`。

不同文件里同名章节自动合并，`documents` 记下所有来源，这样"第 3 章"分成三个文件也存在也只会出现一次。

### 2.4 检索（`lib/retrieve.js`）

不做"每句话都搜"。查询按优先级生成，且每类只在有信号时产生：

| 优先级 | 触发条件 | 查询形态 |
| --- | --- | --- |
| formula | `kind=formula` 或 `mathLike` | `<英文术语> formula derivation explained` / `<标题> 公式 推导 变量含义` |
| terminology | 术语缺英文名或缩写 | `<中文> <英文> 定义 全称` |
| verification | `kind=theorem/comparison` | 条件结论 / 区别对比 |
| concept | `kind=architecture` | 结构原理解释 |
| example | 每章一条（可关） | 例题 应用 案例 |

来源按类型分级（official 5 / university 4 / paper 4 / encyclopedia 3 / code-community 2 / blog 1），
只有 ≥3 级的页面才会被抓取正文。`ctx.web` 缺失或失败时，报告与笔记都会写明"检索未执行"。

### 2.5 覆盖率（`lib/coverage.js`）

笔记里每个知识点被 `<!-- COURSENOTES:POINT K001 START -->` / `END` 包住，这是对齐的依据。
`slicePointSections()` 切出每段，然后：

- 去掉代码围栏（那里是"材料原文依据"，是复制来的，不是写出来的）；
- 去掉 `**来源 / References**` 尾巴；
- 剩下的才是"撰写内容"。

**键是 `chapterKey::pointId`（如 `Chapter_03::K001`），不是裸 id。**
每个章节的知识点都从 K001 重新编号，所以裸 id 会让后一章的小节覆盖前一章 ——
表现为"这一章明明写完了，全目录检查却报 missing"。`loadNoteTexts()` 从文件名提取
`Chapter_NN` 前缀作为 chapterKey，`check_notes_coverage` 也从 `knowledge.json` 的
`chapters[].points`（而不是扁平的 `keyPoints`）重建映射以保留章节归属。

判定：`0.15 + 0.25×标题重合 + 0.35×正文重合 + 0.25×术语重合`，但
**只要该小节还有 TODO 标记、或撰写内容不足 40 字、或标题未出现在笔记里，直接判为未覆盖** ——
这让"覆盖率"忠实反映撰写进度，而不是被骨架本身撑高。

`loadNoteTexts()` 同时排除 `coverage-report.md` / `README.md` / `run-report.md` /
`authoring-report.md`：它们与笔记同目录但不是笔记内容，读进来会干扰结构检查。

因此新生成的骨架必然是 `结构 100% / 覆盖率 0%`，写完后再跑一次即为真实覆盖率。

## 3. 解析后端（`lib/parse/course_notes_parser.py`）

选择 Python 而不是纯 JS，是因为 DSH 自带的 Python 运行时已经包含成熟可靠的解析库，
比在插件里重写 OOXML/ZIP/PDF 解析安全得多：

| 库 | 用途 |
| --- | --- |
| PyMuPDF (pymupdf) | PDF 文本/字号/字体/图片/表格/扫描页判定与整页渲染 |
| python-pptx | 幻灯片顺序、标题占位符、段落层级、表格、备注、图片 |
| python-docx | 段落样式（Heading N）、内嵌 `a:blip` 图片、表格、OMML 公式标记 |
| Pillow | 图片元信息与校验 |

关键实现点：

- **标题推断**：按字符级 `rawdict` 重建行，用"正文字号 = 出现最多的字号"为基线，
  `+4pt` 判为一级、`+1.8pt` 判为二级；同时保留字号供人工复查。
- **扫描页**：可提取字符数低于阈值 → 标为扫描页，整页 2× 渲染为 PNG 交给视觉模型，
  并记录 `page-without-text-layer` 警告。
- **公式候选**：数学字体名（cmmi/cmsy/msam/rsfs…）或数学符号密度命中即记录，附"识别依据"。
- **不臆造**：提取不到的东西写成 warning，不填占位内容。

后端是独立的 CLI：`python course_notes_parser.py <files...> --work-dir <dir> --json-out <file>`，
可以脱离 Node 单独调试。

## 4. 工作区抽象（`lib/files.js`）

同一套代码要能在两种环境跑：

- **Harness 内**：用 `ctx.fs`，写入遵循会话沙箱策略并进入 workspace change 记录；
- **离线 CLI / 测试**：用 `node:fs`。

两者实现同一个 `{ writeText, writeBytes, copyFile, readText, exists, ensureDir }` 接口，
且**返回 `{ok:false, code, message}` 而不抛异常** —— 一次写入被拒绝不应该让整轮运行崩掉，
而应该出现在报告里。输出目录被沙箱拒绝时，`index.js` 会改写到会话工作区内的
`course-notes-output`，并在报告中标注迁移原因（不是静默改路径）。

## 5. 扩展点

| 想做的事 | 改哪里 |
| --- | --- |
| 支持新文件格式 | `lib/scan.js` 的 `FORMAT_ROUTES` + `lib/parsers.js`（文本类）或 `course_notes_parser.py`（二进制类） |
| 换检索来源 | `lib/retrieve.js` 的 `buildRetrievalPlan` / `classifySourceType`，以及对 `ctx.web` 的调用 |
| 全文/向量检索 | `lib/retrieve.js` 的 `extractFetchText` 之后接一层重排 |
| 换撰写后端 | `lib/pipeline.js` 的 `authorChaptersWithLlm`（现在是 `ctx.llm.stream` 逐章） |
| 改笔记版式 | `lib/generate.js` 的 `renderChapter` / `renderKeyPoint` |
| 改覆盖率算法 | `lib/coverage.js` 的 `checkCoverage`，保持 `pointMarker*` 边界协议不变 |
| 加语言 | `lib/generate.js` 的 `LANGUAGE_HEADINGS` + `lib/config.js` 的 `oneOf` 白名单 |
