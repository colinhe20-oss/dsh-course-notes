# CourseNotes 测试与验证（testing.md）

这份文档回答两个问题：**这些测试到底证明了什么**，以及**哪些结论必须到别处去验证**。
它对上 [`docs/architecture.md`](architecture.md) 里的设计不变量，对下是 CI 的实际步骤。

## 0. 先区分四层「验证」，别把 mock 当真实端到端

自动化测试最容易造成的误解，是把「控制流正确」读成「功能在真实环境里可用」。
本仓库的证据分四层：

| 层 | 本仓库里是什么 | 能证明 | **不能**证明 |
| --- | --- | --- | --- |
| 静态检查 | `node --check`（CI 对 `index.js` / `cli.js` / `lib/*.js` / `tests/*.mjs` 全量执行）；`tests/plugin-contract.test.mjs` 的 schema 与导出断言；`tests/v1.1.test.mjs` 第 1 组里「源码里不得出现原生写原语」的源码级断言；`tests/check-yaml.mjs` | 语法可加载、工具 schema 落在注册表支持的子集内、导出形态正确、某条不变量没有被重新写坏 | 任何运行时行为 |
| mock 测试 | `tests/v1.1.test.mjs` 用**确定性 mock `ctx.llm`** 与**假 `ctx.fs`** 驱动；`tests/run-tests.mjs` 的检索用例用手写 stub `web` provider | 控制流、分块与校验/补全逻辑、证据绑定与中和、报告渲染、沙箱缝的契约（拒绝被报告而不是被吞掉） | 真实模型能否写出合格笔记、真实 provider 能否检索、真实沙箱是否拒绝某条路径 |
| 本地真实执行 | `tests/run-tests.mjs` 第 8 组：对真实夹具（PPTX/DOCX/PNG/MD/TXT）跑**完整流水线**，经真实 Python 后端解析，断言磁盘上的产物；`tests/discovery.test.mjs` 真的去探测并启动解释器；`node cli.js --probe`；`npm run sample` 真的生成 `docs/sample-run` | 解析、知识点提取、笔记渲染、覆盖率统计、资源链接可解析、坏文件不影响其他文件 —— 全部在真实文件上成立 | 模型撰写、联网检索、Harness 的权限策略（这些在本地都没有真身） |
| Harness 真实环境验证 | 在 Harness 宿主里以真实会话调用工具：真实 `ctx.fs`（会话权限策略）、真实 `ctx.llm`（provider/model）、真实 `ctx.web`、真实 `agentDefaultModel` | 只有这一层能证明「沙箱拒绝时的迁移行为」「模型分块撰写达到 `verified`」「检索证据真的进入了提示词」 | —— 本仓库的测试套件**做不到**这一层；`plugin-contract.test.mjs` 只是**模拟** Loader 契约（假的 `ctx`，不启动宿主） |

因此，凡是「端到端」「真实模型」「真实沙箱」的说法，都必须注明证据来自哪一层。
本文件其余部分按这个分类标注每个套件。

## 1. 怎么跑

```powershell
npm test               # = node tests/run-tests.mjs          （50 个用例，8 组）
npm run test:v1.1      # = node tests/v1.1.test.mjs          （51 个用例，6 组）
npm run test:contract  # = node tests/plugin-contract.test.mjs
npm run test:discovery # = node tests/discovery.test.mjs
npm run check:reports  # = node tests/check-report-consistency.mjs [dir ...]
npm run check:sample   # = node tests/check-sample-reproducible.mjs
npm run test:all       # 上面六套，按顺序跑
npm run audit          # 只打印样例清单与数字，不做断言
npm run fixtures       # python tests/make_fixtures.py
npm run sample         # node tests/make-sample-run.mjs
node tests/check-yaml.mjs   # CI 会跑，但没有 npm script（也不在 test:all 里）
```

（用例数量以运行输出末尾的 `N passed, M failed` 为准；每个用例独立，失败即 `exit 1`。）

前置条件：

- Node ≥ 22.13（`package.json` 的 `engines`）；
- 解析后端要有 Python 与 `pymupdf` / `python-pptx` / `python-docx` / `Pillow`，
  否则 `run-tests.mjs` 第 8 组与 `npm run sample` 会跳过或失败；
- 夹具 `tests/fixtures/` 是生成物（`.gitignore` 里），首次要先 `npm run fixtures`；
  该 script 跑的是 PATH 上的 `python`，而 **Windows 上的 `python` 很可能是 Python 2**
  （本仓库开发机上就是 Anaconda 2.7，脚本里的类型标注会直接 SyntaxError）。
  这种情况改用 `py tests/make_fixtures.py`，或者直接用 DSH 自带解释器：
  `& "$env:USERPROFILE\.dsh\dsh-runtimes\<runtime>\dependencies\python\python.exe" tests\make_fixtures.py`。
  插件自己的解释器探测不受这个坑影响：它优先使用自带解释器，并把 `py` 排在 `python` 之前；
- **不需要网络、不需要 API key、不需要 Harness 宿主**。

## 2. 套件一览

| 文件 | 类型 | 覆盖 | CI 运行 |
| --- | --- | --- | --- |
| `tests/run-tests.mjs` | 单元 + 本地真实端到端 | 配置、扫描、Node 解析、知识点提取、清理、检索计划、覆盖率、工具函数、完整流水线 | ✅ |
| `tests/v1.1.test.mjs` | mock 为主，含源码级静态断言 | 沙箱完整性、分块撰写、检索证据、多模态管线、多维质量与报告一致性、工具层回归 | ✅ |
| `tests/plugin-contract.test.mjs` | 静态 + 模拟 Loader | 导入/导出形态、4 个工具的 schema 与 render、参数校验、无损 JSON、卸载 | ✅ |
| `tests/discovery.test.mjs` | 本地真实执行 | 在**没有** `DSH_*` 环境变量时发现并使用自带解释器 | ✅ |
| `tests/check-report-consistency.mjs` | 本地真实执行 + 交叉比对 | 样例运行的报告自洽性（重算 vs 声称） | ✅ |
| `tests/check-sample-reproducible.mjs` | 本地真实执行 + 交叉比对 | 重新生成样例后树是否与已提交的一致（即生成器是否确定性） | ✅ |
| `tests/check-yaml.mjs` | 静态 | `cordis.patch.yml` / CI 工作流 / `package.json` 身份一致性 | ✅ |
| `tests/audit-samples.mjs` | 报告型 | 打印两个样例的文件清单与关键数字 | ❌ |
| `tests/make_fixtures.py` | 夹具生成器 | PPTX/DOCX/PNG/MD/TXT | ✅（作为步骤） |
| `tests/make-sample-run.mjs` | 样例生成器 | 重新生成 `docs/sample-run` | ✅（作为步骤） |

## 3. 各套件细看

### 3.1 `tests/run-tests.mjs` — 主套件（50 个用例，8 组）

| 组 | 覆盖 |
| --- | --- |
| 1. configuration | 默认值齐全、非法值回落与数值夹取、工具参数（snake_case）覆盖配置 |
| 2. file scanning | 格式路由与旧格式上报、分类/排序/跳过、显式顺序、课程名推断优先取输入文件夹名 |
| 3. Node-native parsers | Markdown 标题/列表/表格/公式/图片、未闭合围栏被报告、HTML 转文本、CSV 引号 |
| 4. knowledge extraction | 三种双语术语写法与反例（不把句子片段当术语）、前导标题并入下一个知识点、检索查询清洗 LaTeX、`kind` 分类、章节组装（含无顶层标题的幻灯片、跨文件同名章节合并）、术语去重保留定位 |
| 5. content clean-up | 选择题选项并入题干而不成为知识点、选项不挂到表格上、`isOptionText` 的实际形态 |
| 6. retrieval planning | 查询有选择性且按理由排优先级、`ctx.web` 缺失时显式降级、stub provider 下能记录来源、来源分类与 HTML 正文抽取 |
| 6. coverage measurement | 代码围栏不计入覆盖、骨架 0% vs 已撰写高分、缺小节判缺失、按显式标记切段、跨章重复 id 不互相遮蔽、报告文件不被当作笔记内容、CJK 二元组分词、**用 `docs/references/authored-chapter-example.md` 验证「已撰写」的章节真的被判为已覆盖** |
| 7. utilities and safety | 不可信文本中和（角色前缀、chat 控制标记）、路径/截断/自然排序、Node 工作区报错而不抛异常 |
| 8. end-to-end pipeline | 5 种格式全部解析且不丢文件、PPTX 表格/公式/图表抽取、DOCX 内嵌图与表格、纯图片变成视觉任务而不是假文本、章节/知识点/术语产出、笔记与 README/报告落盘且结构良好、简报含写作要求与证据、**资源发布后每个相对链接都能解析**、骨架的覆盖率诚实为 0%、部分撰写的运行报出部分覆盖、坏文件不影响其他文件、旧格式/不支持格式被上报、运行报告显式写出能力限制 |

两个门槛值得注意：第 8 组在缺少夹具或缺少 Python 后端时会**整组跳过**并打印 `SKIP`（不会假装通过）；
第 6 组里那条「已撰写章节」用例依赖 `docs/sample-run/knowledge.json` 与 `docs/references/`，
缺任一时打印跳过原因。（上面的组号沿用源码：`run-tests.mjs` 里「检索计划」与「覆盖率」两组都编号 6。）

### 3.2 `tests/v1.1.test.mjs` — 1.1.0 回归（51 个用例，6 组）

**这一套的模型与文件系统都是假的**：`createMockLlm()` 从提示词里读出知识点 id，
按选项（`omit` / `short` / `dropEnglish` / `inventCitation` / `failFirstNCalls` / `failAlways`）
产出结构良好的 Markdown 或失败；`createFakeFs()` 实现 `ctx.fs` 的文档化契约，
可以按 `allowedRoot` 或 `read-only` 拒绝写入并计数。它验证的是**逻辑与契约**，
不是「模型写得好不好」。

| 组 | 覆盖 |
| --- | --- |
| 1. sandbox integrity (P0) | 被拒的写入被报告且不落盘、允许的写入只经缝而不触碰原生 fs、二进制经文本缝字节等价往返、超限资源被 `FS_TOO_LARGE_LOCAL` 拒绝而不是截断、资源复制被拒时如实上报、`probeWritable` 只探测不越界、Harness 模式整轮运行只经缝、只读缝下磁盘零改动、**源码级断言：Harness 工作区体内没有原生写原语、迁移路径不构造 node 工作区** |
| 2. long chapters are chunked (P1) | 60 个知识点全部分块且不重不漏、超大知识点拆成连续分段（提示词里声明 part i/n）、每个知识点都进入过某个提示词、预算随模型窗口缩放且受上下限约束、mock 模型下 30 个知识点全部撰写成功且章节结构/术语表保持、被模型略过的知识点保留骨架并被报告、写得太短的知识点触发**一次**局部补全（补全提示词不含健康知识点）、缺英文讲解触发补全、章节级小节每章一次调用、调用失败会重试且永久失败被报告、单文件模式下每一章都被撰写、id 标题写法异常不会被误认为合格小节、编造的 URL 会被白名单校验拦住、合并不会动授权块之外的结构 |
| 3. retrieval evidence (P1) | 摘录从页面段落中挑出（不是页面开头）、摘录里的指令式文本被替换为 `[redacted-instruction-like-text]` 而正常句子保留、证据绑定到发出该查询的知识点、无关的高可信页面不会被挂上去、抓到的正文真的进入提示词、白名单内的 URL 可引用而白名单外的不行、检索降级能区分「配置关闭」与「服务未注册」 |
| 4. multimodal plumbing (P1) | 图的分类与问题、从文档与章节图表构建视觉任务、`enableOcr=false` 时不产生任务、解读并入到正确的任务且对不上的条目被报告、适配器不公开模态时能力报「未知」而不是「不支持」 |
| 5. quality & report consistency (P1) | 质量分能分开结构/内容/双语/公式；没有检索时引用检查报「无法核对」；**一次运行的所有报告来自同一份最终状态**（JSON 与实时报告、Markdown 与 JSON、README 与状态一致，写入清单里的文件真实存在）；未撰写的运行状态是 `scaffold_created` 而**不是** `verified`；mock 模型下成功运行能到 `verified` 且没有 TODO、章节级标记被移除；`mode=auto` 但没有模型时显式降级而不伪造正文；`stages` 真的限制执行且不产出被排除阶段的文件；输出目录被拒时如实报错且磁盘零产物；覆盖率拒绝把未撰写骨架判为已覆盖 |
| 6. tool layer (P0 regression) | 直接调用**注册后的工具**（而不是 `runPipeline`）：有解析错误时返回报告而不是抛异常、输出目录被拒时如实报告、拒绝后迁移到允许的根目录并被记录、干净运行返回 `ok` 与完整的 `artifacts` |

第 6 组存在的原因值得记住：在这组之前，**没有任何测试用合法输入调用过注册后的工具**——
契约套件只跑了参数校验失败的分支，回归套件直接调 `runPipeline`，
于是工具层的一处未定义引用可以一路通过所有检查（详见 §6）。

### 3.3 `tests/plugin-contract.test.mjs` — 契约（静态 + 模拟）

用假的 `ctx` 注册四个工具并断言：

- 导出形态：`apply(ctx, config)`、`inject: ['tools']`、`name`；
- 四个工具都注册且没有多余工具；名字符合线上契约（`^[A-Za-z0-9_-]{1,64}$`，且不用保留名）；
- `output.schema` 只使用注册表支持的 JSON Schema 子集
  （`type/oneOf/properties/required/additionalProperties/items/enum/const/description/title/default/examples`，
  没有 `$ref`、`format`、数值边界），否则注册时就会以 `UNSUPPORTED_SCHEMA` 失败；
- `output.render()` 必须返回 `ContentBlock[]`，只有 `text` 块、空字符串块被丢弃；
- 参数校验会以可行动的消息拒绝坏输入（缺 `input_paths`、未知 stage、读不到的报告目录）；
- `probe_course_notes` 在没有宿主的情况下也能工作并如实报告；
- **无损 JSON**：注册表会拒绝含 `undefined` 成员的返回体（而且是在工具已经执行成功之后），
  所以每个工具返回体都过 `jsonSafe()`，这里对返回体做深度检查；
- 卸载：dispose 掉插件 effect 后所有工具都被注销；
- 插件**不发布任何服务**（`ctx.set` 会被断言失败）：没人消费的服务是纯粹的安装风险。

它不启动 Harness 宿主，因此**不能**证明真实环境里的注册/权限行为。

### 3.4 `tests/discovery.test.mjs` — 解释器发现的真实执行

删掉子进程环境里所有 `DSH_*` 与 `COURSE_NOTES_PYTHON`（这正是宿主进程的真实情况：
DSH 把 `DSH_*` 注入 shell 工具调用，而不是注入自己的环境），然后导入插件、打印
`BUILD` 标记、实际存在的运行时根目录、找到的自带解释器数量，最后真的 `resolvePython('')`。
子进程用 `stdio: 'inherit'` 启动：**沙箱禁止创建捕获式子进程所需的管道**，
一个「捕获自己子进程输出」的探测会在它本该验证的沙箱里以 `EPERM` 失败，
所以子进程自己打印、用退出码报告结果。优先加载 profile 里的软链接入口
（`~/.dsh/profiles/<profile>/node_modules/course-notes/index.js`，指向本仓库），
这条路径才是宿主 Loader 会解析的那一个；`BUILD` 标记用来判断当前加载的是哪一代模块。

### 3.5 `tests/check-report-consistency.mjs` — 报告自洽性

对每个「含 `run-report.json` 的 `docs/*` 目录」（或命令行给出的目录）重算并比对：

1. `noteFiles` 里列出的文件真实存在；
2. 用磁盘上的笔记重新计算覆盖率，与 `run-report.json` 声称的
   `totalKeyPoints/covered/partial/missing/ratio` 逐项一致（`ratio` 容差 0.001）；
3. `coverage-report.md` 里写出的比例与提取知识点数与 JSON 一致；
4. `writtenFiles` 里标记 `ok` 的文件真的存在；
5. 笔记的 Markdown 结构没有 `error` 级问题（围栏、`$$` 配对、相对链接…）；
6. 若有 `.coursenotes/evidence.json`，所有被引 URL 都能对上证据索引；
7. **`verified` 声明必须有干净的质量测量背书**：每个知识点每个维度都通过、
   且没有残留占位标记，否则判失败。

它**不与硬编码快照比较**，只比较产物之间的一致性 —— 这样样例内容可以演进，
而「两份报告互相矛盾」这种回归会立刻暴露。目录里放一个 `CONSISTENCY-NA.md`
会显式跳过该目录（这是一个人做出的决定，不是静默跳过）。

### 3.6 `tests/check-yaml.mjs` 与 `tests/audit-samples.mjs`

- `check-yaml.mjs`（CI 会跑，但没有 npm script）：无依赖地检查 `cordis.patch.yml`
  与 `.github/workflows/ci.yml` 里真正会让它们坏掉的东西 —— 制表符、行尾空白、CR、
  奇数缩进、超长行；`- insert:` 形状、`id`/`name` 配对数量；以及插件身份
  （`package.json` 的 `name` 必须等于补丁插入的 `name`，`dsh.bundle.patch` 必须指向
  `./cordis.patch.yml`，不得 `private`，许可为 MIT）。一个畸形的补丁文件会让 bundle 装不上，
  而这类错误不跑它就只能在推送之后才发现。
- `audit-samples.mjs`（**不在 CI 里**）：打印 `docs/sample-run` 与
  `docs/sample-run-real-pdf`（存在且有内容时）的文件清单、章节数、剩余 TODO 数、
  旧版英文块数量、覆盖率报告里的数字，以及 `make_fixtures.py` 里引用的夹具名。
  它是人工审阅用的放大镜，不做断言。

### 3.7 `tests/check-sample-reproducible.mjs` — 样例确定性

它先对待发布的 `docs/sample-run` 做一次全树摘要（相对路径 + 长度 + 一个非加密哈希），
再**真的跑一遍生成器**，然后比较前后两棵树：

- 完全相同 → 打印 `sample reproducibility OK (N files identical across two regenerations)`；
- 有差异 → 打印差异文件名并明确要求「要么把变化的量在 `make-sample-run.mjs` 里冻结/规范化，
  要么删掉这条 CI 断言，不要留一条不可能成立的断言」。

注意两个设计选择：它比较的是「磁盘上的样例 vs 重新生成的样例」（`git status` 会因为行尾或
未提交的改动撒谎，与确定性无关）；它**会重写 `docs/sample-run`**，所以运行后工作树必须与提交内容等价。
缺夹具或缺样例时它打印 `SKIP` 并以 0 退出（在 CI 里夹具总是先生成好）。

### 3.8 生成器与辅助脚本（不是测试）

| 脚本 | 作用 |
| --- | --- |
| `tests/make_fixtures.py` | 用 PyMuPDF / python-pptx / python-docx / Pillow 生成夹具：含表格+图表+公式的 PPTX、含表格+内嵌图+Heading 样式的 DOCX、含公式的 Markdown、纯文本、纯图片 |
| `tests/make-sample-run.mjs` | 用 `mode: scaffold` 跑一遍真实流水线，把结果发布到 `docs/sample-run`：路径替换为 `<sample-run>` / `<repo>` / `<fixtures>` / `<python>`，挂钟时间规范化为固定值（见 §6 第 3 条），`run-<id>` 工作目录改名；一旦运行有错误或没产出笔记文件就拒绝发布 |
| `tests/refresh-sample.mjs` | 维护脚本：把样例章节里的知识点标记按当前 id 方案改名，并按当前代码重算 `coverage-report.md`（不重新跑流水线） |
| `tests/export_pdf_pages.py` | 当某个 PDF 的数学字形映射有缺陷（`∈` 到达时已是替换字符）时，把页面渲染成图片，公式改由图读取 |

## 4. 夹具与样例

| 位置 | 性质 | 说明 |
| --- | --- | --- |
| `tests/fixtures/` | 生成物（gitignore） | 5 个文件：PPTX（表格+图表+链式法则公式）、DOCX（表格+内嵌图+Heading）、Markdown（公式）、TXT、PNG（纯图片） |
| `docs/sample-run/` | **真实产物**，随包发布 | 1.1.0 的 `mode: scaffold` 运行，由 `npm run sample` 重新生成；路径与挂钟时间都已规范化。它是骨架运行，所以覆盖率**按定义为 0%**、状态是 `scaffold_created`——这正是 1.1.0 想让读者看到的区别。说明写在 [`docs/sample-run.md`](sample-run.md)（**不能**放进 `docs/sample-run/`：那个目录会被整目录重新生成） |
| `docs/references/` | 人工精选，**不是**运行产物 | 「写完之后长什么样」的章节样例；`run-tests.mjs` 用它验证覆盖率检查能识别已撰写的笔记；其中真实课程作业的样例不随包发布 |
| `docs/sample-run-real-pdf/` | 本地样例（gitignore） | 第二个样例运行的本地副本，含作者本人作业文字，只作参考 |

**为什么可复现的样例必须是骨架模式**：提交一份模型撰写的样例，别人无法复现（没有相同的模型与提示词），
而且它会被误读为「插件自己产出的样例」。骨架运行不需要模型、网络与 API key，
笔记本身是确定性的（见 §6 里关于报告时间戳的注意事项）。

## 5. CI（`.github/workflows/ci.yml`）

矩阵：Node **22.x / 24.x**，Python **3.12**，`fail-fast: false`。步骤：

| 步骤 | 内容 |
| --- | --- |
| Check syntax | `node --check` 覆盖 `index.js`、`cli.js`、`lib/*.js`、`tests/*.mjs` |
| Install parsing backend | `pip install pymupdf python-pptx python-docx Pillow` |
| Generate fixtures | `python tests/make_fixtures.py` |
| Unit and end-to-end tests | `node tests/run-tests.mjs` |
| v1.1 regression tests | `node tests/v1.1.test.mjs`（无 API key、无网络） |
| Plugin contract tests | `node tests/plugin-contract.test.mjs` |
| Interpreter discovery without DSH_* environment | `node tests/discovery.test.mjs` |
| Sample report data consistency | `node tests/check-report-consistency.mjs` |
| Sample run is reproducible | `node tests/check-sample-reproducible.mjs`（先摘要已提交的样例，再重新生成并比对整棵树） |
| Bundle/CI/identity consistency | `node tests/check-yaml.mjs` |
| Offline CLI smoke test | `node cli.js --probe` |

## 6. 已修掉的缺陷、样例可复现性，以及这些测试证明不了的东西

前两条是**已经修掉的缺陷与它们留下的教训**，不是待办事项 —— 每一处都有回归测试守住，
删掉测试就会重新出现。

**1. 工具层曾经完全没有测试**
`plugin-contract.test.mjs` 只调用 `execute()` 中参数校验失败的分支，而 `v1.1.test.mjs` 直接调
`runPipeline()`。结果是 `index.js` 里的一处未定义引用（`isDenied`，被
`report.errors.filter(...)` 调用）能通过全部检查：`Array.prototype.filter` 对空数组不调用回调，
所以**没有错误**的运行一切正常，而**只要运行记录了一条错误**（解析失败、后端不可用、写入被拒……）
工具就抛 `ReferenceError` —— 恰恰是最需要报告的场景。
现在 `v1.1.test.mjs` 第 6 组用**合法输入**调用注册后的工具，覆盖「有解析错误」「输出目录被全部拒绝」
「输出目录被拒绝但可迁移」「干净运行」四条路径。教训：**边界层要有自己的测试**，
不能靠「底层函数都测过了」。

**2. 「打算产出」与「真的产出」是两个不同的列表**
同一个盲区还藏了第二个缺陷：沙箱迁移的触发条件是 `report.outputs.noteFiles.length === 0`，
而 `noteFiles` 描述的是运行**打算**产出的文件 —— 即使每一次写入都被拒绝，它也是非空的。
于是整条迁移路径不可达，而工具最终用 `noteFiles.length > 0` 判定 `ok`，
把一个**什么都没写成**的运行报成成功，还附上一份磁盘上不存在的笔记清单。
现在报告同时给出 `noteFiles`（打算）与 `writtenNoteFiles`（真的落盘），工具的 `ok`
只由**成功写入的笔记**决定。教训：给两个语义不同的列表起名时要让人看得出差别，
并且**断言磁盘**而不是断言意图。

**3. 样例运行如何做到可复现**
`make-sample-run.mjs` 把**路径**（`<sample-run>` / `<repo>` / `<fixtures>` / `<python>`）与**挂钟时间**
都规范化掉：运行 id（`run-YYYYMMDD-HHMMSS` → `run-20260101-000000`）、所有 ISO 时间戳 → 固定值、
`elapsedMs` / `wallMs` → `0`、`耗时 X s` / `耗时 N ms` → `0`，最后把 `run-<id>` 工作目录本身也改名。
只脱敏路径是不够的：实测同一天、同一夹具、连续两次 `mode: scaffold` 运行，
**28 个文件里 19 个不同**（`Chapter_*.md` 与 `knowledge.json` 字节相同，也就是说只有报告带时间）。
`check-sample-reproducible.mjs` 连跑两次生成器并逐文件比对，因此这个性质是被验证的，而不是被假设的。

**4. `run-report.md` 在输出阶段开始写文件之前渲染**
具体到字段：渲染时 `report.outputs` 还是流水线开头那个空对象，所以「输出文件 / Output files」
**一节是空的**（不是「当时已写入的文件」——清单在渲染之后才组装）；「已执行阶段」不含 `output`；
`completionLabel` 与 `elapsedMs` 要等最后的 `finaliseReport()` 才填，因此耗时显示 `0.0 s`、状态标签为空。
完成状态**字符串**本身是可靠的：`decideCompletion()` 在渲染之前就确定了它，
所以 `run-report.md` 与 `run-report.json` 的 `completion` 一致（`check-report-consistency.mjs`
还单独校验 `verified` 的说法是否有干净的质量测量背书）。完整写入清单在最后序列化的
`run-report.json`（`writtenFiles` / `writtenNoteFiles`）里 —— 报告内容的权威版本是 JSON。

**5. 这些套件证明不了的东西（重复一遍，因为最容易忘）**

- 没有任何测试调用真实 LLM；`verified` 是在 **mock 模型**下达成的。
- 没有任何测试发出真实网络请求；证据与检索都用 stub / 手工构造的 `retrieval` 对象。
- 没有任何测试跑在 Harness 沙箱内；假 `ctx.fs` 复刻的是**文档化的契约**，
  真实缝在宿主里（真实可写根、真实拒绝码只能由 Harness 会话验证）。
  本次升级期间确实在**本机 DSH 沙箱内**实际执行过 CLI 与测试（这是发现「子进程管道被拒」
  与「发现不了自带 Python」这两个问题的原因），但那是 CLI 路径，不是插件在 Host 进程内的路径。
- 端到端用例覆盖的是解析与渲染，**不是**「讲解在数学上是否正确」——
  覆盖率与质量分都只测量文本里出现了什么。

## 7. 新增测试的约定

1. **零依赖**：只用 `node:assert/strict` + Node 内置模块，文件必须能被 `node --check` 通过。
2. **离线**：不联网、不要 API key；需要模型就写 mock，需要检索就写 stub `web`。
3. **临时目录只放 `tests/.work/`**（已 gitignore）；需要"干净重来"就用 `fs.rmSync(dir, {recursive:true, force:true})`。
4. **优先断言磁盘上的产物**，而不是中间对象：主套件的价值大半来自「真的生成了这些文件，
   而且链接真的能解析」。断言写法用「会失败的判据」（`include` / `deepEqual`），
   不要写「不抛错就算过」。
5. **设计不变量用源码级断言守护**：像「Harness 工作区体内不得出现原生写原语」
   「迁移路径不得构造 node 工作区」这类规则，只能在源码文本上断言 —— 放在第 1 组，
   让未来的重构立刻失败。
6. **失败要可诊断**：断言消息里带上实际值（`got ${...}`），因为 CI 的日志是唯一现场。
7. **保持分组与计数**：每个套件打印分组标题、逐条 `ok`/`FAIL`、末尾 `N passed, M failed`，
   有失败就 `exit 1`；需要跳过的前提（缺夹具、缺 Python）打印 `SKIP` 与原因，**不要静默通过**。
8. **边界层测试是必需项**：改了工具 schema、参数校验、返回值形状或卸载逻辑，
   就要在 `plugin-contract.test.mjs` 或 `v1.1.test.mjs` 第 6 组补一条用**合法输入**
   调用注册后工具的用例。
