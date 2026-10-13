# CourseNotes 示例运行 / Sample run

> 这份说明放在 `docs/` 下而不是 `docs/sample-run/` 内：示例运行的目录由
> `tests/make-sample-run.mjs` **整目录重新生成**，放在里面的手写文档会被下次生成覆盖掉。

这个目录是 **CourseNotes 1.1.0 的真实输出**，由 `tests/make-sample-run.mjs` 从合成夹具
（`tests/fixtures/`）重新生成。它是一份**未撰写正文的骨架运行**（`mode: scaffold`），
因为只有骨架模式才能在没有模型、没有网络、没有 API Key 的情况下逐字节复现。

This directory is a **real CourseNotes 1.1.0 output**, regenerated from the synthetic fixtures by
`tests/make-sample-run.mjs`. It is a **scaffold run** (`mode: scaffold`) — the structure, retrieval
evidence mapping and writing brief exist, the explanatory prose was deliberately not authored,
because only that form is byte-for-byte reproducible without a model, a network connection or an
API key.

## 这次运行的状态 / What this run's state means

| 字段 / Field | 值 / Value |
| --- | --- |
| 完成状态 / Completion | `scaffold_created` |
| 依据 / Reason | `mode=scaffold`：只生成骨架与简报，正文由调用方撰写 |
| 输入 / Input | `tests/fixtures/` 下 5 个文件（PNG / PPTX / DOCX / Markdown / TXT） |
| 解析后端 / Parser | Python + PyMuPDF / python-pptx / python-docx / Pillow |
| 章节 / Chapters | 4 |
| 知识点 / Knowledge points | 21 |
| 外部检索 / Retrieval | 未执行（示例运行必须离线可复现） |
| 覆盖率 / Coverage | 0.0%（正文未撰写；覆盖率衡量的是**正文**，见下） |

`scaffold_created` **不是**成功状态：笔记里仍然带有 `<!-- COURSENOTES:TODO -->` 占位标记，
每一个知识点的中文与英文讲解都还没有写。这正是 1.1.0 想表达的区别 ——
**文件生成成功 ≠ 笔记完成**。

`scaffold_created` is **not** a success state: the notes still carry `<!-- COURSENOTES:TODO -->`
placeholders and no knowledge point has prose yet. That gap is exactly what v1.1.0 exists to make
visible — *writing the files is not the same as finishing the notes*.

## 文件 / Files

| 文件 | 内容 |
| --- | --- |
| `README.md` | 课程索引：来源文件表、章节列表、术语表、覆盖率/质量摘要、完成状态 |
| `Chapter_NN_*.md` | 每章一个文件：章节概述、学习目标、知识结构、逐知识点小节（带 `COURSENOTES:POINT` 标记）、公式清单、图表解读、术语表、参考资料 |
| `knowledge.json` | 提取出的章节 / 知识点 / 术语 / 公式，带稳定 ID 与页码定位 |
| `coverage-report.md` | 覆盖率报告 + **多维质量检查**（结构 / 内容 / 双语 / 公式 / 引用 / 全维度通过） |
| `run-report.md` | 人读处理报告：完成状态、解析、证据映射、多模态、输出文件、错误与已知限制 |
| `run-report.json` | 机器可读版本，**与上面所有报告来自同一份最终状态** |
| `assets/` | 课件中提取出的图片，按相对路径被笔记引用 |
| `.coursenotes/note-brief.md` | 撰写简报（给 Agent 或人） |
| `.coursenotes/evidence.json` | 知识点 ↔ 检索证据映射（本示例无检索，因此为空） |
| `.coursenotes/vision-results.json` | 图表视觉任务与解读结果（本示例 `pending` 全部待处理） |
| `.coursenotes/run-20260101-000000/` | 各阶段的中间产物，便于逐步复查 |

## 关于覆盖率 0% / Why coverage is 0 %

覆盖率只统计**笔记正文**，不计入作为“材料原文依据”嵌入的代码块与结构标题 —— 否则每个知识点
都会因为原文被抄进去而自动“覆盖”，指标就失去意义。骨架运行因此必然接近 0%。

Coverage counts *authored prose* only. The source excerpt embedded as evidence, the headings and the
scaffold furniture are excluded on purpose: counting them would make every point look covered the
moment its own source text was copied in. A scaffold run therefore scores ~0 % by construction.

## 关于时间戳 / About the timestamps

报告里的运行编号与时间是**规范化过的固定值**（`run-20260101-000000`、`2026-01-01T00:00:00.000Z`），
这样重新生成示例运行会得到逐字节相同的结果，CI 才能真的验证“示例可复现”。
真实运行当然会记录真实时间。

Run ids and timestamps in these reports are **normalised to fixed values** so that regenerating the
sample is byte-for-byte reproducible — which is what lets CI verify that property. A real run records
real times.

## 想看已撰写正文的样例 / Looking for authored prose

[`references/`](references/) 目录保存了由模型撰写过的章节样例（人工精选，非运行产物），
用于展示“写完之后长什么样”。

## 重新生成 / Regenerating

```bash
npm run fixtures         # 生成 tests/fixtures/（需要 Python 解析后端）
npm run sample           # 重新生成 sample-run/
npm run check:reports    # 校验报告之间的一致性
npm run check:sample     # 校验示例运行可复现
```

`check:reports` 会重新计算覆盖率与质量指标，并与 `run-report.json`、`coverage-report.md` 里声称的
数字逐一比对 —— 这是防止 1.0 版“两份报告数字不一致”问题回归的守门测试。
