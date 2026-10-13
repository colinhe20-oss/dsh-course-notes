# CourseNotes 笔记撰写简报 / Note-writing brief

- 课程 / Course: fixture_outline
- 运行 / Run: run-20260101-000000（2026-01-01T00:00:00.000Z）
- 语言 / Language: bilingual　详细程度 / Detail: comprehensive
- 输出目录 / Output: <sample-run>
- 笔记文件 / Note files:
  - 第 1 章 → Chapter_01_第 2 讲 神经网络基础.md
  - 第 2 章 → Chapter_02_第一章 概述.md
  - 第 3 章 → Chapter_03_第三章 传输层 Transport Layer.md
  - 第 4 章 → Chapter_04_fixture_lab.md

## 1. 源材料清单 / Source materials
- [D01-fixture-chart] fixture_chart.png — image/笔记/资料，0 个内容单元、0 字符、0 表格、1 图、0 公式候选
- [D02-fixture-lecture] fixture_lecture.pptx — pptx/课件/讲义，14 个内容单元、340 字符、1 表格、1 图、2 公式候选
- [D03-fixture-outline] fixture_outline.docx — docx/笔记/资料，9 个内容单元、287 字符、1 表格、1 图、1 公式候选
- [D04-fixture-ch3] fixture_ch3.md — markdown/课件/讲义，9 个内容单元、241 字符、1 表格、0 图、1 公式候选
- [D05-fixture-lab] fixture_lab.txt — text/实验材料，4 个内容单元、111 字符、0 表格、0 图、0 公式候选

## 2. 知识结构 / Knowledge structure
章节 4 个，知识点 21 个，术语 9 条，公式候选 4 个。

### 第 1 章 第 2 讲 神经网络基础（知识点 7）
大纲：第 2 讲 神经网络基础 / 梯度下降与学习率 / 参数更新：theta <- theta - eta * grad L / 学习率 eta 过大导致震荡，过小导致收敛缓慢 / 随机梯度下降（Stochastic Gradient Descent, SGD）每次用一个样本估计梯度 / 优化器对比 / 反向传播推导要点
- [K001] (概念) Neural Network Basics / 优化与反向传播
  来源：fixture_lecture.pptx · slide 1
  原文：Neural Network Basics / 优化与反向传播
- [K002] (概念) 梯度下降（Gradient Descent, GD）沿负梯度方向更新参数
  来源：fixture_lecture.pptx · slide 2 · 梯度下降与学习率
  原文：梯度下降（Gradient Descent, GD）沿负梯度方向更新参数
- [K003] (概念) 强调学习率对收敛性的影响。
  来源：fixture_lecture.pptx · slide 2 notes · 随机梯度下降（Stochastic Gradient Descent, SGD）每次用一个样本估计梯度
  原文：强调学习率对收敛性的影响。
- [K004] (表格) 表格：优化器 / 更新依据 / 典型学习率
  来源：fixture_lecture.pptx · slide 3 · 优化器对比
  原文：优化器 | 更新依据 | 典型学习率 SGD | 当前样本梯度 | 0.01 - 0.1 Momentum | 梯度指数滑动平均 | 0.01 Adam | 一阶/二阶矩估计 | 0.001
- [K005] (概念) 链式法则：dL/dW = dL/dy * dy/dz * dz/dW
  来源：fixture_lecture.pptx · slide 4 · 反向传播推导要点
  原文：链式法则：dL/dW = dL/dy * dy/dz * dz/dW
- [K006] (概念) 其中 z = Wx + b，y = sigma(z)，sigma 为激活函数
  来源：fixture_lecture.pptx · slide 4 · 反向传播推导要点
  原文：其中 z = Wx + b，y = sigma(z)，sigma 为激活函数
- [K007] (概念) 雅可比矩阵维度：dL/dz 为 (n,1)，dz/dW 为 (n,m)
  来源：fixture_lecture.pptx · slide 4 · 反向传播推导要点
  原文：雅可比矩阵维度：dL/dz 为 (n,1)，dz/dW 为 (n,m)
- [公式] `链式法则：dL/dW = dL/dy * dy/dz * dz/dW` — fixture_lecture.pptx · slide 4（contains mathematical symbols or an equation pattern）
- [公式] `其中 z = Wx + b，y = sigma(z)，sigma 为激活函数` — fixture_lecture.pptx · slide 4（contains mathematical symbols or an equation pattern）
- [图表] assets/fixture-lecture_f2c778263b.png — fixture_lecture.pptx · slide 3（figure/diagram on a slide; explain its knowledge content, not just its labels）

### 第 2 章 第一章 概述（知识点 5）
大纲：第一章 概述 / OSI 参考模型 / 关键对比 / 公式示例
- [K008] (模型/架构) 计算机网络（Computer Network）将地理位置不同的计算机互联，实现资源共享与信息传递。
  来源：fixture_outline.docx · paragraph 2
  原文：计算机网络（Computer Network）将地理位置不同的计算机互联，实现资源共享与信息传递。
- [K009] (模型/架构) OSI 七层模型：物理层（Physical Layer）、数据链路层（Data Link Layer, DLL）、网…
  来源：fixture_outline.docx · paragraph 4 · OSI 参考模型
  原文：OSI 七层模型：物理层（Physical Layer）、数据链路层（Data Link Layer, DLL）、网络层（Network Layer）、传输层（Transport Layer）、会话层、表示层、应用层。
- [K010] (定义) 网络层 PDU 称为分组（packet），传输层 PDU 称为报文段（segment）。
  来源：fixture_outline.docx · paragraph 5 · OSI 参考模型
  原文：网络层 PDU 称为分组（packet），传输层 PDU 称为报文段（segment）。
- [K011] (表格) 表格：对比项 / 面向连接 vs 无连接
  来源：fixture_outline.docx · table 1 · 关键对比
  原文：对比项 | 面向连接 vs 无连接 连接建立 | 需要握手 / 无需握手 典型协议 | TCP / UDP
- [K012] (公式) 信道容量遵循香农公式 C = B * log2(1 + S/N)，其中 B 为带宽，S/N 为信噪比。
  来源：fixture_outline.docx · paragraph 8 · 公式示例
  原文：信道容量遵循香农公式 C = B * log2(1 + S/N)，其中 B 为带宽，S/N 为信噪比。
- [公式] `信道容量遵循香农公式 C = B * log2(1 + S/N)，其中 B 为带宽，S/N 为信噪比。` — fixture_outline.docx · paragraph 8（contains mathematical symbols or an equation pattern）
- [图表] assets/fixture-outline_f2c778263b.png — fixture_outline.docx · paragraph 9（figure embedded in the document; explain its knowledge content, not just its labels）

### 第 3 章 第三章 传输层 / Transport Layer（知识点 5）
大纲：第三章 传输层 / Transport Layer / 复用与分用 / 可靠传输
- [K013] (概念) 传输层通过端口号（port number）实现复用（multiplexing）与分用（demultiplexing）。
  来源：fixture_ch3.md · line 5 · 复用与分用
  原文：传输层通过端口号（port number）实现复用（multiplexing）与分用（demultiplexing）。
- [K014] (概念) 无连接分用：UDP 仅使用目的端口
  来源：fixture_ch3.md · line 7 · 复用与分用
  原文：无连接分用：UDP 仅使用目的端口
- [K015] (概念) 面向连接分用：TCP 使用四元组 (源IP, 源端口, 目的IP, 目的端口)
  来源：fixture_ch3.md · line 8 · 复用与分用
  原文：面向连接分用：TCP 使用四元组 (源IP, 源端口, 目的IP, 目的端口)
- [K016] (公式) 停等协议（Stop-and-Wait）的利用率： $$U = \frac{T_{transmit}}{T_{transmit} + 2 \cdot T_{prop}}$$
  来源：fixture_ch3.md · line 14 · 可靠传输
  原文：$$U = \frac{T_{transmit}}{T_{transmit} + 2 \cdot T_{prop}}$$
- [K017] (表格) 表格：机制 / 作用
  来源：fixture_ch3.md · line 16 · 可靠传输
  原文：机制 | 作用 超时重传 | 处理丢失 累计确认 | 提高效率
- [公式] `U = \frac{T_{transmit}}{T_{transmit} + 2 \cdot T_{prop}}` — fixture_ch3.md · line 14（inline LaTeX math in a text source）

### 第 4 章 fixture_lab（知识点 4）
- [K018] (实验) 实验一 数据链路层抓包
  来源：fixture_lab.txt · line 1
  原文：实验一 数据链路层抓包
- [K019] (概念) 1. 使用 Wireshark 抓取 ARP 请求与应答。
  来源：fixture_lab.txt · line 2
  原文：1. 使用 Wireshark 抓取 ARP 请求与应答。
- [K020] (概念) 2. 分析以太网帧（Ethernet frame）首部字段：目的 MAC、源 MAC、类型。
  来源：fixture_lab.txt · line 3
  原文：2. 分析以太网帧（Ethernet frame）首部字段：目的 MAC、源 MAC、类型。
- [K021] (概念) 3. 记录 CRC 校验字段长度，思考其检错能力。
  来源：fixture_lab.txt · line 4
  原文：3. 记录 CRC 校验字段长度，思考其检错能力。

## 3. 术语表 / Glossary
- 传输层 | Transport Layer | — | 出现 1 次
- 分析以太网帧 | Ethernet frame | — | 出现 1 次
- 计算机网络 | Computer Network | — | 出现 1 次
- 数据链路层 | Data Link Layer | DLL | 出现 1 次
- 随机梯度下降 | Stochastic Gradient Descent | SGD | 出现 1 次
- 梯度下降 | Gradient Descent | GD | 出现 1 次
- 停等协议 | Stop-and-Wait | — | 出现 1 次
- 网络层 | Network Layer | — | 出现 1 次
- 物理层 | Physical Layer | — | 出现 1 次

## 4. 外部补充证据 / External evidence
外部检索未执行：配置中已关闭（enableWebSearch=false）。


## 5. 撰写要求 / Writing requirements
- 逐章补全每个知识点，禁止把详细课件压缩成只有标题和定义的短笔记。
- 每个核心知识点都要有实质性中文讲解与对应英文讲解（英文不得只翻译标题）。
- 术语首次出现使用：中文名称（English Full Name, ABBREVIATION）；不确定的全称不要臆造。
- 公式给 LaTeX、变量含义、成立条件、推导步骤、直观意义与一个计算示例。
- 图表必须解读其知识内容（时序/数据流/坐标含义/算法步骤），不能只抄图中文字。
- 区分 [课件内容] / [扩展讲解] / [推导说明]，外部补充内容必须给出真实可访问链接。
- 无法识别或无法验证的内容必须显式标注，不得编造 URL、页码、作者或结论。
- 补全笔记后调用 check_notes_coverage 复核覆盖率。
