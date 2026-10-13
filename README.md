# CourseNotes

**课程资料 → 结构清晰、知识完整、可溯源的学习笔记，直接跑在 DeepSeek Harness 里。**
**Turn course materials into structured, knowledge-complete, source-traceable study notes — inside DeepSeek Harness.**

> 📖 **本 README 为中英对照**：每个小节都同时给出中文与 English（标题、表格、正文并列），无需切换文件。
> **This README is bilingual throughout** — every section carries both Chinese and English, in paired headings, tables and paragraphs. No separate language file to switch to.

CourseNotes 是 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）的原生 Cordis 插件。把课件文件夹（或若干文件）与一个输出目录交给它，它会走完整条流水线；笔记里每个知识点都能追回到课件的具体页码 / 幻灯片号 / 段落号。

CourseNotes is a native Cordis plugin for DeepSeek Harness. Point it at a folder of course material and an output directory and it runs the whole pipeline; every knowledge point stays traceable to the page, slide or paragraph it came from.

它**不是**摘要工具。设计原则：**完整性优先**（不为缩短篇幅丢章节）、**讲解要有深度**（不是把幻灯片换个排版）、**双语落在关键字词**（中文详解为主干 + 术语行内中英对照 + 章末术语表，不做整段英文翻译）、**不编造**（无法识别的图片、无法访问的文献、解析失败的文件全部显式标注）、**完成度要可判定**（写完文件 ≠ 写完笔记）。

It is deliberately **not** a summariser: completeness over brevity, substantive explanations rather than re-arranged slides, **bilingualism at the keyword level** (Chinese prose + inline English glosses + a term table per chapter, no duplicated full-length translation), nothing invented, and **a completion state you can check** — writing the files is not the same as finishing the notes.

> **v1.1.0 新增 / What changed in 1.1.0**
>
> | 变更 / Change | 说明 / Detail |
> | --- | --- |
> | **分块撰写** Chunked authoring | 章节按知识点分块调用模型，长章节不再因固定字符截断而静默丢失后面的知识点；块级校验 + 只重写失败知识点的局部补全 [→](#处理流水线--pipeline) |
> | **真正的 RAG** Evidence-backed generation | 检索到的**正文片段**（而非只有 URL）进入提示词，并建立「知识点 ↔ 证据」映射与可引用 URL 白名单 [→](#覆盖率与质量怎么读--reading-coverage-and-quality) |
> | **完成状态** Completion state | `verified` / `notes_authored` / `scaffold_created` / `partial` / `parsed` / `failed`，由实测数据决定，不靠“文件写成功了”推断 |
> | **多维质量检查** Multi-dimensional quality | 结构 / 内容 / 双语 / 公式 / 引用有效性分别统计，覆盖率为 0 时不再只有一句“未覆盖” |
> | **沙箱边界加固** Sandbox integrity | Harness 模式下所有写入（含二进制图片）只走 `ctx.fs`；被拒绝时**不再**回落到 `node:fs` 重试 |
> | **报告一致性** Report consistency | 所有报告由同一份最终状态生成，并有守门测试比对 JSON 与 Markdown 的数字 |
> | **自动化优先** Auto mode | `mode: "auto"`（默认）在没有模型时明确降级并说明原因，而不是留下 TODO 让人手填 |

---

## 目录 / Contents

[它能做什么](#它能做什么--features) · [依赖](#依赖--requirements) · [安装](#安装--installation) · [用法](#用法--usage) · [工具](#四个工具--tools) · [流水线](#处理流水线--pipeline) · [覆盖率与质量](#覆盖率与质量怎么读--reading-coverage-and-quality) · [双语规范](#双语规范--bilingual-convention) · [配置](#配置--configuration) · [离线 CLI](#离线-cli--offline-cli) · [已知限制](#已知限制--known-limitations) · [排障](#排障--troubleshooting) · [开发与测试](#开发与测试--development) · [设计原则](#设计原则--design-principles) · [License](#license)

---

## 它能做什么 / Features

| 能力 / Capability | 说明 / Detail |
| --- | --- |
| **多格式解析** Multi-format parsing | `.pdf` `.pptx` `.docx` `.md` `.markdown` `.txt` `.rst` `.tex` `.csv` `.json` `.html` `.ipynb` `.srt` `.vtt`，以及图片 `.png` `.jpg` `.jpeg` `.webp` `.gif` `.bmp` `.tif` |
| **结构化提取** Structural extraction | 标题层级、段落、列表、表格、公式候选、图片、PPT 备注、Word 内嵌图、PDF 扫描页 · headings, paragraphs, lists, tables, formula candidates, figures, speaker notes, Word inline pictures, scanned-page detection |
| **来源定位** Source tracing | 每个知识点带 `PDF 页码 / 幻灯片号 / 段落号 / 行号` · every point carries a locator (`page 12`、`slide 4`、`paragraph 8`、`line 30`) |
| **知识组织** Organisation | 章节 → 小节 → 知识点；跨文件同名章节自动合并；识别依赖关系 · chapters → sections → points; same-titled chapters merged across files; prerequisites detected |
| **术语表** Term tables | 识别 `中文（English Full Name, ABBR）`、`English (中文)`、`English (ABBR)` 三种写法 |
| **网络补充 + 证据映射** Retrieval + evidence | 通过 `ctx.web` 检索并抓取权威来源，按官方 / 高校 / 论文 / 社区分级；抓到的**正文片段**按知识点绑定、去重、限长后进入模型上下文 · sources graded, page excerpts bound to the knowledge points they answer |
| **分块撰写** Chunked authoring | 章节 → 知识点分块 → 逐块调用 `ctx.llm` → 块级校验 → 局部补全 → 合并回骨架；超大知识点继续拆子块并保留上下文连续性 |
| **覆盖率 + 质量检查** Coverage + quality | 覆盖率（内容是否出现）+ 结构 / 内容 / 双语 / 公式 / 引用有效性五维检查，并列出具体缺口 |
| **完成状态** Completion state | 明确区分「解析完成」「骨架完成」「正文写完」「通过检查」「部分完成」「失败」，写文件不再被当作成功 |
| **失败可见** Visible failures | 解析不了的文件、无法识别的图片、检索失败、写入被拒绝，一律写进报告 |

## 依赖 / Requirements

- **DeepSeek Harness**（本插件是 Host 插件，注册 Agent 工具）· the plugin is a Host plugin that registers agent tools。
- 解析 PDF / PPTX / DOCX / 图片需要一个带 `pymupdf`、`python-pptx`、`python-docx`、`Pillow` 的 **Python**。
- **自动撰写正文**需要一个可用的模型（`ctx.llm` + 会话默认模型，或在配置里写 `llmProvider` / `llmModel`）。
- **外部检索**需要一个已注册的 web provider；没有时检索阶段会明确说明「未执行」而不是假装有引用。

> **好消息**：DSH 自带的 Python 运行时**已经装好这四个库**，插件会自动找到它——包括 Host 进程没有 `DSH_HOME` 环境变量的常见情况。用别的 Python 就在配置里写 `pythonPath`，或设 `COURSE_NOTES_PYTHON` / `DSH_PYTHON` / `PYTHON`。跑 `probe_course_notes` 可以看到完整的探测轨迹与原因。
>
> **Markdown、纯文本、HTML、CSV、LaTeX、Notebook 完全不需要 Python**，由插件原生解析。
>
> DSH ships its own Python runtime with all four libraries pre-installed, and CourseNotes finds it automatically — including when the Host process has no `DSH_HOME` variable set. Markdown, plain text, HTML, CSV, LaTeX and notebooks need no Python at all.

> **关于沙箱 / About the sandbox**：在 Harness 内，插件的**所有**输出写入都走 `ctx.fs`，因此受会话的沙箱策略约束、并出现在 workspace change 记录里。输出目录不可写时，插件会在**同一套权限**下寻找一个可写的备选目录（先探测再写入），并在报告中写明迁移；找不到就报错停止，**不会**改用原生 `node:fs` 绕过权限。离线 CLI 没有沙箱，直接写本地文件。
>
> Inside Harness every output write goes through `ctx.fs`, so the session's sandbox policy decides. A denied output directory is retried into a directory the *same* policy permits, and the relocation is reported; if none is permitted the run stops and says so. The plugin never falls back to native `node:fs` to escape a refusal.

## 安装 / Installation

**1. 安装 bundle / Install the bundle** —— 用 Plugin Manager，`target` 指向本目录的绝对路径（一次安装，全 profile 生效）：

```
plugin_manager { action: "install_bundle", target: "<绝对路径>/course-notes" }
```

**2. 重启 DeepSeek Harness / Restart the app** —— Node 按 URL 缓存 ES 模块，**运行中的 Host 进程无法加载新安装的插件模块**。重启一次，四个工具才生效。

**3. 验证 / Verify** —— 调用 `probe_course_notes`：它会报告解析后端（含完整探测轨迹）、可用服务（`tools` / `web` / `llm` / `fs`）、生效配置，以及给定输入路径是否可解析。

## 用法 / Usage

### 最短路径：一句话让 Agent 全自动完成 / One sentence, fully automatic

```
请使用 CourseNotes，把 D:\课程\计算机网络 中的课件整理成详细的中英双语笔记，输出到 D:\notes\计算机网络。
```

Agent 会调用 `generate_course_notes`，默认 `mode: "auto"`，因此**不需要你手工逐个填 TODO**：

1. 检查输入 → 2. 解析课件 → 3. 建立知识点清单 → 4. 检索并建立证据映射 →
5. **分块撰写正文**（块级校验 + 局部补全）→ 6. 自动检查覆盖率与质量 → 7. 保存文件 → 8. 报告完成状态

```jsonc
generate_course_notes({
  "input_paths": ["D:\\课程\\计算机网络"],
  "output_dir": "D:\\notes\\计算机网络",
  "language": "bilingual",
  "detail_level": "comprehensive",
  "mode": "auto",              // 默认值：结构 + 正文一次做完
  "enable_web_search": true,
  "split_by_chapter": true,
  "coverage_check": true
})
```

返回值里第一行就是**完成状态**：只有 `verified` 才表示「全部知识点已撰写且通过结构/内容/双语/公式/引用检查」。其余状态（`notes_authored`、`scaffold_created`、`partial`、`parsed`、`failed`）都会附上**具体原因**与未完成的知识点 ID。

The returned report leads with an explicit **completion state**. `verified` is the only state meaning every
knowledge point was written and passed the structure/content/bilingual/formula/citation checks; every other
state names the concrete reason and the knowledge points that are still outstanding.

### 两种模式 / Two modes

| `mode` | 行为 / Behaviour | 适用 / When |
| --- | --- | --- |
| `auto`（默认 default） | 先建结构，再**分块调用 `ctx.llm` 撰写每个知识点**；模型不可用时**明确降级**为骨架并说明原因 | 想让插件一口气出完整笔记 |
| `scaffold` | 只建结构、检索证据映射与撰写简报，正文保留 `COURSENOTES:TODO` 标记 | 想自己/别的 Agent 用简报撰写；或只想先看结构 |

`author_with_llm` 仍被接受，作为 `mode` 的旧写法别名（`true` → `auto`，`false` → `scaffold`）。

### 无模型时的行为 / When no model is available

`mode: "auto"` 但没有可解析的模型（没有 `ctx.llm`，或没有会话默认模型 / `llmProvider`+`llmModel`）时，
插件**不会伪造正文**，而是：

1. 把完成状态置为 `scaffold_created`；
2. 在 `run-report.md` 与工具返回的简报里写明跳过原因（例如 `ctx.llm 不可用`）；
3. 照常输出撰写简报，供 Agent 或人工补全。

### 产出物 / Output layout

```
<output_dir>/
├── README.md                          课程总目录 + 术语表 + 覆盖率/质量摘要 + 完成状态
├── Chapter_01_xxx.md                  每章一个文件（split_by_chapter: false 时合并为一个）
├── coverage-report.md                 覆盖率报告 + 多维质量检查 + Markdown 结构问题
├── run-report.md / run-report.json    处理报告（完成状态、证据映射、多模态、错误、已知限制）
├── knowledge.json                     完整知识点清单（机器可读，带稳定 ID 与定位）
├── assets/                            课件中提取的图片（笔记用相对路径引用）
└── .coursenotes/
    ├── note-brief.md                  撰写简报
    ├── evidence.json                  知识点 ↔ 检索证据映射（含可引用 URL 白名单）
    ├── vision-results.json            图表视觉任务与解读结果
    └── <run-id>/                      documents.json、retrieval.json、authoring.json 等阶段产物
```

## 四个工具 / Tools

| 工具 / Tool | 作用 / Purpose |
| --- | --- |
| `generate_course_notes` | 主入口：扫描 → 解析 → 知识点提取 → 网络检索与证据映射 → 分块撰写 → 覆盖率/质量检查 → 落盘。支持 `stages`、`mode`、`chunk_chars`、`llm_max_attempts` 与逐次覆盖配置 |
| `check_notes_coverage` | 独立复核：对比 `knowledge.json` 与笔记正文，输出覆盖率、**多维质量**（结构/内容/双语/公式/引用）与 Markdown 结构问题（围栏、`$$` 配对、相对链接、TODO 数） |
| `probe_course_notes` | 环境自检：Python 后端、`ctx.web`、`ctx.llm`、会话默认模型、`ctx.fs` 沙箱、生效配置、输入可解析性 |
| `read_course_notes_report` | 读取既往运行的 `run-report.md` / `coverage-report.md` / `knowledge.json` / `note-brief.md` |

### `generate_course_notes` 参数 / Parameters

| 参数 / Parameter | 类型 / Type | 默认 / Default | 含义 / Meaning |
| --- | --- | --- | --- |
| `input_paths` | string[] | **必填 required** | 文件、文件夹或混合；目录递归扫描，跳过 `node_modules` / `.git` / `__pycache__` / `.venv` / `dist` / `build` / `~$…` |
| `output_dir` | string | `<cwd>/course-notes-output` | 输出目录 |
| `course_name` | string | 自动推断 | 覆盖课程名 |
| `language` | `bilingual` \| `zh` \| `en` | `bilingual` | 输出语言 |
| `detail_level` | `concise` \| `standard` \| `comprehensive` | `comprehensive` | 讲解深度（同时影响分块提示词的篇幅要求） |
| `mode` | `auto` \| `scaffold` | `auto` | 是否用 `ctx.llm` 撰写正文 |
| `enable_web_search` | boolean | `true` | 是否用 `ctx.web` 补充资料（provider 未注册时报告会区分“配置关闭”与“服务不可用”） |
| `enable_ocr` | boolean | `true` | 把纯图片内容保留为视觉任务 |
| `include_examples` | boolean | `true` | 生成「实例」小节与例题检索 |
| `include_exercises` | boolean | `true` | 生成自测题与易错点小节 |
| `split_by_chapter` | boolean | `true` | 每章一个文件，或合并为单文件（单文件模式下**每一章**都会被撰写） |
| `coverage_check` | boolean | `true` | 结束时跑覆盖率与质量检查 |
| `file_order` | `natural` \| `name` \| `explicit` \| `mtime` | `natural` | 文件顺序（`lecture2` 在 `lecture10` 前） |
| `explicit_order` | string[] | `[]` | `file_order: "explicit"` 时的文件名顺序 |
| `stages` | string[] | 全部 | `scan` `parse` `knowledge` `retrieve` `generate` `check` `output`；**未列出的阶段不会执行**，输入缺失的阶段会被记为 skipped |
| `max_searches` / `max_fetches` | integer | 12 / 8 | 检索预算 |
| `brief_char_budget` | integer | 60000 | 返回简报的字符预算 |
| `chunk_chars` | integer | `0`（按模型上下文推导） | 单块提示词字符预算；章节按此预算切分成多个块 |
| `max_points_per_chunk` | integer | 12 | 单块最多包含的知识点数 |
| `llm_max_attempts` | integer | 3 | 单次模型调用失败后的最多尝试次数 |
| `author_with_llm` | boolean | — | **已弃用**，等价于 `mode`（`true`→`auto`，`false`→`scaffold`） |

## 处理流水线 / Pipeline

```
阶段 A 文件扫描   识别格式、确认可读、排序、列出旧格式与不支持格式
阶段 B 内容解析   文本/标题/列表/表格/公式候选/图片/扫描页；保留来源定位；建立统一文档模型
阶段 C 知识点提取 章节与小节重建 → 知识点 → 术语表 → 公式清单 → 知识点依赖关系
阶段 D 检索+证据  按优先级生成查询 → 检索 → 抓取高可信来源 → 把正文片段绑定到知识点、建立可引用 URL 白名单
       视觉任务   图表分类（时序/架构/流程图/曲线/统计图/截图/扫描页）+ 模型视觉能力检测 + 结果回填
阶段 E 生成骨架   确定性渲染章节骨架（含 COURSENOTES 标记与小节占位）
       分块撰写   章节 → 知识块 → 逐块调用模型 → 块级校验 → 只补写失败的知识点 → 合并回骨架
阶段 F 质量检查   覆盖率（五维）+ Markdown 结构（围栏、$$ 配对、相对链接、TODO 数）
阶段 G 输出       笔记 + README + knowledge.json + coverage-report.md + run-report.md/json + 所有报告同源生成
```

```
Stage A  scan       classify files, check readability, order them, report legacy/unsupported formats
Stage B  parse      text/headings/lists/tables/formulas/figures + source locators -> one document model
Stage C  knowledge  chapters and sections -> knowledge points -> term table -> formulas -> dependencies
Stage D  retrieve   prioritised queries -> search -> fetch trustworthy pages -> bind excerpts to points
         evidence   per-point lecture + retrieved evidence, citable-URL allowlist
         vision     figure classification + model image capability + interpretation ingestion
Stage E  scaffold   deterministic chapter skeleton with COURSENOTES markers
         author     chapter -> chunks -> model call per chunk -> verify -> repair only the failures -> merge
Stage F  check      coverage (5 dimensions) + Markdown structure
Stage G  output     notes, README, knowledge.json, coverage report, run report — all from one final state
```

### 分块撰写是怎么工作的 / How chunked authoring works

v1.0 用**整章一次调用**，并在提示词里按固定字符数截断草稿——超出的知识点**根本没进模型上下文**，而报告仍说这一章已撰写。v1.1 换成：

1. **分块**（`lib/chunk.js`）：按知识点数量、内容长度与提示词预算把章节切成若干块。**块不会切断知识点**；单个知识点本身超预算时，它会被拆成**同一个知识点的多个连续子块**（提示词里注明「第 N 部分，共 M 部分，接着写」），而不是被丢掉。预算可由 `chunk_chars` 指定，默认按模型上下文窗口推导（窗口的 45%，下限 8000、上限 60000 字符）。
2. **生成**：每块只带自己负责的知识点、原文、公式、图表与**该知识点的检索证据**。
3. **块级校验**（`verifyChunk`）：检查知识点 ID 是否齐全、长度、是否残留 TODO、中英文讲解是否都在、公式是否保留、图表是否被解读、**引用是否只用了检索白名单里的 URL**。
4. **局部补全**：只把失败的知识点再要一次（并说明上次哪里不合格），而不是重写整章——好知识点不会被重新生成拖坏。
5. **合并**（`mergeAuthoredIntoScaffold`）：骨架是**结构的唯一来源**（标记、标题层级、顺序、公式清单、图表清单、术语表、参考资料都不由模型决定），只替换知识点小节之间的正文。模型没写出来的知识点保留骨架与 TODO 标记，因此「没写完」在结果里是看得见的。
6. **章节级小节**（概述、学习目标、本章总结、重点难点、自测题）由每章**一次有界调用**撰写；写完后标记会被移除，所以 `verified` 的笔记里没有任何 `COURSENOTES` 模板痕迹。

整条链路上每一步都是有界的：单次调用有最大尝试次数与退避，单个知识点最多一次局部补全，没有无上限的重试循环。过程中会统计调用次数、重试、失败、提示词/生成字符数、token 与耗时，并写入报告。

**Why it matters:** the later knowledge points of a long chapter can no longer be silently dropped, and a model
that misses one point costs one small repair call instead of a regenerated chapter.

## 覆盖率与质量怎么读 / Reading coverage and quality

覆盖率是**内部完整性指标**，只回答「提取到的知识点是否真的写进了笔记」，**不代表讲解正确性**。Coverage is an internal completeness indicator and says nothing about whether the explanations are correct.

关键设计：笔记里作为「材料原文依据」嵌入的代码块**不计入**统计，只有正文散文计入——否则每个知识点都会因为原文被复制而自动「覆盖」。Source excerpts embedded as evidence sit inside code fences and are **excluded** from the measurement.

### 覆盖率 / Coverage

| 指标 / Metric | 含义 / Meaning |
| --- | --- |
| 结构小节 / keyPointsWithSections | 骨架完整度：每个知识点是否都有自己的小节 |
| 覆盖率 / ratio | 内容完整度：正文是否真的写了这个知识点 |
| 剩余 TODO / remaining markers | 还有多少位置等待撰写 |

所以刚生成的骨架是「结构 100% / 覆盖率 0%」——这是**正确且预期**的结果。A freshly generated skeleton is honestly reported as `structure 100% / content 0%`.

### 多维质量 / Multi-dimensional quality

`coverage-report.md` 的后半部分是五维检查，每一维都从笔记文本本身量出来：

| 维度 / Dimension | 问题 / Question |
| --- | --- |
| 结构覆盖率 / Structure | 每个知识点是否有自己的小节 |
| 内容覆盖率 / Content | 小节里是否有实质正文（而不是只有骨架与原文引用） |
| 双语完整率 / Bilingual | 中文与英文讲解是否都达到最低篇幅 |
| 公式覆盖率 / Formula | 重要公式是否**渲染出来**并且**有上下文解释**（只是贴上去不算解释） |
| 引用有效性 / Citation | 引用的 URL 是否都来自本次真实检索结果 |

再加一个**全维度通过率**（`all-dimensions-complete`）：只有五维全过的知识点才计入。这个数字才是「这篇笔记写完了」的保守指标。

维度检查也可以在有模型时增加**语义完整性**判断，但报告里会把它明确标为「模型判断、未经人工验证」，**不会**换算成准确率。

### 完成状态 / Completion state

| 状态 / State | 含义 / Meaning |
| --- | --- |
| `parsed` | 材料已解析，但未建立知识结构（例如 `stages` 只跑到 `knowledge`） |
| `scaffold_created` | 骨架已生成，正文尚未撰写（仍保留 TODO） |
| `notes_authored` | 全部知识点已撰写，但未执行质量检查 |
| `verified` | **全部知识点已撰写并通过五维检查**（唯一表示“完成”的状态） |
| `partial` | 部分知识点已撰写，或有文件写入失败，或仍有 TODO |
| `failed` | 没有产出任何可用笔记文件 |

`verified` 之外的状态都会在 `run-report.md` 与工具返回值里给出**具体原因**（例如 `全维度通过 17/21，仍有 3 处 COURSENOTES:TODO 未撰写`）。

## 双语规范 / Bilingual convention

**双语落在关键字词层级**：中文详解为主干，英文术语在首次出现处行内标注，章末附术语表。不做重复的整段英文翻译。Bilingualism is applied at the **keyword** level.

| 层次 / Layer | 形式 / Form | 示例 / Example |
| --- | --- | --- |
| 正文行内标注 Inline gloss | `中文术语（English term）` | 集合 $S$ 是**基本可行集**（basic feasible set） |
| 章末术语表 Term table | 表格，**以中文名为主键** | `| 铰链损失 | hinge loss | — | ... |` |

术语表列：**中文术语 / English Full Name / Abbreviation / 简要解释**，首列必须是中文术语（英文名只作第二列）。Terms are keyed by the Chinese name; the English name is the second column.

每个知识点的结构 / Per-point structure：

```markdown
### K001 · 1.2 知识点名称 / English Name

**类型 / Kind**: …　**来源 / Source**: 课件.pptx · slide 12

**术语定义 / Definition**
- 中文术语（English Full Name, ABBR）

**材料原文依据 / Material evidence**      代码块，不计入覆盖率

#### 中文讲解 / Chinese Explanation        中文详解，术语行内中英对照
#### 英文讲解 / English Explanation        同样的技术内容
#### 数学原理 / Mathematical Principles    （公式类知识点）
#### 实例 / Examples                      （适用时）
#### 易错点 / Common Misconceptions       （适用时）
**来源 / References** — [课件内容] 文件 · 页码 / 幻灯片号；[外部资料] 真实链接
```

小节标题带**稳定知识点 ID**（`K001`），因为撰写阶段按 ID 合并、覆盖率检查按 ID 切片——只靠位置编号时，
模型重排小节会让内容绑到错误的知识点上。

来源分三类标注：`[课件内容]` / `[外部资料]` / `[推导说明]`。Provenance tags: `[课件内容]` material, `[外部资料]` retrieved, `[推导说明]` derivation note.

## 配置 / Configuration

在 `cordis.patch.yml`（profile 补丁层，优先级高于 bundle 补丁，升级不丢）里可以改任何配置。Edit your profile's `cordis.patch.yml` (a higher-priority layer than the bundle patch, so it survives upgrades):

```yaml
- id: course-notes
  name: course-notes
  config:
    outputDir: ''            # 空 = <会话 cwd>/course-notes-output
    workDir: ''              # 空 = <outputDir>/.coursenotes
    language: bilingual      # bilingual | zh | en
    detailLevel: comprehensive
    mode: auto               # auto | scaffold
    enableWebSearch: true
    maxSearches: 12
    maxFetches: 8
    enableOcr: true
    includeExamples: true
    includeExercises: true
    splitByChapter: true
    coverageCheck: true
    fileOrder: natural
    maxUnitChars: 4000
    briefCharBudget: 60000
    maxFileBytes: 209715200   # 单个输入文件上限 200 MiB
    pythonPath: ''            # 留空 = 自动探测
    extraSearchKeywords: []
    chapterHeadingLevel: 1
    logLevel: info            # silent | error | warn | info | debug

    # 分块撰写 / chunked authoring
    chunkChars: 0             # 0 = 按模型上下文窗口推导；也可写固定值（如 28000）
    maxPointsPerChunk: 12
    chunkStrategy: balanced   # balanced | per-point
    llmMaxAttempts: 3
    llmRetryBackoffMs: 400

    # 检索证据 / retrieval evidence
    evidencePerPoint: 4       # 每个知识点最多附加几条外部证据
    evidenceCharBudget: 24000 # 全部外部证据的总字符预算
    evidenceExcerptChars: 900 # 单条证据保留多少字符
```

工具调用参数会覆盖以上默认值；未设置的字段回落到上表。Tool-call arguments override these.

## 离线 CLI / Offline CLI

同一套流水线可以在没有 Harness 的环境下跑——适合 CI、批量任务，或单纯试用解析器。The same pipeline without a Harness host:

```powershell
node cli.js "D:\课程\计算机网络" --out D:\notes\计网
node cli.js --probe                                    # 环境自检
node cli.js "D:\课件" --out out --json run.json         # 额外输出机器可读报告
node cli.js "D:\课件" --out out --language zh --detail concise --single-file
node cli.js "D:\课件" --out out --order explicit --input ch2.pdf --input ch1.pdf
node cli.js "D:\课件" --out out --stages scan,parse    # 只跑到解析，看结构
```

离线 CLI **没有** `ctx.web`（除非给 `--web-endpoint`）也**没有** `ctx.llm`，因此 `--mode auto` 会明确降级为 `scaffold`
并在 stderr 说明原因——CLI 负责流水线里确定性的那一半，正文由之后的 Agent / 人工按简报补全。

Offline mode has no `ctx.web` (unless `--web-endpoint` points at a JSON endpoint answering
`{op:"search", query}` / `{op:"fetch", url}`) and no `ctx.llm`, so `--mode auto` degrades to `scaffold`
with a stated reason. The CLI owns the deterministic half of the pipeline.

退出码：`0` = 产出了可用笔记；`1` = 完成状态为 `failed` 或存在错误；`2` = 参数错误。
Exit status: `0` usable notes, `1` failed run or errors, `2` bad arguments.

## 示例运行 / Sample run

- [`docs/sample-run/`](docs/sample-run/) —— **真实且可复现**的 1.1.0 输出（骨架模式，从合成夹具生成）。
  它的完成状态是 `scaffold_created`，覆盖率按定义就是 0%，因为正文没有被撰写；
  [`docs/sample-run.md`](docs/sample-run.md) 逐项解释了每个文件与每个数字的含义。
- [`docs/references/`](docs/references/) —— 人工精选的“**写完之后长什么样**”的章节样例（双语讲解、公式推导、
  图表解读、来源标注），**不是**运行产物。

看这两个目录的差别，就能理解 `scaffold_created` 与 `verified` 的区别。

## 排障 / Troubleshooting

| 症状 / Symptom | 原因与处理 / Cause and fix |
| --- | --- |
| `PDF/PPTX/DOCX/图片 解析未执行` | 没有找到可用的 Python。跑 `probe_course_notes` 看完整探测轨迹（每个候选解释器失败的原因）；在配置里写 `pythonPath`，或设 `COURSE_NOTES_PYTHON`。Markdown/文本类不受影响。 |
| 完成状态是 `scaffold_created`，笔记里全是 `COURSENOTES:TODO` | `mode` 是 `scaffold`，或 `mode: auto` 但没有模型。看 `run-report.md` 的「分块撰写」小节与 `authoring-skipped` 警告里的原因（`ctx.llm 不可用` / 无法确定 provider+model）。 |
| 完成状态是 `partial` | 报告会列出**未撰写或未通过检查的知识点 ID**。常见原因：模型输出被截断（调小 `chunk_chars`）、模型漏写知识点（局部补全会重试一次）、引用不是来自检索白名单（报告里会列出非法 URL）。 |
| `外部检索未执行：配置中已关闭（enableWebSearch=false）` 与 `ctx.web 不可用` 分不清 | 1.1.0 起报告会把两者分开写：`配置开关` 与 `Harness web 服务`。前者是你关的，后者是部署没注册 provider。 |
| 覆盖率总是很低 | 覆盖率只统计**正文**：骨架、原文引用块、标题都不计入。`scaffold_created` 状态下 0% 是预期值。用 `check_notes_coverage` 看五维质量，定位到具体缺口。 |
| 图表一直是「尚未解读」 | 见 [已知限制](#已知限制--known-limitations) 第 2 条：插件的模型通道不能直接接收图片输入。让具备视觉能力的 Agent 读图后把结果写进 `.coursenotes/vision-results.json`（格式见同目录 `vision-results.json` 的 `pending` 字段），再重跑。 |
| 写入被拒绝 / 输出目录被迁移 | 报告里搜 `FS_SANDBOX_DENIED` 与 `output-relocated`。插件不会绕过沙箱：它要么在**同一套权限**下写到一个可写目录并报告，要么失败停止。 |
| `value is not lossless JSON` | 工具返回体里出现了 `undefined`。插件用 `jsonSafe()` 在边界剥离，若仍出现请附上复现步骤报 issue（契约测试覆盖这一点）。 |
| 改了插件代码但行为没变 | Node ESM 按 URL 缓存，**同一 Host 进程内无法替换已加载的模块**。重启 DSH。 |


## 已知限制 / Known limitations

这一节只列**当前实现确实存在**的限制。没有“计划中”当成“已完成”的条目。

1. **旧版 Office 格式需要转换** —— `.ppt` / `.doc` / `.wps` / `.dps` / `.pages` / `.key` / `.odt` / `.odp` 无法直接解析，插件会明确列出并给出转换建议（另存为 `.pptx` / `.docx` 或导出 PDF），**不会**静默跳过。*Legacy Office formats need converting; they are listed, never silently skipped.*
2. **插件自身不能把图片送进模型** —— 这是**能力边界**，不是待办：`ctx.llm` 只接受由附件服务生成的持久附件引用，插件没有这个 seam，因此**不会**假装看过图片。插件做的是：识别图表属于哪一类（时序/架构/流程图/曲线/统计图/截图/扫描页）、生成对应的**提问**、检测当前模型是否声明支持图像输入，并把外部写回的解读（`.coursenotes/vision-results.json`）合并进知识点与笔记。**图片的实际阅读由具备视觉能力的 Agent 或人工完成**；未解读的图表在笔记里明确标注为「尚未解读」，覆盖率与质量报告也不会把它算作完成。*The plugin cannot feed an image to a model, and does not pretend to. It classifies figures, asks the right question, detects image capability, and ingests external interpretations. Un-interpreted figures are marked, never counted as done.*
3. **扫描版 PDF** —— 无文本层的页面会被识别、整页渲染成图片交给视觉流程，并记录 `page-without-text-layer` 警告。*Scanned pages are rendered page-by-page and reported.*
4. **公式识别是候选而非解析** —— 数学字体与符号密度标出候选，LaTeX 化与推导说明由撰写阶段完成；复杂排版可能漏检。另：某些 PDF 的数学字体映射有缺陷（`∈` 到达时已是替换字符），此时公式必须从渲染出的页面图像读取，仓库里的 `tests/export_pdf_pages.py` 正是为此。*Formula detection is heuristic; when a PDF's maths glyphs are mangled, formulas must be read from rendered page images.*
5. **知识点切分基于结构信号** —— 标题层级、编号、列表项、篇幅、术语/公式特征。散文型材料（Word 讲义、中文课件）表现良好；**公式密集的英文讲义可能切得过碎**，此时知识点数相对页数异常偏高，应改为逐页精读并手工建立基线。*Splitting is structural: good for prose decks, prone to fragmentation on formula-heavy English slides.*
6. **覆盖率与质量分都是文本指标** —— 等义改写可能被判为「部分覆盖」，属保守估计；五维检查衡量的是**内容是否出现**，不是**是否正确**。可选的语言模型语义检查会被标为「未经人工验证」，不换算成准确率。*Coverage and quality are textual measurements — completeness, not correctness.*
7. **网络检索依赖 Harness 的 web provider** —— 未注册 provider 时检索不执行，并在报告与笔记中明确标注；检索到的网页正文与课件一样被视为**不可信输入**（会被中和、不可作为指令执行），引用只能取白名单里的 URL，绝不生成看起来像有引用其实没有的内容。*Retrieval depends on a registered web provider, and retrieved page text is untrusted data.*
8. **写入受沙箱策略约束** —— Harness 模式下所有输出（含二进制图片）都经 `ctx.fs`。被拒绝时，插件会在**同一套权限**下探测一个可写目录（会话工作区内的 `course-notes-output`，其次 `.coursenotes-output`）：能写就改写到那里并报告迁移；**都不能写就报 `OUTPUT_DIR_UNAVAILABLE` 并返回 `ok: false`**，不会静默写别处、更不会回落 `node:fs`。工具返回值同时给出 `noteFiles`（**打算**产出的文件）与 `writtenNoteFiles`（**真的**落盘的文件），因此调用方不可能把不存在的笔记当成已产出。经文本 seam 写二进制时单文件上限由 `maxHarnessAssetBytes` 控制（默认 64 MiB，超出以 `FS_TOO_LARGE_LOCAL` 明确拒绝而不是截断）。*Writes obey the session sandbox. A refusal is retried into a permitted directory with the same seam and reported; if none is permitted the run reports `OUTPUT_DIR_UNAVAILABLE` and `ok: false`. `noteFiles` lists intended files, `writtenNoteFiles` lists what actually landed.*
9. **`chunk_strategy: per-point` 会增加调用次数** —— 默认的 `balanced` 会把多个知识点放进同一个块以减少调用；`per-point` 每块只放一个知识点，隔离性更好但成本更高。另外 `stages` 是真跳过的：未列出的阶段不执行，输入缺失的阶段会被记为 skipped 而不是悄悄跑完整流程。
10. **替换已加载的插件需要重启** —— Node ESM 按 URL 缓存，**同一 Host 进程内无法替换已加载的模块生成**。`install_bundle` / `remove_bundle` / `set_plugin` 都会报告 `application: applied`，但插件代码仍是旧的那一代（报错堆栈行号与磁盘文件不一致，可据此判断）。*Replacing a loaded plugin requires a restart.*
11. **工具返回值必须是无损 JSON** —— 注册表会校验返回体，任何成员为 `undefined` 时整次调用以 `value is not lossless JSON` 失败（而且是在工具**已经执行成功之后**）。插件用 `jsonSafe()` 在边界剥掉 `undefined`，并由契约测试守护。*Tool results must be lossless JSON.*
12. **验证边界要说清楚** —— 单元/端到端测试跑在**真实文件与真实 Python 后端**上（合成夹具，已在本机与 CI 通过）；分块撰写、检索证据、视觉回填这些涉及模型/网络的路径由 **Mock 服务**验证（可控、可注入失败），**尚未**在真实模型 + 真实 web provider 的 Harness 会话里做过端到端跑通。本节与 `docs/testing.md` 都会如实标注这一区分。*Tests use real files and the real Python backend; model- and network-dependent paths are verified with mocks and have not been run end-to-end against a real provider.*

## 开发与测试 / Development

```powershell
cd course-notes
python tests/make_fixtures.py              # 生成 PPTX/DOCX/PNG/MD/TXT 测试素材（需要 Python 3）
npm run fixtures                           # 同上，用 PATH 上的 python
npm run test:all                           # 全部套件（见下）
# 或逐个跑：
node tests/run-tests.mjs                   # 50 个单元 + 端到端测试（真实文件 + 真实 Python 后端）
node tests/v1.1.test.mjs                   # 51 个 v1.1 回归测试（沙箱、分块、证据、Mock 模型、质量、报告一致性）
node tests/plugin-contract.test.mjs        # 插件契约：导出形态、schema 子集、render、参数校验、卸载
node tests/discovery.test.mjs              # 解释器探测：模拟 host 进程没有 DSH_* 环境变量
node tests/check-report-consistency.mjs    # 示例运行的报告互相一致（重算覆盖率/质量再比对）
node tests/check-sample-reproducible.mjs   # 示例运行可复现（重跑两次逐文件比对）
node tests/check-yaml.mjs                  # bundle 补丁 / CI 工作流 / 插件身份一致性
npm run sample                             # 重新生成 docs/sample-run
```

> `npm run fixtures` 用的是 PATH 上的 `python`。如果那正好是 Python 2（Windows 上装了 Anaconda 2.7 时很常见），
> 脚本会以 `SyntaxError` 失败 —— 这不是插件的 bug。用 `py tests/make_fixtures.py`，或直接用 DSH 自带解释器：
> `& "$env:USERPROFILE\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\python\python.exe" tests/make_fixtures.py`。
>
> `npm run fixtures` uses whichever `python` is on PATH; if that is Python 2 (common on Windows with an old
> Anaconda), the script fails with a `SyntaxError`. Use `py`, or DSH's bundled interpreter, instead.

### 测试覆盖 / What is covered

- **真实文件、真实后端**：配置归一化、格式路由与自然排序、Markdown/HTML/CSV 解析、术语识别三种写法与反例、
  章节组装（含无顶层标题的幻灯片、跨文件同名章节合并）、选择题选项合并、检索计划与降级、检索查询的 LaTeX 清洗、
  不可信输入中和、覆盖率正负样例与跨章 id 冲突、图片相对链接可解析、端到端多格式解析、坏文件不影响其他文件、
  旧格式上报、报告完整性。
- **v1.1 回归**：Harness 写入被拒时**不回落** `node:fs`（含二进制往返、超限拒绝、资源复制被拒、整轮管道只走 seam）、
  60 个知识点的长章节完整分块与合并、超大知识点拆连续子块、块级校验与**只补写失败知识点**、章节级小节撰写、
  单文件模式覆盖每一章、证据绑定与不可信网页文本中和、引用白名单校验、图表分类与解读回填、
  多维质量维度、完成状态判定（`verified` 只给通过全部检查的运行）、`stages` 真跳过、输出目录被拒/被迁移的两条路径。
- **Mock 边界要说清**：分块撰写、检索证据、视觉回填这些需要模型/网络的路径用**可控的 Mock 服务**验证
  （可注入调用失败、漏写知识点、错误引用等），**尚未**在真实模型 + 真实 web provider 的 Harness 会话里端到端跑通。
  真实文件 + 真实 Python 后端的那部分是在本机与 CI 上实际执行过的。

CI（GitHub Actions）在 **Node 22.x 与 24.x** 两档运行同一套检查（含报告一致性与示例可复现），并在 Python 3.12 下装好解析依赖后生成夹具；全程不需要 API Key，也不访问网络。CI runs every suite on Node 22.x and 24.x with no API key and no network access.

测试分层与“什么被验证过、什么没有”的完整说明见 [`docs/testing.md`](docs/testing.md)。

### 工程结构 / Layout

```
course-notes/
├── index.js                       插件入口：4 个工具的定义与注册
├── cli.js                         离线 CLI（同样的流水线，不依赖 Harness）
├── cordis.patch.yml               bundle 补丁（插入插件行）
├── package.json
├── lib/
│   ├── config.js                  配置：默认值、归一化、参数覆盖
│   ├── scan.js                    阶段 A：文件扫描与格式分类
│   ├── python-bridge.js           Python 后端探测与调用（沙箱安全的子进程 I/O）
│   ├── parse/course_notes_parser.py   PDF/PPTX/DOCX/图片 → 结构化 JSON
│   ├── parsers.js                 Markdown/文本/HTML/CSV/Notebook/LaTeX/字幕
│   ├── document.js                统一文档模型（units / images / formulas / vision tasks）
│   ├── cleanup.js                 选择题选项合并
│   ├── knowledge.js               阶段 C：章节、知识点、术语表、依赖关系
│   ├── retrieve.js                阶段 D：检索计划、检索执行、来源可信度
│   ├── evidence.js                阶段 D2：知识点 ↔ 证据映射、摘录选择、引用校验
│   ├── vision.js                  多模态：图表分类、能力检测、解读回填
│   ├── generate.js                阶段 E：确定性骨架渲染与撰写简报
│   ├── chunk.js                   阶段 E2：知识点分块规划与分块提示词
│   ├── authoring.js               阶段 E3：分块调用、块级校验、局部补全、合并、章节级小节
│   ├── coverage.js                阶段 F：覆盖率 + 多维质量检查
│   ├── files.js                   工作区抽象（ctx.fs 或 node:fs）与资源发布
│   ├── pipeline.js                编排、完成状态判定与运行报告
│   └── util.js                    日志、路径、哈希、文本归一化、不可信输入处理
├── tests/                         测试与仓库级校验脚本
├── docs/
│   ├── architecture.md            设计说明与数据模型
│   ├── usage.md                   详细用法与参数表
│   ├── testing.md                 测试分层与验证边界
│   ├── sample-run/                可复现的骨架运行产物（含 SAMPLE-README.md 说明每个数字）
│   └── references/                人工精选的“已撰写章节”参考样例
└── locale/zh.json / en.json       插件卡片文案
```

设计说明见 [`docs/architecture.md`](docs/architecture.md)，详细参数见 [`docs/usage.md`](docs/usage.md)。See the linked docs for the data model and the full parameter guide.

## 设计原则 / Design principles

| # | 原则 / Principle | 说明 / Detail |
| --- | --- | --- |
| 1 | **知识完整性优先** Completeness first | 不为了缩短篇幅丢章节；大纲、知识点、公式、图表逐项落位。长章节按知识点分块，块不会切断知识点，超大的知识点拆连续子块 |
| 2 | **不编造** Nothing invented | 无法识别的图片、无法访问的文献、检索失败，全部显式标注；引用只能来自真实检索结果 |
| 3 | **课件为主，网络为辅** Material first, web second | 外部内容必须带真实链接与摘录，并区分 `[课件内容]` / `[外部资料]` / `[推导说明]` |
| 4 | **课件只读** Courseware is read-only | 除输出目录与过程目录外不修改任何原始文件（图片是从课件**读**出来另存到输出目录） |
| 5 | **不可信输入** Untrusted input | 课件与网页内容都会被中和处理（`neutralizeUntrustedText` / `neutraliseCostlyPromptText`），其中的指令不会被执行 |
| 6 | **失败要可见** Visible failures | 单个文件解析失败不影响其他文件，且一定出现在报告里；**完成状态**由实测数据决定，不靠「文件写成功了」推断 |
| 7 | **能力边界要说明** State the limits | 做不到的事（例如把图片直接送进模型）明确写成边界，不假装完成；Mock 验证与真实验证在文档里分开写 |
| 8 | **不硬编码密钥** No hardcoded keys | 只使用 Harness 已有的模型、检索与工具服务，不读也不存任何 API Key |
| 9 | **遵守沙箱** Respect the sandbox | Harness 内所有写入走 `ctx.fs`；被拒绝时不绕过、不替换实现，只报告或改到同样允许的目录 |
| 10 | **可配置可测试** Configurable and testable | 所有可调参数进入插件 `Config`，核心逻辑可脱离 Harness 运行与测试 |

---

## 快速开始（最短路径）/ Quick start

```powershell
git clone https://github.com/colinhe20-oss/dsh-course-notes.git
# 然后在 DeepSeek Harness 里：
#   plugin_manager { action: "install_bundle", target: "<克隆路径>/course-notes" }
# 重启一次应用，再调用 probe_course_notes 确认解析后端

# 或者用离线 CLI（不需要 Harness）：
node cli.js "D:\courses\networking" --out D:\notes\networking
```

## License

[MIT](LICENSE) © 2026 colinhe20-oss
