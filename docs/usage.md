# CourseNotes 使用说明（v1.1.0）

本文面向使用者：怎么调用、每个参数/配置项的含义、结果怎么读、拿到的笔记不完整时下一步做什么。
实现层面的取舍见 [`docs/architecture.md`](architecture.md)，测试与验证见 [`docs/testing.md`](testing.md)。

## 1. 最短路径

在 DeepSeek Harness 里直接说：

> 把 `D:\课程\计算机网络` 做成笔记，输出到 `D:\notes\计网`

`mode` 默认为 **`auto`**：插件建立结构后，用会话默认模型**逐块撰写**每个知识点，
逐块校验、只补写写坏的那几个，最后给出一个显式完成状态。正常情况下一次调用就能拿到：

- `verified`：全部知识点都已撰写并通过结构/内容/双语/公式/引用检查；
- `partial` / `notes_authored` / `scaffold_created` 等：**没有写完**，报告会说明差在哪里（见 §4）。

如果需要**只出结构**、由 Agent 或人工按简报撰写正文：

> 用 course-notes 先给 `D:\课程\计算机网络` 建骨架（mode: scaffold），然后再写正文

对应 `generate_course_notes({ input_paths: [...], output_dir: "...", mode: "scaffold" })`，
或旧写法 `author_with_llm: false`（已废弃，语义等价）。

`scaffold` 模式的典型用法是「Agent 自己写」：插件返回的简报里带着每个知识点的写作要求与
证据，Agent 按 `<!-- COURSENOTES:TODO -->` 补全正文，再调用 `check_notes_coverage` 复核。

## 2. 产出物 / Output

| 文件 | 内容 | 谁写的 |
| --- | --- | --- |
| `README.md` | 课程索引、来源文件表、章节列表、术语表、完成状态、覆盖率与全维度通过率 | 确定性渲染 |
| `Chapter_NN_*.md` | 每章一个文件：章节概述、学习目标、知识结构、逐知识点小节、公式清单、图表解读、术语表、参考资料 | 结构确定性渲染，正文由模型（`auto`）或调用方（`scaffold`）写 |
| `knowledge.json` | 提取出的章节/知识点/术语/公式，带稳定 ID 与页码定位 | 阶段 C |
| `coverage-report.md` | 覆盖率报告 + **多维质量检查** + Markdown 结构问题 | 阶段 F 之后 |
| `run-report.md` / `run-report.json` | 处理报告：完成状态、各阶段统计、证据映射、多模态、错误与警告、已知限制 | 阶段 G |
| `assets/` | 课件中提取出的图片，笔记按相对路径引用 | 解析后端 → 经 `ctx.fs` 发布 |
| `.coursenotes/note-brief.md` | 撰写简报（给 Agent 或人） | 阶段 G |
| `.coursenotes/evidence.json` | 知识点 ↔ 检索证据映射（引用白名单也在其中） | 阶段 D |
| `.coursenotes/vision-results.json` | 图表视觉任务与解读结果（`pending` + `results`） | 阶段 D；`results` 由外部写入（见 §9） |
| `.coursenotes/<run-id>/` | 各阶段中间产物（`stage-scan.json`、`documents.json`、`retrieval.json`、`knowledge.json`、`authoring.json`、`run.json`），便于逐步复查 | 各阶段 |

`run-report.json` 是机器可读的**权威**记录：它最后落盘，包含完整的 `writtenFiles` 列表、
`completion`、`coverage`、`quality`、`authoring`（分块、指标、失败清单）等字段。

## 3. `generate_course_notes` 参数

| 参数 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `input_paths` | string[] | 必填 | 文件、文件夹或混合。Windows 绝对路径可用；相对路径按会话 cwd 解析。文件夹递归扫描（跳过 `node_modules`、`.git`、`__pycache__`、`.venv`、`dist`、`build` 等，以及 `~$xxx` 临时文件） |
| `output_dir` | string | `<cwd>/course-notes-output` | 笔记输出目录 |
| `course_name` | string | 自动推断 | 覆盖课程名（优先取输入文件夹名） |
| `language` | `bilingual` \| `zh` \| `en` | `bilingual` | 输出语言。`zh` 只要求中文讲解，`en` 只要求英文讲解（校验与质量分随之变化） |
| `detail_level` | `concise` \| `standard` \| `comprehensive` | `comprehensive` | 讲解深度，写进每块的提示词（约 350 / 600 / 900–1500 中文字符每知识点的目标） |
| `mode` | `auto` \| `scaffold` | `auto` | `auto`：建结构后用 `ctx.llm` 分块撰写全部知识点；`scaffold`：只出结构 + 证据 + 简报 |
| `enable_web_search` | boolean | `true` | 是否用 `ctx.web` 做外部补充（是否**真的**检索到取决于部署里有没有注册 web provider，见 §10） |
| `enable_ocr` | boolean | `true` | 是否把纯图片内容保留为视觉任务（见 §9） |
| `include_examples` | boolean | `true` | 生成「实例 / Examples」小节与例题检索 |
| `include_exercises` | boolean | `true` | 生成「自测题」「重点与难点」等章节级小节 |
| `split_by_chapter` | boolean | `true` | 每章一个文件；`false` 时合并为一个文件（撰写阶段仍会覆盖**每一章**） |
| `coverage_check` | boolean | `true` | 结束后跑覆盖率与多维质量检查 |
| `file_order` | `natural` \| `name` \| `explicit` \| `mtime` | `natural` | 文件处理顺序。`natural` 让 `lecture2` 排在 `lecture10` 前 |
| `explicit_order` | string[] | `[]` | `file_order: "explicit"` 时的文件名顺序 |
| `stages` | string[] | 全部 | 阶段白名单：`scan` `parse` `knowledge` `retrieve` `generate` `check` `output`（别名如 `retrieval`/`coverage` 也接受）。**未列出的阶段真的不执行**；某个阶段的输入没有产出时流水线在该处停止，并在 `limitations` / `completionReason` 里说明 |
| `max_searches` | integer | 12 | 最大检索查询数 |
| `max_fetches` | integer | 8 | 最大抓取页面数 |
| `brief_char_budget` | integer | 60000 | 返回给模型的撰写简报字符预算 |
| `chunk_chars` | integer | `0` | 单块提示词字符预算；`0` = 由模型上下文窗口推导（见 §6） |
| `max_points_per_chunk` | integer | 12 | 单块最多知识点数（防止短知识点把一块塞满） |
| `llm_max_attempts` | integer | 3 | 单次 LLM 调用失败后的最大尝试次数（含首次） |
| `author_with_llm` | boolean | — | **已废弃别名**：`true` = `mode: auto`，`false` = `mode: scaffold`。仅为兼容保留 |

## 4. 先看完成状态，再看数字

`generate_course_notes` 的返回、`run-report.md`、`run-report.json` 都带一个**显式完成状态**。
判断这次运行是否可用，先看它：

| 状态 | 含义 | 下一步 |
| --- | --- | --- |
| `verified` | 全部知识点都已撰写，且通过结构 + 内容 + 双语 + 公式 + 引用检查 | 可直接使用 |
| `notes_authored` | 全部知识点已撰写，但没有执行质量检查（例如 `coverage_check: false`） | 跑一次 `check_notes_coverage` |
| `partial` | 部分知识点未撰写 / 仍有 TODO / 有文件写入失败 | 看 `run-report.md` 的「分块撰写」与错误区，补全后重跑 |
| `scaffold_created` | 只有骨架，正文未撰写（`mode: scaffold`，或 `auto` 但没有可用模型） | 按 §6 撰写，或让 Agent 写 |
| `parsed` | 只做到解析/知识结构，没有生成笔记（例如 `stages` 只给了 `scan,parse,knowledge`，或没提取到知识点） | 检查 `limitations` |
| `failed` | 没有成功写出任何笔记文件 | 看错误区（权限、输入、后端） |

**文件写出来了 ≠ 笔记写完了。** `verified` 是唯一表示「写完了」的状态；
其它状态下的笔记里会保留 `<!-- COURSENOTES:TODO -->` 占位标记，正文该缺的地方就缺着 ——
这是有意的：让没写完的运行看起来就是没写完。

## 5. 插件配置（profile 层，升级不丢）

```yaml
# cordis.patch.yml
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
    ocrCommand: ''           # 预留：外部 OCR 命令模板
    includeExamples: true
    includeExercises: true
    splitByChapter: true
    coverageCheck: true
    fileOrder: natural
    explicitOrder: []
    maxUnitChars: 4000       # 单个内容单元最多保留多少字符
    briefCharBudget: 60000
    maxFileBytes: 209715200  # 单文件上限 200 MiB
    pythonPath: ''           # 空 = 自动探测
    extraSearchKeywords: []  # 附加检索关键词
    chapterHeadingLevel: 1   # 达到该层级即视为"章"
    parserScript: ''         # 自定义解析后端路径
    logLevel: info           # silent | error | warn | info | debug

    # 分块撰写（1.1.0）
    chunkChars: 0            # 0 = 由模型上下文推导（夹在 8000–60000 字符之间）
    maxPointsPerChunk: 12
    chunkStrategy: balanced  # balanced（填满一块）| per-point（一个知识点一块）
    llmMaxAttempts: 3
    llmRetryBackoffMs: 400   # 退避基数，实际等待 = 基数 × 第几次尝试
    llmProvider: ''          # 空 = 用会话默认模型；与 llmModel 成对设置
    llmModel: ''
    maxHarnessAssetBytes: 67108864   # 单个图片资源经 ctx.fs 写出的上限（64 MiB）

    # 检索证据（1.1.0）
    evidencePerPoint: 4      # 每个知识点最多挂几条外部证据
    evidenceCharBudget: 24000  # 整轮进入提示词的外部摘录总预算
    evidenceExcerptChars: 900  # 单条摘录最多保留多少字符
```

工具调用参数优先生效，未给出的项回落到这里。`llmProvider` + `llmModel` 也可以用环境变量
`COURSE_NOTES_LLM_PROVIDER` / `COURSE_NOTES_LLM_MODEL` 提供；模型选择优先级是
**会话默认模型（`agentDefaultModel`）→ 配置/环境变量**，两者都没有时 `auto` 会降级为骨架并说明原因。

## 6. 分块撰写是怎么工作的（以及怎么调）

一次章节不再是一次调用：

```
按章分块（块不切知识点） → 每块一次生成 → 逐知识点校验 → 只补写写坏的知识点 → 合入骨架
```

- **块预算**：`chunkChars: 0` 时由模型上下文窗口推导 —— 预留 45% 给回答，其余按 3.2 字符/token
  折算，夹在 8000–60000 字符之间；模型没有公开上下文元数据时用保守的 28000 字符。
- **一个知识点太大**：不会被丢掉，而是拆成同一知识点的多个连续分段，提示词里说明「这是第 i/n 段，
  接着写、不要重复」。
- **校验**：承诺的每个知识点 id 都要有小节、正文不能过短、不能留 TODO、双语小节都要在、
  公式类必须有公式、图表类必须解释图、**引用只能是检索白名单里的 URL**。
- **局部补全**：块里只有失败的知识点会被重发一次；补全后的回答按「补全任务」而不是按整块校验，
  所以好知识点不会因为邻居写坏而被一起丢弃。
- **失败是可见的**：`run-report.md` 的「分块撰写」表格逐块列出状态、字符数、是否补全过；
  `run-report.json` 的 `authoring.metrics` 给出调用数、重试数、失败数、字符数与 token 数。

想把「没写完」补成「写完」有三种方式：

1. 用 `mode: auto` 重跑（模型可用时，未完成的知识点会重新撰写）；
2. 让 Agent 按 `.coursenotes/note-brief.md` 与笔记里的 TODO 补全正文；
3. 人工补全后跑 `check_notes_coverage` 复核 —— 覆盖率与质量分会按磁盘上的文本重算。

单文件模式（`split_by_chapter: false`）下所有章节写进同一个文件，撰写阶段仍然逐章覆盖，
不会只写第一章。

## 7. `check_notes_coverage` 参数

| 参数 | 说明 |
| --- | --- |
| `knowledge_json` | 必填。`generate_course_notes` 生成的 `knowledge.json` 路径 |
| `notes_dir` | 笔记目录，默认取 `knowledge_json` 所在目录 |
| `write_report` | 是否写出 `coverage-report.md`，默认 `true` |

返回完整的 Markdown 报告，包含：

- **覆盖率**：已覆盖 / 部分覆盖 / 未覆盖清单、分章覆盖、术语是否出现在笔记中、公式逐条匹配；
- **多维质量**：结构、内容、双语、公式（渲染 vs 已解释）、引用有效性、全维度通过率；
- **Markdown 结构问题**：缺标题、围栏数为奇数、`$$` 未闭合、表格缺分隔行、相对链接指向不存在的文件。

引用有效性只有在同目录（或 `.coursenotes/` 下）存在本轮 `evidence.json` 时才能真正核对；
没有证据索引时报告写「未执行检索，无法核对」，而不是「0 条错误」——
手写笔记、旧版本运行产物都走这条路径。

## 8. `probe_course_notes` 与 `read_course_notes_report`

- `probe_course_notes({ input_paths? })`：不生成笔记，只报告环境就绪情况 ——
  解析后端是否存在、解释器探测详情（每个候选各自缺什么库）、`ctx.web` / `ctx.llm` / `ctx.fs` 是否可用、
  会话默认模型、生效配置全量转储，以及（可选）输入扫描结果与「哪些文件需要 Python 后端」。
  排障第一步就该跑它。
- `read_course_notes_report({ output_dir, artifact, max_chars? })`：读取既往运行的
  `run-report.md` / `coverage-report.md` / `knowledge.json` / `note-brief.md`，
  适合在新会话里回顾上一次运行，不必重新生成。

## 9. 图片、图表与扫描页：能力边界要说清楚

**插件本身不做视觉推理。** 它只有两条缝：`ctx.fs`（原始字节）与 `ctx.llm`
（请求只能以 attachment provider 生成的**附件引用**形式携带图像）。
没有任何一条缝能把「工作区里的一个 PNG」变成请求里的图像，所以插件不假装能读图：

1. 解析阶段把图抽出来、按内容哈希去重，存到 `assets/`，并在 `<output_dir>/assets/` 发布一份
   （笔记用相对路径引用，Obsidian / VS Code 里可直接显示）；
2. 每张图变成一个**视觉任务**：按图形类别（时序图/结构图/流程图/曲线/统计图/截图/扫描页/其它）
   配一个具体问题，记录来源定位、优先级，并挂到同定位的知识点上；
3. 检测会话模型是否声明支持图像输入（`ctx.llm.resolveModelInfo`）。适配器**没有公开**
   `inputModalities` 时报告「未知」，不当作「不支持」；
4. **图的内容由能看见图的人补**：具备视觉工具的 Agent（例如先 `read_image`）或人工，
   把解读写进 `<output_dir>/.coursenotes/vision-results.json` 的 `results` 数组，然后重跑：

```json
{
  "results": [
    {
      "taskId": "V002",
      "interpretation": "这张图是停等协议的时序：发送方发出报文段后启动计时器……",
      "confidence": "agent-vision",
      "unresolved": ["图中第 3 行的符号无法确认"]
    }
  ]
}
```

`taskId` 必须来自本轮 `pending` 列表（也可以用完全一致的 `image` 路径）；
对不上的条目会在报告里列为 `vision-result-unmatched` 警告，**不会被凭空变成一条任务**。
`unresolved` 里的细节会以「⚠ 未能确认的细节」出现在笔记中。

未解读的图在笔记里明确写着「尚未解读 / not interpreted yet」并说明原因；`enableOcr: false`
时一条视觉任务都不产生（而不是产生一批空任务）。扫描版 PDF（无文本层）会被识别、整页渲染为图片，
并记录 `page-without-text-layer` 警告 —— 这页的内容完全依赖视觉解读。

## 10. 外部检索与证据

- 检索交给 Harness 的 `ctx.web`。**「用户是否开启检索」与「部署里有没有 web provider」是两件事**，
  报告分别记录：`enableWebSearch=false` → `disabled-by-config`；没有 provider → `web-service-unavailable`。
  两种情况都不假装成功：报告与笔记都会写明「外部检索未执行」。
- 只检索真正需要的知识点：公式推导 > 术语全称 > 事实核查（定理/对比）> 背景（架构）> 例题。
  来源按可信度分级，只有高校/官方/论文/百科级（≥3）的页面才会被抓取正文。
- 抓回来的页面会被**按段落打分**挑出与查询最相关的摘录（不是取页面开头），
  与课件原文一起构成「证据」，随知识点进入提示词。
- **引用白名单**：只有本轮真实检索到的 URL 可以被引用。笔记里出现白名单外的 URL 会被
  质量报告列为异常；模型侧也被明确要求不得编造 URL、DOI、作者或页码。
- 网页与课件原文都是**不可信数据**：其中任何看起来像指令的文字不会被放大成指令，
  指令式句子会被替换为 `[redacted-instruction-like-text]`。

## 11. 覆盖率与质量怎么读

覆盖率是**内部完整性指标**，只回答「提取到的知识点是否真的写进了笔记」，不代表讲解正确性。
作为「材料原文依据」嵌入的代码块不计入统计，否则每个知识点都会因为原文被抄进去而自动"覆盖"。

| 指标 | 含义 |
| --- | --- |
| 结构小节 / `keyPointsWithSections` | 骨架完整度：每个知识点是否都有自己的小节 |
| 覆盖率 / `ratio` | 内容完整度：正文是否真的写了这个知识点（阈值：≥0.55 覆盖，≥0.25 部分覆盖） |
| 剩余 TODO / `remainingTodoMarkers` | 还有多少位置等待撰写 |
| 全维度通过 / `all-dimensions-complete` | 只有结构+内容+双语+公式+引用**都**通过的知识点才计数 —— 这个数字才是「写完了吗」的保守答案 |

所以刚跑完 `scaffold` 时「结构 100% / 覆盖率 0%」是**正确且预期**的结果。

## 12. 离线 CLI

```powershell
node cli.js "D:\课件" --out D:\notes                 # 完整流水线
node cli.js --probe                                  # 环境自检
node cli.js "D:\课件" --out out --json run.json      # 额外导出机器可读报告
node cli.js "D:\课件" --out out --single-file --no-exercises
node cli.js "D:\课件" --out out --language zh --detail concise
node cli.js "D:\课件" --out out --order explicit --input ch2.pdf --input ch1.pdf
node cli.js "D:\课件" --out out --max-searches 4 --max-fetches 2
```

选项：`--out` `--work` `--language` `--detail` `--no-web` `--web-endpoint` `--ocr` / `--no-ocr`
`--no-exercises` `--no-examples` `--single-file` `--no-coverage` `--order` `--python`
`--max-searches` `--max-fetches` `--json` `--brief-budget` `--chapter-level` `--probe` `--help`。

离线运行的已知差异，说清楚以免误判：

- **没有 `ctx.llm`**，因此 CLI 只产出骨架 + 简报（`completion: scaffold_created`），
  正文需要 Agent 或人工撰写；报告里的跳过原因是「`ctx.llm` 不可用」。
- **没有 `ctx.web`**；想验证检索可以给 `--web-endpoint <url>` 指向一个 HTTP 端点：
  收到 `{op:"search", query, maxResults}` 或 `{op:"fetch", url}`，返回
  `{sources:[{url,title,snippet}], content}` 或 `{statusCode, body:{kind,content}}`。
- 日志默认静默；`COURSE_NOTES_LOGS=1` 输出到 stderr，`COURSE_NOTES_VERBOSE=1` 输出 debug 级。

仓库内的开发脚本（离线可复现）：

```powershell
npm test              # 单元 + 端到端（无需模型/网络）
npm run test:v1.1     # 1.1.0 回归：沙箱、分块、证据、多模态、报告一致性、工具层
npm run test:contract # 插件契约：导出形态、schema 子集、render、参数校验、卸载
npm run test:discovery# 解释器探测（模拟宿主进程没有 DSH_* 环境变量）
npm run test:all      # 主套件 + v1.1 回归 + 契约 + 解释器探测 + 报告自洽 + 样例可复现，按顺序跑
npm run check:reports # 示例运行的报告自洽性
npm run check:sample  # 示例运行可复现（重新生成一遍并比对整棵树）
npm run fixtures      # 重新生成测试夹具（PATH 上的 python 若是 Python 2，改用 py）
npm run sample        # 重新生成 docs/sample-run
```

## 13. 常见问题

**Q: 生成的笔记里全是 `<!-- COURSENOTES:TODO -->`？**
说明这次运行的状态是 `scaffold_created`：`mode` 是 `scaffold`，或 `mode: auto` 但没能确定
provider/model（`ctx.llm` 不可用、或会话没有默认模型）。`run-report.md` 的「分块撰写」一节会写明原因。
补全方式见 §6。

**Q: 覆盖率是 0%，是不是坏了？**
不是。覆盖率衡量**正文**是否写了知识点，骨架本身（标题、材料原文、术语表、公式清单）不算。
补齐 TODO 后再跑一次 `check_notes_coverage` 即可看到真实数字。

**Q: 状态是 `partial`，差在哪？**
`run-report.json` 的 `authoring.pointIdsNotAuthored` 给出未撰写的知识点 id，
`authoring.chunks[]` 逐块给出状态与失败清单，`failures[]` 说明是调用失败、补全失败还是块内知识点没过校验；
`quality.incompletePoints` 则列出「已写但某个维度没过」的知识点（例如缺英文讲解）。

**Q: 输出目录写不进去？**
写入受会话沙箱策略约束。Harness 模式下写入被拒时，插件保持**同一个 `ctx.fs` 缝**，
用真实写入探测 `<cwd>/course-notes-output` 与 `<cwd>/.coursenotes-output`，
把整轮运行迁移到第一个可写的目录，并在报告里以 `output-relocated` 说明原因（不静默换目录）；
若没有任何候选可写，则记 `OUTPUT_DIR_UNAVAILABLE` 并停止，不写任何东西。
（不要期待插件会绕过沙箱写到你指定的目录 —— 那正是权限模型要禁止的行为。）

**Q: 提示 Python 后端不可用怎么办？**
运行 `probe_course_notes`，它会列出所有尝试过的解释器与各自缺什么库。修复方式二选一：
装一个带 `pymupdf` / `python-pptx` / `python-docx` / `Pillow` 的 Python，或在配置里写 `pythonPath`。
后端不可用时流水线仍会跑完，但 PDF/PPTX/DOCX/图片 会全部记为"未解析"并出现在报告里
（Markdown / 文本 / HTML / CSV / Notebook 仍然可用）。

**Q: `.ppt` / `.doc` 老格式怎么办？**
插件无法直接解析，会在扫描阶段列出并给出转换建议（另存为 `.pptx`/`.docx` 或导出 PDF），
同时出现在 `README.md` 的「未能解析的文件」和 `run-report.md` 里。转换后重跑即可。

**Q: 笔记看起来写得很对，但真的对吗？**
覆盖率与质量分**只统计文本里出现了什么**，不判断讲解在数学上是否正确，也不能当作准确率的证明。
可选的语义检查（需要调用方提供模型判官）会明确标注「未经验证」。请把它当作完整性核查，而不是学术审阅。

**Q: 某个知识点完全没被提取出来？**
知识点切分基于结构信号（标题层级、编号、列表项、篇幅、术语/公式特征）。散文型材料表现良好；
公式密集的英文讲义可能切得过碎或漏切。可以读 `.coursenotes/<run-id>/documents.json` 看解析结果，
必要时手工补充，或调整 `chapterHeadingLevel` / `maxUnitChars` 后重跑。

**Q: 改了插件代码为什么没生效？**
Node 的 ESM 模块按 URL 缓存，替换已加载的插件包后必须**重启 Harness** 才会载入新的 JS。
`probe_course_notes` 报告里的 `BUILD` 标记（与插件路径一起看）可以判断当前加载的是哪一代代码。

## 14. 已知限制

以仓库 `README.md` 的「已知限制 / Known limitations」清单为准（本文不复制一份，避免两处说法漂移）。
与使用最相关的几条：

- **不做真正的视觉推理**：视觉能力检测 + 任务清单 + 结果并入是全部实现；图的内容必须由
  能看见图的模型或人补（§9）。
- **公式识别是候选而非解析**：数学字体与符号密度标出候选，LaTeX 化与推导由撰写阶段完成；
  某些 PDF 的数学字形映射有缺陷时，公式只能从页面图像读取。
- **覆盖率用词元重合度**：等义改写可能被判为「部分覆盖」，属于保守估计。
- **写入受沙箱策略约束**：被拒时迁移到会话工作区内的目录并在报告里标注，不会绕过沙箱。
- **工具返回值必须是无损 JSON**：注册表会校验返回体，插件用 `jsonSafe()` 在边界剥掉 `undefined`。
