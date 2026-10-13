# CourseNotes 使用说明

## 1. 最短路径

在 DeepSeek Harness 里直接说：

> 把 `D:\课程\计算机网络` 做成笔记，输出到 `D:\notes\计网`

Agent 会调用 `generate_course_notes` 完成解析与骨架生成，然后按返回的简报把正文写完，
最后调用 `check_notes_coverage` 复核覆盖率。

如果希望**一次性拿到完整笔记**（不需要 Agent 再写一遍）：

> 用 course-notes 把 `D:\课程\计算机网络` 生成完整双语笔记到 `D:\notes\计网`，正文用模型直接写

对应 `generate_course_notes({ input_paths: [...], output_dir: "...", author_with_llm: true })`。

## 2. `generate_course_notes` 参数

| 参数 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `input_paths` | string[] | 必填 | 文件、文件夹或混合。Windows 绝对路径可用；相对路径按会话 cwd 解析。文件夹会递归扫描（自动跳过 `node_modules`、`.git`、`__pycache__`、`.venv`、`dist`、`build` 等，以及 `~$xxx` 临时文件） |
| `output_dir` | string | `<cwd>/course-notes-output` | 笔记输出目录 |
| `course_name` | string | 自动推断 | 覆盖课程名 |
| `language` | `bilingual` \| `zh` \| `en` | `bilingual` | 输出语言。`zh` 只出中文讲解，`en` 只出英文讲解 |
| `detail_level` | `concise` \| `standard` \| `comprehensive` | `comprehensive` | 讲解深度（传给撰写阶段的约束） |
| `enable_web_search` | boolean | `true` | 是否用 `ctx.web` 做外部补充 |
| `enable_ocr` | boolean | `true` | 把图片作为视觉任务交给多模态模型（见 §6） |
| `include_examples` | boolean | `true` | 是否生成"实例 / Examples"小节与例题检索 |
| `include_exercises` | boolean | `true` | 是否生成"自测题""易错点"小节 |
| `split_by_chapter` | boolean | `true` | 每章一个文件；`false` 时合并为一个 `<课程名>_Notes.md` |
| `coverage_check` | boolean | `true` | 结束后跑覆盖率检查 |
| `file_order` | `natural` \| `name` \| `explicit` \| `mtime` | `natural` | 文件处理顺序。`natural` 让 `lecture2` 排在 `lecture10` 前 |
| `explicit_order` | string[] | `[]` | `file_order: "explicit"` 时使用的文件名顺序 |
| `stages` | string[] | 全部 | 阶段名白名单，可选项：`scan` `parse` `knowledge` `retrieve` `generate` `check` `output`。名称会被校验，但当前实现按固定顺序执行完整流水线（保留接口，见 README 已知限制 8） |
| `max_searches` | integer | 12 | 最大检索查询数 |
| `max_fetches` | integer | 8 | 最大抓取页面数 |
| `brief_char_budget` | integer | 60000 | 返回给模型的撰写简报字符预算 |
| `author_with_llm` | boolean | `false` | 插件自己用 `ctx.llm` 逐章撰写正文 |

## 3. 插件配置（profile 层，升级不丢）

```yaml
# cordis.patch.yml
- id: course-notes
  name: course-notes
  config:
    outputDir: ''            # 空 = <会话 cwd>/course-notes-output
    workDir: ''              # 空 = <outputDir>/.coursenotes
    language: bilingual
    detailLevel: comprehensive
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
```

工具调用参数优先生效，未给出的项回落到这里。

## 4. `check_notes_coverage` 参数

| 参数 | 说明 |
| --- | --- |
| `knowledge_json` | 必填。`generate_course_notes` 生成的 `knowledge.json` 路径 |
| `notes_dir` | 笔记目录，默认取 `knowledge_json` 所在目录 |
| `write_report` | 是否写出 `coverage-report.md`，默认 `true` |

返回完整的覆盖率报告 Markdown（含分章覆盖、未覆盖清单、术语未出现清单、公式匹配表、Markdown 结构问题）。

## 5. `read_course_notes_report`

读取既往运行的产物：`run-report.md`、`coverage-report.md`、`knowledge.json`、`note-brief.md`。
适合在后续会话里回顾上一次运行，而不必重新生成。

## 6. 关于图片、图表与扫描页

CourseNotes 的做法是**抽取 + 定位 + 派发任务**，而不是假装能读懂图：

1. 解析阶段把图片从课件里取出来（PDF 内嵌图/扫描页渲染、PPT 图片、Word 内嵌 `a:blip`），
   按内容哈希去重，存到 `<output_dir>/assets/`；
2. 在对应章节的「图表解读 / Figures to Interpret」小节写入**标准 Markdown 图片嵌入**
   （`![caption](assets/xxx.png)`，已在测试中验证相对路径可解析）；
3. 附上来源定位、优先级与"这张图要解释什么"的任务说明；
4. 撰写阶段由具备视觉能力的模型读取图片，解释其编码的知识。

所以 `enable_ocr` 的准确含义是"是否把图片作为视觉任务保留下来"。
如果模型没有视觉能力、或图片确实读不出来，笔记里必须保留明确标注，**不允许编造图中内容**。

扫描版 PDF（无文本层）会被识别为整页图片并渲染，同时在报告中记录
`page-without-text-layer` 警告 —— 这说明该页内容完全依赖视觉解读。

## 7. 关于外部检索

- 检索交给 Harness 的 `ctx.web`（当前 profile 已配置 `deepseek-official` 检索 + `http` 抓取）。
- 只检索真正需要的知识点：公式推导 > 术语全称 > 事实核查（定理/对比）> 背景（架构）> 例题。
- 来源按可信度分级，只有高校/官方文档/论文/百科级别的页面才会被抓取正文。
- **检索不可用时不假装成功**：报告与笔记都会写明"外部检索未执行/未完成"，
  笔记的「参考资料」小节会明确写"本次运行未获取到可引用的外部来源"。
- 抓取回来的网页内容会经过 `neutralizeUntrustedText` 中和处理，**其中的指令不会被执行**。

## 8. 离线 CLI

```powershell
cd <插件目录>
node cli.js "D:\课件" --out D:\notes                 # 完整流水线（无网络检索）
node cli.js --probe                                  # 环境自检
node cli.js "D:\课件" --out out --json run.json      # 额外导出机器可读报告
node cli.js "D:\课件" --out out --single-file --no-exercises
node cli.js "D:\课件" --out out --language zh --detail concise
node cli.js "D:\课件" --out out --order explicit --input ch2.pdf --input ch1.pdf
```

- 离线模式没有 `ctx.web`，需要检索时可用 `--web-endpoint <url>` 指向一个 HTTP 端点：
  收到 `{op:"search", query, maxResults}` 或 `{op:"fetch", url}`，返回
  `{sources:[{url,title,snippet}], content}` 或 `{statusCode, body:{kind,content}}`。
- 日志默认静默；`COURSE_NOTES_LOGS=1` 输出到 stderr，`COURSE_NOTES_VERBOSE=1` 输出 debug 级。

## 9. 常见问题

**Q: 提示 Python 后端不可用怎么办？**
运行 `probe_course_notes`，它会列出所有尝试过的解释器与各自缺什么库。修复方式二选一：
装一个带 `pymupdf` / `python-pptx` / `python-docx` / `Pillow` 的 Python，或在配置里写 `pythonPath`。
后端不可用时流水线仍会跑完，但 PDF/PPTX/DOCX/图片 会全部记为"未解析"并出现在报告里
（Markdown / 文本 / HTML / CSV / Notebook 仍然可用）。

**Q: 生成的笔记里全是 `<!-- COURSENOTES:TODO -->`？**
这是预期行为：骨架阶段不写正文。两种补全方式——
让 Agent 按简报写（默认流程），或调用时加 `author_with_llm: true` 让插件自己逐章写。

**Q: 覆盖率是 0%，是不是坏了？**
不是。覆盖率衡量的是**正文是否写了知识点**，骨架本身不算。补齐 TODO 后再跑一次
`check_notes_coverage` 即可看到真实数字；报告里「结构完整度 vs 内容完整度」会同时给出两个指标。

**Q: 输出目录写不进去？**
写入受会话沙箱策略约束。被拒绝时插件会改写到会话工作区内的 `course-notes-output`，
并在 `run-report.md` 与工具返回里标注迁移原因（不静默换目录）。若必须写原目录，
请在具备写权限的模式下重跑。

**Q: 改了插件代码为什么没生效？**
Node 的 ESM 模块按 URL 缓存，替换已加载的插件包后必须**重启 Harness** 才会载入新的 JS。

**Q: `.ppt` / `.doc` 老格式怎么办？**
插件无法直接解析，会在扫描阶段列出并给出转换建议（另存为 `.pptx`/`.docx` 或导出 PDF），
同时出现在 `README.md` 的「未能解析的文件」和 `run-report.md` 里。转换后重跑即可。
