# CourseNotes

**从课程资料自动生成结构清晰、知识完整、可溯源的中英双语学习笔记。**
**Turn course materials into structured, knowledge-complete, source-traceable bilingual study notes.**

CourseNotes 是 DeepSeek Harness 的原生 Cordis 插件。把一个课件文件夹（或若干文件）和一个输出目录交给它，
它就会完成从解析到成稿的整条流水线；笔记里每个知识点都能追回到原课件的页码 / 幻灯片号 / 段落号。

---

## 1. 它能做什么 / What it does

| 能力 | 说明 |
| --- | --- |
| 多格式解析 | `.pdf` `.pptx` `.docx` `.md` `.markdown` `.txt` `.rst` `.tex` `.csv` `.json` `.html` `.ipynb` `.srt` `.vtt` 及常见图片 `.png` `.jpg` `.jpeg` `.webp` `.gif` `.bmp` `.tif` |
| 结构化提取 | 标题层级、段落、列表、表格、公式候选、图片、PPT 备注、Word 内嵌图、PDF 扫描页 |
| 来源定位 | 每个知识点带 `PDF 页码 / 幻灯片编号 / 段落号 / 行号 / 图片名` |
| 知识组织 | 章节 → 小节 → 知识点；跨文件同名章节自动合并；识别知识点依赖关系 |
| 术语表 | 自动识别 `中文（English Full Name, ABBR）`、`English (中文)`、`English (ABBR)` 三种写法 |
| 网络补充 | 通过 Harness 的 `ctx.web` 检索并抓取权威来源，区分官方文档 / 高校 / 论文 / 社区 |
| 双语笔记 | 每个核心知识点的中文讲解与英文讲解必须内容对等，附公式推导、示例、易错点、术语表、自测题 |
| 覆盖率检查 | 对比「提取到的知识点」与「笔记里实际写了的知识点」，列出已覆盖 / 部分覆盖 / 未覆盖 |
| 失败可见 | 解析不了的文件、无法识别的图片、检索失败、写入被拒绝，一律写进报告，绝不假装成功 |

## 2. 安装 / Install

插件包位于 `plugins/course-notes`。用 Plugin Manager 安装（一次安装，全 profile 生效，重启后仍在）：

```
plugin_manager { action: "install_bundle", target: "<绝对路径>/plugins/course-notes" }
```

或通过 Harness 自带的插件管理界面安装该目录。

安装后 **重启 DeepSeek Harness**（Node 的 ESM 模块按 URL 缓存，替换已加载插件必须重启才能载入新的 JS 生成）。

在 `cordis.patch.yml`（profile 补丁层，升级不丢）里可以改任何配置：

```yaml
- id: course-notes
  name: course-notes
  config:
    outputDir: 'D:\notes'     # 默认 <会话 cwd>/course-notes-output
    language: bilingual       # bilingual | zh | en
    detailLevel: comprehensive
    enableWebSearch: true
    maxSearches: 16
    pythonPath: ''            # 留空 = 自动探测
```

### 运行依赖 / Runtime dependency

解析 PDF / PPTX / DOCX / 图片需要一个带 `pymupdf`、`python-pptx`、`python-docx`、`Pillow` 的 Python。
**DSH 自带的 Python 运行时已经全部具备**，插件会自动找到它，通常无需配置。

探测顺序：`pythonPath` 配置 → `COURSE_NOTES_PYTHON` → `DSH_PYTHON` → `PYTHON` →
`$DSH_HOME/dsh-runtimes/*/dependencies/python/python.exe`（DSH 自带）→ `PATH` 上的 `python`。

用 `probe_course_notes` 可以随时确认环境是否就绪。

## 3. 使用 / Usage

### 3.1 让 Agent 直接用（推荐）

```
把 D:\课程\计算机网络 这个文件夹做成笔记，输出到 D:\notes\计网
```

Agent 会调用：

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

返回的是一个**撰写简报**（note-writing brief）：章节、每个知识点的原文依据与来源、术语表、公式清单、
待解读图表、外部来源链接，以及需要补全的位置。Agent 据此把笔记写完，再调用 `check_notes_coverage` 复核。

### 3.2 直接出完整笔记（无需 Agent 二次撰写）

```jsonc
generate_course_notes({
  "input_paths": ["D:\\课程\\计算机网络"],
  "output_dir": "D:\\notes\\计网",
  "author_with_llm": true      // 用会话模型逐章撰写正文
})
```

`author_with_llm: true` 时插件自己调用 `ctx.llm`，**逐章**生成（不会因为上下文长度限制丢掉后面的章节），
生成完自动重跑覆盖率检查。

### 3.3 离线 CLI（不启动 Harness，可用于 CI）

```powershell
cd plugins\course-notes
node cli.js "D:\课程\计算机网络" --out D:\notes\计网
node cli.js --probe                       # 环境自检
node cli.js "D:\课件" --out out --json run.json --no-web
```

### 3.4 四个工具 / Tools

| 工具 | 作用 |
| --- | --- |
| `generate_course_notes` | 主入口：扫描 → 解析 → 知识点提取 → 网络检索 → 生成笔记 → 覆盖率检查 → 落盘 |
| `check_notes_coverage` | 独立复核：对比 `knowledge.json` 与笔记正文，输出覆盖率与 Markdown 结构问题 |
| `probe_course_notes` | 环境自检：Python 后端、`ctx.web`、`ctx.llm`、会话默认模型、生效配置、输入可解析性 |
| `read_course_notes_report` | 读取既往运行的 `run-report.md` / `coverage-report.md` / `knowledge.json` / `note-brief.md` |

## 4. 处理流水线 / Pipeline

```
阶段 A 文件扫描   识别格式、确认可读、排序（name/natural/explicit/mtime）、列出旧格式与不支持格式
阶段 B 内容解析   文本/标题/列表/表格/公式候选/图片/扫描页；保留来源定位；建立统一文档模型
阶段 C 知识点提取 章节与小节重建 → 知识点（定义/定理/公式/算法/架构/对比/示例/应用/实验/推导）
                  → 术语表 → 公式清单 → 知识点依赖关系
阶段 D 外部检索   按优先级生成查询（公式推导 > 术语全称 > 事实核查 > 背景 > 例题）→ 检索 → 抓取高可信来源
阶段 E 笔记生成   逐章 Markdown：章节概述/学习目标/知识结构/详细知识点/公式清单/图表解读/术语表/自测题/参考
阶段 F 质量检查   知识点覆盖率（已覆盖/部分/未覆盖）+ Markdown 结构（围栏、$$ 配对、相对链接、TODO 数）
阶段 G 输出       笔记文件 + README + knowledge.json + run-report.md/json + coverage-report.md + assets/
```

中间产物全部落在 `<output_dir>/.coursenotes/<run-id>/`，任何阶段都可以复查或局部重跑。

### 产出物 / Artifacts

```
<output_dir>/
├── README.md                    课程总目录 + 术语表 + 覆盖率摘要
├── Chapter_01_xxx.md            每章一个文件（split_by_chapter: false 时合并为一个）
├── Chapter_02_xxx.md
├── coverage-report.md           覆盖率报告
├── run-report.md / run-report.json   处理报告（含已知限制、错误、警告）
├── knowledge.json               完整知识点清单（机器可读，供复核与再生成）
├── assets/                      课件中提取的图片（笔记用相对路径引用）
└── .coursenotes/<run-id>/       简报、documents.json、retrieval.json 等过程产物
```

## 5. 中英双语规范 / Bilingual convention

每个核心知识点都包含：

```markdown
### 1.2 知识点名称 (English Name)

**术语定义 / Definition**
- 中文名称（English Full Name, ABBREVIATION）

#### 中文讲解 / Chinese Explanation
#### 英文讲解 / English Explanation
#### 数学原理 / Mathematical Principles      （公式类知识点）
#### 实例 / Examples                        （适用时）
#### 易错点 / Common Misconceptions
**来源 / References** — [课件内容] 文件 · 页码 / 幻灯片号
```

- 术语首次出现用 `中文名称（English Full Name, Abbreviation）`；没有公认缩写就不造一个。
- 英文讲解必须承载与中文相同的技术事实、数学定义与结论，不能只翻译标题。
- 内容来源分三类标注：`[课件内容]` / `[扩展讲解]` / `[推导说明]`。

## 6. 覆盖率检查怎么读 / Reading the coverage report

覆盖率是**内部完整性指标**，只回答「提取到的知识点是否真的写进了笔记」，**不代表讲解正确性**。

关键设计：笔记里作为「材料原文依据」嵌入的代码块**不计入**统计，只有正文散文计入——
否则每个知识点都会因为原文被复制而自动「覆盖」，指标就没有意义了。

报告同时给出两个不同的数字：

| 指标 | 含义 |
| --- | --- |
| 结构小节 / keyPointsWithSections | 骨架完整度：每个知识点是否都有自己的小节 |
| 覆盖率 / ratio | 内容完整度：正文是否真的写了这个知识点 |
| 剩余 TODO | 还有多少位置等待撰写 |

所以刚跑完 `generate_course_notes` 时「结构 100% / 覆盖率 0%」是**正确且预期**的结果——
骨架已就绪，正文尚未撰写。补齐后再跑一次检查即可。

## 7. 已知限制 / Known limitations

1. **旧版 Office 格式需要转换**：`.ppt` / `.doc` / `.wps` / `.dps` / `.pages` / `.key` / `.odt` / `.odp` 等
   无法直接解析，插件会明确列出并给出转换建议（另存为 `.pptx` / `.docx` 或导出 PDF），**不会**静默跳过。
2. **图片与图表的语义需要视觉模型**：插件负责把图从课件里抽出来、定位、写成「待解读图表」任务并附上下文，
   图里"讲了什么"由具备视觉能力的模型读取后解释。没有 OCR 环境时会显式标注，不会编造图中文字。
3. **扫描版 PDF**：无文本层的页面会被识别并整页渲染成图片交给视觉模型，并记录 `page-without-text-layer` 警告。
4. **公式识别是候选而非解析**：数学字体、数学符号与 `$…$` 会被标为公式候选并给出依据，
   LaTeX 化与推导说明由撰写阶段完成。复杂排版公式可能漏检。
5. **知识点的切分基于结构信号**：标题层级、编号、列表项、篇幅、术语/公式特征。
   没有标题层级的纯文本会退化为「按段落切分 + 文档名作为章节」。
6. **覆盖率用词元重合度**：等义改写可能被判为「部分覆盖」，属保守估计。
7. **网络检索依赖 Harness 的 web provider**：未注册 provider 时检索不执行，并在报告与笔记中明确标注，
   绝不生成看起来像有引用其实没有的内容。
8. **`enable_skipped_stages` / 阶段子集**：`stages` 参数当前按固定顺序执行完整流水线，
   阶段名会被校验但不会跳过后续阶段（保留接口，见 `lib/index.js` 的 `STAGE_ORDER`）。
9. **写入受沙箱策略约束**：输出目录超出可写范围时会被拒绝，插件会改写到会话工作区内的
   `course-notes-output` 并在报告中标注迁移原因（不静默改变目标）。
10. **替换已加载的插件需要重启**：Node ESM 按 URL 缓存模块，**同一 Host 进程内无法替换已加载的
    模块生成**。`install_bundle` / `remove_bundle` / `set_plugin` 都会报告 `application: applied`，
    但插件代码仍是旧的那一代（报错堆栈的行号会与磁盘文件不一致，可据此判断）。必须重启 Harness。
11. **工具返回值必须是无损 JSON**：工具注册表会深冻结返回体，任何成员为 `undefined` 时整次调用会以
    `value is not lossless JSON` 失败。插件用 `jsonSafe()` 在边界上统一剥掉 `undefined`，
    并由插件契约测试守护（`node tests/plugin-contract.test.mjs`）。
12. **DSH 官方定位 Python 的方式是 `load_workspace_dependencies` 工具**，Host 插件调不到它；
    因此 CourseNotes 自己探测（环境变量 → `$DSH_HOME` → 用户主目录 `.dsh` → 从插件路径向上找
    `dsh-runtimes` → PATH），并用 `probe_course_notes` 把探测过程完整暴露出来。

## 8. 工程结构 / Layout

```
course-notes/
├── index.js                       插件入口：4 个工具的定义与注册
├── cli.js                         离线 CLI（同样的流水线，不依赖 Harness）
├── cordis.patch.yml               bundle 补丁（插入插件行 + 默认配置）
├── package.json
├── lib/
│   ├── config.js                  配置：默认值、schema、参数覆盖与归一化
│   ├── scan.js                    阶段 A：文件扫描与格式分类
│   ├── python-bridge.js           Python 后端探测与调用
│   ├── parse/
│   │   └── course_notes_parser.py PDF/PPTX/DOCX/图片 → 结构化 JSON
│   ├── parsers.js                 Markdown/文本/HTML/CSV/Notebook/LaTeX/字幕
│   ├── document.js                统一文档模型（units / images / formulas / vision tasks）
│   ├── knowledge.js               阶段 C：章节、知识点、术语表、依赖关系
│   ├── retrieve.js                阶段 D：检索计划、检索执行、来源可信度
│   ├── generate.js                阶段 E：Markdown 笔记与撰写简报
│   ├── coverage.js                阶段 F：覆盖率与结构检查
│   ├── files.js                   工作区抽象（ctx.fs 或 node fs）
│   ├── pipeline.js                编排 + 运行报告
│   └── util.js                    日志、路径、哈希、文本归一化、不可信输入处理
├── tests/
│   ├── run-tests.mjs              50 个单元 + 端到端测试
│   ├── plugin-contract.test.mjs   插件契约：导出形态、schema 子集、render、参数校验、卸载
│   ├── make_fixtures.py           生成 PPTX/DOCX/PNG/MD/TXT 测试素材
│   └── fixtures/
├── docs/
│   ├── architecture.md            设计说明与数据模型
│   ├── usage.md                   详细用法与参数表
│   ├── sample-run/                真实运行的完整产物（含一个撰写完成的章节）
│   └── sample-run-real-pdf/       用真实课程作业 PDF 跑出的结果
└── locale/
    ├── zh.json / en.json          插件卡片文案
```

## 9. 测试 / Tests

```powershell
cd plugins\course-notes
python tests\make_fixtures.py     # 生成测试素材（PPTX 含表格与图表、DOCX 含内嵌图、MD 含公式、PNG）
node tests\run-tests.mjs          # 50 个测试
node tests\plugin-contract.test.mjs
node tests\discovery.test.mjs     # 解释器探测：模拟 host 进程没有 DSH_* 环境变量的真实情况
```

测试覆盖：配置归一化、格式路由与自然排序、Markdown/HTML/CSV 解析、术语识别三种写法与反例、
章节组装（含无顶层标题的幻灯片、跨文件同名章节合并）、选择题选项合并、前导标题合并、
检索计划与降级、检索查询的 LaTeX 清洗、不可信输入中和、
覆盖率正负样例与跨章 id 冲突、图片相对链接可解析、
端到端多格式解析、坏文件不影响其他文件、旧格式上报、报告完整性。

### 已完成的验收 / Acceptance evidence

| # | 验收项 | 结果 |
| --- | --- | --- |
| 1 | 正确解析 PDF / PPTX / DOCX / Markdown / 图片 | ✅ 5/5 文件解析成功（`docs/sample-run/run-report.md`）；真实 PDF 见 `docs/sample-run-real-pdf/` |
| 2 | 识别课件主要章节与知识点 | ✅ 4 章 / 22 个知识点；真实 PDF 1 章 / 18 个知识点 |
| 3 | 处理含数学公式或图表的示例 | ✅ 提取公式候选（数学字体 + 符号密度）、表格、图片，并把图表派发为视觉任务 |
| 4 | 核心知识点具备实质性中英双语讲解 | ✅ `docs/sample-run/Chapter_01_第 2 讲 神经网络基础.md`：7 个知识点全部完成，中英内容对等 |
| 5 | 缩写首次出现给出准确全称 | ✅ 术语表含 `中文 \| English Full Name \| Abbreviation`；材料未给全称的显式标注"课件未给出" |
| 6 | 外部补充内容有真实可访问来源 | ✅ 检索经 `ctx.web`，来源分级（official/university/paper/encyclopedia）；未检索时明确标注 |
| 7 | Markdown 输出无明显结构错误 | ✅ `checkNoteStructure`：围栏配对、`$$` 配对、相对链接全部可解析 |
| 8 | 长课件不会静默丢章节 | ✅ 逐章文件 + 逐章撰写；章节由解析结果决定，不取决于模型输出长度 |
| 9 | 单文件解析失败不影响其他文件 | ✅ 测试 `one unparsable file does not lose the others`：坏 PDF 记入报告，其余文件照常出笔记 |
| 10 | 能在当前 Harness 环境加载并通过调用测试 | ⚠ 见下方说明 |

**关于第 10 项**：插件已通过 `plugin_manager install_bundle` 装入 profile（`package.json` 的 `dsh.profile.bundles` 与 `cordis.patch.yml` 均已写入，
`list_bundles` 显示 `course-notes 1.0.0 enabled:true installed:true`）。
但本会话的 Harness 进程在此前加载过一个**会报错的旧模块生成**（早期的 `ctx.set` 写法），
由于 Node 的 ESM 模块按 URL 缓存，`install_bundle` 无法在进程内替换已加载的生成 —— **需要重启 Harness**。
重启后 `cordis_inspect_query Service` / `listTools` 应能看到四个 `course_notes` 工具。

在重启前，同一份代码已用两种方式实证可用：

- `node tests/plugin-contract.test.mjs`：按 Cordis 契约模拟 Loader，验证导出形态、
  4 个工具的 schema（含 registry 强制的 JSON Schema 子集检查）、`render` 返回 `ContentBlock[]`、
  参数校验报错文案、`probe_course_notes` 可在无 Host 环境下运行、卸载后工具全部注销。
- `node cli.js …`：完全相同的流水线代码在无 Harness 环境下跑通全部 5 种格式。

## 10. 示例产物 / Sample output

`docs/sample-run/` 是一次**真实运行**的完整产物（含一个由模型撰写完成的章节）：

```
docs/sample-run/
├── README.md                                    课程总目录 + 术语表 + 覆盖率
├── Chapter_01_第 2 讲 神经网络基础.md            ✅ 已撰写完成（7/7 知识点覆盖）
├── Chapter_02_第一章 概述.md                     骨架（含 TODO 标记）
├── Chapter_03_第三章 传输层 Transport Layer.md   骨架
├── Chapter_04_fixture_lab.md                     骨架
├── coverage-report.md                           覆盖率报告
├── run-report.md / run-report.json              处理报告
├── knowledge.json                               21 个知识点完整清单（id 全局唯一 K001–K021）
├── assets/                                      从课件提取的图片
└── .coursenotes/note-brief.md                   撰写简报（完整版）
```

该样例的覆盖率报告结果：

| 章 | 覆盖 / 总数 | 说明 |
| --- | --- | --- |
| 第 1 章 第 2 讲 神经网络基础 | **7 / 7** | 已由模型撰写完成 |
| 第 2 章 第一章 概述 | 0 / 5 | 骨架，未撰写 |
| 第 3 章 第三章 传输层 | 0 / 5 | 骨架，未撰写 |
| 第 4 章 fixture_lab | 0 / 4 | 骨架，未撰写 |
| **合计** | **7 / 21（33.3%）** | 结构小节 21/21，剩余 TODO 74 |

这正好演示了指标的设计意图：**结构完整度 100%，内容完整度反映真实撰写进度**。

`docs/sample-run-real-pdf/` 是用一份真实课程作业 PDF（2 页，含 8 道选择题）跑出来的结果：
18 个知识点（选择题的 A/B/C/D 选项已自动并入题干，不会各算一个知识点）、1 个章节、完整来源定位。

## 11. 设计原则 / Design principles

1. **知识完整性优先**：不为了缩短篇幅丢章节；大纲、知识点、公式、图表逐项落位。
2. **不编造**：无法识别的图片、无法访问的文献、检索失败，全部显式标注。
3. **课件为主，网络为辅**：外部内容必须带真实链接，并区分 `[课件内容]` / `[扩展讲解]` / `[推导说明]`。
4. **课件只读**：除输出目录与过程目录外不修改任何原始文件（图片是从课件中**读**出来另存到输出目录）。
5. **不可信输入**：课件与网页内容都会被中和处理（`neutralizeUntrustedText`），其中的指令不会被执行。
6. **失败要可见**：单个文件解析失败不影响其他文件，且一定出现在报告里。
7. **不硬编码密钥**：只使用 Harness 已有的模型、检索与工具服务，不读也不存任何 API Key。
8. **可配置可测试**：所有可调参数进入插件 `Config`，核心逻辑可脱离 Harness 运行与测试。

---

MIT License.
