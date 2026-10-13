/**
 * Small shared helpers for the CourseNotes plugin: logging, paths, hashing,
 * text normalisation and the untrusted-input guards.
 *
 * Everything here is dependency-free plain ESM so the plugin can be loaded by
 * the Harness Loader without a build step.
 */

import crypto from 'node:crypto';
import path from 'node:path';

export const LOG_LEVELS = ['silent', 'error', 'warn', 'info', 'debug'];

/**
 * Minimal structured logger.  The Host plugin passes a `sink` (usually
 * `(...args) => ctx.logger?.info(...)`); the offline CLI keeps `null`.
 */
export function createLogger(level = 'info', sink = null, scope = 'course-notes') {
  const threshold = LOG_LEVELS.indexOf(LOG_LEVELS.includes(level) ? level : 'info');
  const lines = [];
  const emit = (name, args) => {
    const index = LOG_LEVELS.indexOf(name);
    if (threshold < 0 || index > threshold) return;
    const line = `[${scope}] ${name}: ${args
      .map((arg) => (typeof arg === 'string' ? arg : safeJson(arg)))
      .join(' ')}`;
    lines.push(line);
    if (sink) {
      try {
        sink(line);
      } catch {
        /* logging must never break the pipeline */
      }
    }
  };
  return {
    lines,
    error: (...args) => emit('error', args),
    warn: (...args) => emit('warn', args),
    info: (...args) => emit('info', args),
    debug: (...args) => emit('debug', args),
  };
}

export function safeJson(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function sha1(text) {
  return crypto.createHash('sha1').update(text).digest('hex');
}

export function shortHash(text, length = 8) {
  return sha1(text).slice(0, length);
}

/** Make a filesystem-safe ASCII slug; CJK characters are transliterated away. */
export function slugify(value, fallback = 'doc') {
  const base = String(value ?? '')
    .normalize('NFKD')
    .replace(/[^\w\s-]+/g, ' ')
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return base === '' ? fallback : base.slice(0, 80);
}

/**
 * Keep CJK characters in a slug derived from a title.  Used for chapter file
 * names, where a readable Chinese name is better than an empty slug.
 */
export function slugifyKeepCjk(value, fallback = 'chapter') {
  const base = String(value ?? '')
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[\s.]+$/g, '');
  return base === '' ? fallback : base.slice(0, 60);
}

export function naturalCompare(a, b) {
  return String(a).localeCompare(String(b), undefined, {
    numeric: true,
    sensitivity: 'base',
  });
}

export function isCjk(ch) {
  const code = ch.codePointAt(0);
  return (
    (code >= 0x2e80 && code <= 0x2eff) ||
    (code >= 0x3000 && code <= 0x303f) ||
    (code >= 0x3040 && code <= 0x30ff) ||
    (code >= 0x3400 && code <= 0x4dbf) ||
    (code >= 0x4e00 && code <= 0x9fff) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xff00 && code <= 0xffef)
  );
}

export function hasCjk(text) {
  for (const ch of String(text ?? '')) if (isCjk(ch)) return true;
  return false;
}

export function hasLatin(text) {
  return /[A-Za-z]/.test(String(text ?? ''));
}

/** Detect the dominant script of a string for language ratios and glossary. */
export function dominantScript(text) {
  let cjk = 0;
  let latin = 0;
  for (const ch of String(text ?? '')) {
    if (isCjk(ch)) cjk += 1;
    else if (/[A-Za-z]/.test(ch)) latin += 1;
  }
  if (cjk === 0 && latin === 0) return 'unknown';
  if (cjk >= Math.max(4, latin * 0.6)) return 'cjk';
  if (latin >= Math.max(4, cjk * 0.6)) return 'latin';
  return 'mixed';
}

export function normalizeWhitespace(text) {
  return String(text ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u00a0\u2000-\u200b\u3000]/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function truncate(text, max) {
  const value = String(text ?? '');
  if (value.length <= max) return value;
  return `${value.slice(0, max)}\n…[truncated ${value.length - max} characters]`;
}

/** Strip instruction-looking content before it reaches a model prompt. */
export function neutralizeUntrustedText(text) {
  return String(text ?? '')
    .replace(/\u0000/g, '')
    .replace(/^\s*(system|assistant|developer)\s*:/gim, '$1\u200b:')
    .replace(/<\|(im_start|im_end|endoftext|system|user|assistant)\|>/gi, '[redacted-token]');
}

export function toPosix(p) {
  return String(p).replace(/\\/g, '/');
}

export function isWindowsAbsolute(p) {
  return /^[A-Za-z]:[\\/]/.test(String(p)) || String(p).startsWith('\\\\');
}

export function resolveUserPath(input, cwd) {
  const value = String(input ?? '').trim();
  if (value === '') return cwd;
  if (path.isAbsolute(value)) return path.normalize(value);
  return path.resolve(cwd, value);
}

export function extOf(filePath) {
  return path.extname(String(filePath)).toLowerCase();
}

/** Human-readable byte size for reports. */
export function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`;
  return `${(value / (1024 * 1024)).toFixed(2)} MiB`;
}

export function uniqueBy(items, keyFn) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    const key = keyFn(item);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

export function chunk(array, size) {
  const out = [];
  for (let i = 0; i < array.length; i += size) out.push(array.slice(i, i + size));
  return out;
}

/** Split a long text into <=maxChars pieces on paragraph boundaries. */
export function splitLongText(text, maxChars) {
  const value = String(text ?? '');
  if (value.length <= maxChars) return [value];
  const parts = [];
  let current = '';
  for (const paragraph of value.split(/\n{2,}/)) {
    if (current.length + paragraph.length + 2 > maxChars && current !== '') {
      parts.push(current);
      current = '';
    }
    if (paragraph.length > maxChars) {
      for (let i = 0; i < paragraph.length; i += maxChars) {
        parts.push(paragraph.slice(i, i + maxChars));
      }
      continue;
    }
    current = current === '' ? paragraph : `${current}\n\n${paragraph}`;
  }
  if (current !== '') parts.push(current);
  return parts;
}
