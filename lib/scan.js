/**
 * Stage A — file scanning and format classification.
 *
 * Accepts files, directories or glob-ish inputs, expands directories, sorts
 * the result deterministically, and classifies every file by how it will be
 * parsed.  Nothing here reads file content, so a huge course folder costs
 * only directory metadata.
 */

import fs from 'node:fs';
import path from 'node:path';
import { extOf, naturalCompare, resolveUserPath, formatBytes, toPosix } from './util.js';

/** Extension -> parsing route. */
export const FORMAT_ROUTES = Object.freeze({
  '.pdf': { route: 'python', kind: 'pdf', label: 'PDF' },
  '.pptx': { route: 'python', kind: 'pptx', label: 'PowerPoint (OOXML)' },
  '.docx': { route: 'python', kind: 'docx', label: 'Word (OOXML)' },
  '.png': { route: 'python', kind: 'image', label: 'image' },
  '.jpg': { route: 'python', kind: 'image', label: 'image' },
  '.jpeg': { route: 'python', kind: 'image', label: 'image' },
  '.webp': { route: 'python', kind: 'image', label: 'image' },
  '.gif': { route: 'python', kind: 'image', label: 'image' },
  '.bmp': { route: 'python', kind: 'image', label: 'image' },
  '.tif': { route: 'python', kind: 'image', label: 'image' },
  '.tiff': { route: 'python', kind: 'image', label: 'image' },
  '.md': { route: 'node', kind: 'markdown', label: 'Markdown' },
  '.markdown': { route: 'node', kind: 'markdown', label: 'Markdown' },
  '.txt': { route: 'node', kind: 'text', label: 'plain text' },
  '.text': { route: 'node', kind: 'text', label: 'plain text' },
  '.rst': { route: 'node', kind: 'text', label: 'reStructuredText' },
  '.csv': { route: 'node', kind: 'text', label: 'CSV' },
  '.tex': { route: 'node', kind: 'text', label: 'LaTeX source' },
  '.json': { route: 'node', kind: 'text', label: 'JSON' },
  '.html': { route: 'node', kind: 'text', label: 'HTML (text-extracted)' },
  '.htm': { route: 'node', kind: 'text', label: 'HTML (text-extracted)' },
  '.ipynb': { route: 'node', kind: 'notebook', label: 'Jupyter notebook' },
  '.vtt': { route: 'node', kind: 'text', label: 'subtitle transcript' },
  '.srt': { route: 'node', kind: 'text', label: 'subtitle transcript' },
  '.m': { route: 'node', kind: 'text', label: 'source code' },
  '.py': { route: 'node', kind: 'text', label: 'source code' },
  '.c': { route: 'node', kind: 'text', label: 'source code' },
  '.cpp': { route: 'node', kind: 'text', label: 'source code' },
  '.h': { route: 'node', kind: 'text', label: 'source code' },
  '.java': { route: 'node', kind: 'text', label: 'source code' },
  '.js': { route: 'node', kind: 'text', label: 'source code' },
  '.ts': { route: 'node', kind: 'text', label: 'source code' },
});

/** Legacy formats DSH cannot parse directly: reported with a conversion hint. */
export const LEGACY_FORMATS = Object.freeze({
  '.ppt': 'Save as .pptx (PowerPoint), or export to PDF, then rerun.',
  '.doc': 'Save as .docx (Word), or export to PDF, then rerun.',
  '.xls': 'Save as .xlsx and convert to CSV, then rerun.',
  '.wps': 'Save as .docx or export to PDF, then rerun.',
  '.dps': 'Save as .pptx or export to PDF, then rerun.',
  '.pages': 'Export to PDF, then rerun.',
  '.key': 'Export to PDF, then rerun.',
  '.odp': 'Export to PDF or .pptx, then rerun.',
  '.odt': 'Export to PDF or .docx, then rerun.',
  '.epub': 'Convert to .md or .txt, then rerun.',
  '.xmind': 'Export to Markdown or PNG, then rerun.',
  '.mm': 'Export to Markdown, then rerun.',
  '.vsdx': 'Export to PNG or PDF, then rerun.',
});

const SKIP_DIRS = new Set([
  'node_modules', '.git', '.svn', '.hg', '__pycache__', '.idea', '.vscode',
  '.venv', 'venv', 'dist', 'build', '.cache', '$RECYCLE.BIN', 'System Volume Information',
  '.dsh-meow', '.coursenotes',
]);

const IGNORE_FILE_PATTERNS = [
  /^~\$/,
  /^\._/,
  /\.tmp$/i,
  /\.crdownload$/i,
  /\.ds_store$/i,
  /^thumbs\.db$/i,
];

function shouldIgnoreFile(name) {
  return IGNORE_FILE_PATTERNS.some((pattern) => pattern.test(name));
}

function classify(filePath) {
  const ext = extOf(filePath);
  const route = FORMAT_ROUTES[ext];
  if (route) return { supported: true, legacy: false, ...route, extension: ext };
  if (LEGACY_FORMATS[ext]) {
    return {
      supported: false,
      legacy: true,
      route: 'convert',
      kind: 'legacy',
      label: `${ext.slice(1).toUpperCase()} (legacy)`,
      extension: ext,
      conversionHint: LEGACY_FORMATS[ext],
    };
  }
  return {
    supported: false,
    legacy: false,
    route: 'unsupported',
    kind: 'unsupported',
    label: ext === '' ? 'no extension' : ext.slice(1),
    extension: ext,
  };
}

function statFile(filePath, maxFileBytes) {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) return { ok: false, reason: 'not a regular file' };
    if (stat.size === 0) return { ok: false, reason: 'file is empty (0 bytes)' };
    if (stat.size > maxFileBytes) {
      return {
        ok: false,
        reason: `file is larger than the configured limit (${formatBytes(stat.size)} > ${formatBytes(maxFileBytes)})`,
      };
    }
    return { ok: true, size: stat.size, mtimeMs: stat.mtimeMs };
  } catch (error) {
    return { ok: false, reason: `cannot stat file: ${error.message}` };
  }
}

function expandDirectory(dir, options, out) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (error) {
    out.errors.push({ path: dir, reason: `cannot read directory: ${error.message}` });
    return;
  }
  entries.sort((a, b) => naturalCompare(a.name, b.name));
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!options.recursive) continue;
      if (SKIP_DIRS.has(entry.name)) {
        out.skipped.push({ path: full, reason: 'ignored directory name' });
        continue;
      }
      expandDirectory(full, options, out);
    } else if (entry.isFile()) {
      if (shouldIgnoreFile(entry.name)) {
        out.skipped.push({ path: full, reason: 'temporary or metadata file' });
        continue;
      }
      out.files.push(full);
    }
  }
}

function orderFiles(files, order, explicitOrder) {
  const withMeta = files.map((filePath, index) => ({
    filePath,
    index,
    name: path.basename(filePath),
    size: fs.statSync(filePath).size,
    mtimeMs: fs.statSync(filePath).mtimeMs,
  }));
  if (order === 'explicit' && explicitOrder.length > 0) {
    const rank = new Map();
    explicitOrder.forEach((name, position) => rank.set(name.toLowerCase(), position));
    withMeta.sort((a, b) => {
      const ra = rank.has(a.name.toLowerCase()) ? rank.get(a.name.toLowerCase()) : Number.MAX_SAFE_INTEGER;
      const rb = rank.has(b.name.toLowerCase()) ? rank.get(b.name.toLowerCase()) : Number.MAX_SAFE_INTEGER;
      if (ra !== rb) return ra - rb;
      return naturalCompare(toPosix(a.filePath), toPosix(b.filePath));
    });
    return withMeta;
  }
  if (order === 'mtime') {
    withMeta.sort((a, b) => a.mtimeMs - b.mtimeMs || naturalCompare(a.name, b.name));
    return withMeta;
  }
  if (order === 'name') {
    withMeta.sort((a, b) => naturalCompare(a.name, b.name) || naturalCompare(a.filePath, b.filePath));
    return withMeta;
  }
  withMeta.sort((a, b) => naturalCompare(toPosix(a.filePath), toPosix(b.filePath)));
  return withMeta;
}

/**
 * Scan the requested inputs.
 *
 * @param {object} options
 * @param {string[]} options.inputPaths
 * @param {string}   options.cwd
 * @param {string}   [options.order]          natural | name | explicit | mtime
 * @param {string[]} [options.explicitOrder]
 * @param {boolean}  [options.recursive]
 * @param {number}   [options.maxFileBytes]
 * @returns {{files: object[], skipped: object[], unsupported: object[], errors: object[], scannedRoots: string[]}}
 */
export function scanInputs(options) {
  const {
    inputPaths = [],
    cwd = process.cwd(),
    order = 'natural',
    explicitOrder = [],
    recursive = true,
    maxFileBytes = 200 * 1024 * 1024,
  } = options ?? {};

  const result = { files: [], skipped: [], unsupported: [], errors: [], scannedRoots: [] };
  const collected = { files: [], skipped: [], errors: [] };

  for (const raw of inputPaths) {
    const target = resolveUserPath(raw, cwd);
    let stat;
    try {
      stat = fs.statSync(target);
    } catch (error) {
      result.errors.push({ path: target, reason: `input does not exist: ${error.message}` });
      continue;
    }
    result.scannedRoots.push(target);
    if (stat.isDirectory()) {
      expandDirectory(target, { recursive }, collected);
    } else if (stat.isFile()) {
      collected.files.push(target);
    } else {
      result.errors.push({ path: target, reason: 'input is neither a file nor a directory' });
    }
  }

  const ordered = orderFiles(
    collected.files.filter((filePath) => {
      const base = path.basename(filePath);
      if (shouldIgnoreFile(base)) {
        collected.skipped.push({ path: filePath, reason: 'temporary or metadata file' });
        return false;
      }
      return true;
    }),
    order,
    explicitOrder,
  );

  for (const meta of ordered) {
    const classification = classify(meta.filePath);
    const statCheck = statFile(meta.filePath, maxFileBytes);
    const record = {
      path: meta.filePath,
      relative: undefined,
      name: meta.name,
      extension: classification.extension,
      kind: classification.kind,
      label: classification.label,
      route: classification.route,
      supported: classification.supported,
      legacy: classification.legacy,
      conversionHint: classification.conversionHint,
      size: meta.size,
      sizeLabel: formatBytes(meta.size),
      mtimeMs: meta.mtimeMs,
      order: meta.index,
      readable: statCheck.ok,
      problem: statCheck.ok ? undefined : statCheck.reason,
    };
    if (!statCheck.ok) {
      result.skipped.push({ path: meta.filePath, reason: statCheck.reason });
      result.files.push(record);
      continue;
    }
    if (!classification.supported) {
      result.unsupported.push(record);
    }
    result.files.push(record);
  }

  result.skipped.push(...collected.skipped);
  result.errors.push(...collected.errors);

  // A stable relative path per file makes reports readable and locators short.
  // When the input *is* the file, the relative path is empty — falling back to
  // the file name keeps reports from showing a blank entry.
  const roots = result.scannedRoots.slice().sort((a, b) => b.length - a.length);
  const relativeOf = (record) => {
    const root = roots.find((candidate) => record.path.startsWith(candidate));
    const relative = root ? path.relative(root, record.path) : '';
    return relative === '' ? record.name : toPosix(relative);
  };
  for (const record of result.files) record.relative = relativeOf(record);
  for (const record of result.unsupported) record.relative = relativeOf(record);

  return result;
}

export function parseableFiles(scan) {
  return scan.files.filter((record) => record.supported && record.readable);
}

export function pythonFiles(scan) {
  return parseableFiles(scan).filter((record) => record.route === 'python');
}

export function nodeFiles(scan) {
  return parseableFiles(scan).filter((record) => record.route === 'node');
}

export function describeScan(scan) {
  const lines = [];
  lines.push(`输入位置 ${scan.scannedRoots.length} 个 / input roots: ${scan.scannedRoots.length}`);
  for (const record of scan.files) {
    const status = !record.readable
      ? `SKIP (${record.problem})`
      : record.supported
        ? 'OK'
        : record.legacy
          ? 'LEGACY'
          : 'UNSUPPORTED';
    lines.push(`  [${status}] ${record.relative} — ${record.label}, ${record.sizeLabel}`);
  }
  for (const error of scan.errors) {
    lines.push(`  [ERROR] ${error.path}: ${error.reason}`);
  }
  return lines.join('\n');
}
