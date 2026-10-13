// Verify interpreter discovery works when the Host process does NOT provide
// DSH_* environment variables.  That is the real situation: the Harness injects
// DSH_* into shell tool calls, not into its own environment, so a plugin that
// only looked at `process.env.DSH_HOME` would never find the bundled Python.
//
// Run: node tests/discovery.test.mjs

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_DIR = path.resolve(HERE, '..');

const env = { ...process.env };
for (const key of Object.keys(env)) {
  if (key.startsWith('DSH_') || key === 'COURSE_NOTES_PYTHON') delete env[key];
}

// Prefer the profile symlink, which is what the Host's Loader resolves.
const profileEntry = path.join(
  process.env.USERPROFILE ?? '',
  '.dsh',
  'profiles',
  'desktop',
  'node_modules',
  'course-notes',
  'index.js',
);
const entry = fs.existsSync(profileEntry) ? profileEntry : path.join(PLUGIN_DIR, 'index.js');
const bridgePath = path.join(PLUGIN_DIR, 'lib', 'python-bridge.js');

const asUrl = (file) => `file:///${file.replace(/\\/g, '/')}`;

const lines = [
  `const mod = await import(${JSON.stringify(asUrl(entry))});`,
  `const bridge = await import(${JSON.stringify(asUrl(bridgePath))});`,
  'const report = bridge.pythonDiscoveryReport();',
  `console.log('entry loaded from: ${entry.replace(/\\/g, '/')}');`,
  "console.log('BUILD marker:', mod.BUILD ?? '(absent - stale module generation)');",
  "console.log('DSH_HOME env:', report.dshHomeEnv === null ? '(not set) - matches the Host process' : report.dshHomeEnv);",
  "console.log('runtime roots that exist:');",
  "for (const root of report.searchedRoots.filter((r) => r.exists)) console.log('   ', root.root);",
  "console.log('bundled interpreters found:', report.bundledInterpreters.length);",
  "for (const found of report.bundledInterpreters) console.log('   ', found);",
  "const resolved = bridge.resolvePython('');",
  "console.log('RESOLVED:', resolved.ok ? resolved.command + ' (Python ' + resolved.version + ')' : 'FAILED: ' + resolved.reason);",
  "if (!resolved.ok) for (const a of resolved.attempts) console.log('   tried', a.command, '->', a.reason);",
  'process.exit(resolved.ok ? 0 : 1);',
];

const result = spawnSync(process.execPath, ['--input-type=module', '-e', lines.join('\n')], {
  cwd: PLUGIN_DIR,
  env,
  encoding: 'utf8',
});

process.stdout.write(result.stdout ?? '');
if (result.stderr) process.stderr.write(result.stderr);
process.exit(result.status ?? 1);
