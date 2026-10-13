#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""CourseNotes document parser backend.

Reads course materials in several formats and writes one structured JSON
document per input file.  The JSON is designed to be consumed by the Node
side of the CourseNotes plugin (``lib/parse/*.js``), which turns it into
``ParsedDocument`` objects.

Design rules:

*   Never invent content.  Anything that cannot be extracted reliably is
    reported as an explicit warning instead of being guessed.
*   Preserve source locators (page number, slide number, paragraph index,
    line offset, image file name) for every extracted element.
*   Never modify the input files.  All artifacts are written below
    ``--work-dir``.

Supported formats: .pdf .pptx .docx .png .jpg .jpeg .webp .gif .bmp .tif .tiff
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import os
import re
import sys
import traceback
from typing import Any, Dict, Iterable, List, Optional, Tuple

SCHEMA_VERSION = 1

# Fonts that indicate mathematical typesetting in LaTeX/Word-generated PDFs.
MATH_FONT_MARKERS = (
    "cmmi", "cmsy", "cmex", "cmmib", "cmbsy", "msam", "msbm", "rsfs",
    "eufm", "eufb", "stmary", "math", "symbol", "mtmi", "mtsy", "mtm",
)

IMAGE_EXT = {
    "png": ".png", "jpeg": ".jpg", "jpg": ".jpg", "webp": ".webp",
    "gif": ".gif", "bmp": ".bmp", "tiff": ".tiff", "tif": ".tif",
    "jpx": ".jp2", "jp2": ".jp2", "svg": ".svg",
}

LIGATURES = {
    "\ufb00": "ff", "\ufb01": "fi", "\ufb02": "fl", "\ufb03": "ffi",
    "\ufb04": "ffl", "\ufb05": "st", "\ufb06": "st",
}

CJK_RE = re.compile(
    "[\u2e80-\u2eff\u3000-\u303f\u3040-\u30ff\u3100-\u312f\u31a0-\u31bf"
    "\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff00-\uffef]"
)
WS_RE = re.compile(r"[ \t\u00a0\u2000-\u200b\u3000]+")


# --------------------------------------------------------------------------
# small helpers
# --------------------------------------------------------------------------

def clean_text(value: Optional[str]) -> str:
    """Normalise whitespace without destroying CJK content."""
    if not value:
        return ""
    text = value.replace("\r\n", "\n").replace("\r", "\n")
    for src, dst in LIGATURES.items():
        text = text.replace(src, dst)
    # keep newlines, collapse horizontal runs
    lines = [WS_RE.sub(" ", line).strip() for line in text.split("\n")]
    return "\n".join(line for line in lines if line != "")


def emit(payload: Dict[str, Any]) -> None:
    out = payload.get("json_out")
    if out:
        with io.open(out, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, ensure_ascii=False, indent=1)
    else:
        json.dump(payload, sys.stdout, ensure_ascii=False)


def warn(bucket: List[Dict[str, str]], code: str, message: str,
         locator: Optional[str] = None, severity: str = "warning") -> None:
    item = {"code": code, "message": message, "severity": severity}
    if locator:
        item["locator"] = locator
    bucket.append(item)


def safe_dir(path: str) -> str:
    if not os.path.isdir(path):
        os.makedirs(path, exist_ok=True)
    return path


def dominant_script(text: str) -> str:
    if not text:
        return "unknown"
    cjk = len(CJK_RE.findall(text))
    latin = len(re.findall(r"[A-Za-z]", text))
    if cjk == 0 and latin == 0:
        return "unknown"
    if cjk >= max(4, latin * 0.6):
        return "cjk"
    if latin >= max(4, cjk * 0.6):
        return "latin"
    return "mixed"


def is_math_font(font: str) -> bool:
    low = (font or "").lower()
    return any(marker in low for marker in MATH_FONT_MARKERS)


MATH_CHAR_RE = re.compile(
    r"[=≈≠≤≥∑∏∫∮√∞∂∇±×÷∈∉⊂⊆∪∩∀∃→←↔⇒⇔α-ωΑ-Ωθλμπσ]"
)


def looks_mathematical(text: str) -> bool:
    if not text:
        return False
    symbols = len(MATH_CHAR_RE.findall(text))
    if symbols >= 2:
        return True
    if symbols >= 1 and re.search(r"[A-Za-z]\s*[=<>]\s*", text):
        return True
    return False


class ImageCollector:
    """Writes extracted images into <work_dir>/assets and deduplicates them."""

    def __init__(self, work_dir: str, slug: str, extract: bool) -> None:
        self.dir = safe_dir(os.path.join(work_dir, "assets"))
        self.slug = slug
        self.extract = extract
        self.seen: Dict[str, str] = {}
        self.records: List[Dict[str, Any]] = []

    def add_bytes(self, data: bytes, ext: str, locator: str,
                  caption: Optional[str] = None) -> Dict[str, Any]:
        digest = hashlib.sha1(data).hexdigest()
        rel_path = None
        if self.extract:
            if digest in self.seen:
                rel_path = self.seen[digest]
            else:
                name = "%s_%s%s" % (self.slug, digest[:10], ext or ".png")
                abs_path = os.path.join(self.dir, name)
                if not os.path.exists(abs_path):
                    with open(abs_path, "wb") as handle:
                        handle.write(data)
                self.seen[digest] = "assets/" + name
                rel_path = self.seen[digest]
        record = {
            "kind": "image",
            "locator": locator,
            "file": rel_path,
            "sha1": digest,
            "bytes": len(data),
            "caption": caption or "",
            "interpretation": (
                "extracted raster image; semantic content must be interpreted "
                "by a vision-capable model - see vision_tasks"
            ),
        }
        self.records.append(record)
        return record

    def add_file(self, path: str, locator: str, extract: bool = True,
                 caption: Optional[str] = None) -> Dict[str, Any]:
        with open(path, "rb") as handle:
            data = handle.read()
        digest = hashlib.sha1(data).hexdigest()
        if digest in self.seen:
            rel = self.seen[digest]
        else:
            ext = os.path.splitext(path)[1].lower() or ".png"
            name = "%s_%s%s" % (self.slug, digest[:10], ext)
            rel = "assets/" + name
            if extract:
                abs_path = os.path.join(self.dir, name)
                if not os.path.exists(abs_path):
                    with open(abs_path, "wb") as handle:
                        handle.write(data)
                self.seen[digest] = rel
        record = {
            "kind": "image",
            "locator": locator,
            "file": rel,
            "sha1": digest,
            "bytes": len(data),
            "caption": caption or "",
            "interpretation": (
                "extracted raster image; semantic content must be interpreted "
                "by a vision-capable model - see vision_tasks"
            ),
        }
        self.records.append(record)
        return record


# --------------------------------------------------------------------------
# PDF
# --------------------------------------------------------------------------

def _spans_to_lines(spans: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Group character spans (PyMuPDF ``rawdict`` granularity) into lines."""
    lines: List[List[Dict[str, Any]]] = []
    for span in spans:
        chars = span.get("chars") or []
        if not chars:
            continue
        current: List[Dict[str, Any]] = []
        last = None
        for char in chars:
            box = char.get("bbox") or [0, 0, 0, 0]
            if last is not None:
                prev_box = last.get("bbox") or [0, 0, 0, 0]
                same_line = abs(box[1] - prev_box[1]) < 0.55 * max(
                    1.0, box[3] - box[1])
                gap = box[0] - prev_box[2]
                if not same_line or gap > 3.2 * max(1.0, box[2] - box[0]):
                    lines.append(current)
                    current = []
            current.append(char)
            last = char
        if current:
            lines.append(current)

    result: List[Dict[str, Any]] = []
    for chars in lines:
        text = "".join(ch.get("c", "") for ch in chars)
        if not text.strip():
            continue
        sizes = [ch.get("size") or 0.0 for ch in chars if ch.get("size")]
        sizes.sort()
        size = sizes[len(sizes) // 2] if sizes else 0.0
        fonts: Dict[str, int] = {}
        for ch in chars:
            fonts[ch.get("font") or ""] = fonts.get(ch.get("font") or "", 0) + 1
        font = max(fonts.items(), key=lambda kv: kv[1])[0] if fonts else ""
        x0 = min((ch.get("bbox") or [0, 0, 0, 0])[0] for ch in chars)
        x1 = max((ch.get("bbox") or [0, 0, 0, 0])[2] for ch in chars)
        y0 = min((ch.get("bbox") or [0, 0, 0, 0])[1] for ch in chars)
        y1 = max((ch.get("bbox") or [0, 0, 0, 0])[3] for ch in chars)
        result.append({
            "text": clean_text(text),
            "size": round(float(size), 2),
            "font": font,
            "bbox": [round(x0, 2), round(y0, 2), round(x1, 2), round(y1, 2)],
            "math_font": is_math_font(font),
        })
    return result


def _line_indent(lines: List[Dict[str, Any]]) -> float:
    if not lines:
        return 0.0
    xs = sorted(line["bbox"][0] for line in lines)
    return xs[max(0, len(xs) // 10)]


def parse_pdf(path: str, work_dir: str, args: argparse.Namespace,
              slug: str) -> Dict[str, Any]:
    try:
        import pymupdf  # noqa: F401  (PyMuPDF >= 1.24)
    except Exception:  # pragma: no cover - legacy name
        import fitz as pymupdf  # type: ignore

    warnings: List[Dict[str, str]] = []
    collector = ImageCollector(work_dir, slug, args.extract_images)
    pages: List[Dict[str, Any]] = []
    vision_tasks: List[Dict[str, Any]] = []
    formula_candidates: List[Dict[str, Any]] = []
    table_count = 0

    doc = pymupdf.open(path)
    pdf_meta = doc.metadata or {}
    render_dir = safe_dir(os.path.join(work_dir, "page-renders"))

    for pno in range(doc.page_count):
        page = doc[pno]
        words = page.get_text("words") or []
        raw = page.get_text("rawdict", flags=pymupdf.TEXTFLAGS_RAWDICT) or {}
        page_lines: List[Dict[str, Any]] = []
        for block in raw.get("blocks", []):
            if block.get("type") != 0:
                continue
            for line in block.get("lines", []):
                page_lines.extend(_spans_to_lines(line.get("spans") or []))

        page_lines.sort(key=lambda ln: (round(ln["bbox"][1], 1), ln["bbox"][0]))
        body_size = 0.0
        if page_lines:
            sizes: Dict[float, int] = {}
            for line in page_lines:
                key = round(line["size"], 1)
                sizes[key] = sizes.get(key, 0) + len(line["text"])
            body_size = max(sizes.items(), key=lambda kv: kv[1])[0]

        indent = _line_indent(page_lines)
        content: List[Dict[str, Any]] = []
        char_total = sum(len(line["text"]) for line in page_lines)
        for line in page_lines:
            level = 0
            if body_size and line["size"] >= body_size + 4.0:
                level = 1
            elif body_size and line["size"] >= body_size + 1.8:
                level = 2
            elif body_size and line["size"] >= body_size + 0.6 and \
                    line["bbox"][0] <= indent + 2.0 and len(line["text"]) < 70:
                level = 3
            item: Dict[str, Any] = {
                "kind": "heading" if level else "text",
                "text": line["text"],
                "locator": "page %d" % (pno + 1),
                "bbox": line["bbox"],
            }
            if level:
                item["level"] = level
                item["font_size"] = line["size"]
            if looks_mathematical(line["text"]) or line["math_font"]:
                item["math_like"] = True
                if len(formula_candidates) < args.max_formulas:
                    formula_candidates.append({
                        "text": line["text"],
                        "locator": "page %d" % (pno + 1),
                        "font": line["font"],
                        "math_font": bool(line["math_font"]),
                    })
            content.append(item)

        # ---- tables -------------------------------------------------------
        page_tables: List[Dict[str, Any]] = []
        try:
            finder = page.find_tables()
            for t_index, table in enumerate(getattr(finder, "tables", []) or []):
                rows = []
                for row in table.extract() or []:
                    rows.append([clean_text(cell) if cell else "" for cell in row])
                if not rows:
                    continue
                table_count += 1
                page_tables.append({
                    "kind": "table",
                    "locator": "page %d table %d" % (pno + 1, t_index + 1),
                    "rows": rows,
                    "bbox": [round(v, 2) for v in (table.bbox or (0, 0, 0, 0))],
                })
        except Exception as exc:  # tables are best-effort
            warn(warnings, "table-extraction-failed",
                 "table detection failed on page %d: %s" % (pno + 1, exc))

        # ---- images -------------------------------------------------------
        page_images: List[Dict[str, Any]] = []
        try:
            for info in page.get_images(full=True):
                xref = info[0]
                try:
                    pix = pymupdf.Pixmap(doc, xref)
                    if pix.n - pix.alpha >= 4:
                        pix = pymupdf.Pixmap(pymupdf.csRGB, pix)
                    data = pix.tobytes("png")
                    record = collector.add_bytes(
                        data, ".png", "page %d" % (pno + 1))
                    pix = None
                except Exception as exc:
                    warn(warnings, "image-extraction-failed",
                         "image xref %d on page %d could not be extracted: %s"
                         % (xref, pno + 1, exc))
                    continue
                page_images.append(record)
        except Exception as exc:
            warn(warnings, "image-scan-failed",
                 "image scan failed on page %d: %s" % (pno + 1, exc))

        # ---- scanned / visual page detection ------------------------------
        is_scanned = False
        if char_total < args.scanned_char_threshold:
            is_scanned = True
            warn(warnings, "page-without-text-layer",
                 "page %d yields almost no extractable text; treated as a "
                 "scanned or image-only page" % (pno + 1),
                 locator="page %d" % (pno + 1))
            if args.extract_images:
                try:
                    pix = page.get_pixmap(matrix=pymupdf.Matrix(2, 2))
                    data = pix.tobytes("png")
                    record = collector.add_bytes(
                        data, ".png",
                        "page %d (rendered page image)" % (pno + 1),
                        caption="rendered page %d" % (pno + 1))
                    page_images.append(record)
                    render_path = os.path.join(
                        render_dir, "%s_page_%03d.png" % (slug, pno + 1))
                    with open(render_path, "wb") as handle:
                        handle.write(data)
                    pix = None
                except Exception as exc:
                    warn(warnings, "page-render-failed",
                         "page %d could not be rendered: %s" % (pno + 1, exc))

        for record in page_images:
            vision_tasks.append({
                "image": record["file"],
                "locator": record["locator"],
                "priority": "high" if (is_scanned or record.get("bytes", 0) > 20000)
                            else "normal",
                "reason": ("scanned page: full page content must be read from the "
                           "image" if is_scanned else
                           "figure/diagram extracted from the material; explain "
                           "its knowledge content, not just its labels"),
            })

        pages.append({
            "index": pno + 1,
            "char_count": char_total,
            "is_scanned": is_scanned,
            "body_font_size": body_size,
            "elements": content,
            "tables": page_tables,
            "images": page_images,
            "rotation": page.rotation,
            "width": round(page.rect.width, 2),
            "height": round(page.rect.height, 2),
        })

    page_count = doc.page_count
    doc.close()

    return {
        "format": "pdf",
        "page_count": page_count,
        "metadata": {
            "title": clean_text(pdf_meta.get("title")),
            "author": clean_text(pdf_meta.get("author")),
            "subject": clean_text(pdf_meta.get("subject")),
            "creator": clean_text(pdf_meta.get("creator")),
            "producer": clean_text(pdf_meta.get("producer")),
        },
        "pages": pages,
        "tables_count": table_count,
        "images": collector.records,
        "formula_candidates": formula_candidates,
        "vision_tasks": vision_tasks,
        "warnings": warnings,
    }


# --------------------------------------------------------------------------
# PPTX
# --------------------------------------------------------------------------

def _pptx_shape_text(shape: Any) -> List[Dict[str, Any]]:
    """Return paragraph-level records for one shape.

    Each record carries ``text`` (indented for sub-levels) plus ``para_level``
    and ``title_like`` so the caller can decide the heading level without
    guessing from the rendered text.
    """
    out: List[Dict[str, Any]] = []
    if getattr(shape, "has_text_frame", False) and shape.text_frame is not None:
        is_title = False
        try:
            if getattr(shape, "is_placeholder", False):
                is_title = int(getattr(shape.placeholder_format, "idx", -1)) == 0
                if not is_title and shape == shape._parent.shapes.title:
                    is_title = True
        except Exception:
            is_title = False
        for para in shape.text_frame.paragraphs:
            text = clean_text(para.text)
            if not text:
                continue
            out.append({
                "text": text,
                "para_level": int(para.level or 0),
                "title_like": is_title,
            })
    if getattr(shape, "has_table", False) and shape.has_table:
        rows = []
        for row in shape.table.rows:
            rows.append([clean_text(cell.text) for cell in row.cells])
        if rows:
            out.append({"table": rows})
    if getattr(shape, "shape_type", None) is not None:
        try:
            from pptx.enum.shapes import MSO_SHAPE_TYPE
            if shape.shape_type == MSO_SHAPE_TYPE.GROUP:
                for child in shape.shapes:
                    out.extend(_pptx_shape_text(child))
        except Exception:
            pass
    return out


def parse_pptx(path: str, work_dir: str, args: argparse.Namespace,
               slug: str) -> Dict[str, Any]:
    from pptx import Presentation
    from pptx.enum.shapes import MSO_SHAPE_TYPE

    warnings: List[Dict[str, str]] = []
    collector = ImageCollector(work_dir, slug, args.extract_images)
    slides: List[Dict[str, Any]] = []
    vision_tasks: List[Dict[str, Any]] = []
    formula_candidates: List[Dict[str, Any]] = []
    table_count = 0
    media_dir = safe_dir(os.path.join(work_dir, "pptx-media"))

    prs = Presentation(path)
    core = prs.core_properties

    for index, slide in enumerate(prs.slides, start=1):
        title = ""
        elements: List[Dict[str, Any]] = []
        images: List[Dict[str, Any]] = []
        notes = ""

        # Title placeholder first so the slide heading is stable.
        try:
            if slide.shapes.title is not None:
                title = clean_text(slide.shapes.title.text)
        except Exception:
            title = ""

        for shape in slide.shapes:
            records = _pptx_shape_text(shape)
            for record in records:
                if "table" in record:
                    table_count += 1
                    elements.append({
                        "kind": "table",
                        "locator": "slide %d" % index,
                        "rows": record["table"],
                    })
                    continue
                text = record["text"]
                level = 0
                if record.get("title_like"):
                    level = 1
                elif title and text == title:
                    level = 1
                elif record.get("para_level", 0) > 0:
                    level = 3
                item: Dict[str, Any] = {
                    "kind": "heading" if level else "text",
                    "text": text,
                    "locator": "slide %d" % index,
                }
                if level:
                    item["level"] = level
                if looks_mathematical(text):
                    item["math_like"] = True
                    if len(formula_candidates) < args.max_formulas:
                        formula_candidates.append({
                            "text": text,
                            "locator": "slide %d" % index,
                            "font": "",
                            "math_font": False,
                        })
                elements.append(item)

            if shape.shape_type == MSO_SHAPE_TYPE.PICTURE:
                try:
                    image = shape.image
                    record = collector.add_bytes(
                        image.blob, IMAGE_EXT.get(image.ext, "." + str(image.ext)),
                        "slide %d" % index)
                    images.append(record)
                    # also keep a stable per-slide copy for the slide render
                    media_path = os.path.join(
                        media_dir, "%s_slide%03d_%s%s"
                        % (slug, index, record["sha1"][:8],
                           IMAGE_EXT.get(image.ext, "." + str(image.ext))))
                    if not os.path.exists(media_path):
                        with open(media_path, "wb") as handle:
                            handle.write(image.blob)
                except Exception as exc:
                    warn(warnings, "image-extraction-failed",
                         "picture on slide %d could not be extracted: %s"
                         % (index, exc))

        if slide.has_notes_slide:
            try:
                notes = clean_text(slide.notes_slide.notes_text_frame.text)
            except Exception:
                notes = ""

        for record in images:
            vision_tasks.append({
                "image": record["file"],
                "locator": record["locator"],
                "priority": "high" if record.get("bytes", 0) > 20000 else "normal",
                "reason": ("figure/diagram on a slide; explain its knowledge "
                           "content, not just its labels"),
            })

        slides.append({
            "index": index,
            "title": title,
            "elements": elements,
            "images": images,
            "notes": notes,
            "layout": getattr(slide.slide_layout, "name", ""),
        })

    return {
        "format": "pptx",
        "slide_count": len(slides),
        "metadata": {
            "title": clean_text(core.title),
            "author": clean_text(core.author),
            "subject": clean_text(core.subject),
            "created": str(core.created) if core.created else "",
            "modified": str(core.modified) if core.modified else "",
        },
        "slides": slides,
        "tables_count": table_count,
        "images": collector.records,
        "formula_candidates": formula_candidates,
        "vision_tasks": vision_tasks,
        "warnings": warnings,
    }


# --------------------------------------------------------------------------
# DOCX
# --------------------------------------------------------------------------

def _docx_table_rows(table: Any) -> List[List[str]]:
    rows: List[List[str]] = []
    for row in table.rows:
        cells = []
        for cell in row.cells:
            cells.append(clean_text(cell.text))
        rows.append(cells)
    return rows


def parse_docx(path: str, work_dir: str, args: argparse.Namespace,
               slug: str) -> Dict[str, Any]:
    import docx
    from docx.table import Table
    from docx.text.paragraph import Paragraph
    from docx.oxml.ns import qn

    warnings: List[Dict[str, str]] = []
    collector = ImageCollector(work_dir, slug, args.extract_images)
    elements: List[Dict[str, Any]] = []
    tables: List[Dict[str, Any]] = []
    images: List[Dict[str, Any]] = []
    vision_tasks: List[Dict[str, Any]] = []
    formula_candidates: List[Dict[str, Any]] = []
    media_dir = safe_dir(os.path.join(work_dir, "docx-media"))

    document = docx.Document(path)
    body = document.element.body

    def para_item(par: Any, locator: str) -> Optional[Dict[str, Any]]:
        text = clean_text(par.text)
        style = (par.style.name or "") if par.style is not None else ""
        is_math = False
        blocked = False
        has_image = False
        try:
            xml = par._p.xml
            is_math = "<m:oMath" in xml
            has_image = "<a:blip" in xml
            # w:object embeds OLE/equation objects whose text python-docx
            # cannot recover; a plain w:drawing holding an image is fine.
            blocked = "<w:object" in xml or (
                "<w:drawing" in xml and not has_image)
        except Exception:
            is_math = False
        if not text and not is_math and not blocked:
            return None
        level = 0
        match = re.match(r"Heading\s+(\d+)", style, re.I) or \
            re.match(r"标题\s*(\d+)", style)
        if match:
            level = int(match.group(1))
        elif style.lower() in ("title", "标题"):
            level = 1
        elif style.lower().startswith("subtitle"):
            level = 2
        item: Dict[str, Any] = {
            "kind": "heading" if level else "text",
            "text": text,
            "locator": locator,
            "style": style,
            "blocked_object": blocked and not text,
        }
        if level:
            item["level"] = min(level, 6)
        if is_math or looks_mathematical(text):
            item["math_like"] = True
            if len(formula_candidates) < args.max_formulas:
                formula_candidates.append({
                    "text": text,
                    "locator": locator,
                    "font": "oMath" if is_math else "",
                    "math_font": False,
                })
        return item

    p_index = 0
    t_index = 0
    for child in body.iterchildren():
        if child.tag == qn("w:p"):
            p_index += 1
            item = para_item(Paragraph(child, document), "paragraph %d" % p_index)
            if item:
                item["paragraph"] = p_index
                if item.get("blocked_object") and not item.get("text"):
                    warn(warnings, "unrecoverable-object",
                         "paragraph %d embeds an OLE/equation object whose text "
                         "cannot be extracted by python-docx; it is flagged "
                         "instead of guessed" % p_index,
                         locator="paragraph %d" % p_index)
            # inline images are extracted independently of paragraph text so
            # an image-only paragraph still contributes its figure
            for blip in child.findall(".//" + qn("a:blip")):
                rid = blip.get(qn("r:embed")) or blip.get(qn("r:link"))
                if not rid:
                    continue
                try:
                    part = document.part.related_parts[rid]
                    record = collector.add_bytes(
                        part.blob,
                        IMAGE_EXT.get(
                            os.path.splitext(str(part.partname))[1][1:].lower(),
                            ".png"),
                        "paragraph %d" % p_index)
                    images.append(record)
                    media_path = os.path.join(
                        media_dir, "%s_p%04d_%s%s"
                        % (slug, p_index, record["sha1"][:8],
                           os.path.splitext(str(part.partname))[1]))
                    if not os.path.exists(media_path):
                        with open(media_path, "wb") as handle:
                            handle.write(part.blob)
                except Exception as exc:
                    warn(warnings, "image-extraction-failed",
                         "inline image on paragraph %d failed: %s"
                         % (p_index, exc))
            if item:
                elements.append(item)
        elif child.tag == qn("w:tbl"):
            t_index += 1
            try:
                rows = _docx_table_rows(Table(child, document))
            except Exception as exc:
                warn(warnings, "table-extraction-failed",
                     "table %d failed: %s" % (t_index, exc))
                continue
            table = {
                "kind": "table",
                "locator": "table %d" % t_index,
                "rows": rows,
            }
            tables.append(table)
            elements.append(table)

    for record in images:
        vision_tasks.append({
            "image": record["file"],
            "locator": record["locator"],
            "priority": "high" if record.get("bytes", 0) > 20000 else "normal",
            "reason": ("figure embedded in the document; explain its knowledge "
                       "content, not just its labels"),
        })

    core = document.core_properties
    return {
        "format": "docx",
        "metadata": {
            "title": clean_text(core.title),
            "author": clean_text(core.author),
            "subject": clean_text(core.subject),
            "created": str(core.created) if core.created else "",
            "modified": str(core.modified) if core.modified else "",
        },
        "elements": elements,
        "tables_count": len(tables),
        "paragraph_count": p_index,
        "images": collector.records,
        "formula_candidates": formula_candidates,
        "vision_tasks": vision_tasks,
        "warnings": warnings,
    }


# --------------------------------------------------------------------------
# images
# --------------------------------------------------------------------------

def parse_image(path: str, work_dir: str, args: argparse.Namespace,
                slug: str) -> Dict[str, Any]:
    from PIL import Image

    warnings: List[Dict[str, str]] = []
    collector = ImageCollector(work_dir, slug, args.extract_images)
    info: Dict[str, Any] = {}
    caption = ""
    try:
        with Image.open(path) as image:
            info = {
                "width": image.width,
                "height": image.height,
                "mode": image.mode,
                "format": image.format or "",
            }
            exif = {}
            try:
                exif = {str(k): str(v) for k, v in (image.getexif() or {}).items()}
            except Exception:
                exif = {}
            info["exif"] = exif
    except Exception as exc:
        warn(warnings, "image-open-failed", "image could not be opened: %s" % exc)

    record = collector.add_file(path, "image file", extract=True)
    record["caption"] = caption
    vision_tasks = [{
        "image": record["file"],
        "locator": "image file",
        "priority": "high",
        "reason": ("standalone course image (likely a screenshot of a formula, "
                   "diagram, table or slide); read and explain its knowledge "
                   "content"),
    }]

    return {
        "format": "image",
        "metadata": info,
        "pages": [{
            "index": 1,
            "char_count": 0,
            "is_scanned": True,
            "elements": [],
            "tables": [],
            "images": [record],
        }],
        "images": collector.records,
        "formula_candidates": [],
        "vision_tasks": vision_tasks,
        "warnings": warnings,
        "needs_vision": True,
    }


# --------------------------------------------------------------------------
# entry point
# --------------------------------------------------------------------------

def parse_one(path: str, args: argparse.Namespace) -> Dict[str, Any]:
    slug = re.sub(r"[^A-Za-z0-9]+", "-",
                  os.path.splitext(os.path.basename(path))[0]).strip("-") or "doc"
    ext = os.path.splitext(path)[1].lower()
    payload: Dict[str, Any] = {
        "schema_version": SCHEMA_VERSION,
        "source_path": os.path.abspath(path),
        "source_name": os.path.basename(path),
        "slug": slug,
        "size_bytes": os.path.getsize(path) if os.path.exists(path) else 0,
        "parser": "course-notes-python-backend",
        "ok": True,
    }
    try:
        if ext == ".pdf":
            payload.update(parse_pdf(path, args.work_dir, args, slug))
        elif ext == ".pptx":
            payload.update(parse_pptx(path, args.work_dir, args, slug))
        elif ext == ".docx":
            payload.update(parse_docx(path, args.work_dir, args, slug))
        elif ext in (".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp",
                     ".tif", ".tiff"):
            payload.update(parse_image(path, args.work_dir, args, slug))
        else:
            payload["ok"] = False
            payload["handled_by_node"] = True
            payload["warnings"] = [{
                "code": "unsupported-format",
                "message": ("the python backend does not parse %s; the plugin "
                            "reads this format natively" % ext),
                "severity": "info",
            }]
    except Exception as exc:
        payload["ok"] = False
        payload.setdefault("warnings", []).append({
            "code": "parse-failed",
            "message": "%s: %s" % (type(exc).__name__, exc),
            "severity": "error",
            "traceback": traceback.format_exc()[-2000:],
        })
    return payload


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="CourseNotes parser backend")
    parser.add_argument("inputs", nargs="*", help="input files to parse")
    parser.add_argument("--work-dir", required=True,
                        help="directory for extracted images and scratch data")
    parser.add_argument("--json-out", default=None,
                        help="write the result JSON here instead of stdout")
    parser.add_argument("--extract-images", action="store_true", default=True)
    parser.add_argument("--no-extract-images", dest="extract_images",
                        action="store_false")
    parser.add_argument("--max-formulas", type=int, default=120)
    parser.add_argument("--scanned-char-threshold", type=int, default=40,
                        help="pages with fewer characters than this are "
                             "reported as scanned/image-only")
    parser.add_argument("--self-test", action="store_true",
                        help="report backend capability and exit")
    args = parser.parse_args(argv)

    if args.self_test:
        capabilities: Dict[str, Any] = {"python": sys.version.split()[0]}
        for module in ("pymupdf", "fitz", "pptx", "docx", "PIL", "lxml"):
            try:
                __import__(module)
                capabilities[module] = True
            except Exception:
                capabilities[module] = False
        emit({"json_out": args.json_out, "ok": True,
              "capabilities": capabilities})
        return 0

    safe_dir(args.work_dir)
    if not args.inputs:
        emit({"json_out": args.json_out, "ok": False, "documents": [],
              "error": "no input files given"})
        return 2
    documents = []
    for path in args.inputs:
        documents.append(parse_one(path, args))
    emit({
        "json_out": args.json_out,
        "schema_version": SCHEMA_VERSION,
        "ok": all(doc.get("ok", False) for doc in documents),
        "work_dir": os.path.abspath(args.work_dir),
        "documents": documents,
    })
    return 0


if __name__ == "__main__":
    sys.exit(main())
