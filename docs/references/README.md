# 已撰写章节参考样例 / Authored chapter references

这两个文件**不是**某次运行的产物，也不是可复现的示例运行，而是**人工精选的参考样例**，
用来展示 CourseNotes 的“写完之后”应该长什么样：双语讲解、公式推导、图表解读、来源标注。

These two files are **not** run artifacts and are **not** reproducible sample runs. They are curated
references showing what a *finished* CourseNotes chapter looks like: bilingual explanations,
formula derivations, figure interpretation and provenance labels.

| 文件 / File | 来源 / Origin | 说明 |
| --- | --- | --- |
| [`authored-chapter-example.md`](authored-chapter-example.md) | 合成夹具（`tests/fixtures/`） | 神经网络的优化与反向传播；结构与 ID 与 1.0 版一致，用于验证覆盖率检查能识别“已撰写”的笔记 |
| [`authored-chapter-real-coursework.md`](authored-chapter-real-coursework.md) | 作者本人的真实课程 PDF | 含作者自己的作业文字，因此**只作参考保留，不随包发布**（在 npm `files` 白名单之外） |

## 为什么它们不是示例运行 / Why they are not a sample run

一次真实的“已撰写”运行需要一个模型。把这个结果提交进仓库会有两个问题：别人无法复现它
（没有相同的模型与提示词），而且它会被误读为“插件自身产出的样例”。

因此：

* 可复现的示例运行放在 [`docs/sample-run/`](../sample-run/)（骨架模式，离线可复现，附完成状态说明）；
* 本目录只保存“成品长什么样”的参考样例。

提交一份真实的、由模型撰写的运行结果，需要连同当时的模型、提示词预算与检索结果一起记录，
这属于“运行快照”，不属于示例。

## 它们验证了什么 / What they are used for

* `tests/run-tests.mjs` 用 `authored-chapter-example.md` 验证覆盖率检查对**已撰写**笔记的判定；
* 文档用它们说明“骨架”与“成品”的区别。

`docs/sample-run-real-pdf/`（存在时）是第二个样例运行的本地副本，未纳入版本控制。
