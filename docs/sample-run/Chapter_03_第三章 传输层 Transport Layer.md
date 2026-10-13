## 第 3 章 / Chapter 3　第三章 传输层 / Transport Layer

### 章节概述 / Chapter Overview

- 原始课件 / Source files: fixture_ch3.md
- 知识点数量 / Knowledge points: 5
- 公式候选 / Formula candidates: 1
- 图表待解读 / Figures needing vision: 0

<!-- COURSENOTES:TODO --> 用 3–6 句写出本章概述：本章解决什么问题、与前后章的关系、学完后应具备的能力。

### 本章学习目标 / Learning Objectives

<!-- COURSENOTES:TODO --> 依据本章知识点写出 3–6 条可检验的学习目标（能推导/能实现/能对比/能判断）。

### 知识结构 / Knowledge Outline

- 第三章 传输层 / Transport Layer
  - 复用与分用
  - 可靠传输

### 详细知识点 / Detailed Knowledge Points

<!-- COURSENOTES:POINT K013 START -->
### 1. 传输层通过端口号（port number）实现复用（multiplexing）与分用（demultiplexing）。
**类型 / Kind**: 概念　**来源 / Source**: fixture_ch3.md · line 5 · 复用与分用

**术语定义 / Definition**

- <!-- COURSENOTES:TODO --> 从材料中未能自动识别术语对，请依据来源文本补充术语、英文全称与缩写。

#### 中文讲解 / Chinese Explanation

**材料原文依据 / Material evidence**

```text
传输层通过端口号（port number）实现复用（multiplexing）与分用（demultiplexing）。
```

<!-- COURSENOTES:TODO --> 在此写出中文详细讲解：概念是什么 → 为什么需要 → 如何工作 → 数学/技术原理 → 示例 → 应用 → 常见误区。不得压缩为要点罗列。

#### 英文讲解 / English Explanation

<!-- COURSENOTES:TODO --> Write the full English explanation here with the same technical content, definitions and conclusions as the Chinese section. It must not be a translation of the headings only.

#### 易错点 / Common Misconceptions

<!-- COURSENOTES:TODO --> 列出 1–3 条本知识点的常见误解与区分要点。

**来源 / References**

- [课件内容] fixture_ch3.md · line 5 · 复用与分用

<!-- COURSENOTES:POINT K013 END -->

<!-- COURSENOTES:POINT K014 START -->
### 2. 无连接分用：UDP 仅使用目的端口
**类型 / Kind**: 概念　**来源 / Source**: fixture_ch3.md · line 7 · 复用与分用

**术语定义 / Definition**

- <!-- COURSENOTES:TODO --> 从材料中未能自动识别术语对，请依据来源文本补充术语、英文全称与缩写。

#### 中文讲解 / Chinese Explanation

**材料原文依据 / Material evidence**

```text
无连接分用：UDP 仅使用目的端口
```

<!-- COURSENOTES:TODO --> 在此写出中文详细讲解：概念是什么 → 为什么需要 → 如何工作 → 数学/技术原理 → 示例 → 应用 → 常见误区。不得压缩为要点罗列。

#### 英文讲解 / English Explanation

<!-- COURSENOTES:TODO --> Write the full English explanation here with the same technical content, definitions and conclusions as the Chinese section. It must not be a translation of the headings only.

#### 易错点 / Common Misconceptions

<!-- COURSENOTES:TODO --> 列出 1–3 条本知识点的常见误解与区分要点。

**来源 / References**

- [课件内容] fixture_ch3.md · line 7 · 复用与分用

<!-- COURSENOTES:POINT K014 END -->

<!-- COURSENOTES:POINT K015 START -->
### 3. 面向连接分用：TCP 使用四元组 (源IP, 源端口, 目的IP, 目的端口)
**类型 / Kind**: 概念　**来源 / Source**: fixture_ch3.md · line 8 · 复用与分用

**术语定义 / Definition**

- <!-- COURSENOTES:TODO --> 从材料中未能自动识别术语对，请依据来源文本补充术语、英文全称与缩写。

#### 中文讲解 / Chinese Explanation

**材料原文依据 / Material evidence**

```text
面向连接分用：TCP 使用四元组 (源IP, 源端口, 目的IP, 目的端口)
```

<!-- COURSENOTES:TODO --> 在此写出中文详细讲解：概念是什么 → 为什么需要 → 如何工作 → 数学/技术原理 → 示例 → 应用 → 常见误区。不得压缩为要点罗列。

#### 英文讲解 / English Explanation

<!-- COURSENOTES:TODO --> Write the full English explanation here with the same technical content, definitions and conclusions as the Chinese section. It must not be a translation of the headings only.

#### 易错点 / Common Misconceptions

<!-- COURSENOTES:TODO --> 列出 1–3 条本知识点的常见误解与区分要点。

**来源 / References**

- [课件内容] fixture_ch3.md · line 8 · 复用与分用

<!-- COURSENOTES:POINT K015 END -->

<!-- COURSENOTES:POINT K016 START -->
### 4. 停等协议（Stop-and-Wait）的利用率： $$U = \frac{T_{transmit}}{T_{transmit} + 2 \cdot T_{prop}}$$
**类型 / Kind**: 公式　**来源 / Source**: fixture_ch3.md · line 14 · 可靠传输

**术语定义 / Definition**

- <!-- COURSENOTES:TODO --> 从材料中未能自动识别术语对，请依据来源文本补充术语、英文全称与缩写。

#### 中文讲解 / Chinese Explanation

**材料原文依据 / Material evidence**

```text
$$U = \frac{T_{transmit}}{T_{transmit} + 2 \cdot T_{prop}}$$
```

<!-- COURSENOTES:TODO --> 在此写出中文详细讲解：概念是什么 → 为什么需要 → 如何工作 → 数学/技术原理 → 示例 → 应用 → 常见误区。不得压缩为要点罗列。

#### 英文讲解 / English Explanation

<!-- COURSENOTES:TODO --> Write the full English explanation here with the same technical content, definitions and conclusions as the Chinese section. It must not be a translation of the headings only.

#### 数学原理 / Mathematical Principles

$$
\text{（替换为材料中的公式 / replace with the formula from the material）}
$$

<!-- COURSENOTES:TODO --> 逐项说明：① 每个变量与符号的含义、量纲与取值范围；② 公式成立的条件与前提；③ 必要的推导步骤；④ 直观意义；⑤ 一个完整的数值计算示例。

#### 易错点 / Common Misconceptions

<!-- COURSENOTES:TODO --> 列出 1–3 条本知识点的常见误解与区分要点。

**来源 / References**

- [课件内容] fixture_ch3.md · line 14 · 可靠传输

<!-- COURSENOTES:POINT K016 END -->

<!-- COURSENOTES:POINT K017 START -->
### 5. 表格：机制 / 作用
**类型 / Kind**: 表格　**来源 / Source**: fixture_ch3.md · line 16 · 可靠传输

**术语定义 / Definition**

- <!-- COURSENOTES:TODO --> 从材料中未能自动识别术语对，请依据来源文本补充术语、英文全称与缩写。

#### 中文讲解 / Chinese Explanation

**材料原文依据 / Material evidence**

```text
机制 | 作用
超时重传 | 处理丢失
累计确认 | 提高效率
```

<!-- COURSENOTES:TODO --> 在此写出中文详细讲解：概念是什么 → 为什么需要 → 如何工作 → 数学/技术原理 → 示例 → 应用 → 常见误区。不得压缩为要点罗列。

#### 英文讲解 / English Explanation

<!-- COURSENOTES:TODO --> Write the full English explanation here with the same technical content, definitions and conclusions as the Chinese section. It must not be a translation of the headings only.

#### 易错点 / Common Misconceptions

<!-- COURSENOTES:TODO --> 列出 1–3 条本知识点的常见误解与区分要点。

**来源 / References**

- [课件内容] fixture_ch3.md · line 16 · 可靠传输

<!-- COURSENOTES:POINT K017 END -->

### 公式清单 / Formula Checklist

- `U = \frac{T_{transmit}}{T_{transmit} + 2 \cdot T_{prop}}` — fixture_ch3.md · line 14（识别依据：inline LaTeX math in a text source）

<!-- COURSENOTES:TODO --> 为以上每个公式补全 LaTeX 表示、变量定义、成立条件、推导与数值示例。

### 本章总结 / Chapter Summary

<!-- COURSENOTES:TODO --> 用要点+一句话结论总结本章，并指出与后续章节的衔接。

### 术语表 / Glossary

（本章未自动识别到术语对，请依据来源文本补充。）

### 重点与难点 / Key Points and Difficulties

<!-- COURSENOTES:TODO --> 标注本章重点与难点，并说明难在哪里（概念抽象/推导繁琐/易混淆/需要先修知识）。

### 自测题 / Self-Assessment Questions

<!-- COURSENOTES:TODO --> 生成 3–5 道可自测的问题（含答案要点），覆盖本章核心知识点。

### 参考资料 / References

- （本次运行未获取到可引用的外部来源。/ No external reference was retrieved in this run.)

