#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Render a PDF into per-page text and page images for note authoring.

CourseNotes' automatic knowledge-point chunking fits prose documents; a
formula-heavy slide deck fragments into meaningless micro-points.  For that
material the notes are authored by reading the pages directly, and this script
produces the two inputs that makes practical:

  * ``--text``  a per-page text dump with light column handling, so the whole
    deck can be read in a few file reads instead of one per page;
  * ``--images`` full-page PNG renders, so equations and figures that exist only
    as glyphs can actually be seen.

Usage:
  python tests/export_pdf_pages.py <input.pdf> --out <dir> [--dpi 130] [--pages 1-62]
"""

from __future__ import annotations

import argparse
import os
import re
import sys


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('pdf')
    parser.add_argument('--out', required=True)
    parser.add_argument('--dpi', type=int, default=130)
    parser.add_argument('--pages', default='')
    parser.add_argument('--text', action='store_true', default=True)
    parser.add_argument('--images', action='store_true', default=True)
    parser.add_argument('--no-images', dest='images', action='store_false')
    args = parser.parse_args()

    try:
        import pymupdf
    except Exception:  # pragma: no cover
        import fitz as pymupdf  # type: ignore

    os.makedirs(args.out, exist_ok=True)
    image_dir = os.path.join(args.out, 'pages')
    os.makedirs(image_dir, exist_ok=True)

    doc = pymupdf.open(args.pdf)
    total = doc.page_count

    wanted = set()
    if args.pages:
        for chunk in args.pages.split(','):
            chunk = chunk.strip()
            if '-' in chunk:
                a, b = chunk.split('-', 1)
                wanted.update(range(int(a), int(b) + 1))
            elif chunk:
                wanted.add(int(chunk))
    else:
        wanted = set(range(1, total + 1))

    lines = []
    lines.append(f'# {os.path.basename(args.pdf)}')
    lines.append(f'pages: {total}   rendered: {len(wanted)}   dpi: {args.dpi}')
    lines.append('')

    for index in range(total):
        page_no = index + 1
        if page_no not in wanted:
            continue
        page = doc[index]
        text = page.get_text('text') or ''
        cleaned = [re.sub(r'[ \t]+', ' ', line).rstrip() for line in text.split('\n')]
        cleaned = [line for line in cleaned if line.strip() != '']

        lines.append(f'===== PAGE {page_no} =====')
        if not cleaned:
            lines.append('(no extractable text — image-only page)')
        lines.extend(cleaned)
        lines.append('')

        if args.images:
            pix = page.get_pixmap(matrix=pymupdf.Matrix(args.dpi / 72, args.dpi / 72))
            target = os.path.join(image_dir, f'page-{page_no:03d}.png')
            pix.save(target)
            pix = None

    text_path = os.path.join(args.out, 'pages.txt')
    with open(text_path, 'w', encoding='utf-8') as handle:
        handle.write('\n'.join(lines))

    print(f'wrote {text_path} ({os.path.getsize(text_path)} bytes)')
    if args.images:
        print(f'rendered {len(wanted)} pages into {image_dir}')
    doc.close()
    return 0


if __name__ == '__main__':
    sys.exit(main())
