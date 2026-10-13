/**
 * Bridge to the Python document-parsing backend.
 *
 * The backend is a self-contained script (`lib/parse/course_notes_parser.py`)
 * that turns PDF / PPTX / DOCX / image files into structured JSON.  This
 * module is responsible for:
 *
 *   1. finding a Python interpreter that can actually import the libraries the
 *      backend needs (PyMuPDF, python-pptx, python-docx, Pillow),
 *   2. running the backend with an explicit argv (never a shell string),
 *   3. reading back the JSON report it writes, and
 *   4. translating any failure into a structured, non-fatal result so one bad
 *      file can never take the whole run down.
 *
 * ## Why nothing here captures a child's piped output
 *
 * Inside DeepSeek Harness a plugin runs under the session sandbox, and the
 * confined sandbox forbids creating the pipes a captured child would need:
 * `spawnSync(cmd, args, { encoding: 'utf8' })` fails with `EPERM` before the
 * child ever starts.  A probe that captures stdout therefore reported *every*
 * interpreter as unusable 鈥?including the perfectly good bundled one 鈥?and the
 * whole PDF/PPTX/DOCX route silently degraded to "backend unavailable".
 *
 * The fix is structural, not a retry: children are started with
 * `stdio: ['ignore', fd, fd]` where `fd` are real files opened by this process
 * (an *inherited descriptor*, not a pipe), and the results are read back from
 * those files.  This works identically under the sandbox and outside it, so
 * there is no "works in the CLI, fails in Harness" divergence left.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

export const BACKEND_SCRIPT = path.join(HERE, 'parse', 'course_notes_parser.py');

/** Modules the backend imports; all of them must be importable. */
const REQUIRED_MODULES = ['pymupdf', 'pptx', 'docx', 'PIL'];

let cachedInterpreter = null;
let scratchCounter = 0;

/** Relative locations of the bundled interpreter below a runtime directory. */
const RUNTIME_SUBDIRS = [
  path.join('dependencies', 'python'),
  path.join('dependencies', 'python', 'bin'),
];

/* --------------------------------------------------------- sandbox-safe exec */

/**
 * Run a child process with its stdout/stderr redirected to real files.
 *
 * @param {string} command
 * @param {string[]} argv
 * @param {{ timeoutMs?: number, env?: object }} [options]
 * @returns {{ status: number|null, stdout: string, stderr: string, error: Error|null, elapsedMs: number }}
 */
export function runCaptured(command, argv, options = {}) {
  const { timeoutMs = 25_000, env = process.env } = options;
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'course-notes-exec-'));
  const outFile = path.join(scratch, 'stdout.txt');
  const errFile = path.join(scratch, 'stderr.txt');
  let outFd = null;
  let errFd = null;
  const started = Date.now();
  try {
    outFd = fs.openSync(outFile, 'w');
    errFd = fs.openSync(errFile, 'w');
    const result = spawnSync(command, argv, {
      stdio: ['ignore', outFd, errFd],
      timeout: timeoutMs,
      windowsHide: true,
      env: {
        ...env,
        PYTHONIOENCODING: 'utf-8',
        PYTHONDONTWRITEBYTECODE: '1',
        PYTHONUTF8: '1',
      },
    });
    const read = (file) => {
      try {
        return fs.readFileSync(file, 'utf8');
      } catch {
        return '';
      }
    };
    return {
      status: result.status,
      stdout: read(outFile),
      stderr: read(errFile),
      error: result.error ?? null,
      elapsedMs: Date.now() - started,
    };
  } finally {
    if (outFd !== null) {
      try {
        fs.closeSync(outFd);
      } catch {
        /* already closed */
      }
    }
    if (errFd !== null) {
      try {
        fs.closeSync(errFd);
      } catch {
        /* already closed */
      }
    }
    try {
      fs.rmSync(scratch, { recursive: true, force: true });
    } catch {
      /* scratch cleanup is best effort */
    }
  }
}

/** Last non-empty line of captured stdout (the backend logs freely before it). */
function lastLine(text) {
  const lines = String(text ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '');
  return lines.length > 0 ? lines[lines.length - 1] : '';
}

/** A unique scratch file path for a probe result. */
function scratchPath(suffix) {
  scratchCounter += 1;
  return path.join(os.tmpdir(), `course-notes-${process.pid}-${Date.now()}-${scratchCounter}.${suffix}`);
}

/* ------------------------------------------------------------- discovery */

/**
 * Directories that may themselves contain runtime folders with a Python.
 *
 * `process.env.DSH_HOME` is *not* reliably present in the Host process: the
 * Harness injects `DSH_*` variables into shell tool calls, not into its own
 * environment.  Discovery therefore also derives candidates from the
 * filesystem, and every candidate is validated by probing rather than assumed.
 */
function runtimeRoots() {
  const roots = new Set();
  const add = (value) => {
    if (typeof value === 'string' && value.trim() !== '') {
      roots.add(path.resolve(value.trim()));
    }
  };

  add(process.env.DSH_RUNTIME_DIR);
  for (const home of [process.env.DSH_HOME, safeHome()]) {
    if (typeof home === 'string' && home.trim() !== '') {
      const base = path.resolve(home.trim());
      add(path.join(base, 'dsh-runtimes'));
      // `DSH_RUNTIME_DIR` is sometimes `<home>/dsh-runtimes` already.
      if (path.basename(base) === 'dsh-runtimes') add(base);
    }
  }

  // `.../plugins/course-notes` 鈫?the DSH home or install directory is usually a
  // few levels up from the plugin package.
  let dir = HERE;
  for (let depth = 0; depth < 7; depth += 1) {
    const parent = path.dirname(dir);
    if (parent === dir) break;
    add(path.join(parent, 'dsh-runtimes'));
    add(path.join(parent, '.dsh', 'dsh-runtimes'));
    add(path.join(parent, 'storages', 'dsh-runtimes'));
    dir = parent;
  }
  return roots;
}

function safeHome() {
  try {
    return os.homedir();
  } catch {
    return null;
  }
}

/** Interpreters found under every `<root>/<runtime>/dependencies/python`. */
function bundledInterpreters() {
  const found = [];
  const names = process.platform === 'win32' ? ['python.exe'] : ['python3', 'python'];
  for (const root of runtimeRoots()) {
    let entries;
    try {
      entries = fs.readdirSync(root, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      for (const sub of RUNTIME_SUBDIRS) {
        for (const name of names) {
          const candidate = path.join(root, entry.name, sub, name);
          if (fs.existsSync(candidate) && !found.includes(candidate)) found.push(candidate);
        }
      }
    }
  }
  return found;
}

function candidateInterpreters(explicit) {
  const out = [];
  const push = (value) => {
    if (typeof value === 'string' && value.trim() !== '' && !out.includes(value)) {
      out.push(value.trim());
    }
  };
  // 1. Whatever the user or the environment stated explicitly.
  push(explicit);
  push(process.env.COURSE_NOTES_PYTHON);
  push(process.env.DSH_PYTHON);
  push(process.env.PYTHON);
  // 2. The interpreters DSH itself ships: these already contain every library
  //    the backend needs, so they are tried before anything on PATH (a system
  //    Python without the libraries must not win the probe).
  for (const bundled of bundledInterpreters()) push(bundled);
  // 3. Whatever this machine has on PATH.
  if (process.platform === 'win32') {
    // `py` resolves to the newest installed CPython; a bare `python` on Windows
    // is frequently python2 (Anaconda 2.7 is common), which cannot run the
    // backend at all.
    push('py');
  }
  push('python3');
  push('python');
  return out;
}

/**
 * Probe one interpreter for the required libraries.
 *
 * The answer is written to a file by the child and read back here, because a
 * captured stdout pipe is unavailable under the DSH sandbox (see the module
 * header).  Version metadata is produced by the child rather than parsed from
 * platform-specific stdout.
 */
function probeInterpreter(command, timeoutMs = 25_000) {
  const scriptFile = scratchPath('py');
  const resultFile = `${scriptFile}.json`;
  const script = [
    'import json, sys',
    `mods = ${JSON.stringify(REQUIRED_MODULES)}`,
    'missing = []',
    'for m in mods:',
    '    try:',
    '        __import__(m)',
    '    except Exception:',
    '        missing.append(m)',
    'payload = {"version": sys.version.split()[0], "missing": missing}',
    `open(sys.argv[1], "w", encoding="utf-8").write(json.dumps(payload))`,
  ].join('\n');
  try {
    fs.writeFileSync(scriptFile, script, 'utf8');
    const run = runCaptured(command, [scriptFile, resultFile], { timeoutMs });
    if (run.error) {
      return { command, ok: false, reason: `${run.error.code ?? 'SPAWN_FAILED'}: ${run.error.message}` };
    }
    if (!fs.existsSync(resultFile)) {
      return {
        command,
        ok: false,
        reason:
          run.status === null
            ? 'probe timed out'
            : `exit ${run.status}${lastLine(run.stderr) ? `: ${lastLine(run.stderr).slice(0, 200)}` : ''}`,
      };
    }
    const parsed = JSON.parse(fs.readFileSync(resultFile, 'utf8'));
    const missing = Array.isArray(parsed.missing) ? parsed.missing : [];
    return {
      command,
      ok: missing.length === 0,
      version: parsed.version,
      missing,
      reason: missing.length > 0 ? `missing modules: ${missing.join(', ')}` : undefined,
    };
  } catch (error) {
    return { command, ok: false, reason: `probe failed: ${error.message}` };
  } finally {
    for (const file of [scriptFile, resultFile]) {
      try {
        fs.rmSync(file, { force: true });
      } catch {
        /* best effort */
      }
    }
  }
}

/**
 * Resolve a usable Python interpreter.
 * @returns {{ok: boolean, command?: string, version?: string, attempts: object[], reason?: string}}
 */
export function resolvePython(explicit) {
  if (cachedInterpreter && (!explicit || cachedInterpreter.command === explicit)) {
    return cachedInterpreter;
  }
  const attempts = [];
  for (const command of candidateInterpreters(explicit)) {
    const probe = probeInterpreter(command);
    attempts.push(probe);
    if (probe.ok) {
      const resolved = { ok: true, command: probe.command, version: probe.version, attempts };
      if (!explicit) cachedInterpreter = resolved;
      return resolved;
    }
  }
  return {
    ok: false,
    attempts,
    reason:
      'no Python interpreter with the required libraries (pymupdf, python-pptx, ' +
      'python-docx, Pillow) was found; set the `pythonPath` config option',
  };
}

export function resetPythonCache() {
  cachedInterpreter = null;
}

/** Diagnostic view of the discovery inputs, used by `probe_course_notes`. */
export function pythonDiscoveryReport() {
  const roots = [...runtimeRoots()];
  const bundled = bundledInterpreters();
  const rootsWithState = roots.map((root) => {
    let exists = false;
    try {
      exists = fs.statSync(root).isDirectory();
    } catch {
      exists = false;
    }
    return { root, exists };
  });
  return {
    dshHomeEnv: process.env.DSH_HOME ?? null,
    runtimeDirEnv: process.env.DSH_RUNTIME_DIR ?? null,
    homeDir: safeHome(),
    searchedRoots: rootsWithState,
    bundledInterpreters: bundled,
    pathCandidates: candidateInterpreters('').filter((entry) => !bundled.includes(entry)),
  };
}

export function pythonCapabilities(pythonCommand, timeoutMs = 25_000) {
  const result = runCaptured(pythonCommand, ['-c', 'import sys;print(sys.version.split()[0])'], {
    timeoutMs,
  });
  return {
    command: pythonCommand,
    ok: !result.error && result.status === 0,
    version: lastLine(result.stdout),
    error: result.error ? `${result.error.code ?? 'SPAWN_FAILED'}: ${result.error.message}` : undefined,
  };
}

/* ------------------------------------------------------------- backend run */

/** Compare a parsed report against each input file to spot silently lost files. */
function reconcileReports(files, documents, stderrText) {
  const bySource = new Map();
  for (const doc of documents) {
    bySource.set(path.normalize(doc.source_path), doc);
  }
  const missing = [];
  for (const file of files) {
    if (!bySource.has(path.normalize(file))) {
      missing.push({
        source_path: file,
        ok: false,
        format: path.extname(file).replace('.', '').toLowerCase(),
        warnings: [
          {
            code: 'no-parser-report',
            message:
              'the parsing backend produced no report for this file; it was ' +
              'not parsed' + (stderrText ? ` (backend stderr: ${stderrText.slice(0, 300)})` : ''),
            severity: 'error',
          },
        ],
        images: [],
        vision_tasks: [],
        formula_candidates: [],
        units: [],
      });
    }
  }
  return missing;
}

/**
 * Run the backend over a batch of files.
 *
 * @param {object} options
 * @param {string[]} options.files       absolute paths to parse
 * @param {string}   options.workDir     directory for extracted assets
 * @param {string}   [options.pythonPath]
 * @param {string}   [options.parserScript]
 * @param {boolean}  [options.extractImages]
 * @param {number}   [options.timeoutMs]
 * @param {object}   [options.logger]
 * @returns {{ok: boolean, runtime: object, documents: object[], error?: string}}
 */
export function runParserBackend(options) {
  const {
    files,
    workDir,
    pythonPath = '',
    parserScript = '',
    extractImages = true,
    timeoutMs = 15 * 60 * 1000,
    logger = null,
    scannedCharThreshold = 40,
    maxFormulas = 200,
  } = options ?? {};

  if (!Array.isArray(files) || files.length === 0) {
    return {
      ok: false,
      documents: [],
      runtime: { available: false },
      error: 'no files to parse',
    };
  }

  const script = parserScript !== '' ? parserScript : BACKEND_SCRIPT;
  if (!fs.existsSync(script)) {
    return {
      ok: false,
      documents: [],
      runtime: { available: false, script },
      error: `parser backend not found at ${script}`,
    };
  }

  const python = resolvePython(pythonPath);
  if (!python.ok) {
    return {
      ok: false,
      documents: [],
      runtime: { available: false, attempts: python.attempts },
      error: python.reason,
    };
  }

  fs.mkdirSync(workDir, { recursive: true });
  const reportFile = path.join(workDir, `parse-report-${Date.now()}.json`);
  const argv = [
    script,
    ...files,
    '--work-dir',
    workDir,
    '--json-out',
    reportFile,
    extractImages ? '--extract-images' : '--no-extract-images',
    '--scanned-char-threshold',
    String(scannedCharThreshold),
    '--max-formulas',
    String(maxFormulas),
  ];

  logger?.debug('running parser backend', { command: python.command, files: files.length });
  const run = runCaptured(python.command, argv, { timeoutMs });
  const stderrText = run.stderr.trim();

  let report = null;
  if (fs.existsSync(reportFile)) {
    try {
      report = JSON.parse(fs.readFileSync(reportFile, 'utf8'));
    } catch (error) {
      logger?.warn('parser report could not be read', { error: error.message });
    }
  }

  const runtime = {
    available: true,
    interpreter: python.command,
    pythonVersion: python.version,
    script,
    elapsedMs: run.elapsedMs,
    exitCode: run.status,
    timedOut: run.error?.code === 'ETIMEDOUT',
  };

  if (!report) {
    return {
      ok: false,
      documents: [],
      runtime,
      error:
        (run.error ? `${run.error.code ?? 'SPAWN_FAILED'}: ${run.error.message}` : null) ??
        `parser backend exited with ${run.status} and wrote no report: ${stderrText.slice(0, 500)}`,
    };
  }

  const documents = Array.isArray(report.documents) ? report.documents : [];
  const recovered = reconcileReports(files, documents, stderrText);
  if (recovered.length > 0) documents.push(...recovered);

  try {
    fs.rmSync(reportFile, { force: true });
  } catch {
    /* scratch file cleanup is best effort */
  }

  return { ok: true, documents, runtime, stderr: stderrText };
}

export function defaultWorkDir(baseDir, runId) {
  return path.join(baseDir, '.coursenotes', runId ?? `run-${Date.now()}`);
}

export function tempDirFor(prefix = 'course-notes-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}
