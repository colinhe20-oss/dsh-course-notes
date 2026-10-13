/**
 * Workspace I/O abstraction — the *only* place in this plugin that writes files.
 *
 * Two backends implement the same small interface:
 *
 *   * `createHarnessWorkspace(ctx)` — the Harness `ctx.fs` seam.  Every write is
 *     subject to the session's sandbox policy, appears in the workspace-change
 *     record, and can be denied with a structured `FS_SANDBOX_DENIED`.
 *   * `createNodeWorkspace()` — plain `node:fs`, used by the offline CLI and by
 *     tests, where no sandbox exists and the process already owns the disk.
 *
 * ## The rule this file exists to enforce
 *
 * **A Harness-mode plugin never falls back to `node:fs` for output.**  Earlier
 * versions copied binaries with `node:fs` and re-ran a denied write into a
 * second workspace backed by `node:fs`; both silently converted a sandbox
 * refusal into a successful native write, which is exactly the bypass the
 * Harness permission model is supposed to prevent.  `writeBytes` and `copyFile`
 * now go through `ctx.fs` like every other write, and a denial is *reported*:
 * the caller either stops or retries into a directory that the same sandbox
 * policy accepts.
 *
 * ## `ctx.fs` facts this module depends on
 *
 *   * `resolve(path, { cwd })` is the only way to obtain an `FsTarget`.
 *   * `writeText(target, content)` creates parent directories itself
 *     (`writeFileAtomic` → `mkdir(dir, {recursive:true})`), so there is no
 *     separate "make directory" primitive to call.
 *   * `readBytes(target, signal, maxBytes)` is the raw-byte read; it needs an
 *     explicit cap and fails with `FS_TOO_LARGE` rather than truncating.
 *   * `writeText`/`editText` are the *only* mutations and they are text-only by
 *     contract; there is no binary-append or "raw copy" primitive, so creating
 *     a file from bytes means writing the bytes as a `latin1` string.
 *
 * The by-contract text-only limitation is why {@link bytesToBinaryString} and
 * {@link binaryStringToBytes} exist: a 1:1 byte↔code-unit mapping means the
 * string round-trips through any UTF-8 text seam without corruption.  It is
 * lossless, but it is not free — the whole file is materialised in memory — so
 * {@link MAX_HARNESS_BINARY_BYTES} reports an explicit refusal instead of
 * exhausting the process on a 200 MB PDF page render.
 */

import fs from 'node:fs';
import path from 'node:path';
import { toPosix } from './util.js';

/**
 * Largest asset this plugin will push through the text-only `ctx.fs` seam.
 *
 * Extracted figures are slide images and scanned pages, so 64 MiB is far above
 * any legitimate asset while still bounding the doubled in-memory cost
 * (bytes + the latin1 string) of one write.
 */
export const MAX_HARNESS_BINARY_BYTES = 64 * 1024 * 1024;

/** Cap used when reading an asset back for verification (never the whole file). */
const VERIFY_READ_BYTES = 4096;

function failure(filePath, error, fallbackCode) {
  const code = error?.code ?? fallbackCode;
  // `FsError` carries the sandbox vocabulary (`FS_SANDBOX_DENIED`, `FS_NOT_TEXT`,
  // …); plain `Error` values from `ctx.fs.resolve` keep their own code or fall
  // back to the operation name so callers can still branch on something stable.
  return {
    ok: false,
    path: filePath,
    code: typeof code === 'string' && code !== '' ? code : fallbackCode,
    message: String(error?.message ?? error),
    denied: code === 'FS_SANDBOX_DENIED' || code === 'EACCES' || code === 'EPERM' || code === 'EROFS',
  };
}

/**
 * Map bytes to a string whose UTF-8 encoding reproduces them exactly.
 *
 * `latin1` maps code unit *n* to byte *n*, so a Buffer survives a round trip
 * through a text-only write/read seam byte for byte.  Callers must pass the
 * result to a seam that preserves the code units unchanged (UTF-8 does).
 */
export function bytesToBinaryString(bytes) {
  return Buffer.from(bytes).toString('latin1');
}

/** Inverse of {@link bytesToBinaryString}. */
export function binaryStringToBytes(text) {
  return Buffer.from(String(text), 'latin1');
}

/* ------------------------------------------------------------------ node fs */

/** Offline/CLI workspace: real files, no sandbox, no seam. */
export function createNodeWorkspace() {
  return {
    kind: 'node',
    sandboxed: false,
    supportsBinary: true,
    async ensureDir(dir) {
      try {
        fs.mkdirSync(dir, { recursive: true });
        return { ok: true, path: dir };
      } catch (error) {
        return failure(dir, error, 'MKDIR_FAILED');
      }
    },
    async writeText(filePath, content) {
      try {
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, content, 'utf8');
        return { ok: true, path: filePath };
      } catch (error) {
        return failure(filePath, error, 'WRITE_FAILED');
      }
    },
    async writeBytes(filePath, bytes) {
      try {
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, bytes);
        return { ok: true, path: filePath };
      } catch (error) {
        return failure(filePath, error, 'WRITE_FAILED');
      }
    },
    async copyFile(from, to) {
      try {
        fs.mkdirSync(path.dirname(to), { recursive: true });
        fs.copyFileSync(from, to);
        return { ok: true, path: to };
      } catch (error) {
        return failure(to, error, 'COPY_FAILED');
      }
    },
    async readBytes(filePath, maxBytes = VERIFY_READ_BYTES) {
      const handle = fs.openSync(filePath, 'r');
      try {
        const buffer = Buffer.alloc(maxBytes);
        const read = fs.readSync(handle, buffer, 0, maxBytes, 0);
        return buffer.subarray(0, read);
      } finally {
        fs.closeSync(handle);
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
    async size(filePath) {
      try {
        return fs.statSync(filePath).size;
      } catch {
        return null;
      }
    },
  };
}

/* -------------------------------------------------------------- harness fs */

/**
 * Harness-backed workspace over `ctx.fs`.
 *
 * `ctx.fs.resolve` is the only way to obtain an `FsTarget`; targets are cached
 * because resolution is a filesystem round trip.  Nothing in here reaches for
 * `node:fs`: if the seam refuses, the refusal is returned.
 */
export function createHarnessWorkspace(ctx, options = {}) {
  const seam = ctx?.fs ?? ctx;
  if (!seam || typeof seam.writeText !== 'function' || typeof seam.resolve !== 'function') {
    throw new Error('createHarnessWorkspace requires a ctx.fs seam with resolve() and writeText()');
  }
  const cwd = options.cwd ?? process.cwd();
  const maxBinaryBytes = options.maxBinaryBytes ?? MAX_HARNESS_BINARY_BYTES;
  const targets = new Map();
  const resolve = async (filePath) => {
    const key = path.normalize(filePath);
    if (!targets.has(key)) {
      targets.set(key, await seam.resolve(filePath, { cwd }));
    }
    return targets.get(key);
  };
  const drop = (filePath) => targets.delete(path.normalize(filePath));

  const harnessWorkspace = {
    kind: 'harness',
    sandboxed: true,
    supportsBinary: true,
    /** The seam exposes no mkdir primitive; the first write creates the tree. */
    async ensureDir(dir) {
      return { ok: true, path: dir, deferred: true };
    },
    async writeText(filePath, content) {
      try {
        const target = await resolve(filePath);
        const outcome = await seam.writeText(target, content);
        drop(filePath);
        return { ok: true, path: filePath, version: outcome?.version };
      } catch (error) {
        drop(filePath);
        return failure(filePath, error, 'FS_ERROR');
      }
    },
    /**
     * Binary write through the text-only seam.
     *
     * `ctx.fs` has no binary mutation by contract, so the bytes travel as a
     * 1:1 `latin1` string (see {@link bytesToBinaryString}).  Oversized assets
     * are refused with `FS_TOO_LARGE_LOCAL` instead of being truncated, because
     * a silently truncated figure is worse than a reported one.
     */
    async writeBytes(filePath, bytes) {
      const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
      if (buffer.byteLength > maxBinaryBytes) {
        return {
          ok: false,
          path: filePath,
          code: 'FS_TOO_LARGE_LOCAL',
          denied: false,
          message:
            `asset is ${buffer.byteLength} bytes, above the ${maxBinaryBytes}-byte limit for a ` +
            'text-seam write; raise the maxHarnessAssetBytes config option or run the CLI',
        };
      }
      return harnessWorkspace.writeText(filePath, bytesToBinaryString(buffer));
    },
    /**
     * Copy one file to another through the seam.
     *
     * There is no `copy` primitive and no raw-file handle, so the source is read
     * as bytes and re-written — the destination write is what the sandbox
     * checks, which is the point.
     */
    async copyFile(from, to) {
      try {
        const stat = await this.stat(from);
        if (stat !== null && stat.size > maxBinaryBytes) {
          return {
            ok: false,
            path: to,
            code: 'FS_TOO_LARGE_LOCAL',
            denied: false,
            message: `asset ${path.basename(from)} is ${stat.size} bytes, above the ${maxBinaryBytes}-byte copy limit`,
          };
        }
        let bytes;
        try {
          // Preferred: the bounded raw-byte read.  Not every provider
          // implements it — `readBytes` is optional on a text-oriented backend.
          bytes = await this.readBytes(from, maxBinaryBytes);
        } catch (error) {
          if (error?.code !== 'FS_IO_ERROR' && error?.code !== 'FS_NOT_SUPPORTED') throw error;
          // Fallback: read as text and reverse the 1:1 byte mapping, which is
          // exactly how `writeBytes` wrote it.
          const text = await this.readText(from);
          bytes = binaryStringToBytes(text);
        }
        return await harnessWorkspace.writeBytes(to, bytes);
      } catch (error) {
        return failure(to, error, 'COPY_FAILED');
      }
    },
    async readBytes(filePath, maxBytes = VERIFY_READ_BYTES) {
      const target = await resolve(filePath);
      return seam.readBytes(target, undefined, Math.max(1, maxBytes));
    },
    async readText(filePath) {
      const target = await resolve(filePath);
      return seam.readText(target);
    },
    async exists(filePath) {
      try {
        const stat = await this.stat(filePath);
        return stat !== null;
      } catch {
        return false;
      }
    },
    async stat(filePath) {
      const target = await resolve(filePath);
      const info = await seam.stat(target);
      return info ?? null;
    },
    async size(filePath) {
      const info = await this.stat(filePath);
      return info?.size ?? null;
    },
  };
  return harnessWorkspace;
}

/**
 * Name of the permission-proof marker {@link probeWritable} writes.
 *
 * Exported so callers can name it in a report instead of leaving an unexplained
 * file in the output directory.
 */
export const WRITE_PROBE_FILE = '.coursenotes-writable';

/**
 * True when the filesystem seam may mutate `dir` under the current session
 * policy.  Used to choose a *permitted* fallback directory without ever
 * attempting a write the sandbox would refuse.
 *
 * `ctx.fs` exposes no "can I write here" query, so this is a dry run of the exact
 * primitive the real write uses.  The seam has no delete primitive, so the probe
 * leaves a one-byte marker named {@link WRITE_PROBE_FILE} — obvious, stable, and
 * overwritten by the next probe rather than accumulating.
 */
export async function probeWritable(workspace, dir) {
  const probe = path.join(dir, WRITE_PROBE_FILE);
  const outcome = await workspace.writeText(probe, '\n');
  return { ...outcome, path: probe };
}

/* -------------------------------------------------------------------- assets */

/**
 * Copy the extracted `assets/` tree next to the notes so relative image links
 * resolve in Obsidian / VS Code.
 *
 * Every copy goes through `workspace.copyFile`, so in Harness mode the sandbox
 * decides; a denial is collected as a failure instead of being retried with
 * native I/O.
 *
 * @returns {{copied: number, failures: object[], dir: string|null, skipped: boolean}}
 */
export async function publishAssets(workspace, workDir, outputDir, logger = null) {
  const sourceDir = path.join(workDir, 'assets');
  const result = { copied: 0, failures: [], dir: null, skipped: false };
  /*
   * Presence is decided by actually listing the directory, not by `stat`.
   * A filesystem seam is free to answer "no metadata" for a directory it cannot
   * describe (the sandbox's own `stat` is file-oriented), and treating that as
   * "no assets" would silently drop every figure from the notes.  An ENOENT from
   * `readdir` is the real, unambiguous "there are none".
   */
  let entries;
  try {
    entries = fs.readdirSync(sourceDir, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return result;
    result.failures.push({ file: sourceDir, code: error?.code ?? 'READ_FAILED', message: String(error?.message ?? error) });
    return result;
  }
  const targetDir = path.join(outputDir, 'assets');
  result.dir = targetDir;
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const from = path.join(sourceDir, entry.name);
    const to = path.join(targetDir, entry.name);
    const outcome = await workspace.copyFile(from, to);
    if (outcome.ok) result.copied += 1;
    else result.failures.push({ file: entry.name, code: outcome.code, message: outcome.message });
  }
  logger?.debug('assets published', { copied: result.copied, failures: result.failures.length });
  return result;
}

/** Resolve the asset path that note files should reference. */
export function relativeAssetPath(assetFile) {
  if (!assetFile) return '';
  return toPosix(assetFile);
}
