# 知识点覆盖率报告 / Knowledge Coverage Report

生成时间 / Generated at: 2026-10-13T14:21:43.147Z

> 覆盖率只反映“提取到的知识点是否在笔记中出现”，**不代表讲解的正确性**。
> Coverage only reports whether extracted knowledge points appear in the notes;
> it is **not** a measure of correctness.

## 汇总 / Summary

- 提取知识点 / Extracted knowledge points: **21**
- 已覆盖 / Covered: **7**
- 部分覆盖 / Partially covered: **0**
- 未覆盖 / Not covered: **14**
- 覆盖率 / Coverage ratio: **33.3%**（加权：33.3%）
- 判定阈值 / Thresholds: covered ≥ 0.55, partial ≥ 0.25

### 结构完整度 vs 内容完整度 / Scaffold vs authored content

- 已生成小节的知识点 / key points that have their own section: **21/21**（100.0%）
- 尚未由模型撰写的位置 / remaining authoring markers (`COURSENOTES:TODO`): **74**

> ⚠ 笔记骨架已完整生成，但讲解正文尚未撰写。上面的“覆盖率”衡量的是**正文内容**是否覆盖知识点，因此此时偏低是预期结果：请先按 `note-brief.md` 补全全部 TODO，再重新运行本检查。
> The note skeleton is complete but the explanatory prose has not been written yet. The coverage
> ratio above measures *authored content*, so a low value here is expected until the TODO
> markers are filled in from `note-brief.md`.

> 覆盖率只反映“提取到的知识点是否在笔记中出现”，**不代表讲解的正确性**。
> Coverage only reports whether extracted knowledge points appear in the notes;
> it is **not** a measure of correctness.

> 说明：笔记中作为“材料原文依据”嵌入的代码块不计入覆盖统计，只有正文散文计入；否则每个知识点都会因原文被复制而自动“覆盖”。

## 分章覆盖 / Per-chapter coverage

| 章 / Chapter | 知识点 | 已覆盖 | 部分 | 未覆盖 | 覆盖率 |
| --- | --- | --- | --- | --- | --- |
| 第 1 章 第 2 讲 神经网络基础 | 7 | 7 | 0 | 0 | 100.0% |
| 第 2 章 第一章 概述 | 5 | 0 | 0 | 5 | 0.0% |
| 第 3 章 第三章 传输层 / Transport Layer | 5 | 0 | 0 | 5 | 0.0% |
| 第 4 章 fixture_lab | 4 | 0 | 0 | 4 | 0.0% |

## 术语覆盖 / Glossary coverage

- 术语总数 / Total terms: 9；出现在笔记中 / present in notes: 9

## 公式覆盖 / Formula coverage

- 公式候选 / candidates: 4；已覆盖 4；部分 0；未覆盖 0

| # | 公式 / Formula | 来源 | 匹配度 | 状态 |
| --- | --- | --- | --- | --- |
| 1 | `链式法则：dL/dW = dL/dy * dy/dz * dz/dW` | fixture_lecture.pptx · slide 4 | 1 | covered |
| 2 | `其中 z = Wx + b，y = sigma(z)，sigma 为激活函数` | fixture_lecture.pptx · slide 4 | 1 | covered |
| 3 | `信道容量遵循香农公式 C = B * log2(1 + S/N)，其中 B 为带宽，S/N 为信噪比。` | fixture_outline.docx · paragraph 8 | 1 | covered |
| 4 | `U = \frac{T_{transmit}}{T_{transmit} + 2 \cdot T_{prop}}` | fixture_ch3.md · line 14 | 1 | covered |

## 未覆盖知识点 / Uncovered knowledge points

| ID | 章 | 知识点 | 来源 | 匹配度 |
| --- | --- | --- | --- | --- |
| K008 | 2 | 计算机网络（Computer Network）将地理位置不同的计算机互联，实现资源共享与信息传递。 | fixture_outline.docx · paragraph 2 | 0.24 |
| K009 | 2 | OSI 七层模型：物理层（Physical Layer）、数据链路层（Data Link Layer, DLL）、网… | fixture_outline.docx · paragraph 4 | 0.24 |
| K010 | 2 | 网络层 PDU 称为分组（packet），传输层 PDU 称为报文段（segment）。 | fixture_outline.docx · paragraph 5 | 0.24 |
| K011 | 2 | 表格：对比项 / 面向连接 vs 无连接 | fixture_outline.docx · table 1 | 0.24 |
| K012 | 2 | 信道容量遵循香农公式 C = B * log2(1 + S/N)，其中 B 为带宽，S/N 为信噪比。 | fixture_outline.docx · paragraph 8 | 0.24 |
| K013 | 3 | 传输层通过端口号（port number）实现复用（multiplexing）与分用（demultiplexing）。 | fixture_ch3.md · line 5 | 0.24 |
| K014 | 3 | 无连接分用：UDP 仅使用目的端口 | fixture_ch3.md · line 7 | 0.24 |
| K015 | 3 | 面向连接分用：TCP 使用四元组 (源IP, 源端口, 目的IP, 目的端口) | fixture_ch3.md · line 8 | 0.24 |
| K016 | 3 | 停等协议（Stop-and-Wait）的利用率： $$U = \frac{T_{transmit}}{T_{transmit} + 2 \cdot T_{pro | fixture_ch3.md · line 14 | 0.24 |
| K017 | 3 | 表格：机制 / 作用 | fixture_ch3.md · line 16 | 0.24 |
| K018 | 4 | 实验一 数据链路层抓包 | fixture_lab.txt · line 1 | 0.24 |
| K019 | 4 | 1. 使用 Wireshark 抓取 ARP 请求与应答。 | fixture_lab.txt · line 2 | 0.24 |
| K020 | 4 | 2. 分析以太网帧（Ethernet frame）首部字段：目的 MAC、源 MAC、类型。 | fixture_lab.txt · line 3 | 0.24 |
| K021 | 4 | 3. 记录 CRC 校验字段长度，思考其检错能力。 | fixture_lab.txt · line 4 | 0.24 |

处理要求 / Required action: 逐一补全，或在此说明无法补全的原因（例如材料本身缺失、需要付费文献、图片无法识别）。

## 笔记文件 / Note files

- Chapter_01_第 2 讲 神经网络基础.md（60790 字符）
- Chapter_02_第一章 概述.md（6595 字符）
- Chapter_03_第三章 传输层 Transport Layer.md（5769 字符）
- Chapter_04_fixture_lab.md（4426 字符）

## 覆盖方法说明 / Method note

匹配使用 CJK 二元组与英文词的词元重合度，并优先采信标题原样出现。因此“改写但等义”的讲解可能被判为部分覆盖，属于保守估计。该指标仅用于内部完整性核查。
