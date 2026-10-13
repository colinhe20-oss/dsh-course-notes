## 第 1 章 / Chapter 1　第 2 讲 神经网络基础

### 章节概述 / Chapter Overview

<!-- COURSENOTES:SECTION C01-OVERVIEW START -->
<!-- COURSENOTES:TODO --> 用 3–6 句写出本章概述：本章解决什么问题、与前后章的关系、学完后应具备的能力。
<!-- COURSENOTES:SECTION C01-OVERVIEW END -->

- 原始课件 / Source files: fixture_lecture.pptx
- 知识点数量 / Knowledge points: 7
- 公式候选 / Formula candidates: 2
- 图表待解读 / Figures needing vision: 1

### 本章学习目标 / Learning Objectives

<!-- COURSENOTES:SECTION C01-OBJECTIVES START -->
<!-- COURSENOTES:TODO --> 依据本章知识点写出 3–6 条可检验的学习目标（能推导/能实现/能对比/能判断）。
<!-- COURSENOTES:SECTION C01-OBJECTIVES END -->

### 知识结构 / Knowledge Outline

- 第 2 讲 神经网络基础
  - 梯度下降与学习率
    - 参数更新：theta <- theta - eta * grad L
    - 学习率 eta 过大导致震荡，过小导致收敛缓慢
    - 随机梯度下降（Stochastic Gradient Descent, SGD）每次用一个样本估计梯度
  - 优化器对比
  - 反向传播推导要点

### 详细知识点 / Detailed Knowledge Points

<!-- COURSENOTES:POINT K001 START -->
### K001 · 1. Neural Network Basics / 优化与反向传播
**类型 / Kind**: 概念　**来源 / Source**: fixture_lecture.pptx · slide 1

**术语定义 / Definition**

- <!-- COURSENOTES:TODO --> 从材料中未能自动识别术语对，请依据来源文本补充术语、英文全称与缩写。

#### 中文讲解 / Chinese Explanation

**材料原文依据 / Material evidence**

```text
Neural Network Basics / 优化与反向传播
```

<!-- COURSENOTES:TODO --> 在此写出中文详细讲解：概念是什么 → 为什么需要 → 如何工作 → 数学/技术原理 → 示例 → 应用 → 常见误区。不得压缩为要点罗列。

#### 英文讲解 / English Explanation

<!-- COURSENOTES:TODO --> Write the full English explanation here with the same technical content, definitions and conclusions as the Chinese section. It must not be a translation of the headings only.

#### 易错点 / Common Misconceptions

<!-- COURSENOTES:TODO --> 列出 1–3 条本知识点的常见误解与区分要点。

**来源 / References**

- [课件内容] fixture_lecture.pptx · slide 1

<!-- COURSENOTES:POINT K001 END -->

<!-- COURSENOTES:POINT K002 START -->
### K002 · 2. 梯度下降（Gradient Descent, GD）沿负梯度方向更新参数
**类型 / Kind**: 概念　**来源 / Source**: fixture_lecture.pptx · slide 2 · 梯度下降与学习率

**术语定义 / Definition**

- 梯度下降（Gradient Descent, GD）

#### 中文讲解 / Chinese Explanation

**材料原文依据 / Material evidence**

```text
梯度下降（Gradient Descent, GD）沿负梯度方向更新参数
```

<!-- COURSENOTES:TODO --> 在此写出中文详细讲解：概念是什么 → 为什么需要 → 如何工作 → 数学/技术原理 → 示例 → 应用 → 常见误区。不得压缩为要点罗列。

#### 英文讲解 / English Explanation

<!-- COURSENOTES:TODO --> Write the full English explanation here with the same technical content, definitions and conclusions as the Chinese section. It must not be a translation of the headings only.

#### 易错点 / Common Misconceptions

<!-- COURSENOTES:TODO --> 列出 1–3 条本知识点的常见误解与区分要点。

**来源 / References**

- [课件内容] fixture_lecture.pptx · slide 2 · 梯度下降与学习率

<!-- COURSENOTES:POINT K002 END -->

<!-- COURSENOTES:POINT K003 START -->
### K003 · 3. 强调学习率对收敛性的影响。
**类型 / Kind**: 概念　**来源 / Source**: fixture_lecture.pptx · slide 2 notes · 随机梯度下降（Stochastic Gradient Descent, SGD）每次用一个样本估计梯度

**术语定义 / Definition**

- <!-- COURSENOTES:TODO --> 从材料中未能自动识别术语对，请依据来源文本补充术语、英文全称与缩写。

#### 中文讲解 / Chinese Explanation

**材料原文依据 / Material evidence**

```text
强调学习率对收敛性的影响。
```

<!-- COURSENOTES:TODO --> 在此写出中文详细讲解：概念是什么 → 为什么需要 → 如何工作 → 数学/技术原理 → 示例 → 应用 → 常见误区。不得压缩为要点罗列。

#### 英文讲解 / English Explanation

<!-- COURSENOTES:TODO --> Write the full English explanation here with the same technical content, definitions and conclusions as the Chinese section. It must not be a translation of the headings only.

#### 易错点 / Common Misconceptions

<!-- COURSENOTES:TODO --> 列出 1–3 条本知识点的常见误解与区分要点。

**来源 / References**

- [课件内容] fixture_lecture.pptx · slide 2 notes · 随机梯度下降（Stochastic Gradient Descent, SGD）每次用一个样本估计梯度

<!-- COURSENOTES:POINT K003 END -->

<!-- COURSENOTES:POINT K004 START -->
### K004 · 4. 表格：优化器 / 更新依据 / 典型学习率
**类型 / Kind**: 表格　**来源 / Source**: fixture_lecture.pptx · slide 3 · 优化器对比

**术语定义 / Definition**

- <!-- COURSENOTES:TODO --> 从材料中未能自动识别术语对，请依据来源文本补充术语、英文全称与缩写。

#### 中文讲解 / Chinese Explanation

**材料原文依据 / Material evidence**

```text
优化器 | 更新依据 | 典型学习率
SGD | 当前样本梯度 | 0.01 - 0.1
Momentum | 梯度指数滑动平均 | 0.01
Adam | 一阶/二阶矩估计 | 0.001
```

<!-- COURSENOTES:TODO --> 在此写出中文详细讲解：概念是什么 → 为什么需要 → 如何工作 → 数学/技术原理 → 示例 → 应用 → 常见误区。不得压缩为要点罗列。

#### 英文讲解 / English Explanation

<!-- COURSENOTES:TODO --> Write the full English explanation here with the same technical content, definitions and conclusions as the Chinese section. It must not be a translation of the headings only.

#### 易错点 / Common Misconceptions

<!-- COURSENOTES:TODO --> 列出 1–3 条本知识点的常见误解与区分要点。

**来源 / References**

- [课件内容] fixture_lecture.pptx · slide 3 · 优化器对比

<!-- COURSENOTES:POINT K004 END -->

<!-- COURSENOTES:POINT K005 START -->
### K005 · 5. 链式法则：dL/dW = dL/dy * dy/dz * dz/dW
**类型 / Kind**: 概念　**来源 / Source**: fixture_lecture.pptx · slide 4 · 反向传播推导要点

**术语定义 / Definition**

- <!-- COURSENOTES:TODO --> 从材料中未能自动识别术语对，请依据来源文本补充术语、英文全称与缩写。

#### 中文讲解 / Chinese Explanation

**材料原文依据 / Material evidence**

```text
链式法则：dL/dW = dL/dy * dy/dz * dz/dW
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

- [课件内容] fixture_lecture.pptx · slide 4 · 反向传播推导要点

<!-- COURSENOTES:POINT K005 END -->

<!-- COURSENOTES:POINT K006 START -->
### K006 · 6. 其中 z = Wx + b，y = sigma(z)，sigma 为激活函数
**类型 / Kind**: 概念　**来源 / Source**: fixture_lecture.pptx · slide 4 · 反向传播推导要点

**术语定义 / Definition**

- <!-- COURSENOTES:TODO --> 从材料中未能自动识别术语对，请依据来源文本补充术语、英文全称与缩写。

#### 中文讲解 / Chinese Explanation

**材料原文依据 / Material evidence**

```text
其中 z = Wx + b，y = sigma(z)，sigma 为激活函数
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

- [课件内容] fixture_lecture.pptx · slide 4 · 反向传播推导要点

<!-- COURSENOTES:POINT K006 END -->

<!-- COURSENOTES:POINT K007 START -->
### K007 · 7. 雅可比矩阵维度：dL/dz 为 (n,1)，dz/dW 为 (n,m)
**类型 / Kind**: 概念　**来源 / Source**: fixture_lecture.pptx · slide 4 · 反向传播推导要点

**术语定义 / Definition**

- <!-- COURSENOTES:TODO --> 从材料中未能自动识别术语对，请依据来源文本补充术语、英文全称与缩写。

#### 中文讲解 / Chinese Explanation

**材料原文依据 / Material evidence**

```text
雅可比矩阵维度：dL/dz 为 (n,1)，dz/dW 为 (n,m)
```

<!-- COURSENOTES:TODO --> 在此写出中文详细讲解：概念是什么 → 为什么需要 → 如何工作 → 数学/技术原理 → 示例 → 应用 → 常见误区。不得压缩为要点罗列。

#### 英文讲解 / English Explanation

<!-- COURSENOTES:TODO --> Write the full English explanation here with the same technical content, definitions and conclusions as the Chinese section. It must not be a translation of the headings only.

#### 易错点 / Common Misconceptions

<!-- COURSENOTES:TODO --> 列出 1–3 条本知识点的常见误解与区分要点。

**来源 / References**

- [课件内容] fixture_lecture.pptx · slide 4 · 反向传播推导要点

<!-- COURSENOTES:POINT K007 END -->

### 公式清单 / Formula Checklist

- `链式法则：dL/dW = dL/dy * dy/dz * dz/dW` — fixture_lecture.pptx · slide 4（识别依据：contains mathematical symbols or an equation pattern）
- `其中 z = Wx + b，y = sigma(z)，sigma 为激活函数` — fixture_lecture.pptx · slide 4（识别依据：contains mathematical symbols or an equation pattern）

### 公式清单 / Formula Checklist

<!-- COURSENOTES:SECTION C01-FORMULAS START -->
<!-- COURSENOTES:TODO --> 为以上每个公式补全 LaTeX 表示、变量定义、成立条件、推导与数值示例。
<!-- COURSENOTES:SECTION C01-FORMULAS END -->

### 图表解读 / Figures to Interpret

![figure from fixture_lecture.pptx slide 3](assets/fixture-lecture_f2c778263b.png)

> 来源 / Source: fixture_lecture.pptx · slide 3　优先级 / priority: normal
> 视觉任务 / Vision task: V002 — 课件截图 / slide screenshot
> 任务 / Task: Transcribe any text and formulas exactly, marking anything illegible rather than guessing it, then state what the slide is teaching.

**尚未解读 / not interpreted yet**：本插件的模型通道不能直接接收图片输入，因此图片内容必须由具备视觉能力的 Agent（例如先 `read_image` 再写回 `vision-results.json`）或人工补全。

**Not interpreted.** The model channel available to this plugin cannot receive image input; the figure must be read by an agent with a vision tool (write the result into `.coursenotes/vision-results.json`) or by a human.

### 图表解读 / Figures to Interpret

<!-- COURSENOTES:SECTION C01-FIGURES START -->
<!-- COURSENOTES:TODO --> 对尚未解读的图表，请依据视觉解读结果写出知识层面的解释；无法确认的细节必须标注。
<!-- COURSENOTES:SECTION C01-FIGURES END -->

### 本章总结 / Chapter Summary

<!-- COURSENOTES:SECTION C01-SUMMARY START -->
<!-- COURSENOTES:TODO --> 用要点+一句话结论总结本章，并指出与后续章节的衔接。
<!-- COURSENOTES:SECTION C01-SUMMARY END -->

### 术语表 / Glossary

| 中文术语 | English Full Name | Abbreviation | 简要解释 |
| --- | --- | --- | --- |
| 梯度下降 | Gradient Descent | GD |  |

### 重点与难点 / Key Points and Difficulties

<!-- COURSENOTES:SECTION C01-DIFFICULTIES START -->
<!-- COURSENOTES:TODO --> 标注本章重点与难点，并说明难在哪里（概念抽象/推导繁琐/易混淆/需要先修知识）。
<!-- COURSENOTES:SECTION C01-DIFFICULTIES END -->

### 自测题 / Self-Assessment Questions

<!-- COURSENOTES:SECTION C01-EXERCISES START -->
<!-- COURSENOTES:TODO --> 生成 3–5 道可自测的问题（含答案要点），覆盖本章核心知识点。
<!-- COURSENOTES:SECTION C01-EXERCISES END -->

### 参考资料 / References

- （本次运行未获取到可引用的外部来源。/ No external reference was retrieved in this run.)

