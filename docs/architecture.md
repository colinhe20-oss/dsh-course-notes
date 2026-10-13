# CourseNotes 架构与数据模型（v1.1.0）

本文记录实现层面的设计取舍，供后续扩展（新格式、新检索源、新的撰写后端）参考。
1.1.0 的三个主题是：**不越权**（沙箱内绝不回落到 `node:fs`）、**不静默丢内容**
（长章节分块撰写 + 逐块校验）、**不虚报完成**（完成状态与多维质量分）。

三条不变量贯穿全文，任何改动都不应破坏它们：

| 不变量 | 含义 | 守护位置 |
| --- | --- | --- |
| 一次运行，一套报告 | `README.md` / `run-report.md` / `run-report.json` / `coverage-report.md` / 简报都从同一份最终 `report` 渲染 | `lib/pipeline.js` 末尾（`run-report.json` 最后序列化） |
| 完成是状态，不是推断 | 「文件写出来了」不等于「笔记写完了」，只有 `verified` 表示全部知识点在每个维度上都通过检查 | `COMPLETION_STATES` / `decideCompletion` |
| 沙箱内不回落原生 I/O | Harness 模式下所有**输出写入**都经过 `ctx.fs`；被拒绝就报告，不换一套文件系统偷偷写 | `lib/files.js`、`index.js` 的迁移逻辑 |

## 1. 为什么要分成「骨架」和「正文」两步

一个面向专业课程的笔记生成器有两个互相冲突的要求：

- **完整性**：几百页课件里的知识点一个都不能丢；
- **教学深度**：每个知识点都要有概念 → 动机 → 原理 → 推导 → 示例 → 应用 → 常见误区。

如果让一次 LLM 调用同时满足两者，结果必然是：要么因为输出长度限制丢掉后面的章节，
要么把详细课件压成几十行标题。所以 CourseNotes 把工作拆开：

1. **确定性阶段（插件内，不调用 LLM）** 负责完整性：解析、知识点切分、章节重建、术语表、
   公式清单、图表任务、证据映射、覆盖率基线。这些是纯函数，可复现、可测试、不消耗 token。
2. **撰写阶段** 负责深度：1.1.0 起由插件自己按**分块**调用 `ctx.llm`（`mode: auto`），
   或者只产出骨架 + 简报交给 Agent / 人工撰写（`mode: scaffold`）。

于是「完整性」不依赖模型是否听话，而「深度」不依赖解析器是否聪明。
撰写阶段产出的正文只被当作**小节正文**使用，标题、顺序、标记、公式清单、图表、术语表、
参考资料全部由确定性渲染决定（见 §4.3）。

## 2. v1.1.0 修掉的四个结构性问题

| # | 1.0 的症状 | 1.0 的做法 | 1.1.0 的做法 | 代码 |
| --- | --- | --- | --- | --- |
| P0 | 沙箱拒绝写入后，文件仍然出现在磁盘上 | 把整轮流水线重跑到一个 `node:fs` 工作区 | 保留同一个 `ctx.fs` 缝，只换**路径**，且先用真实写入探测候选目录 | `lib/files.js`、`index.js` |
| P0 | 每个 Python 探测都报「不可用」，PDF/PPTX/DOCX 全线降级 | `spawnSync(..., {encoding:'utf8'})` 捕获子进程输出（沙箱禁止建管道 → `EPERM`） | 子进程 `stdio: ['ignore', fd, fd]` 指向真实文件，再读回来 | `lib/python-bridge.js` |
| P1 | 长章节后半段知识点从未进入提示词，运行仍报「本章已撰写」 | 整章一次调用，并把章节草稿在提示词里截断到固定字符预算 | 章节切成**块**，每块带自己的知识点清单，逐块校验、局部补全 | `lib/chunk.js`、`lib/authoring.js` |
| P1 | 引用无法核对，检索只给了标题和 URL | 把检索结果的标题/URL 列表塞进提示词 | 建立知识点 ↔ 证据索引（含摘录、来源类型、可信度、查询、时间），引用按白名单校验 | `lib/evidence.js` |
| P1 | 「完成」= 文件写成功 | 无完成状态概念 | 显式完成状态 + 多维质量检查，且同一状态渲染所有报告 | `lib/pipeline.js`、`lib/coverage.js` |

### 2.1 沙箱完整性（P0）

Harness 用一个文件系统缝（`ctx.fs`）实施会话权限策略：每次写入都会进入 workspace change 记录，
也可能被结构化地拒绝（`FS_SANDBOX_DENIED`）。**任何绕过这条缝的写入，都等于把这套权限模型作废。**

1.0 有两处绕过：图片资源用 `node:fs` 复制；写入被拒时把整轮流水线重跑到一个 `node:fs` 工作区。
1.1.0 的处理见 §6：`writeBytes` / `copyFile` 也走 `ctx.fs`，被拒时**只换路径、不换文件系统**，
  并且先用 `probeWritable()` 真的写一个探测文件来证明候选目录可写。

### 2.2 长章节分块撰写（P1）

1.0 的提示词里有一句 `truncate(existingNote, 8000)`。超预算的知识点从未进入提示词，
  而运行报告仍然说这一章已撰写 —— 这是最糟的一类错误：**读者无从知道笔记在哪里断掉了**。
1.1.0 把「章」降级为渲染单位，把**块**作为调用单位：一块负责一组明确的知识点 id，
  这份清单既是提示词的输入，也是事后校验的契约（见 §4）。

### 2.3 检索证据（P1）

一个 URL 无法支撑一段推导的讲解。没有摘录时，模型只有两个选择：凭记忆写（不可核对）
或编一个引用（更糟）。1.1.0 因此把「检索结果」加工成**证据**：每个知识点带上课件原文摘录
与外部证据摘录，且只能引用真实检索到的 URL（见 §3.4）。

### 2.4 多模态的诚实能力声明

插件能触及的缝只有两条：`ctx.fs`（原始字节，读不懂）与 `ctx.llm`（请求只能以
**附件引用**的形式携带图像，而附件引用由 attachment provider 生成）。
**没有**一条缝能把「会话工作区里的一个 PNG」变成请求里的图像。所以插件只做能证明的三件事：

1. 从 `ctx.llm.resolveModelInfo(provider, model)` **检测**会话模型是否接受图像输入；
2. 为每张图**规划**一个视觉任务，并按图形类别问一个具体问题；
3. 把**能看见图的人**（带视觉工具的 Agent，或人工）写回 `vision-results.json` 的解读**并入**笔记。

`describeFigureWithModel()` 是唯一会带图调用模型的函数，它按文档化的请求形状实现，
在缝无法携带图像时返回结构化的 `unsupported` / `VISION_ATTACHMENT_REQUIRED`，
**绝不会**只发一个纯文本请求再把回答当作「看过了图」。图未被解读时，笔记里明确写着
「尚未解读 / not interpreted yet」，报告也照实计数。

### 2.5 完成状态、质量与报告一致性（P1）

1.0 在 LLM 撰写**之前**就写了 `coverage-report.md`，又在第三个时刻写了 `run-report.json`，
于是随包发布的样例里两个文件的覆盖率数字互相矛盾。1.1.0 的规则很简单：
**所有报告文件都在最后一个阶段之后、从同一个 `report` 对象渲染**，机器可读的那份最后落盘
（见 §5.3）。

## 3. 数据模型

### 3.1 统一文档模型（`lib/document.js`）

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

### 3.2 知识点（`lib/knowledge.js`）

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
决定笔记里是否有"数学原理""实例"等小节，也决定检索阶段查什么、撰写阶段校验什么
（公式类知识点必须出现公式，图表类必须解释图，见 §4.3）。

### 3.3 章节（outline 组装）

层级判定优先级：

1. **数字编号优先**：`3` → 章，`3.1` → 节，`3.1.2` → 子节。
   幻灯片里每页标题样式相同，编号是唯一可靠信号。
2. **否则用解析器推断的 heading level**，并按"文档内首个标题层级 = 章"平移。

没有顶层标题的文档会得到**一个以文档名（或编号前缀）命名的章节**，
而不是把所有知识点倒进一个"总览"桶 —— 见 `docChapterTitle()`。

不同文件里同名章节自动合并，`documents` 记下所有来源，这样"第 3 章"分成三个文件也存在也只会出现一次。
章节对象上还挂着 `points` / `formulas` / `figures` / `outline`，它们是撰写阶段分块与章节级小节的数据来源。

### 3.4 证据索引（`lib/evidence.js`）

`retrieve.js` 产出的是**搜索结果**（查询、来源列表、抓取到的页面正文）；
`evidence.js` 把它变成**证据**：属于某个知识点、带足够溯源信息、可以被真实引用的摘录。

```ts
interface PointEvidence {
  pointId: string; chapterIndex: number; chapterKey: string;
  topic: string;
  lectureEvidence: { kind: 'lecture', documentName, locator, section, excerpt }[];
  retrievedEvidence: {
    kind: 'search-summary' | 'snippet' | 'page';
    url, title, excerpt, sourceType, trust, query, reason, retrievedAt;
    omitted?: 'budget';        // 超出全局字符预算、摘录被清空但条目保留
    overlap?: number;          // 章节级查询抓到的页面，记录主题重合度
  }[];
  queries: string[];
}
```

编码在这份结构里的规则：

- **只有真检索到的 URL 存在**：白名单直接从检索报告构建，编造的 URL 过不了引用校验
  （`validateCitations` / `verifyChunk` 都按白名单比对）；
- **摘录按段落打分挑出**，不是取页面开头（开头通常是导航条）：`selectRelevantExcerpt()`
  按查询词命中、是否含公式/定义/推导等结构特征、以及轻微的段首先验给段落打分，
  再按分数取段落并保持原文顺序；
- **一条记录一个 (kind, url)**：只按 URL 去重会丢掉「同一 URL 的页面摘录」——
  而那恰恰是带着推导的那一条；搜索摘要、搜索片段、页面段落是互补的，不是重复的；
- **不为无关知识点硬凑证据**：为某个知识点发出的查询，其结果直接归到该知识点；
  为章节级查询抓回来的页面，必须与知识点主题的重合度 ≥ `FETCH_OVERLAP_THRESHOLD`（0.34）
  才会被挂上去。给每个知识点挂一个高可信但无关的页面，比不挂更糟：它让来源清单看起来完整；
- **全局字符预算按可信度顺序花**（`official 5 / university 4 / paper 4 / encyclopedia 3 /
  code-community 2 / blog 1`），预算用尽时不删除条目，而是把 `excerpt` 置空并标记 `omitted: 'budget'`，
  这样「为什么没有摘录」是可读的；
- **摘录是不可信数据**。课件原文与网页文本都过 `neutralizeUntrustedText()`；
  进入提示词时再过 `neutraliseCostlyPromptText()`：缩进片段里的 ``` 围栏、
  打断 `system:` / `assistant:` 之类角色标签、把「ignore previous instructions」这类
  指令式句子替换为 `[redacted-instruction-like-text]`（只是**提到** ignore 的正常句子必须原样保留）。

默认预算 `EVIDENCE_LIMITS`：每条摘录 900 字符、课件摘录 900 字符、每个知识点最多 4 条外部证据、
整轮 24000 字符外部摘录；可通过 `evidencePerPoint` / `evidenceCharBudget` / `evidenceExcerptChars` 调整。

### 3.5 视觉任务（`lib/vision.js`）

视觉任务的来源按具体程度排序：解析器自己产出的 `vision_tasks`（扫描页、纯图 PDF）→
纯图片文档（`units` 为空但有 `images`）→ 章节里发现的图表。去重键是
`image|locator` + `pageKey`，上限 200 条，`enableOcr: false` 时**一条都不产生**
（不是产生一批空任务）。

每张图按上下文文本分类，再配一个**形状对应的问题**（`FIGURE_PROMPTS`）：

| 类别 | 判定线索（`classifyFigure`） | 问题问什么 |
| --- | --- | --- |
| `sequence` | 时序 / sequence / handshake / 报文交互 | 谁按什么顺序给谁发了什么，两侧状态如何变化，字段与定时/确认语义 |
| `architecture` | 架构 / 结构图 / block diagram / 网络结构 | 输入形状、逐层操作、激活、输出形状、参数在哪 |
| `flowchart` | 流程 / flow chart / 算法步骤 | 初始化、循环条件、循环体、终止条件、每轮不变式 |
| `curve` | 曲线 / curve / 函数图像 / loss curve | 坐标轴与单位、极限行为、形状、参数变化如何移动曲线 |
| `chart` | 统计 / bar / histogram / 分布 | 变量、单位、趋势、显著点，以及数据支持与**不支持**的各一条结论 |
| `screenshot` | slide / 截图 / 课件图 | 原样转录文字与公式，读不清的标注而非猜测，再说明这一页在讲什么 |
| `scanned` | 扫描 / 整页 / page N | 转录整页，符号明确时给 LaTeX，不确定的显式标注 |
| `generic` | 其余 | 说明图**编码的知识**（结构/流程/坐标/步骤），而不是复述图里的文字 |

分类只决定「问什么问题」，不声称读过图；分类错了的代价是一个稍差的问题，不是笔记里的一句错话。

解读结果的并入是**严格**的（`applyVisionResults`）：条目必须能对应到本轮规划出的任务
（`taskId`，或规范化后的图片路径），`interpretation` 必须是非空文本；
对不上的条目进入 `unknown` 并在报告里列出，**不会被凭空变成一条任务**。
写入的解读会被截断到 4000 字符，`unresolved` 细节原样带上，笔记里以
「⚠ 未能确认的细节」出现。渲染时（`renderFigureBlock`）未解读的图明确写
「尚未解读 / not interpreted yet」并说明原因（模型通道不能直接接收图片）。

### 解读如何进入知识点与撰写提示词

一条解读要走完整条链路，缺任何一环都会变成「插件知道图上是什么，却不去用」：

1. **任务归属**（`buildVisionTasks`，三段式）：① 精确 locator 命中；② 知识点原文里出现图片路径或
   locator（Markdown 内嵌图走这条）；③ **章级兜底** —— 不属于任何具体知识点但属于某一章的图，
   归属给该章的知识点，并把 `attribution` 记为 `chapter`。归属不到知识点的解读等于白写，
   所以宁可宽一点也不要留空。文档级任务（解析器报告的图片 / 扫描页）本身没有章号，
   用 `documentId → chapterIndex` 的映射补上。
2. **去重**：章节图表清单里的图通常就是解析器已经报过的那张（同资源、同 slide），
   因此两者使用**同一个去重键**（图片 + locator）。用不同键会让同一张图产生两个任务，
   其中一个永远归属不到 —— 这正是 1.1.0 修掉的一个实例。
3. **挂到知识点**（`lib/pipeline.js`）：`visionByPoint()` 按知识点索引已解读的任务，结果写入
   `point.visionInterpretations`。注意 `extractKnowledge` 的 `keyPoints` 是各章 points 的**展开副本**：
   两者是不同对象，而分块规划器读 `chapter.points`、`knowledge.json` 发布 `keyPoints`，
   所以**两份都要写**。同理，`sanitiseKnowledge()` 必须保留这个字段 —— 规划器读的正是这份视图，
   视图里丢了字段，解读就到不了提示词。
4. **进入提示词**（`lib/chunk.js`）：分块提示词在图表清单之后附上
   「图表视觉解读（外部提供，可作为依据引用）」，并把 `unresolved` 一起带上；
   解读文本与课件原文一样经 `neutraliseCostlyPromptText` 处理 —— 它同样是不可信输入。

模型因此拿到的不是「有一张图，自己猜」，而是「这张图讲的是 X，其中 Y 未能确认」，
笔记里的图表解读有据可依；`run-report` 的 `pointsWithInterpretation` 报告解读落到了几个知识点上。

## 4. 撰写流水线（`lib/chunk.js` + `lib/authoring.js`）

```
plan（分块） → generate（一块一次调用） → verify（逐知识点校验）
             → repair（只重发失败的知识点） → merge（合入确定性骨架）
             → global check（引用白名单、TODO 计数）
```

### 4.1 分块计划

一条硬规则：**块不切知识点**。一个知识点放不进任何预算时，不是丢掉它，而是把它拆成
**同一个知识点的多个连续分段**（`partIndex` / `partCount`），提示词里明确写
“This is part i of n of one knowledge point: continue the explanation, do not repeat the earlier parts”，
这样推导是接着写而不是重新开始。

计划是**数据**而不是提示词拼接：每块携带它负责的 `pointIds`，校验阶段就按这份清单问
「K017 写了吗」。没有这份清单，「模型有没有漏写」这个问题根本无法回答。

预算换算（`chunkBudgetFromContext`）：预留 45% 的上下文给回答与对话其余部分，
其余按 3.2 字符/token 折算，并夹在 `[8000, 60000]` 之间；模型没有公开上下文元数据时
用保守默认值 28000 字符。`chunkChars` 显式设值则直接使用。每块的字符预算还会被
`maxPointsPerChunk`（默认 12）二次限制，以防一条知识点过短时一块塞进过多知识点。

### 4.2 生成 → 校验 → 局部补全

`verifyChunk()` 检查的是**产出文本的事实**，不是风格意见：

| 检查 | 失败码 |
| --- | --- |
| 承诺的每个知识点 id 都出现了小节 | `missing-section` |
| 正文（去空白）≥ `MIN_POINT_CHARS`（120） | `too-short` |
| 正文里没有 `COURSENOTES:TODO` | `todo-marker` |
| 双语要求的小节都在（按 `language` 判定，中英各自可含标题或足够长的文本） | `missing-chinese` / `missing-english` |
| 公式类知识点出现公式（`$…$` / `$$…$$` / `\frac` / `\sum` / `=`…） | `formula-missing` |
| 图表类知识点解释了图（图片链接或“图表/figure/diagram”字样） | `figure-unexplained` |
| 引用只包含检索白名单里的 URL | `citations.unknown` |
| 正文 < 400 字符（**软**问题：记录但不单独否决该块） | `short` |

块校验失败时只对**失败的知识点**发一次 repair 调用（提示词里列出失败原因与禁止的 URL），
好知识点不会因为邻居写坏而重写。一个关键细节：**repair 的回答要针对 repair 任务校验，
而不是针对原块**。按原块校验会把那些「本来就好、repair 时故意没重发」的知识点全判成
`missing-section`，于是整块被否掉，好坏一起丢。

合并是**外科手术式**的（`mergeAuthoredIntoScaffold`）：`generate.js` 渲染出的骨架是
**结构的事实来源**（标记、标题层级、顺序、公式清单、图表清单、术语表、参考资料），
只有每个块 START/END 之间的正文被替换。模型没写出来的知识点**保留骨架与 TODO 标记** ——
于是「没写完的运行看起来就是没写完」。知识点标记保留（覆盖率检查按它切段），
章节级小节的标记在写完后**移除**，让写完的章节读起来像一篇写好的章节而不是填好的模板。

`splitModelSections()` 把模型回复切成按 id 的小节，接受实际会出现的几种写法
（`### K001 · 标题`、`### K001 标题`、`## K001 …`、`**K001**`、行首裸 `K001`）；
第一处标题之前的内容作为 `preamble` 丢弃。**匹配到的标题行留在正文里** ——
这一点看起来无关紧要，实则是 1.1.0 修掉的一个静默损坏：合并时会把正文第一个标题
改写成带 id 的标题，如果模型自己的标题行已被删掉，被改写的就会是 `#### 中文讲解`，
结果是一个「中文讲解没有标题」的知识点，质量检查随即报它为不完整。

### 4.3 章节级小节

章节概述、学习目标、本章总结、重点难点、自测题是**散文**，必须由模型写，但它们不是知识点。
1.1.0 给它们各自一对 `<!-- COURSENOTES:SECTION C01-OVERVIEW START -->` 标记，
按章一次性撰写（`authorChapterSections`，每章一次有界调用），写完后**移除标记**。
1.0 把这几处永久留作 TODO —— 这正是「一次运行永远无法诚实地声称完成」的原因。

公式清单与图表清单是确定性渲染的（公式候选 + 识别依据；图表块 + 视觉解读），
它们只在有内容时才追加自己的 SECTION 块（`C01-FORMULAS` / `C01-FIGURES`）。
章节级小节只有这一次调用，**没有** repair 步骤：缺失或过短的小节保留占位并记入
`failures`（`sections-not-authored`），因此该次运行的状态不会是 `verified`。

### 4.4 有界性与度量

每一步都有界：每次调用 `maxAttempts`（默认 3）次并退避（`backoffMs × 尝试次数`，
`AbortSignal` 一旦触发立即停止重试）、每个坏知识点一次 repair、不出现无界循环。
一个始终失败的块连同它的知识点 id 记入 `result.failures`，运行状态随之变成 `partial`。

度量集中在 `runner.metrics`：调用数、重试数、失败数、按用途分类的调用数、
提示词/生成字符数、输入/输出 token、耗时（毫秒），以及墙上时间 `wallMs`。
运行报告会把它渲染成人可读的一行，并附逐块的表格（章、块号、知识点、状态、字符数、是否补全过）。

另外，单文件模式（`splitByChapter: false`）下每一章都指向同一个文件，
`targetFileForChapter()` 明确处理这种情况；1.0 在这里只撰写了第一章，其余章节的 TODO 永远留着。

## 5. 完成状态、质量与报告

### 5.1 `COMPLETION_STATES` 与 `decideCompletion`

```ts
parsed           材料已解析，但尚未建立知识结构
scaffold_created 笔记骨架已生成，正文尚未撰写（保留 COURSENOTES:TODO 标记）
notes_authored   全部知识点已由模型撰写，但尚未通过质量检查
verified         全部知识点已撰写并通过质量检查（结构+内容+双语+公式+引用）
partial          部分知识点已撰写或部分阶段失败，结果不完整
failed           本次运行未能产出可用笔记文件
```

判定顺序（`decideCompletion`，`verified` 是唯一表示成功的状态）：

1. 一个笔记文件都没写成功 → `failed`；
2. 未执行模型撰写：没有知识点 → `parsed`；否则 → `scaffold_created`（理由用跳过原因）；
3. 有知识点未撰写、有 TODO 残留、或**有文件写入失败** → `partial`；
4. 没跑质量检查 → `notes_authored`；
5. 每个知识点的每个维度都通过、且没有无法对应的引用 → `verified`；
6. 其余 → `partial`（理由里给出「全维度通过 m/n」与引用异常数）。

写入成功、模型写了一些段落，都不足以进入 `verified`。

### 5.2 多维质量（`checkQuality`）

覆盖率只回答一个词元重合度问题：「这个知识点的内容出现在笔记里了吗」。质量检查补上
读者真正会注意到的维度，全部从笔记文本本身测量：

| 维度 | 判据 |
| --- | --- |
| 结构 structure | 每个知识点是否有一对 `COURSENOTES:POINT` 标记包住的独立小节 |
| 内容 content | 小节里是否有实质正文（≥ 40 个非空白字符）且没有残留 TODO |
| 双语 bilingual | 中文 ≥ 80 个汉字、英文 ≥ 40 个词（按 `language` 决定要求哪一侧） |
| 索引 indexed | 知识点标题是否能在笔记中找到（否则目录与交叉引用会对不上） |
| 公式 formula | 每个公式候选是否**渲染**（记号感知匹配）且**被解释**（公式所在小节还有 ≥ 120 字符的散文） |
| 引用 citation | 每条被引 URL 是否来自本轮真实检索结果；没跑检索时报告「无法核对」而不是「0 条错误」 |
| 语义 semantic | 只有调用方提供 LLM 判官时才有值，且明确标注**未经人工验证**，不换算成准确率 |
| 全部维度 completeness | `all-dimensions-complete` 比例：只有每个维度都通过的知识点才计数，所以骨架不可能刷到 100% |

公式匹配单独说明：`formulaAtoms()` 把 LaTeX 与 PDF 文本层的两种写法归一到同一组原子
（`\infty` 与 `inf`、`\lfloor` 与 `floor`、`\le` 与 `<=` …），
`formulaPresent()` 在**单个渲染出的公式**上比对而不是在整篇文档上比对（整篇比对会让
任何公式都被无关公式的零散符号满足），并要求命中至少一个算子原子 + 覆盖度 ≥ 0.7
（或该片段 ≥ 85% 的原子属于目标，用于「只渲染了一部分」的合理情形）。
这样「公式写了吗」这个问题的答案，不受笔记用哪种记号书写的影响。

### 5.3 一份状态，一套报告

流水线最后一个阶段结束后才渲染报告，顺序固定：

```
coverage/quality 计算 → decideCompletion → README.md / knowledge.json / run-report.md /
note-brief.md / evidence.json / vision-results.json / coverage-report.md → run-report.json（最后）
```

`tests/check-report-consistency.mjs` 会把磁盘上的笔记重新算一遍覆盖率与质量，
与 `run-report.json` 声称的数字逐项比对（见 `docs/testing.md`），
这是防止「两份报告数字不一致」问题回归的守门测试。

需要知道的两个细节：

- `.coursenotes/<run-id>/run.json` 是**阶段快照**，在输出阶段记录文件清单之前写出，
  因此它没有 `outputs` 与 `brief` 字段；它不是对外报告，而是复查用的中间产物；
- `run-report.md` 在输出阶段**开始写文件之前**渲染：此时 `report.outputs` 还是流水线开头那个空对象，
  所以「输出文件 / Output files」一节为空、「已执行阶段」不含 `output`；`completionLabel` 与耗时
  要等最后的 `finaliseReport()` 才填，因此显示为空标签与 `0.0 s`。完成状态**字符串**本身在渲染前
  就已确定，与 JSON 一致；完整的写入清单在最后序列化的 `run-report.json`
  （`writtenFiles` / `writtenNoteFiles`）里。报告内容的权威版本是 JSON。

## 6. 工作区抽象与沙箱（`lib/files.js`）

同一套代码要能在两种环境跑：

- **Harness 内**：用 `ctx.fs`，写入遵循会话沙箱策略并进入 workspace change 记录；
- **离线 CLI / 测试**：用 `node:fs`。

两者实现同一个接口：`ensureDir` / `writeText` / `writeBytes` / `copyFile` /
`readBytes` / `readText` / `exists` / `stat` / `size`，
且**返回 `{ok:false, code, message}` 而不抛异常** —— 一次写入被拒绝不应该让整轮运行崩掉，
而应该出现在报告里。`ctx.fs` 侧只认 `FS_SANDBOX_DENIED` 之类结构化代码，**从不按消息文本判断**。

关于 `ctx.fs` 的几个事实，决定了实现形状：

- `resolve(path, {cwd})` 是拿到 `FsTarget` 的唯一途径（解析结果按路径缓存）；
- `writeText(target, content)` 自己创建父目录，所以没有单独的 `mkdir` 原语
  （Harness 工作区的 `ensureDir` 因此是「延后」语义）；
- `readBytes(target, signal, maxBytes)` 需要显式上限，超限失败为 `FS_TOO_LARGE` 而不是截断；
- `writeText` / `editText` 是**仅文本**的写入，没有二进制追加或原始复制原语。

### 6.1 二进制数据如何穿过「只写文本」的缝

`latin1` 编码把第 n 个代码单元映射到第 n 个字节，所以一个 Buffer 可以**字节等价**地
穿过任何保持代码单元的文本缝：`bytesToBinaryString()` / `binaryStringToBytes()`。
这是无损的，但不是免费的 —— 整个文件会在内存里被物化两份，所以超过
`MAX_HARNESS_BINARY_BYTES`（64 MiB，配置项 `maxHarnessAssetBytes`）的资源会得到
明确的 `FS_TOO_LARGE_LOCAL` 拒绝，而不是悄悄截断。一张被悄悄截断的图，比一张被报错的图糟得多。

`copyFile` 同理：没有 copy 原语，也没有原始文件句柄，所以先把源读成字节（优先用有界的
`readBytes`，后端不支持时退回「按文本读 + 反解 latin1」）再作为新文件写出 ——
**被沙箱检查的是目标写入**，这正是重点。

### 6.2 拒绝的处理：先探测，再迁移或报告

`ctx.fs` 没有「这里能写吗」的查询接口，所以 `probeWritable()` 用真实写入原语做一次演练：
在目标目录写一个 0 字节的 `.coursenotes-write-probe`。探针文件会留下（没有删除原语），
但它名字明显、会被后续运行覆盖，代价可忽略。

Harness 模式下写入被拒时（`index.js`）：保持**同一个** `ctx.fs` 缝，
对 `<cwd>/course-notes-output` 与 `<cwd>/.coursenotes-output` 逐个探测，
选第一个真正可写的目录整轮重跑，并在报告里以 `output-relocated` 警告说明迁移原因（不静默换目录）；
若没有任何候选可写，则记 `OUTPUT_DIR_UNAVAILABLE` 错误并停止 —— **什么都不写**。
CLI/Node 模式没有沙箱内备选目录的概念，因此只记录 `output-denied` 警告。

判定的依据必须是**真实落盘的结果**，不是意图：报告里 `noteFiles` 是运行**打算**产出的清单
（即使每次写入都被拒绝也非空），`writtenNoteFiles` / `refusedNoteFiles` 才是实际结果，
迁移与 `ok` 都只看后者。把这两个语义不同的列表混用，会让「什么都没写成」的运行报成成功。

### 6.3 边界：哪些 I/O 不走这条缝

「Harness 运行不回落 `node:fs`」这条规则针对的是**输出写入**。解析侧的 I/O 仍是本地的：

- Python 后端是一个子进程，它在 `workDir` 下写抽取出的图片、在 `os.tmpdir()` 写探测脚本与
  报告文件，这些由 `lib/python-bridge.js` 用原生 I/O 管理（见 §7）；
- 资源发布前需要知道 `workDir/assets` 里有什么，`publishAssets()` 用一次原生目录列举
  （`readdirSync`）判断「有没有资源」—— 用 `stat` 判断会被只面向文件的 `stat` 实现
  答成「没有」，从而静默丢掉所有插图；真正的**复制**仍然逐个经过 `workspace.copyFile`；
- `.coursenotes/vision-results.json` 是外部输入（Agent 或人工写下的解读），
  读它是原生读取，写入笔记才是缝上的操作。

## 7. 解析后端（`lib/python-bridge.js`）

### 7.1 为什么用 Python

DSH 自带的 Python 运行时已经包含成熟可靠的解析库，比在插件里重写 OOXML/ZIP/PDF 解析安全得多：

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

后端是独立的 CLI：`python course_notes_parser.py <files...> --work-dir <dir> --json-out <file>
--extract-images --scanned-char-threshold 40 --max-formulas 200`，
可以脱离 Node 单独调试。后端**只为它拿到的文件**产出报告，`reconcileReports()` 会把
「输入里有、报告里没有」的文件补成一条 `no-parser-report` 失败 —— 静默丢文件是不可接受的。

### 7.2 为什么子进程的输出要写进文件

DSH 沙箱禁止创建捕获式子进程所需的管道：`spawnSync(cmd, args, {encoding:'utf8'})`
在子进程启动之前就以 `EPERM` 失败。后果不是「少了一个诊断信息」，而是
**每一个解释器探测都被判为不可用**（包括 DSH 自带、库齐全的那个），
于是 PDF/PPTX/DOCX 整条路径静默降级成「后端不可用」。

修法是结构性的，不是重试：`runCaptured()` 用 `stdio: ['ignore', fd, fd]` 把 stdout/stderr
指向真实文件（继承描述符，不是管道），运行完再从文件读回。沙箱内外行为一致，
不存在「CLI 能跑、Harness 里失败」的差异。解释器探测同理：子进程把结果 JSON 写进文件，
版本信息由子进程自己产出，而不是解析平台相关的 stdout。

### 7.3 解释器发现顺序

`DSH_*` 环境变量并不可靠：Harness 把它们注入**shell 工具调用**，而不是注入宿主进程自己的环境。
所以发现过程既看环境变量，也从文件系统推导候选，并且**每个候选都要真正探测**（能不能
`import` 全部依赖库）而不是假定：

1. 显式配置 `pythonPath` → `COURSE_NOTES_PYTHON` → `DSH_PYTHON` → `PYTHON`；
2. DSH 自带的解释器（`<runtime>/dependencies/python/bin/python.exe` 等）——
   它们已包含全部所需库，因此必须排在 PATH 之前（一个缺库的系统 Python 不能赢得探测）；
3. PATH：Windows 上先 `py`（`python` 常常是 Anaconda 的 Python 2.7），再 `python3`、`python`。

运行时的 `report.stages.parse.runtime` 会记录最终用到的解释器、Python 版本、耗时与退出码，
`README.md` 里的「解析后端」一栏据此渲染（1.0 漏传这个字段，导致每次都写「Node-native only」）。

## 8. 扩展点

| 想做的事 | 改哪里 |
| --- | --- |
| 支持新文件格式 | `lib/scan.js` 的 `FORMAT_ROUTES` + `lib/parsers.js`（文本类）或 `course_notes_parser.py`（二进制类） |
| 换检索来源 | `lib/retrieve.js` 的 `buildRetrievalPlan` / `classifySourceType`，以及对 `ctx.web` 的调用 |
| 全文/向量检索 | `lib/retrieve.js` 的 `extractFetchText` 之后接一层重排，并在 `lib/evidence.js` 里给它一个新的 `kind` |
| 改证据挑选策略 | `lib/evidence.js` 的 `selectRelevantExcerpt` / `FETCH_OVERLAP_THRESHOLD` / 全局预算排序 |
| 改分块策略 | `lib/chunk.js` 的 `planChapterChunks`（`balanced` / `per-point`）、`measurePoint`、`splitPoint` |
| 改撰写/校验规则 | `lib/authoring.js` 的 `verifyChunk`（新增失败码要同时更新 `buildRepairPrompt` 的说明） |
| 换撰写后端 | `lib/authoring.js` 的 `createModelRunner`（只需满足 `{system, user, purpose} → string`） |
| 增加章节级小节 | `lib/generate.js` 的 `SECTION_TITLES` + `renderChapter` 里的 `section(id, placeholder)`，撰写侧无需改动 |
| 改笔记版式 | `lib/generate.js` 的 `renderChapter` / `renderKeyPoint` |
| 改覆盖率或质量算法 | `lib/coverage.js` 的 `checkCoverage` / `checkQuality`，保持 `pointMarker*` 边界协议不变 |
| 加语言 | `lib/generate.js` 的 `LANGUAGE_HEADINGS` + `lib/config.js` 的 `oneOf` 白名单（撰写侧的 `language` 分支也要覆盖） |
| 接真正的视觉推理 | 提供一个能把本地图片变成**附件引用**的 provider，然后实现 `lib/vision.js` 的 `describeFigureWithModel`（`VISION_ATTACHMENT_REQUIRED` 那个分支就是留给它的） |
