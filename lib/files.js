/**
 * Workspace I/O abstraction.
 *
 * Two backends implement the same tiny interface:
 *
 *   * `createNodeWorkspace()` — plain `node:fs`, used by the offline CLI and by
 *     tests.  Always available.
 *   * `createHarnessWorkspace(ctx)` — the Harness `ctx.fs` seam, so a plugin
 *     write is subject to the session's sandbox policy and appears in the
 *     workspace-change record.  `ctx.fs.writeText` creates parent directories.
 *
 * Both return `{ ok, path?, code?, message? }` from `writeText` instead of
 * throwing, because a denied write must be *reported*, never swallowed: the
 * whole point of this plugin is that failures are visible.
 */

import fs from 'node:fs';
import path from 'node:path';
import { toPosix } from './util.js';

export function createNodeWorkspace() {
  return {
    kind: 'node',
    async ensureDir(dir) {
      fs.mkdirSync(dir, { recursive: true });
      return { ok: true, path: dir };
    },
    async writeText(filePath, content) {
      try {
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, content, 'utf8');
        return { ok: true, path: filePath };
      } catch (error) {
        return {
          ok: false,
          path: filePath,
          code: error.code ?? 'WRITE_FAILED',
          message: error.message,
        };
      }
    },
    async writeBytes(filePath, bytes) {
      try {
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, bytes);
        return { ok: true, path: filePath };
      } catch (error) {
        return { ok: false, path: filePath, code: error.code ?? 'WRITE_FAILED', message: error.message };
      }
    },
    async copyFile(from, to) {
      try {
        fs.mkdirSync(path.dirname(to), { recursive: true });
        fs.copyFileSync(from, to);
        return { ok: true, path: to };
      } catch (error) {
        return { ok: false, path: to, code: error.code ?? 'COPY_FAILED', message: error.message };
      }
    },
    async readText(filePath) {
      return fs.readFileSync(filePath, 'utf8');
    },
    async exists(filePath) {
      try {
        fs.accessSync(filePath);
        return true;
      } catch {
        return false;
      }
    },
  };
}

/**
 * Harness-backed workspace over `ctx.fs`.
 *
 * `ctx.fs.resolve` is the only way to obtain an `FsTarget`; targets are cached
 * because resolution is a filesystem round trip.
 */
export function createHarnessWorkspace(ctx) {
  const targets = new Map();
  const resolve = async (filePath) => {
    const key = path.normalize(filePath);
    if (!targets.has(key)) {
      targets.set(key, await ctx.fs.resolve(filePath, { cwd: process.cwd() }));
    }
    return targets.get(key);
  };
  return {
    kind: 'harness',
    async ensureDir(dir) {
      // The fs seam has no mkdir primitive, and `writeText` creates parent
      // directories itself (`writeFileAtomic` → `mkdir(dir, {recursive:true})`).
      // So there is nothing to do here; the first real write materialises the
      // directory.  Reporting it as satisfied keeps call sites uniform.
      return { ok: true, path: dir, deferred: true };
    },
    async writeText(filePath, content) {
      try {
        const target = await resolve(filePath);
        await ctx.fs.writeText(target, content);
        return { ok: true, path: filePath };
      } catch (error) {
        return {
          ok: false,
          path: filePath,
          code: error.code ?? 'FS_ERROR',
          message: error.message,
        };
      }
    },
    async writeBytes(filePath, bytes) {
      // The seam writes text; binary assets are copied with Node after the
      // directory exists, because extracted images are produced by Python.
      try {
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, bytes);
        return { ok: true, path: filePath };
      } catch (error) {
        return { ok: false, path: filePath, code: error.code ?? 'FS_ERROR', message: error.message };
      }
    },
    async copyFile(from, to) {
      try {
        fs.mkdirSync(path.dirname(to), { recursive: true });
        fs.copyFileSync(from, to);
        return { ok: true, path: to };
      } catch (error) {
        return { ok: false, path: to, code: error.code ?? 'COPY_FAILED', message: error.message };
      }
    },
    async readText(filePath) {
      const target = await resolve(filePath);
      return ctx.fs.readText(target);
    },
    async exists(filePath) {
      const target = await resolve(filePath);
      const stat = await ctx.fs.stat(target);
      return stat !== undefined;
    },
  };
}

/**
 * Copy the extracted `assets/` tree next to the notes so relative image links
 * resolve in Obsidian / VS Code.
 *
 * @returns {{copied: number, failures: object[], dir: string|null}}
 */
export async function publishAssets(workspace, workDir, outputDir, logger = null) {
  const sourceDir = path.join(workDir, 'assets');
  const result = { copied: 0, failures: [], dir: null };
  if (!fs.existsSync(sourceDir)) return result;
  const targetDir = path.join(outputDir, 'assets');
  result.dir = targetDir;
  let entries;
  try {
    entries = fs.readdirSync(sourceDir);
  } catch (error) {
    result.failures.push({ file: sourceDir, code: 'READ_FAILED', message: error.message });
    return result;
  }
  for (const name of entries) {
    const from = path.join(sourceDir, name);
    const to = path.join(targetDir, name);
    const outcome = await workspace.copyFile(from, to);
    if (outcome.ok) result.copied += 1;
    else result.failures.push({ file: name, code: outcome.code, message: outcome.message });
  }
  logger?.debug('assets published', { copied: result.copied, failures: result.failures.length });
  return result;
}

/** Resolve the asset path that note files should reference. */
export function relativeAssetPath(assetFile) {
  if (!assetFile) return '';
  return toPosix(assetFile);
}
