#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Generate CourseNotes test fixtures (pptx / docx / png / md / txt).

Fixtures are synthetic but realistic: they contain headings, bullet lists,
tables, a formula, a chart image and both Chinese and English text so the
pipeline can be exercised without shipping copyrighted course material.
"""

from __future__ import annotations

import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
FIX = os.path.join(HERE, "fixtures")


def make_chart_image(path: str) -> None:
    from PIL import Image, ImageDraw

    width, height = 640, 400
    image = Image.new("RGB", (width, height), "white")
    draw = ImageDraw.Draw(image)
    # axes
    draw.line((70, 20, 70, 350), fill="black", width=2)
    draw.line((70, 350, 600, 350), fill="black", width=2)
    draw.text((20, 10), "loss", fill="black")
    draw.text((560, 360), "epoch", fill="black")
    # a decaying training curve
    points = []
    for i in range(51):
        x = 70 + i * 10
        y = 330 - int(300 * (0.9 ** i) - 20)
        points.append((x, max(30, y)))
    draw.line(points, fill="red", width=3)
    draw.text((300, 40), "training loss vs epoch", fill="black")
    image.save(path)


def make_pptx(path: str) -> None:
    from pptx import Presentation
    from pptx.util import Inches, Pt

    prs = Presentation()
    core = prs.core_properties
    core.title = "Neural Network Basics (fixture)"
    core.author = "CourseNotes test fixture"

    # slide 1: title
    slide = prs.slides.add_slide(prs.slide_layouts[0])
    slide.shapes.title.text = "第 2 讲 神经网络基础"
    slide.placeholders[1].text = "Neural Network Basics / 优化与反向传播"

    # slide 2: bullets + formula
    slide = prs.slides.add_slide(prs.slide_layouts[1])
    slide.shapes.title.text = "2.1 梯度下降与学习率"
    body = slide.placeholders[1].text_frame
    body.text = "梯度下降（Gradient Descent, GD）沿负梯度方向更新参数"
    for text, level in [
        ("参数更新：theta <- theta - eta * grad L", 1),
        ("学习率 eta 过大导致震荡，过小导致收敛缓慢", 1),
        ("随机梯度下降（Stochastic Gradient Descent, SGD）每次用一个样本估计梯度", 1),
    ]:
        para = body.add_paragraph()
        para.text = text
        para.level = level
        for run in para.runs:
            run.font.size = Pt(18)
    slide.notes_slide.notes_text_frame.text = "强调学习率对收敛性的影响。"

    # slide 3: table + picture
    slide = prs.slides.add_slide(prs.slide_layouts[5])
    slide.shapes.title.text = "2.2 优化器对比"
    rows, cols = 4, 3
    table = slide.shapes.add_table(rows, cols, Inches(0.6), Inches(1.6),
                                   Inches(6), Inches(2)).table
    data = [
        ["优化器", "更新依据", "典型学习率"],
        ["SGD", "当前样本梯度", "0.01 - 0.1"],
        ["Momentum", "梯度指数滑动平均", "0.01"],
        ["Adam", "一阶/二阶矩估计", "0.001"],
    ]
    for r in range(rows):
        for c in range(cols):
            table.cell(r, c).text = data[r][c]
    chart = os.path.join(FIX, "fixture_chart.png")
    slide.shapes.add_picture(chart, Inches(0.6), Inches(3.9), width=Inches(4.5))

    # slide 4: math heavy
    slide = prs.slides.add_slide(prs.slide_layouts[5])
    slide.shapes.title.text = "2.3 反向传播推导要点"
    box = slide.shapes.add_textbox(Inches(0.6), Inches(1.5), Inches(8), Inches(3))
    tf = box.text_frame
    tf.text = "链式法则：dL/dW = dL/dy * dy/dz * dz/dW"
    tf.add_paragraph().text = "其中 z = Wx + b，y = sigma(z)，sigma 为激活函数"
    tf.add_paragraph().text = "雅可比矩阵维度：dL/dz 为 (n,1)，dz/dW 为 (n,m)"

    prs.save(path)


def make_docx(path: str) -> None:
    import docx
    from docx.shared import Inches

    document = docx.Document()
    document.core_properties.title = "计算机网络复习提纲 (fixture)"
    document.core_properties.author = "CourseNotes test fixture"

    document.add_heading("第一章 概述", level=1)
    document.add_paragraph(
        "计算机网络（Computer Network）将地理位置不同的计算机互联，"
        "实现资源共享与信息传递。")
    document.add_heading("1.1 OSI 参考模型", level=2)
    document.add_paragraph(
        "OSI 七层模型：物理层（Physical Layer）、数据链路层（Data Link Layer, "
        "DLL）、网络层（Network Layer）、传输层（Transport Layer）、"
        "会话层、表示层、应用层。")
    document.add_paragraph("网络层 PDU 称为分组（packet），传输层 PDU 称为报文段（segment）。")

    document.add_heading("1.2 关键对比", level=2)
    table = document.add_table(rows=3, cols=2)
    table.style = "Table Grid"
    table.cell(0, 0).text = "对比项"
    table.cell(0, 1).text = "面向连接 vs 无连接"
    table.cell(1, 0).text = "连接建立"
    table.cell(1, 1).text = "需要握手 / 无需握手"
    table.cell(2, 0).text = "典型协议"
    table.cell(2, 1).text = "TCP / UDP"

    document.add_heading("1.3 公式示例", level=2)
    document.add_paragraph(
        "信道容量遵循香农公式 C = B * log2(1 + S/N)，其中 B 为带宽，S/N 为信噪比。")
    document.add_picture(os.path.join(FIX, "fixture_chart.png"), width=Inches(4))
    document.save(path)


def make_text_fixtures() -> None:
    md = [
        "# 第三章 传输层 / Transport Layer",
        "",
        "## 3.1 复用与分用",
        "",
        "传输层通过端口号（port number）实现复用（multiplexing）与分用（demultiplexing）。",
        "",
        "- 无连接分用：UDP 仅使用目的端口",
        "- 面向连接分用：TCP 使用四元组 (源IP, 源端口, 目的IP, 目的端口)",
        "",
        "## 3.2 可靠传输",
        "",
        "停等协议（Stop-and-Wait）的利用率：",
        "",
        "$$U = \\frac{T_{transmit}}{T_{transmit} + 2 \\cdot T_{prop}}$$",
        "",
        "| 机制 | 作用 |",
        "| --- | --- |",
        "| 超时重传 | 处理丢失 |",
        "| 累计确认 | 提高效率 |",
        "",
    ]
    with open(os.path.join(FIX, "fixture_ch3.md"), "w", encoding="utf-8") as fh:
        fh.write("\n".join(md))

    txt = (
        "实验一 数据链路层抓包\n"
        "1. 使用 Wireshark 抓取 ARP 请求与应答。\n"
        "2. 分析以太网帧（Ethernet frame）首部字段：目的 MAC、源 MAC、类型。\n"
        "3. 记录 CRC 校验字段长度，思考其检错能力。\n"
    )
    with open(os.path.join(FIX, "fixture_lab.txt"), "w", encoding="utf-8") as fh:
        fh.write(txt)


def main() -> int:
    os.makedirs(FIX, exist_ok=True)
    make_chart_image(os.path.join(FIX, "fixture_chart.png"))
    make_pptx(os.path.join(FIX, "fixture_lecture.pptx"))
    make_docx(os.path.join(FIX, "fixture_outline.docx"))
    make_text_fixtures()
    for name in sorted(os.listdir(FIX)):
        print("%10d  %s" % (os.path.getsize(os.path.join(FIX, name)), name))
    return 0


if __name__ == "__main__":
    sys.exit(main())
