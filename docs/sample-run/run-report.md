# CourseNotes 处理报告 / Processing Report

- 运行编号 / Run: `run-20261013-142142`
- 开始 / Started: 2026-10-13T14:21:42.351Z
- 结束 / Finished: —
- 耗时 / Elapsed: 0.0 s
- 输出目录 / Output: `C:/Users/10679/Documents/deepseek-harness/plugins/course-notes/docs/sample-run`
- 过程目录 / Work dir: `C:/Users/10679/Documents/deepseek-harness/plugins/course-notes/docs/sample-run/.coursenotes/run-20261013-142142`

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
- 解析后端 / backend: C:/Users/10679/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/python/python.exe (Python 3.12.14)，耗时 342 ms

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
## 覆盖率 / Coverage

- 知识点 / key points: 21；已覆盖 0；部分 0；未覆盖 21
- 覆盖率 / ratio: 0.0%（加权 0.0%）

## 输出文件 / Output files


## 已知限制 / Known limitations

- 外部检索未执行：配置中已关闭（enableWebSearch=false）。
- 覆盖率是词元重合度指标，改写但等义的内容可能被判为“部分覆盖”；它不代表讲解正确性。
- 本次运行未启用 LLM 补全：笔记文件中由模型撰写的段落保留 `<!-- COURSENOTES:TODO -->` 标记，需由 Agent 或人工补全。
