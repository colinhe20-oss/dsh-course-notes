# CourseNotes

**课程资料 → 结构清晰、知识完整、可溯源的学习笔记，直接跑在 DeepSeek Harness 里。**
**Turn course materials into structured, knowledge-complete, source-traceable study notes — inside DeepSeek Harness.**

CourseNotes 是 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）的原生 Cordis 插件。把课件文件夹（或若干文件）与一个输出目录交给它，它会走完整条流水线；笔记里每个知识点都能追回到课件的具体页码 / 幻灯片号 / 段落号。

CourseNotes is a native Cordis plugin for DeepSeek Harness. Point it at a folder of course material and an output directory and it runs the whole pipeline; every knowledge point stays traceable to the page, slide or paragraph it came from.

它**不是**摘要工具。设计原则：**完整性优先**（不为缩短篇幅丢章节）、**讲解要有深度**（不是把幻灯片换个排版）、**双语落在关键字词**（中文详解为主干 + 术语行内中英对照 + 章末术语表，不做整段英文翻译）、**不编造**（无法识别的图片、无法访问的文献、解析失败的文件全部显式标注）。

It is deliberately **not** a summariser: completeness over brevity, substantive explanations rather than re-arranged slides, **bilingualism at the keyword level** (Chinese prose + inline English glosses + a term table per chapter, no duplicated full-length translation), and nothing invented.

---

## 目录 / Contents

[它能做什么](#它能做什么--features) · [依赖](#依赖--requirements) · [安装](#安装--installation) · [用法](#用法--usage) · [工具](#四个工具--tools) · [流水线](#处理流水线--pipeline) · [覆盖率](#覆盖率怎么读--reading-coverage) · [双语规范](#双语规范--bilingual-convention) · [配置](#配置--configuration) · [离线 CLI](#离线-cli--offline-cli) · [已知限制](#已知限制--known-limitations) · [开发与测试](#开发与测试--development) · [设计原则](#设计原则--design-principles) · [License](#license)

---

## 它能做什么 / Features

| 能力 / Capability | 说明 / Detail |
| --- | --- |
| **多格式解析** Multi-format parsing | `.pdf` `.pptx` `.docx` `.md` `.markdown` `.txt` `.rst` `.tex` `.csv` `.json` `.html` `.ipynb` `.srt` `.vtt`，以及图片 `.png` `.jpg` `.jpeg` `.webp` `.gif` `.bmp` `.tif` |
| **结构化提取** Structural extraction | 标题层级、段落、列表、表格、公式候选、图片、PPT 备注、Word 内嵌图、PDF 扫描页 · headings, paragraphs, lists, tables, formula candidates, figures, speaker notes, Word inline pictures, scanned-page detection |
| **来源定位** Source tracing | 每个知识点带 `PDF 页码 / 幻灯片号 / 段落号 / 行号` · every point carries a locator (`page 12`、`slide 4`、`paragraph 8`、`line 30`) |
| **知识组织** Organisation | 章节 → 小节 → 知识点；跨文件同名章节自动合并；识别依赖关系 · chapters → sections → points; same-titled chapters merged across files; prerequisites detected |
| **术语表** Term tables | 识别 `中文（English Full Name, ABBR）`、`English (中文)`、`English (ABBR)` 三种写法 |
| **网络补充** Retrieval | 通过 `ctx.web` 检索并抓取权威来源，按官方 / 高校 / 论文 / 社区分级，只抓可信的 · sources graded and only trustworthy ones fetched |
| **覆盖率检查** Coverage | 对比「提取到的知识点」与「笔记里实际写了的知识点」，列出已覆盖 / 部分 / 未覆盖 · compares extracted points against what the notes actually say |
| **失败可见** Visible failures | 解析不了的文件、无法识别的图片、检索失败、写入被拒绝，一律写进报告 · all recorded in the run report |

## 依赖 / Requirements

- **DeepSeek Harness**（本插件是 Host 插件，注册 Agent 工具）· the plugin is a Host plugin that registers agent tools。
- 解析 PDF / PPTX / DOCX / 图片需要一个带 `pymupdf`、`python-pptx`、`python-docx`、`Pillow` 的 **Python**。

> **好消息**：DSH 自带的 Python 运行时**已经装好这四个库**，插件会自动找到它——包括 Host 进程没有 `DSH_HOME` 环境变量的常见情况。用别的 Python 就在配置里写 `pythonPath`，或设 `COURSE_NOTES_PYTHON` / `DSH_PYTHON` / `PYTHON`。跑 `probe_course_notes` 可以看到完整的探测轨迹与原因。
>
> **Markdown、纯文本、HTML、CSV、LaTeX、Notebook 完全不需要 Python**，由插件原生解析。
>
> DSH ships its own Python runtime with all four libraries pre-installed, and CourseNotes finds it automatically — including when the Host process has no `DSH_HOME` variable set. Markdown, plain text, HTML, CSV, LaTeX and notebooks need no Python at all.

## 安装 / Installation

**1. 安装 bundle / Install the bundle** —— 用 Plugin Manager，`target` 指向本目录的绝对路径（一次安装，全 profile 生效）：

```
plugin_manager { action: "install_bundle", target: "<绝对路径>/course-notes" }
```

**2. 重启 DeepSeek Harness / Restart the app** —— Node 按 URL 缓存 ES 模块，**运行中的 Host 进程无法加载新安装的插件模块**。重启一次，四个工具才生效。

**3. 验证 / Verify** —— 调用 `probe_course_notes`：它会报告解析后端（含完整探测轨迹）、可用服务（`tools` / `web` / `llm` / `fs`）、生效配置，以及给定输入路径是否可解析。

## 用法 / Usage

### 让 Agent 直接用（推荐）/ Let the agent drive

```
把 D:\课程\计算机网络 这个文件夹做成笔记，输出到 D:\notes\计网
```

```jsonc
generate_course_notes({
  "input_paths": ["D:\\课程\\计算机网络"],   // 文件夹、文件、或混合，可多个
  "output_dir": "D:\\notes\\计网",
  "language": "bilingual",
  "detail_level": "comprehensive",
  "enable_web_search": true,
  "split_by_chapter": true,
  "coverage_check": true
})
```

返回的是一个**撰写简报**（note-writing brief）：章节、每个知识点的原文依据与来源、术语表、公式清单、待解读图表、外部来源链接，以及需要补全的位置。Agent 据此把笔记写完，再用 `check_notes_coverage` 复核。

It returns a note-writing brief — the outline, each point with its source excerpt, the term table, formula candidates, figures to interpret, retrieval evidence and the positions to fill. The agent writes the prose; `check_notes_coverage` verifies nothing was skipped.

### 直接出完整笔记 / Produce finished notes in one call

```jsonc
generate_course_notes({
  "input_paths": ["D:\\课程\\计算机网络"],
  "output_dir": "D:\\notes\\计网",
  "author_with_llm": true      // 用会话模型逐章撰写正文
})
```

`author_with_llm: true` 时插件自己调用 `ctx.llm`，**逐章**生成——长课程不会因为一次超长补全而丢章节——生成完自动重跑覆盖率检查。With `author_with_llm: true` the plugin calls `ctx.llm` once **per chapter**, so a long course never depends on one oversized completion.

### 产出物 / Output layout

```
<output_dir>/
├── README.md                    课程总目录 + 术语表 + 覆盖率摘要
├── Chapter_01_xxx.md            每章一个文件（split_by_chapter: false 时合并为一个）
├── coverage-report.md           覆盖率报告 + Markdown 结构检查
├── run-report.md / run-report.json   处理报告（含已知限制、错误、警告）
├── knowledge.json               完整知识点清单（机器可读）
├── assets/                      课件中提取的图片（笔记用相对路径引用）
└── .coursenotes/<run-id>/       简报、documents.json、retrieval.json 等过程产物
```

## 四个工具 / Tools

| 工具 / Tool | 作用 / Purpose |
| --- | --- |
| `generate_course_notes` | 主入口：扫描 → 解析 → 知识点提取 → 网络检索 → 生成笔记 → 覆盖率检查 → 落盘。支持 `stages`、`author_with_llm` 与逐次覆盖配置 |
| `check_notes_coverage` | 独立复核：对比 `knowledge.json` 与笔记正文，输出覆盖率与 Markdown 结构问题（围栏、`$$` 配对、相对链接、TODO 数） |
| `probe_course_notes` | 环境自检：Python 后端、`ctx.web`、`ctx.llm`、会话默认模型、生效配置、输入可解析性 |
| `read_course_notes_report` | 读取既往运行的 `run-report.md` / `coverage-report.md` / `knowledge.json` / `note-brief.md` |

### `generate_course_notes` 参数 / Parameters

| 参数 / Parameter | 类型 / Type | 默认 / Default | 含义 / Meaning |
| --- | --- | --- | --- |
| `input_paths` | string[] | **必填 required** | 文件、文件夹或混合；目录递归扫描，跳过 `node_modules` / `.git` / `__pycache__` / `.venv` / `dist` / `build` / `~$…` |
| `output_dir` | string | `<cwd>/course-notes-output` | 输出目录 |
| `course_name` | string | 自动推断 | 覆盖课程名 |
| `language` | `bilingual` \| `zh` \| `en` | `bilingual` | 输出语言 |
| `detail_level` | `concise` \| `standard` \| `comprehensive` | `comprehensive` | 讲解深度 |
| `enable_web_search` | boolean | `true` | 是否用 `ctx.web` 补充资料 |
| `enable_ocr` | boolean | `true` | 把纯图片内容保留为视觉任务 |
| `include_examples` | boolean | `true` | 生成「实例」小节与例题检索 |
| `include_exercises` | boolean | `true` | 生成自测题与易错点小节 |
| `split_by_chapter` | boolean | `true` | 每章一个文件，或合并为单文件 |
| `coverage_check` | boolean | `true` | 结束时跑覆盖率检查 |
| `file_order` | `natural` \| `name` \| `explicit` \| `mtime` | `natural` | 文件顺序（`lecture2` 在 `lecture10` 前） |
| `explicit_order` | string[] | `[]` | `file_order: "explicit"` 时的文件名顺序 |
| `stages` | string[] | 全部 | `scan` `parse` `knowledge` `retrieve` `generate` `check` `output` |
| `max_searches` / `max_fetches` | integer | 12 / 8 | 检索预算 |
| `brief_char_budget` | integer | 60000 | 返回简报的字符预算 |
| `author_with_llm` | boolean | `false` | 用 `ctx.llm` 逐章撰写正文 |

## 处理流水线 / Pipeline

```
阶段 A 文件扫描   识别格式、确认可读、排序、列出旧格式与不支持格式
阶段 B 内容解析   文本/标题/列表/表格/公式候选/图片/扫描页；保留来源定位；建立统一文档模型
阶段 C 知识点提取 章节与小节重建 → 知识点 → 术语表 → 公式清单 → 知识点依赖关系
阶段 D 外部检索   按优先级生成查询（推导 > 术语全称 > 事实核查 > 背景 > 例题）→ 检索 → 抓取高可信来源
阶段 E 笔记生成   逐章 Markdown + 供撰写阶段消费的机器可读简报
阶段 F 质量检查   知识点覆盖率 + Markdown 结构（围栏、$$ 配对、相对链接、TODO 数）
阶段 G 输出       笔记文件 + README + knowledge.json + run-report.md/json + coverage-report.md + assets/
```

```
Stage A  scan       classify files, check readability, order them, report legacy/unsupported formats
Stage B  parse      text/headings/lists/tables/formulas/figures + source locators -> one document model
Stage C  knowledge  chapters and sections -> knowledge points -> term table -> formulas -> dependencies
Stage D  retrieve   prioritised queries (derivations > term definitions > fact checks > background > examples)
Stage E  generate   per-chapter Markdown + the machine-readable brief the writing stage consumes
Stage F  check      knowledge-point coverage + Markdown structure
Stage G  output     notes, README, knowledge.json, run report, coverage report, assets
```

中间产物全部落在 `<output_dir>/.coursenotes/<run-id>/`，任何阶段都可以复查或局部重跑。Intermediate artefacts live in `<output_dir>/.coursenotes/<run-id>/`, so any stage can be inspected.

**一个值得知道的设计决定**：确定性阶段（解析、章节切分、术语表、覆盖率基线）**不调用任何 LLM**，因此「完整性」不取决于模型是否听话；撰写阶段只负责「深度」。这就是长课件不会静默丢章节的结构性原因。

**Design decision:** the deterministic stages never call an LLM, so completeness does not depend on the model behaving — which is why a long deck cannot silently lose its later chapters.

## 覆盖率怎么读 / Reading coverage

覆盖率是**内部完整性指标**，只回答「提取到的知识点是否真的写进了笔记」，**不代表讲解正确性**。Coverage is an internal completeness indicator and says nothing about whether the explanations are correct.

关键设计：笔记里作为「材料原文依据」嵌入的代码块**不计入**统计，只有正文散文计入——否则每个知识点都会因为原文被复制而自动「覆盖」。Source excerpts embedded as evidence sit inside code fences and are **excluded** from the measurement.

| 指标 / Metric | 含义 / Meaning |
| --- | --- |
| 结构小节 / keyPointsWithSections | 骨架完整度：每个知识点是否都有自己的小节 |
| 覆盖率 / ratio | 内容完整度：正文是否真的写了这个知识点 |
| 剩余 TODO / remaining markers | 还有多少位置等待撰写 |

所以刚跑完 `generate_course_notes` 时「结构 100% / 覆盖率 0%」是**正确且预期**的结果——骨架已就绪，正文尚未撰写。A freshly generated skeleton is honestly reported as `structure 100% / content 0%`; a low number is a to-do list, not a failure.

## 双语规范 / Bilingual convention

**双语落在关键字词层级**：中文详解为主干，英文术语在首次出现处行内标注，章末附术语表。不做重复的整段英文翻译。Bilingualism is applied at the **keyword** level.

| 层次 / Layer | 形式 / Form | 示例 / Example |
| --- | --- | --- |
| 正文行内标注 Inline gloss | `中文术语（English term）` | 集合 $S$ 是**基本可行集**（basic feasible set） |
| 章末术语表 Term table | 表格，**以中文名为主键** | `| 铰链损失 | hinge loss | — | ... |` |

术语表列：**中文术语 / English Full Name / Abbreviation / 简要解释**，首列必须是中文术语（英文名只作第二列）。Terms are keyed by the Chinese name; the English name is the second column.

每个知识点的结构 / Per-point structure：

```markdown
### 1.2 知识点名称 / English Name

**[课件内容]** 材料原文依据（代码块，不计入覆盖率）

**中文讲解 / Chinese Explanation**      中文详解，术语行内中英对照
**数学原理 / Mathematical Principles**  （公式类知识点）
**实例 / Examples**                     （适用时）
**易错点 / Common Misconceptions**
**来源 / References** — [课件内容] 文件 · 页码 / 幻灯片号
```

来源分三类标注：`[课件内容]` / `[扩展讲解]` / `[推导说明]`。Provenance tags: `[课件内容]` material, `[扩展讲解]` supplementary, `[推导说明]` derivation note.

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
```

离线模式没有 `ctx.web`；仍想验证检索可以给 `--web-endpoint` 传一个能应答 `{op:"search", query}` / `{op:"fetch", url}` 的 HTTP 端点。Offline mode has no `ctx.web`; point `--web-endpoint` at such an endpoint to exercise retrieval anyway.

## 已知限制 / Known limitations

1. **旧版 Office 格式需要转换** —— `.ppt` / `.doc` / `.wps` / `.dps` / `.pages` / `.key` / `.odt` / `.odp` 无法直接解析，插件会明确列出并给出转换建议（另存为 `.pptx` / `.docx` 或导出 PDF），**不会**静默跳过。*Legacy Office formats need converting; they are listed, never silently skipped.*
2. **图片与图表的语义需要视觉模型** —— 插件负责把图抽出来、定位、写成「待解读图表」任务并附上下文；图里"讲了什么"由具备视觉能力的模型读取。没有视觉能力时显式标注，不编造图中文字。*Figures need a vision model; without one the position is marked, not guessed.*
3. **扫描版 PDF** —— 无文本层的页面会被识别、整页渲染成图片交给视觉模型，并记录 `page-without-text-layer` 警告。*Scanned pages are rendered page-by-page and reported.*
4. **公式识别是候选而非解析** —— 数学字体与符号密度标出候选，LaTeX 化与推导说明由撰写阶段完成；复杂排版可能漏检。另：某些 PDF 的数学字体映射有缺陷（`∈` 到达时已是替换字符），此时公式必须从渲染出的页面图像读取，仓库里的 `tests/export_pdf_pages.py` 正是为此。*Formula detection is heuristic; when a PDF's maths glyphs are mangled, formulas must be read from rendered page images.*
5. **知识点切分基于结构信号** —— 标题层级、编号、列表项、篇幅、术语/公式特征。散文型材料（Word 讲义、中文课件）表现良好；**公式密集的英文讲义可能切得过碎**，此时知识点数相对页数异常偏高，应改为逐页精读并手工建立基线。*Splitting is structural: good for prose decks, prone to fragmentation on formula-heavy English slides.*
6. **覆盖率用词元重合度** —— 等义改写可能被判为「部分覆盖」，属保守估计。公式匹配是记号感知的，无法确认规范形式几乎全是单字母符号的公式。*Coverage uses lexical overlap — a deliberately conservative estimate.*
7. **网络检索依赖 Harness 的 web provider** —— 未注册 provider 时检索不执行，并在报告与笔记中明确标注，绝不生成看起来像有引用其实没有的内容。*Retrieval depends on a registered web provider; missing citations are never fabricated.*
8. **写入受沙箱策略约束** —— 输出目录超出可写范围时会被拒绝，插件会改写到会话工作区内的 `course-notes-output`，并在报告中标注迁移原因（不静默改变目标）。*Writes obey the session sandbox, and any relocation is reported.*
9. **`stages` 参数当前按固定顺序执行完整流水线** —— 阶段名会被校验但不会跳过后续阶段。*`stages` is validated, but the pipeline currently runs in fixed order.*
10. **替换已加载的插件需要重启** —— Node ESM 按 URL 缓存，**同一 Host 进程内无法替换已加载的模块生成**。`install_bundle` / `remove_bundle` / `set_plugin` 都会报告 `application: applied`，但插件代码仍是旧的那一代（报错堆栈行号与磁盘文件不一致，可据此判断）。*Replacing a loaded plugin requires a restart.*
11. **工具返回值必须是无损 JSON** —— 注册表会校验返回体，任何成员为 `undefined` 时整次调用以 `value is not lossless JSON` 失败（而且是在工具**已经执行成功之后**）。插件用 `jsonSafe()` 在边界剥掉 `undefined`，并由契约测试守护。*Tool results must be lossless JSON.*

## 开发与测试 / Development

```powershell
cd course-notes
python tests/make_fixtures.py         # 生成 PPTX/DOCX/PNG/MD/TXT 测试素材
node tests/run-tests.mjs              # 50 个单元 + 端到端测试
node tests/plugin-contract.test.mjs   # 插件契约：导出形态、schema 子集、render、参数校验、卸载
node tests/discovery.test.mjs         # 解释器探测：模拟 host 进程没有 DSH_* 环境变量
node tests/check-yaml.mjs             # bundle 补丁 / CI 工作流 / 插件身份一致性
```

测试覆盖：配置归一化、格式路由与自然排序、Markdown/HTML/CSV 解析、术语识别三种写法与反例、章节组装（含无顶层标题的幻灯片、跨文件同名章节合并）、选择题选项合并、前导标题合并、检索计划与降级、检索查询的 LaTeX 清洗、不可信输入中和、覆盖率正负样例与跨章 id 冲突、图片相对链接可解析、端到端多格式解析、坏文件不影响其他文件、旧格式上报、报告完整性。

CI（GitHub Actions）在 **Node 22.x 与 24.x** 两档运行同一套检查，并在 Python 3.12 下装好解析依赖后生成夹具。CI runs the same checks on Node 22.x and 24.x.

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
│   ├── python-bridge.js           Python 后端探测与调用
│   ├── parse/course_notes_parser.py   PDF/PPTX/DOCX/图片 → 结构化 JSON
│   ├── parsers.js                 Markdown/文本/HTML/CSV/Notebook/LaTeX/字幕
│   ├── document.js                统一文档模型（units / images / formulas / vision tasks）
│   ├── cleanup.js                 选择题选项合并
│   ├── knowledge.js               阶段 C：章节、知识点、术语表、依赖关系
│   ├── retrieve.js                阶段 D：检索计划、检索执行、来源可信度
│   ├── generate.js                阶段 E：Markdown 笔记与撰写简报
│   ├── coverage.js                阶段 F：覆盖率与结构检查
│   ├── files.js                   工作区抽象（ctx.fs 或 node:fs）
│   ├── pipeline.js                编排 + 运行报告
│   └── util.js                    日志、路径、哈希、文本归一化、不可信输入处理
├── tests/                         测试与仓库级校验脚本
├── docs/
│   ├── architecture.md            设计说明与数据模型
│   ├── usage.md                   详细用法与参数表
│   └── sample-run/                真实运行的完整产物（含一个撰写完成的章节）
└── locale/zh.json / en.json       插件卡片文案
```

设计说明见 [`docs/architecture.md`](docs/architecture.md)，详细参数见 [`docs/usage.md`](docs/usage.md)。See the linked docs for the data model and the full parameter guide.

## 设计原则 / Design principles

| # | 原则 / Principle | 说明 / Detail |
| --- | --- | --- |
| 1 | **知识完整性优先** Completeness first | 不为了缩短篇幅丢章节；大纲、知识点、公式、图表逐项落位 |
| 2 | **不编造** Nothing invented | 无法识别的图片、无法访问的文献、检索失败，全部显式标注 |
| 3 | **课件为主，网络为辅** Material first, web second | 外部内容必须带真实链接，并区分 `[课件内容]` / `[扩展讲解]` / `[推导说明]` |
| 4 | **课件只读** Courseware is read-only | 除输出目录与过程目录外不修改任何原始文件（图片是从课件**读**出来另存到输出目录） |
| 5 | **不可信输入** Untrusted input | 课件与网页内容都会被中和处理（`neutralizeUntrustedText`），其中的指令不会被执行 |
| 6 | **失败要可见** Visible failures | 单个文件解析失败不影响其他文件，且一定出现在报告里 |
| 7 | **不硬编码密钥** No hardcoded keys | 只使用 Harness 已有的模型、检索与工具服务，不读也不存任何 API Key |
| 8 | **可配置可测试** Configurable and testable | 所有可调参数进入插件 `Config`，核心逻辑可脱离 Harness 运行与测试 |

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
