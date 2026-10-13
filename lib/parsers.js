/**
 * Node-native text parsers: Markdown, plain text, HTML, CSV and Jupyter
 * notebooks.  Binary formats (PDF/PPTX/DOCX/images) go through the Python
 * backend instead — see `python-bridge.js`.
 *
 * Every parser returns the same shape: `{ elements, images, warnings, metadata }`.
 * `elements` is an ordered list of the document's structure, so nothing is
 * lost even when a later stage only cares about text.
 */

import fs from 'node:fs';
import path from 'node:path';
import { normalizeWhitespace, truncate } from './util.js';

function element(kind, fields) {
  return { kind, ...fields };
}

function textElement(text, locator, extra = {}) {
  const value = normalizeWhitespace(text);
  if (value === '') return null;
  return element('text', { text: value, locator, ...extra });
}

/* ------------------------------------------------------------------ markdown */

const FENCE_RE = /^\s*(```+|~~~+)\s*([\w+#.-]*)\s*$/;
const ATX_RE = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const SETEXT_RE = /^\s*(=+|-{2,})\s*$/;
const TABLE_SEP_RE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/;
const IMAGE_RE = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
const LINK_RE = /\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
const LIST_RE = /^\s*(?:[-*+]|\d+[.)])\s+/;
const QUOTE_RE = /^\s*>\s?/;

function splitTableRow(line) {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());
}

function stripInlineMarkdown(text) {
  return text
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/~~(.+?)~~/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .trim();
}

export function parseMarkdownFile(filePath) {
  return parseMarkdownText(fs.readFileSync(filePath, 'utf8'));
}

export function parseMarkdownText(rawInput) {
  const raw = String(rawInput ?? '').replace(/\r\n?/g, '\n');
  const lines = raw.split('\n');
  const elements = [];
  const images = [];
  const warnings = [];
  const headings = [];

  let inFence = false;
  let fenceMarker = '';
  let codeBuffer = [];
  let codeLanguage = '';
  let codeStart = 0;
  let paragraph = [];
  let paragraphStart = 0;

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    const item = textElement(paragraph.join(' '), `line ${paragraphStart}`);
    if (item) elements.push(item);
    paragraph = [];
  };

  const flushCode = () => {
    if (codeBuffer.length === 0) return;
    elements.push(
      element('code', {
        text: codeBuffer.join('\n'),
        locator: `line ${codeStart}`,
        language: codeLanguage,
      }),
    );
    codeBuffer = [];
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const lineNumber = index + 1;

    const fenceMatch = line.match(FENCE_RE);
    if (fenceMatch) {
      if (!inFence) {
        flushParagraph();
        inFence = true;
        fenceMarker = fenceMatch[1][0];
        codeLanguage = fenceMatch[2] ?? '';
        codeStart = lineNumber;
      } else if (fenceMatch[1][0] === fenceMarker) {
        inFence = false;
        flushCode();
      } else {
        codeBuffer.push(line);
      }
      continue;
    }
    if (inFence) {
      codeBuffer.push(line);
      continue;
    }

    const atx = line.match(ATX_RE);
    if (atx) {
      flushParagraph();
      const text = stripInlineMarkdown(atx[2]);
      const level = atx[1].length;
      elements.push(element('heading', { text, locator: `line ${lineNumber}`, level }));
      headings.push({ text, level, line: lineNumber });
      continue;
    }

    if (
      line.trim() !== '' &&
      index + 1 < lines.length &&
      SETEXT_RE.test(lines[index + 1]) &&
      !LIST_RE.test(line)
    ) {
      flushParagraph();
      const text = stripInlineMarkdown(line.trim());
      const level = lines[index + 1].trim().startsWith('=') ? 1 : 2;
      elements.push(element('heading', { text, locator: `line ${lineNumber}`, level }));
      headings.push({ text, level, line: lineNumber });
      index += 1;
      continue;
    }

    if (line.includes('|') && index + 1 < lines.length && TABLE_SEP_RE.test(lines[index + 1])) {
      flushParagraph();
      const header = splitTableRow(line);
      const rows = [header];
      let cursor = index + 2;
      while (cursor < lines.length && lines[cursor].includes('|') && lines[cursor].trim() !== '') {
        rows.push(splitTableRow(lines[cursor]));
        cursor += 1;
      }
      elements.push(
        element('table', { rows, locator: `line ${lineNumber}`, headerRows: 1 }),
      );
      index = cursor - 1;
      continue;
    }

    const imageMatches = [...line.matchAll(IMAGE_RE)];
    if (imageMatches.length > 0) {
      flushParagraph();
      for (const match of imageMatches) {
        images.push({
          file: null,
          externalPath: match[2],
          caption: match[1] ?? '',
          locator: `line ${lineNumber}`,
          kind: 'image',
        });
      }
      const remainder = line.replace(IMAGE_RE, '').trim();
      const item = textElement(remainder, `line ${lineNumber}`);
      if (item) elements.push(item);
      continue;
    }

    if (QUOTE_RE.test(line)) {
      flushParagraph();
      const item = textElement(stripInlineMarkdown(line.replace(QUOTE_RE, '')), `line ${lineNumber}`, {
        quote: true,
      });
      if (item) elements.push(item);
      continue;
    }

    if (LIST_RE.test(line)) {
      flushParagraph();
      const indent = line.match(/^\s*/)[0].length;
      const text = stripInlineMarkdown(line.replace(LIST_RE, ''));
      const item = textElement(text, `line ${lineNumber}`, {
        listItem: true,
        listIndent: indent,
      });
      if (item) elements.push(item);
      continue;
    }

    if (line.trim() === '') {
      flushParagraph();
      continue;
    }

    if (paragraph.length === 0) paragraphStart = lineNumber;
    paragraph.push(stripInlineMarkdown(line.trim()));
    void LINK_RE;
    void truncate;
  }

  flushParagraph();
  if (inFence) {
    flushCode();
    warnings.push({
      code: 'unterminated-code-fence',
      message: 'a fenced code block was not closed before the end of the file',
      severity: 'warning',
    });
  }

  return {
    format: 'markdown',
    elements,
    images,
    warnings,
    metadata: { headings, lineCount: lines.length },
    text: raw,
  };
}

/* ----------------------------------------------------------------- plain text */

const TIMESTAMP_RE =
  /^\s*(?:\[?(\d{1,2}:\d{2}(?::\d{2})?)\]?|(\d{4}-\d{2}-\d{2}))\s*[-–—]?\s*/;

export function parseTextFile(filePath, { kind = 'text' } = {}) {
  const raw = fs.readFileSync(filePath, 'utf8').replace(/\r\n?/g, '\n');
  const lines = raw.split('\n');
  const elements = [];
  const warnings = [];

  const numbered = /^\s*(?:第\s*[0-9一二三四五六七八九十百]+\s*[章节讲部分]|[0-9]+(?:\.[0-9]+){0,3}[.、)]?\s+\S|Chapter\s+\d+|Lecture\s+\d+|Part\s+\d+)/i;
  const chapterOnly = /^\s*(?:第\s*[0-9一二三四五六七八九十百]+\s*[章节讲]|Chapter\s+\d+|Lecture\s+\d+|Part\s+\d+)\s*[：:、.]?\s*(.*)$/i;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const lineNumber = index + 1;
    const trimmed = line.trim();
    if (trimmed === '') continue;

    const chapterMatch = trimmed.match(chapterOnly);
    if (chapterMatch) {
      elements.push(
        element('heading', { text: trimmed, locator: `line ${lineNumber}`, level: 1 }),
      );
      continue;
    }

    const isShort = trimmed.length <= 40;
    const looksLikeHeading =
      isShort &&
      numbered.test(trimmed) &&
      !/[。；;]$/.test(trimmed) &&
      !TIMESTAMP_RE.test(trimmed);
    if (looksLikeHeading) {
      const level = /[0-9]+\.[0-9]+/.test(trimmed) ? 2 : 1;
      elements.push(element('heading', { text: trimmed, locator: `line ${lineNumber}`, level }));
      continue;
    }

    const item = textElement(trimmed, `line ${lineNumber}`);
    if (item) elements.push(item);
  }

  if (elements.length === 0) {
    warnings.push({
      code: 'empty-text-document',
      message: 'no non-empty lines were found in this text file',
      severity: 'warning',
    });
  }

  void kind;
  return {
    format: kind === 'notebook' ? 'notebook' : 'text',
    elements,
    images: [],
    warnings,
    metadata: { lineCount: lines.length },
    text: raw,
  };
}

/* ----------------------------------------------------------------- HTML */

export function htmlToText(html) {
  const withoutScripts = String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');
  const withBreaks = withoutScripts
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6]|section|article)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '- ');
  const entities = {
    '&nbsp;': ' ',
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#39;': "'",
    '&mdash;': '—',
    '&ndash;': '–',
    '&hellip;': '…',
  };
  return withBreaks
    .replace(/&[a-z#0-9]+;/gi, (match) => entities[match.toLowerCase()] ?? ' ')
    .replace(/<[^>]+>/g, ' ')
    .split('\n')
    .map((line) => normalizeWhitespace(line))
    .filter((line) => line !== '')
    .join('\n');
}

export function parseHtmlFile(filePath) {
  const html = fs.readFileSync(filePath, 'utf8');
  const text = htmlToText(html);
  const elements = [];
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (titleMatch) {
    elements.push(
      element('heading', {
        text: normalizeWhitespace(titleMatch[1]),
        locator: 'document title',
        level: 1,
      }),
    );
  }
  text.split('\n').forEach((line, index) => {
    const item = textElement(line, `text line ${index + 1}`);
    if (item) elements.push(item);
  });
  return {
    format: 'html',
    elements,
    images: [],
    warnings: [
      {
        code: 'html-text-extraction',
        message:
          'HTML was reduced to text; layout and interactive content of the page are not preserved',
        severity: 'info',
      },
    ],
    metadata: {},
    text,
  };
}

/* ----------------------------------------------------------------- CSV */

export function parseCsvFile(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8').replace(/\r\n?/g, '\n');
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let index = 0; index < raw.length; index += 1) {
    const ch = raw[index];
    if (inQuotes) {
      if (ch === '"') {
        if (raw[index + 1] === '"') {
          field += '"';
          index += 1;
        } else inQuotes = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ',') {
      row.push(field.trim());
      field = '';
      continue;
    }
    if (ch === '\n') {
      row.push(field.trim());
      if (row.some((cell) => cell !== '')) rows.push(row);
      row = [];
      field = '';
      continue;
    }
    field += ch;
  }
  row.push(field.trim());
  if (row.some((cell) => cell !== '')) rows.push(row);

  const elements = [];
  if (rows.length > 0) {
    elements.push(element('table', { rows, locator: 'row 1', headerRows: 1 }));
  }
  return {
    format: 'csv',
    elements,
    images: [],
    warnings: [],
    metadata: { rowCount: rows.length },
    text: raw,
  };
}

/* ----------------------------------------------------------------- notebook */

export function parseNotebookFile(filePath) {
  const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const elements = [];
  const warnings = [];
  const cells = Array.isArray(data.cells) ? data.cells : [];
  cells.forEach((cell, index) => {
    const locator = `cell ${index + 1}`;
    const source = Array.isArray(cell.source) ? cell.source.join('') : String(cell.source ?? '');
    if (cell.cell_type === 'markdown') {
      // Parsed in memory: the plugin never writes into the source folder.
      try {
        const parsed = parseMarkdownText(source);
        for (const item of parsed.elements) {
          elements.push({ ...item, locator: `${locator}, ${item.locator}` });
        }
      } catch (error) {
        warnings.push({
          code: 'notebook-markdown-failed',
          message: `markdown cell ${index + 1} could not be parsed as Markdown: ${error.message}`,
          severity: 'warning',
        });
        const item = textElement(source, locator);
        if (item) elements.push(item);
      }
      return;
    }
    if (cell.cell_type === 'code') {
      elements.push(
        element('code', {
          text: source,
          locator,
          language: 'python',
          outputs: (cell.outputs ?? [])
            .map((output) => {
              if (output.text) return Array.isArray(output.text) ? output.text.join('') : String(output.text);
              if (output.data?.['text/plain']) {
                const plain = output.data['text/plain'];
                return Array.isArray(plain) ? plain.join('') : String(plain);
              }
              return '';
            })
            .filter((value) => value !== '')
            .join('\n'),
        }),
      );
      return;
    }
    if (cell.cell_type === 'raw') {
      const item = textElement(source, locator);
      if (item) elements.push(item);
    }
  });
  if (cells.length === 0) {
    warnings.push({
      code: 'empty-notebook',
      message: 'the notebook contains no cells',
      severity: 'warning',
    });
  }
  return {
    format: 'notebook',
    elements,
    images: [],
    warnings,
    metadata: {
      cellCount: cells.length,
      kernelspec: data.metadata?.kernelspec?.name ?? '',
      language: data.metadata?.language_info?.name ?? '',
    },
    text: '',
  };
}

/** Dispatch a Node-native parse by file kind. */
export function parseNodeFile(record) {
  switch (record.kind) {
    case 'markdown':
      return parseMarkdownFile(record.path);
    case 'notebook':
      return parseNotebookFile(record.path);
    case 'text': {
      const ext = path.extname(record.path).toLowerCase();
      if (ext === '.html' || ext === '.htm') return parseHtmlFile(record.path);
      if (ext === '.csv') return parseCsvFile(record.path);
      if (ext === '.tex') return parseLatexFile(record.path);
      if (ext === '.srt' || ext === '.vtt') return parseTranscriptFile(record.path, ext);
      return parseTextFile(record.path, { kind: 'text' });
    }
    default:
      return parseTextFile(record.path, { kind: record.kind });
  }
}

/* ----------------------------------------------------------------- LaTeX */

export function parseLatexFile(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8').replace(/\r\n?/g, '\n');
  const elements = [];
  const lines = raw.split('\n');
  let buffer = [];
  let bufferStart = 1;
  const flush = () => {
    if (buffer.length === 0) return;
    const item = textElement(buffer.join(' '), `line ${bufferStart}`);
    if (item) elements.push(item);
    buffer = [];
  };
  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    const heading = line.match(/\\(part|chapter|section|subsection|subsubsection)\*?\{([^}]*)\}/);
    if (heading) {
      flush();
      const levelMap = { part: 1, chapter: 1, section: 2, subsection: 3, subsubsection: 4 };
      elements.push(
        element('heading', {
          text: normalizeWhitespace(heading[2]),
          locator: `line ${lineNumber}`,
          level: levelMap[heading[1]] ?? 3,
        }),
      );
      return;
    }
    if (/^\s*%/.test(line)) return;
    if (line.trim() === '') {
      flush();
      return;
    }
    if (buffer.length === 0) bufferStart = lineNumber;
    buffer.push(line.trim());
  });
  flush();
  return {
    format: 'latex',
    elements,
    images: [],
    warnings: [
      {
        code: 'latex-source',
        message:
          'LaTeX source was read as text; macros are not expanded and math is kept verbatim',
        severity: 'info',
      },
    ],
    metadata: {},
    text: raw,
  };
}

/* ----------------------------------------------------------------- subtitles */

function parseTranscriptFile(filePath, ext) {
  const raw = fs.readFileSync(filePath, 'utf8').replace(/\r\n?/g, '\n');
  const elements = [];
  const blocks = raw.split(/\n{2,}/);
  blocks.forEach((block, index) => {
    const lines = block
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '');
    if (ext === '.vtt') {
      const cues = lines.filter((line) => !/^WEBVTT/.test(line) && !/-->/.test(line) && !/^\d+$/.test(line));
      const item = textElement(cues.join(' '), `cue ${index + 1}`);
      if (item) elements.push(item);
      return;
    }
    const cues = lines.filter((line) => !/-->/.test(line) && !/^\d+$/.test(line));
    const item = textElement(cues.join(' '), `cue ${index + 1}`);
    if (item) elements.push(item);
  });
  return {
    format: 'transcript',
    elements,
    images: [],
    warnings: [],
    metadata: { cueCount: blocks.length },
    text: raw,
  };
}
