# CourseNotes 处理报告 / Processing Report

- 运行编号 / Run: `run-20260101-000000`
- 插件版本 / Version: 1.1.0
- 开始 / Started: 2026-01-01T00:00:00.000Z
- 结束 / Finished: —
- 耗时 / Elapsed: 0.0 s
- 输出目录 / Output: `<sample-run>`
- 过程目录 / Work dir: `<sample-run>/.coursenotes/run-20260101-000000`
- 文件写入 / File writes: Node fs（CLI 模式）

## 完成状态 / Completion state

- 状态 / State: **`scaffold_created`** — 
- 依据 / Reason: mode=scaffold：只生成骨架与简报，正文由调用方（Agent/人工）撰写。
- 已执行阶段 / Stages executed: scan → parse → knowledge → retrieve → generate → check

> `verified` 是唯一表示“全部知识点都已写入且通过检查”的状态；文件生成成功不等于笔记完成。
> `verified` is the only state meaning every knowledge point was written and passed the checks.

## 输入扫描 / Input scan

```text
输入位置 1 个 / input roots: 1
  [OK] fixture_ch3.md — Markdown, 551 B
  [OK] fixture_chart.png — image, 4.5 KiB
  [OK] fixture_lab.txt — plain text, 235 B
  [OK] fixture_lecture.pptx — PowerPoint (OOXML), 39.9 KiB
  [OK] fixture_outline.docx — Word (OOXML), 40.9 KiB
```

## 解析结果 / Parsing

- 文档 / documents: 5（成功 5，失败 0）
- 内容 / content: 36 单元，979 字符
- 结构 / structure: 3 表格，3 图，4 公式候选
- 图表待解读 / figures needing vision: 3
- 警告 / warnings: 0
- 解析后端 / backend: <python> (Python 3.12.14)，耗时 0 ms

| ID | 文件 / File | 格式 | 类型 | 单元 | 字符 | 表格 | 图 | 公式 | 状态 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| D01-fixture-chart | fixture_chart.png | image | notes | 0 | 0 | 0 | 1 | 0 | OK |
| D02-fixture-lecture | fixture_lecture.pptx | pptx | lecture | 14 | 340 | 1 | 1 | 2 | OK |
| D03-fixture-outline | fixture_outline.docx | docx | notes | 9 | 287 | 1 | 1 | 1 | OK |
| D04-fixture-ch3 | fixture_ch3.md | markdown | lecture | 9 | 241 | 1 | 0 | 1 | OK |
| D05-fixture-lab | fixture_lab.txt | text | lab | 4 | 111 | 0 | 0 | 0 | OK |

## 知识结构 / Knowledge structure

- 章节 / chapters: 4
- 知识点 / knowledge points: 21
- 术语 / glossary terms: 9
- 公式候选 / formula candidates: 4
- 依赖关系 / dependencies: 0

| 章 / Chapter | 标题 | 知识点 | 公式 | 图表 |
| --- | --- | --- | --- | --- |
| 1 | 第 2 讲 神经网络基础 | 7 | 2 | 1 |
| 2 | 第一章 概述 | 5 | 1 | 1 |
| 3 | 第三章 传输层 / Transport Layer | 5 | 1 | 0 |
| 4 | fixture_lab | 4 | 0 | 0 |

## 外部检索 / External retrieval

外部检索未执行：配置中已关闭（enableWebSearch=false）。

- 配置开关 / `enableWebSearch`: false（用户关闭）
- Harness web 服务 / ctx.web: 未注册 / not registered
## 证据映射 / Evidence mapping

- 有外部证据的知识点 / points with external evidence: 0/21
- 证据条目 / evidence excerpts: 0（0 字符进入提示词）
- 可引用 URL 白名单 / citable URLs: 0

## 多模态 / Multimodal

- 视觉任务 / vision tasks: 3 个（已解读 0，待处理 3）；模型不支持图像输入 / the model is text-only（no provider/model is resolvable for this session）。未解读的图表在笔记中明确标注，不会被当作已完成。Un-interpreted figures are marked explicitly, never presented as done.
- 模型视觉能力 / model vision: 不支持 / text-only — no provider/model is resolvable for this session
- 结果文件 / results file: `.coursenotes/vision-results.json`（已应用 0 条）

## 分块撰写 / Chunked authoring

- 未执行 / not attempted: mode=scaffold：只生成骨架与简报，正文由调用方（Agent/人工）撰写。

## 多维质量 / Multi-dimensional quality

- 全维度通过 / all dimensions: 0/21（0.0%）
- 结构 / structure: 21/21
- 内容 / content: 0/21
- 双语 / bilingual: 0/21
- 公式 / formulas: 渲染 1/4，解释 1/4
- 引用 / citations: 未执行检索，无法核对
- 语义检查 / semantic: 未执行

## 覆盖率 / Coverage

- 知识点 / key points: 21；已覆盖 0；部分 0；未覆盖 21
- 覆盖率 / ratio: 0.0%（加权 0.0%）

## 输出文件 / Output files


## 警告 / Warnings

- [author/authoring-disabled-by-mode] mode=scaffold：只生成骨架与简报，正文由调用方（Agent/人工）撰写。

## 已知限制 / Known limitations

- 外部检索未执行：配置中已关闭（enableWebSearch=false）。
- 覆盖率与质量分都由笔记文本统计得出，只说明“内容是否出现”，不代表讲解正确。
- 本次运行的状态是 `scaffold_created`，不是 `verified`；未完成的知识点保留 `<!-- COURSENOTES:TODO -->` 标记，请在补全后重新运行 `check_notes_coverage`。
