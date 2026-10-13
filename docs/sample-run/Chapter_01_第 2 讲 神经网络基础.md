## 第 1 章 / Chapter 1　第 2 讲 神经网络基础

### 章节概述 / Chapter Overview

- 原始课件 / Source files: fixture_lecture.pptx
- 知识点数量 / Knowledge points: 7
- 公式候选 / Formula candidates: 2
- 图表待解读 / Figures needing vision: 1

本章解决一个核心问题：神经网络的参数究竟是怎样"学"出来的。课件把基础部分压缩成两条主线——优化（optimization）与反向传播（backpropagation）：前者负责任务目标（损失函数）与参数更新规则，后者负责高效地算出每个参数的梯度。全章从 K001 的优化总览出发，经 K002 的梯度下降（Gradient Descent, GD）更新式、K003 的学习率（learning rate）对收敛性的影响和 K004 的优化器（optimizer）对比，最后落到 K005–K007 的反向传播推导要点：链式法则（chain rule）与雅可比矩阵（Jacobian matrix）的维度。学完本章，应能手工推导一层网络的 ∂L/∂W、能读懂 training loss vs epoch 曲线并据此判断学习率是否合适；本章是后续网络结构、正则化与工程实践内容的前置。[课件内容] 提供本章的知识点清单与结构；[扩展讲解] 补充先修知识与章节衔接。本次运行未执行外部检索（运行配置中 enableWebSearch=false），因此下文所有 [扩展讲解] 内容均为通用背景知识，不附外部链接。

### 本章学习目标 / Learning Objectives

学完本章后，你应当能够：

1. 写出参数更新式 θ ← θ − η∇L，并用一阶泰勒展开解释它为什么使损失不增（K002）；能推导并说明学习率过大导致震荡/发散、过小导致收敛缓慢的机制（K003）。
2. 对 z = Wx + b、y = σ(z) 的单层网络手工推导 ∂L/∂W（K005、K006），并写出各偏导的维度 dL/dz 为 (n,1)、dz/dW 为 (n,m)，用维度相乘自检推导是否自洽（K007）。
3. 对比 SGD、Momentum、Adam 三者的"更新依据"与典型学习率，为给定任务给出初始优化器与学习率的合理选择并说明理由（K004）。
4. 解读 training loss vs epoch 曲线：判断训练处于收敛、震荡还是发散状态，并明确指出单条训练损失曲线**不能**证明什么（图表解读）。
5. 区分"反向传播"与"梯度下降"的职责边界，并说明为什么反向传播能把梯度计算代价降到与前向传播同一量级（K001）。

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
### 1. Neural Network Basics / 优化与反向传播
**类型 / Kind**: 概念　**来源 / Source**: fixture_lecture.pptx · slide 1

**术语定义 / Definition**

- 神经网络（Neural Network，缩写 NN）：由"线性变换 + 非线性激活"逐层堆叠而成的参数化函数，可学习参数是各层的权重与偏置。[扩展讲解] 课件 slide 1 只给出标题文字 "Neural Network Basics / 优化与反向传播"，**未给出英文全称与缩写**；NN 是通用写法，本笔记把它标为扩展内容而非课件术语。
- 优化（Optimization，课件未给出缩写）：在给定目标函数下寻找使目标最小（或最大）的参数取值的过程。[扩展讲解] 课件只写中文"优化"，未给出对应的英文全称。
- 反向传播（Backpropagation，中文教材常缩写 BP）：从损失出发、按链式法则逐层回传误差信号，从而得到各参数偏导的方法。[扩展讲解] 课件只写中文"反向传播"，**未给出英文全称与缩写**；BP 虽常见，但既然课件未给出，本笔记只作提示，不当作课件术语使用。

#### 中文讲解 / Chinese Explanation

**材料原文依据 / Material evidence**

```text
Neural Network Basics / 优化与反向传播
```

**概念是什么。** slide 1 的标题直接写 "Neural Network Basics / 优化与反向传播"，把"神经网络基础"等同于"优化 + 反向传播"这两件事，这就是本章的总纲：一个神经网络训练系统 = 参数化函数（模型）+ 目标函数（损失）+ 求梯度的方法（反向传播）+ 用梯度改进参数的方法（优化器）。[课件内容]

**为什么需要。** 神经网络本身只是一族函数 f(x; θ)，θ 是全部可学习参数。若不做优化，θ 随机初始化时输出毫无意义；若没有反向传播，要得到第 j 个参数的偏导 ∂L/∂θ_j，就得让 θ_j 微微扰动一次、再做一次前向传播；参数量为 P 时求一次完整梯度需要 P+1 次前向计算，而现代网络的 P 在 10^6–10^12 量级，完全不可行。反向传播把所有参数的梯度一次性算出来，总代价与前向传播同一量级（仅差一个常数倍），这正是深度学习可行的前提。[扩展讲解]

**如何工作（训练闭环）。** ① 前向传播（forward propagation）：由输入 x 逐层算出预测 ŷ = f(x; θ)，代入损失函数得到标量 L；② 反向传播（backpropagation）：从 L 出发，用链式法则把"损失对某层输出的敏感度"逐层回传，得到每层权重与偏置的偏导；③ 优化器（optimizer）：按自己的规则用这些偏导更新 θ；④ 重复 ①–③，直到损失不再明显下降或达到预设轮次。[扩展讲解]

**数学/技术原理。** 训练被形式化为经验风险最小化：在训练集 {(x_i, y_i)}（i = 1…N）上最小化平均损失 L(θ) = (1/N)·Σ_i ℓ(f(x_i; θ), y_i)。反向传播是这个 L(θ) 的**高效计算方案**（反向模式自动微分，即把链式法则组织成动态规划），优化算法则决定"拿到梯度之后往哪走、走多远"。两者职责不同，可以分别替换：把梯度下降换成 Adam，反向传播不必改；把反向传播换成数值微分，优化器也不必改。[扩展讲解]

**示例。** 用一个只有单个权重的玩具模型走一遍闭环：x = 3，w = 2，b = 1，于是 z = wx + b = 7，取线性激活 y = z，目标值 t = 0，损失 L = ½(y − t)² = 24.5。前向得 L = 24.5；反向得 ∂L/∂w = (y − t)·1·x = 21；取 η = 0.01 更新 w ← 2 − 0.01×21 = 1.79；重新前向得 L = ½(1.79×3 + 1)² ≈ 20.29 < 24.5，损失确实下降。这个"前向 → 反向 → 更新"三步流程就是本章 K002–K007 的全部内容。[推导说明]

**应用场景。** 图像分类、语音识别、机器翻译、大规模语言模型的预训练与微调，训练循环都是上述闭环，差别只在模型结构、损失函数与优化器的选择。[扩展讲解]

**常见误区。** ① 把反向传播当成学习算法本身——它只负责求梯度，不决定步长；② 以为"神经网络基础"就是会调库，实际上 K005–K007 的链式法则与维度是排查 shape 错误、梯度消失/爆炸的第一手依据；③ 以为必须显式构造巨大的雅可比矩阵——工程实现走的是"雅可比 × 向量"乘积，从不显式生成矩阵（见 K007）。[扩展讲解]

#### 英文讲解 / English Explanation

**What it is.** The title of slide 1 — "Neural Network Basics / 优化与反向传播" — reduces "neural network basics" to exactly two things, optimization and backpropagation, and that is the outline of this chapter. A training system consists of a parameterized function (the model), an objective (the loss), a way of obtaining gradients (backpropagation), and a way of turning those gradients into better parameters (the optimizer). [课件内容] gives the point itself; [扩展讲解] supplies the surrounding framing.

**Why it is needed.** A neural network is nothing but a family of functions f(x; θ) with learnable parameters θ. Without optimization, a randomly initialized θ produces meaningless outputs. Without backpropagation, obtaining the partial derivative ∂L/∂θ_j for even one parameter would require perturbing θ_j slightly and running one extra forward pass; with P parameters, a full gradient would cost P + 1 forward passes. Modern networks have P between 10^6 and 10^12, so that route is hopeless, whereas backpropagation returns the gradient with respect to every parameter at a cost of the same order as a single forward pass, differing only by a constant factor. This is precisely why deep learning is computationally feasible. [扩展讲解]

**How it works (the training loop).** (1) Forward propagation computes the prediction ŷ = f(x; θ) layer by layer and evaluates the loss, a scalar L. (2) Backpropagation starts from L and propagates the sensitivity of the loss back through the layers using the chain rule, producing ∂L/∂W and ∂L/∂b for every layer. (3) The optimizer applies its own rule to update θ with those partial derivatives. (4) Steps 1–3 repeat until the loss stops improving clearly or a preset number of epochs is reached. [扩展讲解]

**Mathematical principle.** Training is formalized as empirical risk minimization: minimize the average loss L(θ) = (1/N) Σ_i ℓ(f(x_i; θ), y_i) over the training set {(x_i, y_i)}, i = 1…N. Backpropagation is an *efficient scheme for computing the gradient of that objective* — reverse-mode automatic differentiation, i.e. the chain rule organized as dynamic programming — while the optimization algorithm decides how to move once the gradient is in hand. Because the two roles are separate, they can be swapped independently: replacing gradient descent with Adam leaves backpropagation untouched, and replacing backpropagation with numerical differentiation leaves the optimizer untouched. [扩展讲解]

**Worked example.** Take a toy model with a single weight: x = 3, w = 2, b = 1, so z = wx + b = 7; use a linear activation y = z; let the target be t = 0 and the loss be L = ½(y − t)² = 24.5. Forward gives L = 24.5; backward gives ∂L/∂w = (y − t)·1·x = 21; with η = 0.01 the update is w ← 2 − 0.01 × 21 = 1.79; a fresh forward pass gives L = ½(1.79 × 3 + 1)² ≈ 20.29 < 24.5, so the loss really did decrease. This forward → backward → update cycle is the whole content of K002–K007 below. [推导说明]

**Where it is used.** Image classification, speech recognition, machine translation, and the pretraining and fine-tuning of large language models all run this same loop; they differ only in model architecture, loss function, and optimizer. [扩展讲解]

**Common misconceptions.** (i) Treating backpropagation as the learning algorithm itself — it only computes gradients and says nothing about step size. (ii) Assuming "basics" means "just call a library": in practice the chain rule and the Jacobian dimensions of K005–K007 are the first tools you reach for when a shape mismatch, vanishing gradient, or exploding gradient appears. (iii) Believing a huge Jacobian matrix must be materialized — real implementations compute vector–Jacobian products and never build the matrix explicitly (see K007). [扩展讲解]

#### 易错点 / Common Misconceptions

- **把反向传播（backpropagation）与梯度下降（gradient descent）混为一谈。** 反向传播只按链式法则计算损失对参数的偏导；梯度下降（以及 SGD、Momentum、Adam）是用这些偏导更新参数的算法。二者可以独立替换：换优化器不需要改反向传播，换自动微分实现也不需要改优化器。
- **以为"基础"就可以跳过推导。** slide 4 给出的链式法则与维度（K005–K007）正是后续调试的判据：一旦出现 shape 不匹配或损失不下降，第一件事就是回到维度推导逐项检查。
- **把课件没有给出的英文全称/缩写当成课件术语。** slide 1 只写了 "Neural Network Basics / 优化与反向传播"，课件并未给出 NN、BP 等缩写，本笔记把它们标注为 [扩展讲解]。

**来源 / References**

- [课件内容] fixture_lecture.pptx · slide 1
- [扩展讲解] 训练闭环、经验风险最小化与自动微分的通用背景（本次运行未执行外部检索，无链接）
- [推导说明] 单权重玩具模型的数值示例

<!-- COURSENOTES:POINT K001 END -->

<!-- COURSENOTES:POINT K002 START -->
### 2. 梯度下降（Gradient Descent, GD）沿负梯度方向更新参数
**类型 / Kind**: 概念　**来源 / Source**: fixture_lecture.pptx · slide 2 · 梯度下降与学习率

**术语定义 / Definition**

- 梯度下降（Gradient Descent, GD）：一阶迭代优化算法，沿目标函数梯度的反方向以固定步长 η 反复更新参数，直到满足停止条件。[课件内容] 术语与缩写由课件 slide 2 给出。
- 梯度（gradient，课件未给出缩写）：标量函数对所有自变量的一阶偏导所构成的向量，指向函数在该点上升最快的方向；其反方向即局部下降最快的方向。[扩展讲解] 课件未给出英文全称与缩写。
- 学习率（learning rate，课件记作 η，未给出英文全称与缩写）：控制每次更新步长的正超参数。[扩展讲解] 工程中常见的缩写 lr 同样不是课件内容。

#### 中文讲解 / Chinese Explanation

**材料原文依据 / Material evidence**

```text
梯度下降（Gradient Descent, GD）沿负梯度方向更新参数
```

**概念是什么。** 梯度下降（Gradient Descent, GD）是一种一阶迭代优化算法：把参数沿损失函数梯度的**反方向**移动一小步，反复进行直到收敛。课件 slide 2 的表述是"沿负梯度方向更新参数"，其更新式为 theta <- theta - eta * grad L。[课件内容]

**为什么需要。** 神经网络的损失函数是参数的非线性函数，参数量动辄上百万，几乎没有解析解。GD 只需要一阶导数（由反向传播提供），每次迭代的计算与内存开销都很小，而且对任何可微目标都适用，因此成为深度学习默认的优化范式。[扩展讲解]

**如何工作。** 给定初始参数 θ₀ 与学习率 η > 0：① 在当前点计算梯度 ∇L(θ_t)；② 沿负梯度方向走一步，得到 θ_{t+1}；③ 重复，直到梯度范数足够小、损失不再下降或达到迭代上限。按每次使用多少样本估计梯度，又分为批量梯度下降（用全部样本）、随机梯度下降 SGD（用 1 个样本，见 K003）与小批量梯度下降（用一批样本）。[课件内容] 给出更新方向，[扩展讲解] 补充批量划分。

**数学/技术原理。** 更新式为

$$
\theta_{t+1} \leftarrow \theta_t - \eta \, \nabla_\theta L(\theta_t)
$$

其中 θ_t ∈ R^P 是第 t 步的全部参数（可展平为 P 维列向量），η > 0 是学习率（步长），∇_θ L(θ_t) ∈ R^P 是损失对参数的梯度，L 是标量损失。为什么负梯度方向能让损失下降？对位移 Δ 做一阶泰勒展开：

$$
L(\theta_t + \Delta) \approx L(\theta_t) + \nabla_\theta L(\theta_t)^{\top} \Delta
$$

取 Δ = −η∇_θ L(θ_t)，代入得

$$
L(\theta_{t+1}) \approx L(\theta_t) - \eta \, \lVert \nabla_\theta L(\theta_t) \rVert_2^2 \;\le\; L(\theta_t)
$$

推导步骤 [推导说明]：① 在 θ_t 处做一阶泰勒展开，要求 Δ 足够小使二阶余项可忽略；② 选取 Δ 为负梯度方向乘以步长 η；③ 展开后得到 −η‖∇L‖²，只要 η > 0 该量就 ≤ 0，故损失不增（当且仅当梯度为 0 时取等号，此时已是驻点）；④ 结论的**前提是 η 足够小**：η 过大时二阶余项不再可忽略，实际损失可能上升，这正是 K003 讨论的情形。上述泰勒推导属 [推导说明]；课件只给出更新式本身 [课件内容]。

**数值示例。** 取 L(w₁, w₂) = w₁² + 4w₂²，起点 (1, 1)，此时 ∇L = (2w₁, 8w₂) = (2, 8)，L = 5。取 η = 0.1：w₁ ← 1 − 0.1×2 = 0.8，w₂ ← 1 − 0.1×8 = 0.2，新点损失 L = 0.8² + 4×0.2² = 0.64 + 0.16 = 0.8，比 5 大幅下降。注意两个方向的下降幅度并不均衡：w₂ 方向的梯度是 w₁ 方向的 4 倍，同样走一步就被推得更远——这解释了为什么各方向曲率差异大的目标函数需要调学习率或换自适应优化器（K003、K004）。[推导说明]

**应用场景。** 线性回归与逻辑回归的拟合、深度网络的端到端训练、矩阵分解与推荐系统，以及大规模预训练模型的微调，默认都用某种形式的梯度下降。[扩展讲解]

**常见误区。** ① 认为 GD 一定能找到全局最优——对非凸目标它只保证收敛到驻点（局部极小、鞍点或平台）；② 认为沿负梯度方向走一步损失必然下降——步长过大时不成立，见上面推导的前提；③ 把梯度下降与反向传播混为一体（见 K001 易错点）；④ 认为学习率一旦设定就该保持不变（实际常用衰减或预热调度，见 K003）。[扩展讲解]

#### 英文讲解 / English Explanation

**What it is.** Gradient descent (GD) is a first-order iterative optimization algorithm: it moves the parameters a small step in the *opposite* direction of the loss gradient and repeats. Slide 2 states it as "update the parameters along the negative gradient direction", with the update rule theta <- theta - eta * grad L. [课件内容]

**Why it is needed.** The loss of a neural network is a nonlinear function of millions of parameters and has essentially no closed-form minimizer. GD needs only first-order derivatives — which backpropagation supplies — its per-iteration time and memory cost is small, and it applies to any differentiable objective, which is why it became the default optimization paradigm in deep learning. [扩展讲解]

**How it works.** Given initial parameters θ₀ and a learning rate η > 0: (1) compute the gradient ∇L(θ_t) at the current point; (2) take a step along the negative gradient to obtain θ_{t+1}; (3) repeat until the gradient norm is small enough, the loss stops decreasing, or an iteration limit is reached. Varying how many samples estimate the gradient yields batch gradient descent (all samples), stochastic gradient descent (one sample, see K003), and mini-batch gradient descent (a batch of samples). [课件内容] gives the direction; [扩展讲解] adds the batch taxonomy.

**Mathematical principle.** The update is θ_{t+1} ← θ_t − η ∇_θ L(θ_t), where θ_t ∈ R^P is the whole parameter vector (P parameters flattened into a column vector), η > 0 is the learning rate (step size), ∇_θ L(θ_t) ∈ R^P is the gradient of the scalar loss L with respect to the parameters, and L is the scalar loss value. Why does the negative gradient direction decrease the loss? Expand to first order for a small displacement Δ: L(θ_t + Δ) ≈ L(θ_t) + ∇_θ L(θ_t)ᵀΔ. Choosing Δ = −η∇_θ L(θ_t) gives L(θ_{t+1}) ≈ L(θ_t) − η‖∇_θ L(θ_t)‖₂² ≤ L(θ_t).

**Derivation steps** [推导说明]: (1) take the first-order Taylor expansion at θ_t, which requires Δ small enough that the second-order remainder is negligible; (2) choose Δ to be the negative gradient times the step size η; (3) substituting yields −η‖∇L‖², which is ≤ 0 for any η > 0, so the loss does not increase — equality holds only when the gradient is zero, i.e. at a stationary point; (4) the conclusion holds **only when η is small enough**: for large η the second-order term dominates and the loss can increase, which is exactly the situation discussed in K003. This Taylor argument is [推导说明]; the slide itself gives only the update rule [课件内容].

**Worked example.** Let L(w₁, w₂) = w₁² + 4w₂² and start at (1, 1), where ∇L = (2w₁, 8w₂) = (2, 8) and L = 5. With η = 0.1: w₁ ← 1 − 0.1 × 2 = 0.8 and w₂ ← 1 − 0.1 × 8 = 0.2, so the new loss is 0.8² + 4 × 0.2² = 0.64 + 0.16 = 0.8, a large decrease from 5. Note that the two directions behave very differently: the gradient in the w₂ direction is four times larger than in w₁, so the same step size pushes it much further. This is why objectives whose curvature differs strongly across directions need learning-rate tuning or an adaptive optimizer (K003, K004). [推导说明]

**Where it is used.** Fitting linear and logistic regression, end-to-end training of deep networks, matrix factorization and recommender systems, and fine-tuning of large pretrained models all use some form of gradient descent as the default. [扩展讲解]

**Common misconceptions.** (i) Assuming GD always finds the global optimum — on non-convex objectives it only converges to a stationary point (local minimum, saddle, or plateau). (ii) Assuming one negative-gradient step always lowers the loss — false when the step is too large, as the derivation's precondition shows. (iii) Confusing gradient descent with backpropagation (see K001). (iv) Assuming the learning rate should stay constant — in practice decay or warm-up schedules are standard (see K003). [扩展讲解]

#### 易错点 / Common Misconceptions

- **"梯度下降 = 反向传播"。** 梯度下降决定步子怎么迈，反向传播只负责把梯度算出来；把优化器换成 Adam 时被替换的是梯度下降那一环，反向传播逻辑完全不变。
- **忽略收敛前提。** θ ← θ − η∇L 的"损失不增"结论依赖 η 足够小；η 过大时损失会上升，此时"再多训几轮"并不能解决问题，只会放大震荡。
- **把 η 与梯度大小割裂看待。** 真正决定步长的是二者的乘积 η·∇L，所以梯度尺度不同的层、或更换损失函数之后，同一个 η 的行为可能完全不同。

**来源 / References**

- [课件内容] fixture_lecture.pptx · slide 2 · 梯度下降与学习率
- [扩展讲解] 批量梯度下降/小批量梯度下降的划分与常见优化范式（本次运行未执行外部检索，无链接）
- [推导说明] 一阶泰勒展开推导与二维数值示例

<!-- COURSENOTES:POINT K002 END -->

<!-- COURSENOTES:POINT K003 START -->
### 3. 强调学习率对收敛性的影响。
**类型 / Kind**: 概念　**来源 / Source**: fixture_lecture.pptx · slide 2 notes · 随机梯度下降（Stochastic Gradient Descent, SGD）每次用一个样本估计梯度

**术语定义 / Definition**

- 学习率（learning rate，课件写作 η/eta，未给出英文全称与缩写）：更新式中决定每步走多远的正超参数，同时决定收敛速度与稳定性。[扩展讲解] 英文全称与缩写均非课件内容。
- 收敛（convergence，课件未给出英文全称与缩写）：迭代序列逐渐趋近最优解或驻点的性质；工程上常以损失或梯度范数不再明显下降作为判据。[扩展讲解]
- 随机梯度下降（Stochastic Gradient Descent, SGD）：每次只用一个样本（或用一个小批量）估计梯度并立即更新一次的梯度下降变体。[课件内容] 术语与缩写由课件 slide 2 给出。

#### 中文讲解 / Chinese Explanation

**材料原文依据 / Material evidence**

```text
强调学习率对收敛性的影响。
```

**概念是什么。** slide 2 的备注强调学习率对收敛性的影响：学习率 η 是更新式中唯一直接决定"每步走多远"的量，因此它同时决定收敛**速度**与收敛**稳定性**。同样的梯度，η 取大一点会更快接近极小点，取太大则会在极小点附近来回跳，甚至越走越远。[课件内容]

**为什么需要。** 目标函数在不同方向上的曲率往往相差几个数量级（各向异性），单一的 η 很难对所有方向同时合适：对曲率大的方向太大会震荡，对曲率小的方向又太小会停滞。因此理解 η 与收敛性的定量关系，是后续选择优化器与调度策略的基础。[扩展讲解]

**如何工作。** 对二次目标 L(θ) = ½θᵀAθ（A 对称正定）可以完全解析地看出 η 的作用。其梯度为 ∇L = Aθ，代入更新式得

$$
\theta_{t+1} = \theta_t - \eta A \theta_t = (I - \eta A)\,\theta_t
$$

在 A 的特征基下各方向解耦，第 i 个方向每步都乘以因子 (1 − ηλ_i)，其中 λ_i 是 A 的特征值。因此收敛条件为

$$
\text{收敛} \iff \max_i |1 - \eta \lambda_i| < 1 \iff 0 < \eta < \frac{2}{\lambda_{\max}}
$$

**推导步骤** [推导说明]：① 对 L(θ) = ½θᵀAθ 求梯度得 ∇L = Aθ；② 代入 θ_{t+1} = θ_t − η∇L 得 θ_{t+1} = (I − ηA)θ_t；③ 在 A 的特征基下迭代矩阵是对角的，误差在第 i 个方向按因子 (1 − ηλ_i) 衰减；④ 所有方向都衰减才算收敛，即所有 |1 − ηλ_i| < 1，等价于 0 < η < 2/λ_max；⑤ 收敛速率由最慢的方向 max_i|1 − ηλ_i| 决定，最优学习率在 λ_min 与 λ_max 之间折中，η* = 2/(λ_min + λ_max)。课件只给出"学习率 eta 过大导致震荡，过小导致收敛缓慢"这一结论 [课件内容]，上面的特征值分析属 [推导说明]。

**数值示例。** 取 L(θ) = 2θ²（即 ½θᵀAθ 中 A = 4，λ_max = 4，故收敛上界为 η < 2/4 = 0.5），起点 θ₀ = 1，每步乘因子 (1 − 4η)：

- η = 0.1：因子 1 − 0.4 = 0.6 > 0，θ 依次为 1 → 0.6 → 0.36 → 0.216，**单调收敛**；
- η = 0.4：因子 1 − 1.6 = −0.6 < 0，θ 依次为 1 → −0.6 → 0.36 → −0.216，在最优解两侧来回跳，**震荡收敛**，损失序列不是单调下降的；
- η = 0.6：因子 1 − 2.4 = −1.4，|−1.4| > 1，θ 依次为 1 → −1.4 → 1.96 → −2.744，**发散**，损失逐轮增大。

三种情形的分界线正是 2/λ_max = 0.5，与课件"过大导致震荡，过小导致收敛缓慢"完全对应。[推导说明]

**与 SGD 的关系。** 课件备注指出"随机梯度下降（Stochastic Gradient Descent, SGD）每次用一个样本估计梯度" [课件内容]。此时梯度 g_t 是真实梯度的无偏估计，但方差很大（方差大致与批量大小 B 成反比，B = 1 时最大）[扩展讲解]。噪声带来两个后果：① 步长过大会把噪声放大成剧烈震荡，因此 SGD 通常需要较小的学习率或配合衰减调度；② 噪声本身也有好处，它有助于逃离鞍点与尖锐的极小点，这常被用来解释 SGD 的泛化优势。[扩展讲解]

**应用场景。** 学习率调度（预热 warm-up、阶梯衰减 step decay、余弦退火 cosine annealing）是训练大模型的常规操作 [扩展讲解]；不同优化器的典型学习率量级差异也源于此，课件给出 SGD 为 0.01–0.1、Momentum 为 0.01、Adam 为 0.001（见 K004）[课件内容]。

**常见误区。** ① 认为学习率越小越安全——太小会长时间停滞在平台上，浪费算力，甚至看起来"训练不收敛"；② 认为学习率必须是常数——现代训练几乎都用调度；③ 认为学习率与批量大小无关——常用的近似经验是线性缩放规则（批量翻倍则学习率大致翻倍）[扩展讲解]；④ 把"损失曲线不平滑"一律当成发散——震荡收敛（η 位于 (1/λ_max, 2/λ_max)）同样不平滑，但包络仍在下降。

#### 英文讲解 / English Explanation

**What it is.** The notes for slide 2 stress the influence of the learning rate on convergence. The learning rate η is the only quantity in the update rule that directly sets *how far each step goes*, so it simultaneously controls both the speed and the stability of convergence: for a fixed gradient, a larger η approaches the minimum faster, but too large an η makes the iterates bounce around the minimum or diverge outright. [课件内容]

**Why it matters.** The curvature of the objective typically differs by orders of magnitude across directions (the problem is anisotropic), so no single η is ideal for all of them: for directions with large curvature η looks too big and produces oscillation, while for directions with small curvature the same η looks too small and produces stalling. Understanding the quantitative link between η and convergence is therefore the foundation for choosing optimizers and schedules later. [扩展讲解]

**How it works.** For a quadratic objective L(θ) = ½θᵀAθ with A symmetric positive definite, the role of η is fully analysable. Its gradient is ∇L = Aθ, and substituting into the update rule gives θ_{t+1} = θ_t − ηAθ_t = (I − ηA)θ_t. In the eigenbasis of A the directions decouple: the i-th direction is multiplied by the factor (1 − ηλ_i) at every step, where λ_i is an eigenvalue of A. Convergence therefore requires max_i |1 − ηλ_i| < 1, which is equivalent to 0 < η < 2/λ_max, and the convergence rate is governed by the slowest direction, max_i |1 − ηλ_i|; the best compromise between λ_min and λ_max is η* = 2/(λ_min + λ_max).

**Derivation steps** [推导说明]: (1) differentiate L(θ) = ½θᵀAθ to get ∇L = Aθ; (2) substitute into θ_{t+1} = θ_t − η∇L to obtain θ_{t+1} = (I − ηA)θ_t; (3) in the eigenbasis of A the iteration matrix is diagonal, so the error component along direction i decays by the factor (1 − ηλ_i); (4) every direction must decay, hence 0 < η < 2/λ_max; (5) the rate is set by the worst direction and the optimal η is the compromise 2/(λ_min + λ_max). The slide itself states only the qualitative conclusion "learning rate eta too large causes oscillation, too small causes slow convergence" [课件内容]; the eigenvalue analysis above is [推导说明].

**Worked example.** Take L(θ) = 2θ², i.e. A = 4 in ½θᵀAθ, so λ_max = 4 and the convergence bound is η < 2/4 = 0.5. Starting from θ₀ = 1, each step multiplies by (1 − 4η). With η = 0.1 the factor is 0.6 > 0 and the iterates are 1 → 0.6 → 0.36 → 0.216, a **monotone convergence**. With η = 0.4 the factor is −0.6 < 0 and the iterates are 1 → −0.6 → 0.36 → −0.216: the sequence oscillates across the optimum and still converges, but the loss is not monotonically decreasing. With η = 0.6 the factor is −1.4, whose magnitude exceeds 1, and the iterates become 1 → −1.4 → 1.96 → −2.744: the process **diverges** and the loss grows every step. The boundary between the three regimes is exactly 2/λ_max = 0.5, matching the slide's statement. [推导说明]

**Relation to SGD.** The slide note states that stochastic gradient descent (SGD) estimates the gradient from one sample at a time [课件内容]. The resulting g_t is an unbiased estimate of the true gradient but has large variance, roughly inversely proportional to the batch size B, and maximal when B = 1 [扩展讲解]. Two consequences follow: (i) too large a step amplifies that noise into violent oscillation, so SGD usually needs a smaller learning rate or a decay schedule; (ii) the noise can also help escape saddles and sharp minima, which is often cited as the source of SGD's generalization advantage. [扩展讲解]

**Where it is used.** Learning-rate schedules (warm-up, step decay, cosine annealing) are standard practice when training large models [扩展讲解], and the different typical magnitudes reported on slide 3 — SGD 0.01–0.1, Momentum 0.01, Adam 0.001 — come from exactly this analysis (see K004) [课件内容].

**Common misconceptions.** (i) "Smaller is safer": too small a learning rate stalls on plateaus and wastes computation, which may even look like non-convergence. (ii) "The learning rate is a constant": modern training almost always uses a schedule. (iii) "The learning rate is independent of batch size": the linear scaling rule (double the batch, roughly double the rate) is a widely used approximation [扩展讲解]. (iv) Treating every non-smooth loss curve as divergence — oscillatory convergence for η in (1/λ_max, 2/λ_max) is also non-smooth, yet its envelope still decreases.

#### 易错点 / Common Misconceptions

- **把"震荡收敛"误判为"发散"。** 判据是包络（各轮损失的上界）是否下降，而不是曲线是否平滑；η 落在 (1/λ_max, 2/λ_max) 区间时损失上下跳动，但整体仍在下降。
- **用"多训几轮"处理学习率过大。** η > 2/λ_max 时迭代误差被逐轮放大，训练越久越糟，正确做法是降低 η 或使用学习率调度。
- **忽略 SGD 的梯度噪声。** "每次用一个样本估计梯度"意味着梯度方差很大，不能直接套用全批量梯度下降的学习率；教学示例里恒定的梯度在真实 SGD 中并不存在。

**来源 / References**

- [课件内容] fixture_lecture.pptx · slide 2 notes · 随机梯度下降（Stochastic Gradient Descent, SGD）每次用一个样本估计梯度
- [扩展讲解] 梯度噪声与批量大小的关系、学习率调度（本次运行未执行外部检索，无链接）
- [推导说明] 二次目标下的特征值收敛条件推导与三组数值对比

<!-- COURSENOTES:POINT K003 END -->

<!-- COURSENOTES:POINT K004 START -->
### 4. 表格：优化器 / 更新依据 / 典型学习率
**类型 / Kind**: 表格　**来源 / Source**: fixture_lecture.pptx · slide 3 · 优化器对比

**术语定义 / Definition**

- 优化器（optimizer，课件未给出英文全称与缩写）：决定"拿到梯度之后如何更新参数"的算法；同一个梯度可以由不同优化器换算成不同的实际步长。[扩展讲解]
- 动量法（Momentum，课件只给出 "Momentum" 这一名称，未给出英文全称与缩写）：用梯度的指数滑动平均代替当前梯度做更新的优化器。[课件内容] 名称来自课件表格。
- Adam（课件只给出名称 "Adam"，未给出英文全称与缩写）：同时使用梯度的一阶矩与二阶矩估计、并对每个参数自适应缩放步长的优化器。[课件内容] 课件表格写"一阶/二阶矩估计"；至于 Adam 是否为 "Adaptive Moment Estimation" 的缩写，课件未给出，本笔记不作断言。[扩展讲解]

#### 中文讲解 / Chinese Explanation

**材料原文依据 / Material evidence**

```text
优化器 | 更新依据 | 典型学习率
SGD | 当前样本梯度 | 0.01 - 0.1
Momentum | 梯度指数滑动平均 | 0.01
Adam | 一阶/二阶矩估计 | 0.001
```

**概念是什么。** slide 3 用一张三行表格对比三种优化器，两个维度是"更新依据"（拿什么量去更新参数）与"典型学习率"（该优化器常用的 η 量级）。整理如下：[课件内容]

| 优化器 | 更新依据 | 典型学习率 |
| --- | --- | --- |
| SGD | 当前样本梯度 | 0.01 - 0.1 |
| Momentum | 梯度指数滑动平均 | 0.01 |
| Adam | 一阶/二阶矩估计 | 0.001 |

**为什么需要。** 单纯的 SGD 直接用带噪声的瞬时梯度，方向抖动大、在曲率悬殊的方向上效率低；Momentum 通过平滑梯度方向抑制抖动，Adam 进一步对每个参数自适应缩放步长。三者的差异最终体现在"典型学习率"上：更新依据越"归一化"，需要的 η 就越小。[扩展讲解]

**如何工作（技术原理）。** 记第 t 步的随机梯度为 g_t，参数为 θ，学习率为 η。三种优化器的更新可以写成统一形式。课件表格只给出"更新依据"的中文描述，下面的公式与 β、ε 的取值均属 [扩展讲解] 的通用背景知识，**课件并未给出**：

SGD —— 直接用当前样本的梯度：

$$
\theta_{t+1} = \theta_t - \eta \, g_t
$$

Momentum —— 用梯度的指数滑动平均（指数移动平均，EMA）作为方向：

$$
v_t = \beta v_{t-1} + (1 - \beta) g_t, \qquad \theta_{t+1} = \theta_t - \eta \, v_t
$$

Adam —— 同时估计梯度的一阶矩 m_t 与二阶矩 v_t，并做偏差修正，最后逐参数归一化：

$$
m_t = \beta_1 m_{t-1} + (1-\beta_1) g_t, \qquad v_t = \beta_2 v_{t-1} + (1-\beta_2) g_t^{2}
$$

$$
\hat{m}_t = \frac{m_t}{1-\beta_1^{\,t}}, \qquad \hat{v}_t = \frac{v_t}{1-\beta_2^{\,t}}, \qquad \theta_{t+1} = \theta_t - \eta \, \frac{\hat{m}_t}{\sqrt{\hat{v}_t} + \epsilon}
$$

符号含义 [扩展讲解]：g_t 为第 t 步的随机梯度；η 为学习率；β（Momentum）与 β₁、β₂（Adam）为滑动平均的衰减系数，常见默认值为 0.9 与 0.9/0.999；ε 是为避免除以 0 的小常数（常见 1e−8）；m_t、v_t 分别是梯度的一阶矩（均值）与二阶矩（平方的均值）的滑动估计；分母 √v̂_t + ε 把步长按该参数的梯度尺度归一化。成立条件是 g_t 有限、β ∈ [0, 1)。

**为什么典型学习率差一个量级。** SGD 的步长就是 η·g_t，梯度量级直接进入步长，因此 η 要取 0.01–0.1 才能在合理的轮次内走完；Adam 的分母 √v̂_t 已经把每个参数的梯度尺度归一化，等效步长约为 η 本身，因此 η 取 0.001 即可，取大反而会震荡。Momentum 介于两者之间：它把有效步长放大到约 η/(1−β) 倍（β = 0.9 时约 10 倍），故典型值取 0.01 而非 0.1。[推导说明]

**数值示例（动量如何"先慢后快"）。** 设梯度恒为 g_t = 2，取 β = 0.9，v₀ = 0：[推导说明]

- SGD（η = 0.01）：每步位移恒为 η·g = 0.02；
- Momentum（η = 0.01）：v₁ = 0.9×0 + 0.1×2 = 0.2，位移 0.002；v₂ = 0.9×0.2 + 0.2 = 0.38，位移 0.0038；v₃ = 0.542，位移 0.00542；v₄ = 0.6878，位移 0.006878；极限 v∞ = 0.9 v∞ + 0.2 ⇒ v∞ = 2，位移趋于 0.02。

前四步的位移都小于 SGD，之后才追上并稳定在同一量级——这就是动量"起步慢、后程快、方向平滑"的定量来源，也说明它抑制的是方向的抖动，而不是简单地放大学习率。

**应用场景。** 稀疏梯度场景（大规模嵌入矩阵、推荐系统）常选 Adam 类自适应方法；计算机视觉中 SGD + Momentum 配合学习率调度仍被广泛使用。[扩展讲解]

**常见误区。** ① 认为 Adam 一定优于 SGD——它收敛更快，但泛化未必更好，二者需要实验比较；② 认为 Momentum 等于"调大学习率"——它改变的是更新方向的平滑程度与有效步长，η 仍需单独设定；③ 直接把表中典型学习率照搬——它们依赖批量大小、损失尺度与网络结构，只能作为起点。

#### 英文讲解 / English Explanation

**What it is.** Slide 3 compares three optimizers in a three-row table along two axes: the *basis of the update* (which quantity is used to move the parameters) and the *typical learning rate* (the usual order of magnitude of η for that optimizer). The table reads: SGD uses the current sample gradient with a typical rate of 0.01–0.1; Momentum uses an exponential moving average of gradients with a typical rate of 0.01; Adam uses first- and second-moment estimates with a typical rate of 0.001. [课件内容]

**Why it is needed.** Plain SGD uses a noisy instantaneous gradient directly, so its direction jitters and it is inefficient when curvature differs strongly across directions. Momentum smooths the update direction and thereby suppresses that jitter, and Adam additionally rescales the step per parameter. The differences show up precisely in the third column: the more "normalized" the update basis, the smaller the learning rate needs to be. [扩展讲解]

**How it works.** Let g_t be the stochastic gradient at step t, θ the parameters and η the learning rate. All three optimizers can be written in a common shape. The slide gives only the Chinese descriptions in the table; the formulas below, together with the values of β and ε, are [扩展讲解] background knowledge that the slide does **not** provide. SGD: θ_{t+1} = θ_t − η g_t. Momentum: v_t = β v_{t−1} + (1 − β) g_t, then θ_{t+1} = θ_t − η v_t. Adam: m_t = β₁ m_{t−1} + (1 − β₁) g_t and v_t = β₂ v_{t−1} + (1 − β₂) g_t², with bias corrections m̂_t = m_t/(1 − β₁^t) and v̂_t = v_t/(1 − β₂^t), and the update θ_{t+1} = θ_t − η m̂_t /(√v̂_t + ε).

**Symbols** [扩展讲解]: g_t is the stochastic gradient at step t; η is the learning rate; β (Momentum) and β₁, β₂ (Adam) are decay coefficients for the moving averages, commonly defaulted to 0.9 and to 0.9/0.999; ε is a small constant (commonly 1e−8) preventing division by zero; m_t and v_t are running estimates of the first moment (mean) and second moment (mean square) of the gradient; the denominator √v̂_t + ε normalizes the step by that parameter's own gradient scale. The formulas hold whenever g_t is finite and β ∈ [0, 1).

**Why the typical rates differ by an order of magnitude.** For SGD the step is literally η·g_t, so the gradient's magnitude enters the step directly and η must be 0.01–0.1 to make reasonable progress within a sensible number of epochs. For Adam the denominator √v̂_t already normalizes each parameter's gradient scale, so the effective step is close to η itself and 0.001 suffices — a larger value oscillates. Momentum sits in between: it amplifies the effective step by roughly 1/(1 − β) (about 10× for β = 0.9), which is why its typical value is 0.01 rather than 0.1. [推导说明]

**Worked example (why momentum starts slowly and speeds up).** Take a constant gradient g_t = 2, β = 0.9 and v₀ = 0. [推导说明] SGD with η = 0.01 moves exactly η·g = 0.02 every step. Momentum with the same η = 0.01 gives v₁ = 0.9 × 0 + 0.1 × 2 = 0.2 (displacement 0.002), v₂ = 0.9 × 0.2 + 0.2 = 0.38 (0.0038), v₃ = 0.542 (0.00542), v₄ = 0.6878 (0.006878), and the fixed point v∞ = 0.9v∞ + 0.2 ⇒ v∞ = 2, so the displacement tends to 0.02. The first four steps are all smaller than SGD's and only later catch up: this is the quantitative origin of momentum's slow start, faster finish and smoother direction, and it shows that momentum smooths direction rather than simply inflating the learning rate.

**Where it is used.** Sparse-gradient settings (large embedding matrices, recommender systems) usually favour Adam-style adaptive methods; in computer vision, SGD with Momentum plus a learning-rate schedule is still widely used. [扩展讲解]

**Common misconceptions.** (i) "Adam is always better than SGD" — it converges faster but does not necessarily generalize better; the choice is empirical. (ii) "Momentum means a larger learning rate" — it changes the smoothness of the update direction and the effective step, but η still has to be chosen separately. (iii) Copying the typical rates verbatim — they depend on batch size, loss scale, and architecture, and serve only as a starting point.

#### 易错点 / Common Misconceptions

- **把"更新依据"当成"更新公式"。** 课件表格只给出中文概括（当前样本梯度／梯度指数滑动平均／一阶二阶矩估计），公式与超参数是 [扩展讲解] 补的；不要把补出来的 β、ε 默认值当成课件结论。
- **以为 Adam 的 0.001 与 SGD 的 0.01–0.1 是同一把尺子。** 两者的"有效步长"定义不同，跨优化器直接比较 η 数值没有意义。
- **以为动量能自动解决学习率过大。** 动量平滑方向，但它同时把有效步长放大到约 1/(1−β) 倍，学习率过大时震荡会更严重。

**来源 / References**

- [课件内容] fixture_lecture.pptx · slide 3 · 优化器对比
- [扩展讲解] 三种优化器的惯用公式、β/ε 默认值与适用场景（本次运行未执行外部检索，无链接）
- [推导说明] 有效步长倍数 1/(1−β) 与常量梯度下的动量数值示例

<!-- COURSENOTES:POINT K004 END -->

<!-- COURSENOTES:POINT K005 START -->
### 5. 链式法则：dL/dW = dL/dy * dy/dz * dz/dW
**类型 / Kind**: 概念　**来源 / Source**: fixture_lecture.pptx · slide 4 · 反向传播推导要点

**术语定义 / Definition**

- 链式法则（chain rule，课件未给出英文全称与缩写）：复合函数求导的基本法则，把"总变化率"分解为沿复合路径各环节变化率的乘积。[扩展讲解] 课件只给出中文"链式法则"。
- 偏导数（partial derivative，课件未给出英文全称与缩写）：多元函数对某一个自变量的导数，其余自变量视为常数。[扩展讲解]
- 雅可比矩阵（Jacobian matrix，课件未给出英文全称与缩写）：向量值函数对向量输入的一阶偏导矩阵，是链式法则在向量情形下的推广形式（维度见 K007）。[扩展讲解]

#### 中文讲解 / Chinese Explanation

**材料原文依据 / Material evidence**

```text
链式法则：dL/dW = dL/dy * dy/dz * dz/dW
```

**概念是什么。** 链式法则（chain rule）说的是：若一个量通过若干中间量间接依赖于另一个量，那么"最终量对最初量"的变化率，等于沿途每一段变化率的乘积。课件 slide 4 把它写成 dL/dW = dL/dy * dy/dz * dz/dW：损失 L 通过输出 y 依赖净输入 z，z 再通过 z = Wx + b 依赖权重 W。[课件内容]

**为什么需要。** 反向传播的全部合法性都建立在链式法则之上：网络越深，复合层数越多，直接求 ∂L/∂W 需要把每一层的关系都展开；链式法则给出了一种"逐段相乘、逐层回传"的机械流程，使得梯度计算可以复用前向传播已经算出的中间量，从而把代价降到与前向同阶（见 K001）。[扩展讲解]

**如何工作。** 具体到本讲的一层结构：前向按 x → z → y → L 的顺序算值；反向按 L → y → z → W 的顺序算导数，每一步都只用到"上一段传回来的敏感度"和"本段的局部导数"，二者相乘后继续往前传。这就是"反向"二字的含义——不是公式方向的颠倒，而是计算顺序沿着与前向相反的方向进行。[扩展讲解]

**数学/技术原理。** 标量情形下链式法则就是

$$
\frac{\partial L}{\partial W} = \frac{\partial L}{\partial y} \cdot \frac{\partial y}{\partial z} \cdot \frac{\partial z}{\partial W}
$$

在向量/矩阵情形下，"分数"应理解为雅可比矩阵，连乘按矩阵乘法进行。变量与符号 [推导说明]：L 为标量损失；y 为该层输出（激活之后）；z 为该层净输入（激活之前，z = Wx + b）；W 为权重矩阵；每个因子回答一个问题——∂L/∂y 是"损失对输出多敏感"，∂y/∂z 是"激活对净输入多敏感"，∂z/∂W 是"净输入对权重多敏感"。成立条件：① L、y、z 在相应点处可微；② 复合路径完备——如果某个量有**多条**通往 W 的路径（例如残差连接、参数共享），必须把所有路径的贡献**相加**，只乘一条路径会漏项；③ 向量情形下相邻雅可比必须维度相容（列数 = 下一因子的行数，见 K007）。

**推导步骤** [推导说明]。设 z = Wx + b、y = σ(z)、L = ℓ(y)，把 L 看成 W 的复合函数 L(W) = ℓ(σ(z(W)))，对 W 中任一元素 W_ij 求偏导：

① 按多元链式法则，L 通过所有中间变量依赖 W_ij，故先写出对所有中间变量求和的形式；
② 由于激活是逐元素作用的，∂y_k/∂z_j 只在 k = j 时非零，求和只剩下一项；
③ 于是 ∂L/∂W_ij = (∂L/∂y_i) · σ′(z_i) · (∂z_i/∂W_ij)；
④ 又因 z_i = Σ_j W_ij x_j + b_i，有 ∂z_i/∂W_ij = x_j；
⑤ 合并得 ∂L/∂W_ij = (∂L/∂y_i) · σ′(z_i) · x_j，写成矩阵形式即 ∂L/∂W = (∂L/∂y ⊙ σ′(z)) xᵀ，其中 ⊙ 为逐元素乘。这正是工程实现中一层反向传播的公式（向量–雅可比乘积，VJP）。

**数值示例。** 取 w = 2，x = 3，b = 1，线性激活（σ′ ≡ 1，此时 y = z），目标 t = 0，损失 L = ½(y − t)²。[推导说明]

① 前向：z = wx + b = 2×3 + 1 = 7，y = 7，L = ½(7 − 0)² = 24.5；
② 三个因子：∂L/∂y = y − t = 7；∂y/∂z = σ′(z) = 1；∂z/∂w = x = 3；
③ 相乘：∂L/∂w = 7 × 1 × 3 = 21；
④ 取 η = 0.01 更新：w ← 2 − 0.01×21 = 1.79；
⑤ 复核：新的 z = 1.79×3 + 1 = 6.37，L = ½×6.37² ≈ 20.29 < 24.5，损失确实下降，与链式法则给出的方向一致。

**应用场景。** 所有自动微分框架的反向传播都实现这条法则；深层网络中的梯度消失/爆炸可以直观地理解为"三个因子连乘、层数越多乘得越多"的结果——若每层因子都远小于 1，梯度指数衰减；远大于 1 则指数放大。[扩展讲解]

**常见误区。** ① 漏掉"多条路径求和"：链式法则对每条路径给出一个乘积，最终必须求和；② 把向量情形的连乘当成逐元素相乘（只有激活逐元素作用、且因子为对角矩阵时才可以这样简化）；③ 忽略转置与维度顺序，导致矩阵乘法不合法（见 K007）；④ 以为链式法则只适用于标量——它是自动微分的数学基础，对任意维度的张量都成立。

#### 英文讲解 / English Explanation

**What it is.** The chain rule states that if one quantity depends on another only indirectly, through a sequence of intermediate quantities, then the rate of change of the final quantity with respect to the original one is the product of the rates of change along that sequence. Slide 4 writes it as dL/dW = dL/dy * dy/dz * dz/dW: the loss L depends on the output y, y depends on the pre-activation z, and z depends on the weight W through z = Wx + b. [课件内容]

**Why it is needed.** The legitimacy of the entire backpropagation algorithm rests on the chain rule. The deeper the network, the more composite layers there are, and computing ∂L/∂W directly would mean expanding every layer relationship. The chain rule provides a mechanical procedure — multiply segment by segment, propagate layer by layer — that lets gradient computation reuse the intermediate quantities already produced by the forward pass, which is what brings the cost down to the same order as the forward pass (see K001). [扩展讲解]

**How it works.** For the one-layer structure of this lecture: the forward pass evaluates values in the order x → z → y → L; the backward pass computes derivatives in the order L → y → z → W, where each step uses only "the sensitivity handed back from the next segment" and "the local derivative of the current segment", multiplying the two before passing the result on. That is what "backward" means — not that the formula is reversed, but that the computation runs in the direction opposite to the forward pass. [扩展讲解]

**Mathematical principle.** In the scalar case the chain rule is ∂L/∂W = (∂L/∂y)·(∂y/∂z)·(∂z/∂W). In the vector/matrix case each "fraction" must be read as a Jacobian matrix and the products become matrix products. Symbols: L is the scalar loss; y is the layer output (after the activation); z is the layer's pre-activation, z = Wx + b; W is the weight matrix. Each factor answers one question — ∂L/∂y is "how sensitive is the loss to the output", ∂y/∂z is "how sensitive is the activation to the pre-activation", ∂z/∂W is "how sensitive is the pre-activation to the weight".

**Conditions of validity.** (1) L, y and z must be differentiable at the relevant points. (2) The composition path must be complete — if some quantity reaches W along *several* paths (residual connections, shared parameters), the contributions of all paths must be **summed**; keeping only one path loses terms. (3) In the vector case adjacent Jacobians must be dimension-compatible: the number of columns of one factor must equal the number of rows of the next (see K007).

**Derivation steps** [推导说明]. Let z = Wx + b, y = σ(z), L = ℓ(y), so that L is the composite function L(W) = ℓ(σ(z(W))). For a single entry W_ij: (1) write the multivariate chain rule as a sum over all intermediate variables through which L depends on W_ij; (2) because the activation acts elementwise, ∂y_k/∂z_j vanishes unless k = j, so the sum collapses to one term; (3) hence ∂L/∂W_ij = (∂L/∂y_i)·σ′(z_i)·(∂z_i/∂W_ij); (4) since z_i = Σ_j W_ij x_j + b_i, we have ∂z_i/∂W_ij = x_j; (5) combining gives ∂L/∂W_ij = (∂L/∂y_i)·σ′(z_i)·x_j, i.e. in matrix form ∂L/∂W = (∂L/∂y ⊙ σ′(z)) xᵀ with ⊙ the elementwise product. This is exactly the one-layer backward formula used in implementations (a vector–Jacobian product, VJP).

**Worked example.** Take w = 2, x = 3, b = 1, a linear activation (σ′ ≡ 1, so y = z), target t = 0 and loss L = ½(y − t)². [推导说明] (1) Forward: z = 2×3 + 1 = 7, y = 7, L = ½(7 − 0)² = 24.5. (2) The three factors: ∂L/∂y = y − t = 7, ∂y/∂z = σ′(z) = 1, ∂z/∂w = x = 3. (3) Multiply: ∂L/∂w = 7 × 1 × 3 = 21. (4) With η = 0.01 update w ← 2 − 0.01 × 21 = 1.79. (5) Check: the new z = 1.79 × 3 + 1 = 6.37 and L = ½ × 6.37² ≈ 20.29 < 24.5, so the loss decreased in the direction the chain rule prescribed.

**Where it is used.** Every automatic differentiation framework implements this rule in its backward pass. Vanishing and exploding gradients in deep networks have a direct reading here: the three factors are multiplied, and with many layers they are multiplied many times — if each layer's factor is well below 1 the gradient decays exponentially, and if well above 1 it grows exponentially. [扩展讲解]

**Common misconceptions.** (i) Omitting the "sum over all paths": the chain rule gives one product per path, and the products must be added. (ii) Treating the vector-case product as an elementwise product — that simplification is valid only when the activation acts elementwise and the corresponding factor is diagonal. (iii) Ignoring transposes and dimension order, producing illegal matrix products (see K007). (iv) Believing the chain rule is only for scalars — it is the mathematical basis of automatic differentiation and holds for tensors of any rank.

#### 数学原理 / Mathematical Principles

$$
\frac{\partial L}{\partial W} = \frac{\partial L}{\partial y} \cdot \frac{\partial y}{\partial z} \cdot \frac{\partial z}{\partial W}
$$

① **变量与符号。** L：标量损失（实数，越小越好）；y：该层输出（激活之后），本讲中 y = σ(z)；z：该层净输入（激活之前），z = Wx + b；W：权重矩阵，形状 (n, m)。三个因子依次是"损失对输出的偏导""输出对净输入的偏导（即激活的导数）""净输入对权重的偏导"；向量情形下它们都是雅可比矩阵。[推导说明]

② **成立条件。** L、y、z 在相应点处可微；复合路径必须完整（有多条路径时要对路径求和）；向量情形下相邻雅可比的维度必须首尾相接。课件只给出该式本身，未给出这些前提 [课件内容]。

③ **推导步骤。** 见上文"推导步骤"五步：写出对中间变量的求和 → 利用逐元素激活使求和坍缩为一项 → 代入 ∂z_i/∂W_ij = x_j → 合并为 ∂L/∂W = (∂L/∂y ⊙ σ′(z)) xᵀ。[推导说明]

④ **直观意义。** 三个因子分别放大或缩小信号：只要其中任何一个接近 0，整条路径的梯度就接近 0（梯度消失）；任何一个显著大于 1，梯度就会被放大（梯度爆炸）。层数越多，这种乘性效应越强。

⑤ **数值计算示例。** w = 2，x = 3，b = 1、线性激活、t = 0：∂L/∂y = 7、∂y/∂z = 1、∂z/∂w = 3，故 ∂L/∂w = 21；取 η = 0.01 得 w ← 1.79，损失由 24.5 降到 ≈ 20.29。完整算式见上文数值示例。[推导说明]

#### 易错点 / Common Misconceptions

- **忘记"多路径求和"。** 链式法则给出的是"每条路径一个乘积、再把所有乘积加起来"；只保留一条路径是最常见的漏项错误，带残差连接与参数共享的网络尤其容易踩。
- **把雅可比连乘当成逐元素相乘。** 只有当激活逐元素作用（雅可比为对角矩阵）时，乘积才退化为逐元素乘；否则必须做矩阵乘法并注意转置顺序。
- **忽略公式的可微性前提。** 在不可导点（如 ReLU 的 0 点）公式不成立，工程实现按次梯度处理，这属于约定而非数学结论。

**来源 / References**

- [课件内容] fixture_lecture.pptx · slide 4 · 反向传播推导要点
- [扩展讲解] 自动微分的 VJP 形式、梯度消失/爆炸的乘性解释（本次运行未执行外部检索，无链接）
- [推导说明] 逐元素激活下链式法则的五步推导与单权重数值示例

<!-- COURSENOTES:POINT K005 END -->

<!-- COURSENOTES:POINT K006 START -->
### 6. 其中 z = Wx + b，y = sigma(z)，sigma 为激活函数
**类型 / Kind**: 概念　**来源 / Source**: fixture_lecture.pptx · slide 4 · 反向传播推导要点

**术语定义 / Definition**

- 净输入 / 预激活（pre-activation，课件未给出英文全称与缩写）：线性变换的结果 z = Wx + b，尚未经过激活函数。[扩展讲解] 课件只给出符号 z。
- 激活函数（activation function，课件未给出英文全称与缩写）：逐元素作用于净输入的非线性函数，课件用 σ 表示，中文写作"sigma 为激活函数"。[课件内容] 给出符号与中文名称；英文全称与缩写课件未给出。
- 偏置（bias，课件未给出英文全称与缩写）：线性变换中的加性项 b，使超平面不必过原点。[扩展讲解]

#### 中文讲解 / Chinese Explanation

**材料原文依据 / Material evidence**

```text
其中 z = Wx + b，y = sigma(z)，sigma 为激活函数
```

**概念是什么。** slide 4 用这两行定义了本讲讨论的最小网络单元：先做一次仿射（线性 + 平移）变换得到净输入 z = Wx + b，再逐元素施加激活函数得到输出 y = σ(z)，其中 σ 就是激活函数。[课件内容]

**为什么需要。** 只有仿射变换的网络没有意义：两层仿射复合仍是仿射，W₂(W₁x + b₁) + b₂ = (W₂W₁)x + (b₂ + W₂b₁) 与单层等价，加深网络不会增加表达能力。激活函数引入非线性，才使网络能够逼近任意连续函数（通用近似性质，[扩展讲解]）。同时，这一对式子也是 K005 链式法则中 ∂y/∂z 与 ∂z/∂W 两个因子的来源。[扩展讲解]

**如何工作。** 前向：x → z = Wx + b → y = σ(z)，逐元素写出即 z_i = Σ_j W_ij x_j + b_i、y_i = σ(z_i)。反向：从上一层传回 ∂L/∂y，先乘以激活的导数 σ′(z)（逐元素），再乘以输入 x 得到对 W 的梯度，同时把"对 z 的敏感度"继续往下一层传。[扩展讲解]

**数学/技术原理。** 两个式子为

$$
z = Wx + b
$$

$$
y = \sigma(z)
$$

变量与符号 [推导说明]：x ∈ R^m 为输入列向量（输入维度记作 m；**课件未给出该符号**，此处为便于推导自行引入）；W ∈ R^{n×m} 为权重矩阵（n 为该层神经元个数、即输出维度）；b ∈ R^n 为偏置向量；z ∈ R^n 为净输入（激活前）；σ 为逐元素激活函数；y ∈ R^n 为该层输出。成立条件：① 矩阵乘法维度相容——(n×m)(m×1) = (n×1)，搭配 (n×1) 的 b 得到 (n×1) 的 z；② σ 在相应点处可微（不可导点按次梯度约定处理）；③ 若 x 是批量数据矩阵（形状 (m×B)），则 z = Wx + b 需要 b 沿批量维广播，结论不变。

**推导步骤（各局部雅可比）** [推导说明]：

① 逐元素展开：z_i = Σ_{j=1}^{m} W_ij x_j + b_i；
② 对输入求导：∂z_i/∂x_j = W_ij，故 ∂z/∂x = W，形状 (n, m)；
③ 对偏置求导：∂z_i/∂b_k = δ_ik（δ 为克罗内克符号），故 ∂z/∂b = I_n，形状 (n, n)；
④ 对激活求导：因 σ 逐元素作用，∂y_i/∂z_j = σ′(z_i)·δ_ij，故 ∂y/∂z = diag(σ′(z))，形状 (n, n) 的对角矩阵；
⑤ 把 ②③④ 代入 K005 的链式法则并利用 y = σ(z)，得到一层反向传播的两个结果：∂L/∂b = ∂L/∂z ⊙ σ′(z)（形状 (n,1)）与 ∂L/∂W = (∂L/∂y ⊙ σ′(z)) xᵀ（形状 (n,m)，与 W 同形）。

**数值示例。** 取输入 x = (1, 2)ᵀ（m = 2），W = [[0.5, −0.25], [1, 0.5]]，b = (0, 0.5)ᵀ，为便于计算临时选用 logistic 激活 σ(z) = 1/(1 + e^(−z))（**课件只写"sigma 为激活函数"，未指定具体形式**）。[推导说明]

① z₁ = 0.5×1 + (−0.25)×2 + 0 = 0；z₂ = 1×1 + 0.5×2 + 0.5 = 2.5，即 z = (0, 2.5)ᵀ；
② y₁ = σ(0) = 0.5；y₂ = σ(2.5) = 1/(1 + e^(−2.5)) ≈ 0.9241，即 y ≈ (0.5, 0.9241)ᵀ；
③ 激活导数 σ′(z) = σ(z)(1 − σ(z))：σ′(0) = 0.5×0.5 = 0.25，σ′(2.5) ≈ 0.9241×0.0759 ≈ 0.0701；
④ 于是 ∂y/∂z = diag(0.25, 0.0701)，两个方向上的局部增益相差 3.5 倍以上。

这个例子还顺带说明了梯度消失的机理：logistic 激活的导数上界是 0.25（在 z = 0 处取得），层与层之间连乘这些 ≤ 0.25 的因子，梯度会迅速衰减 [扩展讲解]。

**应用场景。** 一个这样的单元就是线性分类器（感知机）；把若干单元堆叠并配以非线性激活，就是多层感知机（MLP），也是卷积网络、循环网络与 Transformer 的基本积木。常见激活函数有 sigmoid、tanh、ReLU 等，但**课件未给出任何具体选择**，本笔记不替课件做断言。[扩展讲解]

**常见误区。** ① 以为 z 就是输出——z 是激活前的净输入，y 才是输出，K005 的因子正是按 z、y 分开写的；② 忘记偏置 b（会导致决策边界必须过原点）；③ 认为激活函数可选可无（去掉后深度退化，见"为什么需要"）；④ 把批量数据的广播当成额外操作（它只是把 b 复制到每个样本，数学上等价）。

#### 英文讲解 / English Explanation

**What it is.** Slide 4 defines the minimal network unit of this lecture in two lines: an affine (linear plus shift) transformation produces the pre-activation z = Wx + b, and an elementwise activation function produces the output y = σ(z), where σ is the activation function. [课件内容]

**Why it is needed.** A network built only from affine maps is pointless: composing two affine maps gives another affine map, W₂(W₁x + b₁) + b₂ = (W₂W₁)x + (b₂ + W₂b₁), which is equivalent to a single layer, so adding depth buys no extra expressive power. The activation function injects nonlinearity, which is what allows the network to approximate arbitrary continuous functions (the universal approximation property, [扩展讲解]). These two equations are also the source of the two factors ∂y/∂z and ∂z/∂W used in the chain rule of K005. [扩展讲解]

**How it works.** Forward: x → z = Wx + b → y = σ(z), i.e. elementwise z_i = Σ_j W_ij x_j + b_i and y_i = σ(z_i). Backward: the sensitivity ∂L/∂y arriving from the layer above is first multiplied by the activation derivative σ′(z) elementwise, then multiplied by the input x to produce the gradient with respect to W, while the sensitivity with respect to z is passed further down. [扩展讲解]

**Mathematical principle.** The two equations are z = Wx + b and y = σ(z). Symbols [推导说明]: x ∈ R^m is the input column vector (the input dimension is written m here; **the slide does not introduce this symbol**, it is introduced only to make the derivation explicit); W ∈ R^{n×m} is the weight matrix, with n the number of units in the layer, i.e. the output dimension; b ∈ R^n is the bias vector; z ∈ R^n is the pre-activation; σ is an elementwise activation function; y ∈ R^n is the layer output. Conditions: (1) the matrix product must be dimension-compatible, (n×m)(m×1) = (n×1), and adding the (n×1) bias b keeps z at (n×1); (2) σ must be differentiable at the relevant points (non-differentiable points are handled by the subgradient convention); (3) if x is a batch matrix of shape (m×B), the bias is broadcast along the batch dimension and nothing changes mathematically.

**Derivation steps (the local Jacobians)** [推导说明]: (1) expand elementwise, z_i = Σ_{j=1}^{m} W_ij x_j + b_i; (2) differentiate with respect to the input, ∂z_i/∂x_j = W_ij, hence ∂z/∂x = W of shape (n, m); (3) differentiate with respect to the bias, ∂z_i/∂b_k = δ_ik (Kronecker delta), hence ∂z/∂b = I_n of shape (n, n); (4) differentiate the activation, and since σ acts elementwise ∂y_i/∂z_j = σ′(z_i)·δ_ij, hence ∂y/∂z = diag(σ′(z)), a diagonal (n, n) matrix; (5) substituting (2)–(4) into the chain rule of K005 and using y = σ(z) gives the two one-layer backward results, ∂L/∂b = ∂L/∂z ⊙ σ′(z) of shape (n,1) and ∂L/∂W = (∂L/∂y ⊙ σ′(z)) xᵀ of shape (n,m), the same shape as W.

**Worked example.** Let x = (1, 2)ᵀ (so m = 2), W = [[0.5, −0.25], [1, 0.5]] and b = (0, 0.5)ᵀ; for concreteness use the logistic activation σ(z) = 1/(1 + e^(−z)) — note that **the slide only says "sigma is the activation function" and does not fix a particular form**. [推导说明] (1) z₁ = 0.5×1 + (−0.25)×2 + 0 = 0 and z₂ = 1×1 + 0.5×2 + 0.5 = 2.5, so z = (0, 2.5)ᵀ. (2) y₁ = σ(0) = 0.5 and y₂ = σ(2.5) = 1/(1 + e^(−2.5)) ≈ 0.9241, so y ≈ (0.5, 0.9241)ᵀ. (3) The activation derivative is σ′(z) = σ(z)(1 − σ(z)), giving σ′(0) = 0.25 and σ′(2.5) ≈ 0.9241 × 0.0759 ≈ 0.0701. (4) Hence ∂y/∂z = diag(0.25, 0.0701): the local gain differs by more than a factor of 3.5 between the two directions. This example also illustrates vanishing gradients: the derivative of the logistic activation is bounded by 0.25 (attained at z = 0), and multiplying such factors across layers decays the gradient rapidly. [扩展讲解]

**Where it is used.** One such unit is a linear classifier (a perceptron); stacking many units with nonlinear activations yields the multilayer perceptron (MLP), the basic building block also of convolutional networks, recurrent networks and Transformers. Common activation functions include sigmoid, tanh and ReLU, but **the slide specifies none of them**, and this note does not assert a choice on the slide's behalf. [扩展讲解]

**Common misconceptions.** (i) Confusing z with the output: z is the pre-activation and y is the output, and K005 keeps the two factors separate for exactly this reason. (ii) Forgetting the bias b, which would force every decision boundary through the origin. (iii) Treating the activation as optional — removing it collapses the depth (see "Why it is needed"). (iv) Mistaking batch broadcasting for an extra operation: it merely replicates b for every sample and is mathematically equivalent.

#### 数学原理 / Mathematical Principles

$$
z = Wx + b, \qquad y = \sigma(z)
$$

① **变量与符号。** x ∈ R^m 输入向量（m 为输入维度，课件未给出该符号）；W ∈ R^{n×m} 权重矩阵；b ∈ R^n 偏置向量；z ∈ R^n 净输入（激活前）；σ 逐元素激活函数；y ∈ R^n 输出。各量的形状检查：(n×m)(m×1) + (n×1) = (n×1)。[推导说明]

② **成立条件。** 矩阵维度相容；σ 可微；批量输入时 b 沿批量维广播。课件只给出公式本身，未给出维度定义与条件 [课件内容]。

③ **推导步骤。** 见上文五步：逐元素展开 → ∂z/∂x = W → ∂z/∂b = I_n → ∂y/∂z = diag(σ′(z)) → 代回链式法则得 ∂L/∂W = (∂L/∂y ⊙ σ′(z)) xᵀ。[推导说明]

④ **直观意义。** 线性部分把输入空间旋转、缩放、平移到 n 维净输入空间，激活函数再对每个分量做一次非线性"压缩/整流"；没有激活，多层网络等价于一层。

⑤ **数值计算示例。** x = (1, 2)ᵀ、W = [[0.5, −0.25], [1, 0.5]]、b = (0, 0.5)ᵀ ⇒ z = (0, 2.5)ᵀ；以 logistic 激活得 y ≈ (0.5, 0.9241)ᵀ 与 diag(σ′(z)) ≈ diag(0.25, 0.0701)。完整计算见上文数值示例。[推导说明]

#### 易错点 / Common Misconceptions

- **把 z 与 y 混用。** z 是激活前的净输入、y 是激活后的输出；K005 的三个因子正是沿着 x → z → y → L 这条链写的，混用会直接导致链式法则写错。
- **给 σ 指定一个课件没说的形式。** 课件只写"sigma 为激活函数"；本笔记的数值示例临时选用 logistic 并已标注，读者不应把它当成课件结论。
- **忽略偏置与广播。** 忘记 b 会让模型失去平移能力；批量输入下 b 需要沿批量维广播，否则维度不匹配。

**来源 / References**

- [课件内容] fixture_lecture.pptx · slide 4 · 反向传播推导要点
- [扩展讲解] 通用近似性质、常见激活函数与梯度消失机理（本次运行未执行外部检索，无链接）
- [推导说明] 局部雅可比五步推导、x/W/b 的符号引入与 logistic 数值示例

<!-- COURSENOTES:POINT K006 END -->

<!-- COURSENOTES:POINT K007 START -->
### 7. 雅可比矩阵维度：dL/dz 为 (n,1)，dz/dW 为 (n,m)
**类型 / Kind**: 概念　**来源 / Source**: fixture_lecture.pptx · slide 4 · 反向传播推导要点

**术语定义 / Definition**

- 雅可比矩阵（Jacobian matrix，课件未给出英文全称与缩写）：向量值函数 f: R^p → R^q 的一阶偏导矩阵 J ∈ R^{q×p}，其元素为 J_ij = ∂f_i/∂x_j。[扩展讲解] 课件只给出该术语的中文名与两个维度结论。
- 梯度（gradient，课件未给出缩写）：标量函数对向量输入的偏导向量；可视为雅可比矩阵在 q = 1 时的特例，按课件记法形状为 (n,1)。[扩展讲解]
- 矩阵形状 / 维度（shape，课件未给出英文全称与缩写）：张量每个轴的维数，例如 (n, m) 表示 n 行 m 列。[扩展讲解]

#### 中文讲解 / Chinese Explanation

**材料原文依据 / Material evidence**

```text
雅可比矩阵维度：dL/dz 为 (n,1)，dz/dW 为 (n,m)
```

**概念是什么。** 课件在 slide 4 给出的两条"雅可比矩阵维度"结论是：dL/dz 为 (n,1)，dz/dW 为 (n,m)。其中雅可比矩阵把"标量对向量""向量对矩阵"的导数统一成矩阵形状，而 (n,1)、(n,m) 分别说明"损失对净输入的梯度是一个 n 维列向量""净输入对权重的偏导与权重同形"。[课件内容]

**为什么需要。** 反向传播在实现层面就是一串"雅可比 × 向量"的乘积，每一步都必须满足**前一因子的列数等于后一因子的行数**。维度是推导正确性最便宜的自检手段：算出的形状对不上，公式一定写错了（多半是漏了转置或多写了一层）。同时，维度也决定了实现的代价——真正的自动微分绝不会显式构造 (n, nm) 这样的稠密矩阵。[扩展讲解]

**如何工作（维度推导）。** 沿用 K006 的记号：x ∈ R^m，W ∈ R^{n×m}，b ∈ R^n，z = Wx + b ∈ R^n，L 为标量。[推导说明]

① z 的形状：(n×m)(m×1) + (n×1) = (n×1)；
② L 是标量、z 是 n 维向量，故 ∂L/∂z 由 n 个偏导组成，按课件记法为 **(n,1)** 列向量——这正是回传给该层的"误差信号"；
③ ∂z/∂W：若把 W 展平成 nm 维向量，严格的雅可比是 (n, nm)；**课件记作 (n,m)**，即采用"与 W 同形状"的逐元素偏导阵列记法（只关心 ∂z_i/∂W_ij 的对应关系）。两种记法在判断"形状是否匹配"时结论一致，但严格意义上 (n,m) 是 (n,nm) 的约简写法——**课件未说明采用哪种约定**，本笔记在此显式标注，读者如需严格论证请与授课老师确认；
④ 与 K005 的链式法则拼接时的完整维度检查（采用同形记法）：∂L/∂W = (∂L/∂y ⊙ σ′(z)) xᵀ，其中 (∂L/∂y ⊙ σ′(z)) 为 (n,1)，xᵀ 为 (1,m)，故乘积为 **(n,m)**，与 W 同形。

第 ④ 步给出了一个重要的工程事实：**梯度必须与参数同形状**。自动微分框架的 backward() 返回的张量形状若与参数形状不一致，几乎一定是推导中的转置或求和使用错了。[扩展讲解]

**数值示例。** 沿用 K005 的单权重例子：n = 1、m = 1、x = 3，∂L/∂y = 7、σ′(z) = 1，于是 ∂L/∂W = 7×1×3 = 21，形状 (1,1)，与 W 相同。再取 K006 的两维例子：n = 2、m = 2，x = (1,2)ᵀ，则 ∂L/∂z 的形状为 (2,1)、∂L/∂W 的形状为 (2,2)，与 W 的 (2,2) 一致；若把 xᵀ 误写成 x，维度会变成 (2,1)×(2,1)，矩阵乘法不合法，程序立即报 shape 错误——这正是维度自检的价值。[推导说明]

**应用场景。** 所有深度学习框架在反向传播时执行的都是"雅可比 × 向量"（更准确说是向量–雅可比乘积，VJP）：用回传的 (n,1) 信号直接乘回去，代价为 O(nm)，而不是显式构造 (n, nm) 矩阵并做 O(n²m) 乘法——当 n、m 都是上千时，差别是三个数量级。[扩展讲解]

**常见误区。** ① 把"标量对矩阵的导数"当成标量——它是一个与矩阵同形的阵列；② 把 (n,m) 当成严格雅可比维度——严格地说展平 W 后是 (n, nm)，(n,m) 是同形记法的约简（课件未说明约定）；③ 行向量与列向量混用导致转置错误，例如把 xᵀ 写成 x 使 (n,1)(1,m) 变成非法的 (n,1)(m,1)；④ 认为必须显式构造雅可比矩阵才能反向传播。

#### 英文讲解 / English Explanation

**What it is.** Slide 4 states two dimensions for the Jacobians involved in backpropagation: dL/dz is (n,1) and dz/dW is (n,m). The Jacobian matrix unifies "scalar with respect to a vector" and "vector with respect to a matrix" derivatives into matrix shapes; the two stated shapes say that the gradient of the loss with respect to the pre-activation is an n-dimensional column vector, and that the derivative of the pre-activation with respect to the weights has the same shape as the weights. [课件内容]

**Why it is needed.** At the implementation level, backpropagation is a chain of Jacobian–vector products, and every step must satisfy "the number of columns of one factor equals the number of rows of the next". Checking shapes is the cheapest correctness test available: if the shapes do not line up, the formula is wrong — usually a missing transpose or an extra layer. Shapes also determine the cost: no real automatic differentiation system ever materializes a dense (n, nm) matrix. [扩展讲解]

**How it works (dimension derivation).** Using the notation of K006: x ∈ R^m, W ∈ R^{n×m}, b ∈ R^n, z = Wx + b ∈ R^n, and L a scalar. [推导说明] (1) Shape of z: (n×m)(m×1) + (n×1) = (n×1). (2) Since L is a scalar and z is an n-vector, ∂L/∂z consists of n partial derivatives and, in the slide's convention, is an **(n,1) column vector** — this is the error signal handed back to the layer. (3) For ∂z/∂W: if W were flattened into an nm-vector the strict Jacobian would be (n, nm); **the slide writes (n,m)**, i.e. it uses the shape-aligned array of elementwise partial derivatives, keeping only the correspondence between z_i and W_ij. The two conventions agree whenever the question is "do the shapes match", but strictly speaking (n,m) is an abbreviated way of writing (n,nm) — **the slide does not say which convention it uses**, and this note flags that explicitly; a reader who needs the rigorous form should confirm it with the lecturer. (4) The complete dimension check when chaining with K005, in the shape-aligned convention: ∂L/∂W = (∂L/∂y ⊙ σ′(z)) xᵀ, where (∂L/∂y ⊙ σ′(z)) is (n,1) and xᵀ is (1,m), so the product is **(n,m)**, the same shape as W.

Step (4) yields an important engineering fact: **a gradient must have the same shape as the parameter it belongs to.** If a framework's backward() returns a tensor whose shape does not match the parameter, the derivation almost certainly mishandled a transpose or a summation. [扩展讲解]

**Worked example.** Reusing the single-weight example of K005 — n = 1, m = 1, x = 3, ∂L/∂y = 7, σ′(z) = 1 — gives ∂L/∂W = 7 × 1 × 3 = 21 of shape (1,1), identical to W. In the two-dimensional example of K006, n = 2 and m = 2 with x = (1,2)ᵀ, so ∂L/∂z has shape (2,1) and ∂L/∂W has shape (2,2), matching W's (2,2). If xᵀ were mistakenly written as x, the shapes would become (2,1)×(2,1), which is not a legal matrix product and the program would immediately raise a shape error — precisely the value of dimension checking. [推导说明]

**Where it is used.** Every deep-learning framework performs vector–Jacobian products (VJPs) during backpropagation: the incoming (n,1) signal is multiplied straight back, at a cost of O(nm) rather than materializing an (n, nm) matrix and performing O(n²m) multiplications — a difference of three orders of magnitude when n and m are in the thousands. [扩展讲解]

**Common misconceptions.** (i) Treating "derivative of a scalar with respect to a matrix" as a scalar — it is an array with the same shape as that matrix. (ii) Treating (n,m) as the strict Jacobian dimension — strictly it is (n, nm) after flattening W; (n,m) is the shape-aligned abbreviation, and the slide does not state its convention. (iii) Mixing row and column vectors and producing transpose errors, e.g. writing x instead of xᵀ and turning the legal (n,1)(1,m) into the illegal (n,1)(m,1). (iv) Believing the Jacobian matrix must be built explicitly before backpropagation can run.

#### 易错点 / Common Misconceptions

- **把 (n,m) 当作严格意义上的雅可比维度。** 严格地说，把 W 展平成 nm 维向量后，∂z/∂W 是 (n, nm)；课件写的 (n,m) 是"与 W 同形状"的约简记法，课件未说明所采用的约定，本笔记已显式标注以免误导。
- **忽略转置与向量方向。** (n,1) 与 (1,n) 在数学上互为转置、在实现上是完全不同的张量；xᵀ 写成 x 会让矩阵乘法直接非法。
- **以为梯度形状可以与参数不同。** 无论采用哪种记法，最终 ∂L/∂W 必须与 W 同形、∂L/∂b 必须与 b 同形，这是检查推导的最快判据，也是框架报 shape 错误的根源。

**来源 / References**

- [课件内容] fixture_lecture.pptx · slide 4 · 反向传播推导要点
- [扩展讲解] 向量–雅可比乘积（VJP）的实现代价（本次运行未执行外部检索，无链接）
- [推导说明] (n,1)/(n,m) 的逐步维度推导，以及对"同形记法 vs 展平记法"的显式说明

<!-- COURSENOTES:POINT K007 END -->

### 公式清单 / Formula Checklist

- `链式法则：dL/dW = dL/dy * dy/dz * dz/dW` — fixture_lecture.pptx · slide 4（识别依据：contains mathematical symbols or an equation pattern）
- `其中 z = Wx + b，y = sigma(z)，sigma 为激活函数` — fixture_lecture.pptx · slide 4（识别依据：contains mathematical symbols or an equation pattern）

两个公式候选的 LaTeX 形式、变量定义、成立条件、推导步骤与数值示例均已在下表登记，正文见 K005 与 K006 的"数学原理 / Mathematical Principles"小节。[推导说明]

| # | 课件原文 | LaTeX 形式 | 变量定义 | 成立条件 | 推导与示例位置 |
| --- | --- | --- | --- | --- | --- |
| 1 | 链式法则：dL/dW = dL/dy * dy/dz * dz/dW | $\dfrac{\partial L}{\partial W} = \dfrac{\partial L}{\partial y}\cdot\dfrac{\partial y}{\partial z}\cdot\dfrac{\partial z}{\partial W}$ | L 标量损失；y 激活后输出；z 激活前净输入；W 权重矩阵 (n,m)；向量情形各因子为雅可比矩阵 | L、y、z 均可微；复合路径完整（多路径须求和）；相邻雅可比维度相容 | K005 数学原理：五步推导；数值示例 w=2, x=3, b=1, t=0 ⇒ ∂L/∂w = 21 |
| 2 | 其中 z = Wx + b，y = sigma(z)，sigma 为激活函数 | $z = Wx + b,\qquad y = \sigma(z)$ | x ∈ R^m 输入；W ∈ R^{n×m} 权重；b ∈ R^n 偏置；z ∈ R^n 净输入；σ 逐元素激活函数；y ∈ R^n 输出 | 矩阵维度相容 (n×m)(m×1) = (n×1)；σ 可微；批量输入时 b 沿批量维广播 | K006 数学原理：五步局部雅可比推导；数值示例 x=(1,2)ᵀ ⇒ z=(0,2.5)ᵀ，y≈(0.5,0.9241)ᵀ |

说明：课件只给出两式的原始写法，未给出 LaTeX、变量符号说明（如 m、n 的含义）与成立条件；表中这些内容属 [推导说明]，已在对应知识点正文中逐条标注。

### 图表解读 / Figures to Interpret

![figure from fixture_lecture.pptx slide 3](assets/fixture-lecture_f2c778263b.png)

> 来源 / Source: fixture_lecture.pptx · slide 3　优先级 / priority: normal
> 任务 / Task: figure/diagram on a slide; explain its knowledge content, not just its labels

**这张图是什么。** 它是 fixture_lecture.pptx 第 3 张幻灯片内嵌的一张折线图，图像尺寸 640×400 像素，标题文字为 "training loss vs epoch"。图内可用于解读的元素只有：纵轴标签 `loss`、横轴标签 `epoch`、标题文字，以及一条红色的曲线；图中没有任何数值刻度（tick）与图例。[课件内容] 给出该图所属的课件位置与"需解读其知识内容"的要求。

**坐标轴编码了什么。** 横轴 `epoch` 是训练轮次，即模型把训练集完整遍历一遍的次数，代表训练**时间/迭代进程**单调向前；纵轴 `loss` 是损失值，即当前参数下模型预测与目标的偏差，**越小越好**。因此图中任意一点 (epoch, loss) 表示"训练进行到第若干轮时，模型在训练集上的损失是多少"——它是 K002/K003 中参数更新过程在时间维度上的宏观投影。[扩展讲解]

**曲线形状说明了什么。** 曲线是一条单调下降且斜率逐渐变小的红线：在最初的若干轮（图的左侧约五分之一宽度内）斜率最大，损失沿垂直方向下降得最快；随后斜率迅速变小，中段近似直线倾斜下行；到图的右端，曲线几乎与水平方向平行，趋于一条水平渐近线，但**并未**出现向上抬升或周期性上下振荡。这一形状对应优化过程：初期参数离极小点很远、梯度范数大，每步挪动造成的损失下降也大；随着接近极小点，梯度范数趋于 0，步长 η·∇L 自然变小，损失变化随之趋缓，直至进入平台期——这就是 K003 所说的"收敛"。[推导说明]

**对训练意味着什么。** ① 这是一条**健康**的收敛曲线：单调下降说明学习率没有大到引起发散，也没有出现 K003 数值示例中 η = 0.6 那样的逐轮放大；缺少周期性起伏说明 η 也没有落在 (1/λ_max, 2/λ_max) 的"震荡收敛"区间（例如 K003 例子中的 η = 0.4）；② 曲线后期趋于平坦意味着继续训练带来的收益递减，此时通常可以停止训练或引入学习率衰减；③ 反过来，如果曲线出现规律性的大幅上下摆动或整体抬升，应首先怀疑学习率过大；如果曲线在很少的轮次内就几乎水平但损失仍处于较高水平，则应怀疑学习率过小或模型容量不足。[扩展讲解]

**本图不能支持哪些结论（必须标注的不可识别内容）。** ① 图中没有坐标刻度，纵轴与横轴都没有具体数值，因此**无法**读出初始/最终损失值、下降比例或收敛所需的准确 epoch 数，本笔记不做任何数值推断；② 图中只有一条曲线（标注为 training loss），**没有**验证集/测试集损失曲线，因此仅凭此图**不能**判断模型是否过拟合或欠拟合；③ 图内未标注损失函数的具体形式（是均方误差还是交叉熵等），也未标注优化器、学习率或批量大小的取值，因此无法据此反推本次训练的超参数；④ 曲线是一条光滑的红色实线，图内未给出所绘数据的来源或生成方式，本笔记不对其做进一步推测。以上各项属于"无法可靠识别"的内容，按要求显式标注而非编造。[推导说明]

**与正文的衔接。** 图中"先陡后缓、最终趋平"的形态，正是 K002 中 θ ← θ − η∇L 反复迭代的结果，也是 K003 中收敛条件 0 < η < 2/λ_max 的直观体现：η 位于收敛区间且不过小，才会出现这种平滑的单调下降。[推导说明]

> 说明：本次运行未执行外部检索（enableWebSearch=false），图片解读完全基于对图内像素与标注的观察，以及本讲已提取的知识点；未使用任何外部资料，因此不提供链接。

### 本章总结 / Chapter Summary

- **训练 = 一个闭环。** 神经网络基础只有两件事：优化（怎么把参数调好）与反向传播（怎么高效算出该往哪里调）；前向传播 → 反向传播 → 优化器更新 → 重复，构成全部深度学习训练。[课件内容]
- **更新规则。** θ ← θ − η∇L；由一阶泰勒展开可证，当 η 足够小时该步使损失不增，η 过大则前提失效、损失反升（K002）。[课件内容] + [推导说明]
- **学习率决定收敛。** 对二次目标，收敛当且仅当 0 < η < 2/λ_max；η 过大震荡或发散，过小收敛缓慢；SGD 用单样本估计梯度、噪声大，需要更谨慎的学习率（K003）。[课件内容] + [推导说明]
- **优化器选择。** SGD 用当前样本梯度、Momentum 用梯度的指数滑动平均、Adam 用一阶/二阶矩估计；典型学习率依次为 0.01–0.1、0.01、0.001，差异源于更新依据的"归一化程度"（K004）。[课件内容]
- **反向传播的数学内核。** 链式法则 dL/dW = (dL/dy)(dy/dz)(dz/dW)，配合 z = Wx + b、y = σ(z)，给出 ∂L/∂W = (∂L/∂y ⊙ σ′(z)) xᵀ；维度上 ∂L/∂z 为 (n,1)、∂L/∂W 为 (n,m)，与参数同形（K005–K007）。[课件内容] + [推导说明]
- **一句话结论。** 本讲把"学习"还原为"求梯度 + 沿负梯度走小步"，并给出了每个量的确切维度；能否读懂 training loss vs epoch 曲线（先陡后缓、趋于平坦即健康收敛），是检验是否真正理解本讲的试金石。
- **与后续章节的衔接。** 本章只解决了"参数怎么更新"，尚未涉及网络结构设计、激活函数选择、正则化与过拟合、批归一化与学习率调度等；这些内容都建立在 K002–K007 的梯度视角之上，后续章节会反复回到 ∂L/∂W 的形状与链式法则。[扩展讲解]

### 术语表 / Glossary

| 中文术语 | English Full Name | Abbreviation | 简要解释 |
| --- | --- | --- | --- |
| 梯度下降 | Gradient Descent | GD | 沿损失函数负梯度方向、以学习率 η 为步长迭代更新参数的一阶优化算法（K002）。 |
| 随机梯度下降 | Stochastic Gradient Descent | SGD | 每次用一个样本估计梯度并立即更新的梯度下降变体，梯度无偏但方差大（K003、K004）。 |
| 学习率 | Learning Rate（课件未给出英文全称与缩写，仅写作 η/eta） | —（课件未给出；工程中常见 lr） | 更新式中决定每步走多远的正超参数，同时决定收敛速度与稳定性（K002、K003）。 |
| 优化器 | Optimizer（课件未给出英文全称与缩写） | —（课件未给出） | 决定"拿到梯度后如何更新参数"的算法，如 SGD、Momentum、Adam（K004）。 |
| 动量法 | Momentum（课件仅给出名称 Momentum，未给出英文全称与缩写） | —（课件未给出） | 用梯度的指数滑动平均代替瞬时梯度作为更新方向的优化器（K004）。 |
| Adam | Adam（课件仅给出名称；是否对应 "Adaptive Moment Estimation" 课件未说明，本笔记不作断言） | —（课件未给出） | 同时估计梯度的一阶矩与二阶矩、逐参数自适应缩放步长的优化器（K004）。 |
| 反向传播 | Backpropagation（课件未给出英文全称与缩写；中文教材常见缩写 BP） | —（课件未给出） | 按链式法则从损失逐层回传误差信号、计算各参数偏导的方法（K001、K005）。 |
| 链式法则 | Chain Rule（课件未给出英文全称与缩写） | —（课件未给出） | 复合函数求导法则：最终量对最初量的变化率等于沿途各段变化率之积（K005）。 |
| 激活函数 | Activation Function（课件未给出英文全称与缩写，仅用符号 σ） | —（课件未给出） | 逐元素作用于净输入的非线性函数，使多层网络不被压缩为单层仿射映射（K006）。 |
| 净输入 / 预激活 | Pre-activation（课件未给出英文全称与缩写，仅用符号 z） | —（课件未给出） | 线性变换的结果 z = Wx + b，即激活函数的输入（K006、K007）。 |
| 雅可比矩阵 | Jacobian Matrix（课件未给出英文全称与缩写） | —（课件未给出） | 向量值函数对向量输入的一阶偏导矩阵 J_ij = ∂f_i/∂x_j，链式法则在向量情形的推广（K007）。 |

说明：表中标注"课件未给出"的英文全称与缩写，均指本轮提取到的课件文本（fixture_lecture.pptx slide 1–4 及其备注）中确实没有出现；按撰写要求，这些位置不臆造英文名称与缩写，只在确属通用写法时以 [扩展讲解] 的口径提示，并使用"—"占位。[扩展讲解]

### 重点与难点 / Key Points and Difficulties

**本章重点。** ① K002 的参数更新式 θ ← θ − η∇L 及其成立的步长前提；② K003 学习率与收敛性的定量关系（0 < η < 2/λ_max）；③ K004 三种优化器"更新依据"的差异及其对典型学习率的影响；④ K005 链式法则 dL/dW = (dL/dy)(dy/dz)(dz/dW)；⑤ K007 的维度结论 dL/dz 为 (n,1)、dz/dW 为 (n,m)。

**本章难点。**

- **K003——难在概念抽象 + 需要先修知识。** "收敛"要求读者理解迭代矩阵的谱半径：课件只给结论"过大震荡、过小缓慢"，而要真正说清分界线为何是 2/λ_max，必须先修线性代数中的特征值与谱半径。本笔记用二次目标 L(θ) = ½θᵀAθ 与三组数值（η = 0.1 / 0.4 / 0.6）把这一层展开；读者若只记结论，遇到"为什么我的损失曲线上下跳"时仍无法判断是震荡收敛还是发散。[推导说明]
- **K005——难在推导繁琐。** 标量形式的链式法则人人会背，但落到矩阵形式时需要处理"多路径求和 → 逐元素激活使求和坍缩 → 引入输入 x 的转置"三步，任何一步出错都会得到形状正确但数值错误的梯度（或直接形状不合法）。[推导说明]
- **K007——难在记号约定易混淆。** 课件写 dz/dW 为 (n,m)，而严格雅可比（把 W 展平为 nm 维向量后）是 (n, nm)。这两者只有在"同形记法"下才一致，而课件未说明采用哪种约定；本笔记已将其显式标注为需要与授课老师确认的记号问题，读者不应把 (n,m) 当作严格的雅可比维度。[推导说明]
- **K001——难在易混淆。** "反向传播""梯度下降""优化器""SGD"四个词在日常讨论中经常被混着用；如果分不清"谁负责算梯度、谁负责定步长"，后续所有关于学习率、动量、Adam 的讨论都会失去落脚点。

**先修知识提示。** 多元微积分（偏导数、链式法则、一阶泰勒展开）、线性代数（矩阵乘法与维度匹配、特征值与谱半径）、基础概率（"梯度是无偏估计、方差与批量大小相关"的表述）。[扩展讲解]

### 自测题 / Self-Assessment Questions

1. **写出梯度下降的参数更新式，并用一阶泰勒展开说明它为什么使损失不增。这个结论的前提是什么？**
   要点：θ_{t+1} ← θ_t − η∇L(θ_t)。在 θ_t 处展开 L(θ_t + Δ) ≈ L(θ_t) + ∇L(θ_t)ᵀΔ，代入 Δ = −η∇L 得损失变化约为 −η‖∇L(θ_t)‖² ≤ 0。前提是 η 足够小、二阶余项可忽略；η 过大时该近似失效，损失可能上升（K002、K003）。

2. **对二次目标 L(θ) = ½θᵀAθ，A 的最大特征值 λ_max = 8。学习率取什么范围才保证收敛？若 η = 0.2，会看到什么现象？**
   要点：收敛条件 0 < η < 2/λ_max = 0.25。η = 0.2 落在 (1/λ_max, 2/λ_max) = (0.125, 0.25) 内，迭代因子 1 − 0.2λ 会出现负值，因此是**震荡收敛**：损失序列上下跳动但包络下降，而不是发散（K003）。

3. **设 x ∈ R^m、W ∈ R^{n×m}、b ∈ R^n，写出 z 与 y 的形状，并给出 ∂L/∂b 与 ∂L/∂W 的形状。**
   要点：z = Wx + b ∈ R^n，y = σ(z) ∈ R^n；∂L/∂z 为 (n,1)，∂L/∂b 与 b 同形即 (n,1)，∂L/∂W 与 W 同形即 (n,m)。形式化地 ∂L/∂W = (∂L/∂y ⊙ σ′(z)) xᵀ，其中 (n,1)×(1,m) = (n,m)（K006、K007）。

4. **SGD、Momentum、Adam 的"更新依据"分别是什么？为什么 Adam 的典型学习率（0.001）比 SGD（0.01–0.1）小一个量级？**
   要点：SGD 用当前样本梯度；Momentum 用梯度的指数滑动平均；Adam 用梯度一阶矩与二阶矩的估计。Adam 用 √v̂_t + ε 对每个参数的梯度尺度做归一化，有效步长接近 η 本身，故 η 取小值即可；SGD 的步长直接是 η·g_t，梯度量级直接进入步长，所以需要更大的 η（K004）。

5. **一条 training loss vs epoch 曲线初期陡降、后期趋于平坦。能否据此断定模型没有过拟合？还缺什么信息？**
   要点：不能。该图只有训练损失一条曲线、且没有数值刻度，缺少验证集/测试集损失曲线，无法区分"拟合良好"与"已经过拟合"；也无法读出具体损失值与收敛轮数。判断过拟合需要同时观察训练与验证损失是否分叉（图表解读）。

### 参考资料 / References

- [课件内容] fixture_lecture.pptx · slide 1（Neural Network Basics / 优化与反向传播）、slide 2 及其备注（梯度下降与学习率、SGD 每次用一个样本估计梯度）、slide 3（优化器对比表格、内嵌图 training loss vs epoch）、slide 4（反向传播推导要点：链式法则、z = Wx + b 与 y = σ(z)、雅可比矩阵维度）。
- [扩展讲解] 通用背景知识：经验风险最小化与自动微分、批量划分、优化器惯用公式与默认超参数、学习率调度、梯度消失/爆炸、通用近似性质。本次运行未执行外部检索（运行配置 enableWebSearch=false），因此不附任何外部链接。
- [推导说明] 本笔记自行完成的内容：K002 的一阶泰勒推导与二维数值示例；K003 的二次目标特征值收敛条件推导与三组数值对比；K004 的有效步长倍数与常量梯度动量示例；K005 的五步推导与单权重数值示例；K006 的局部雅可比五步推导与 logistic 数值示例；K007 的维度推导与"同形记法 vs 展平记法"说明；图表解读中的量化说明与不可识别内容标注。
- 未识别/未验证事项：课件未给出 NN、BP、Adam 全称、激活函数具体形式、优化器公式与 β/ε 默认值、图片坐标刻度与数据来源；本笔记对以上内容一律不做断言，或以"课件未给出"显式标注。
- （本次运行未获取到可引用的外部来源。/ No external reference was retrieved in this run.)
