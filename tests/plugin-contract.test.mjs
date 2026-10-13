// Simulate the Cordis Loader contract for the CourseNotes plugin without a
// live Host: check the export shape, register every tool against a fake tools
// registry, assert the schemas are valid, and exercise the probe tool.
//
// This is the cheapest check that catches the mistakes that actually break
// installation: wrong export form, an invalid `output.schema`, a render that
// returns something other than ContentBlock[], or a tool that throws on a
// trivial call.

import assert from 'node:assert/strict';

const registered = new Map();
const effects = [];
const published = new Map();

const fakeCtx = {
  logger: {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
  },
  tools: {
    register(definition) {
      assert.equal(typeof definition.name, 'string', 'tool name must be a string');
      assert.ok(/^[A-Za-z0-9_-]{1,64}$/.test(definition.name), `tool name must match the wire contract: ${definition.name}`);
      assert.notEqual(definition.name, 'run_code', 'run_code is reserved');
      assert.ok(definition.output && typeof definition.output.render === 'function', `${definition.name}: output.render is required`);
      assert.equal(typeof definition.execute, 'function', `${definition.name}: execute is required`);
      assert.equal(typeof definition.description, 'string', `${definition.name}: description is required`);
      assert.equal(definition.parameters?.type, 'object', `${definition.name}: parameters must be an object schema`);
      assertJsonSchemaSubset(definition.output.schema, `${definition.name}.output.schema`);
      if (registered.has(definition.name)) throw new Error(`tool "${definition.name}" is already registered`);
      registered.set(definition.name, definition);
      return () => registered.delete(definition.name);
    },
  },
  effect(callback, label) {
    const dispose = callback();
    effects.push({ dispose, label });
    return () => {};
  },
  // Cordis refuses `ctx.set(name, value)` unless the plugin declares
  // `provide: [name]`.  The plugin must not publish services at all: a service
  // nobody consumes is activation risk without benefit.
  set(key, value) {
    void value;
    assert.fail(`the plugin must not call ctx.set("${key}") — publish nothing, register only tools`);
  },
  get: (key) => {
    void key;
    return undefined;
  },
};

/**
 * The registry enforces a narrow JSON Schema subset; anything else fails at
 * registration time with UNSUPPORTED_SCHEMA.  Mirror the documented subset.
 */
function assertJsonSchemaSubset(node, where) {
  if (node === undefined || node === null) return;
  const allowed = new Set([
    'type', 'oneOf', 'properties', 'required', 'additionalProperties', 'items',
    'enum', 'const', 'description', 'title', 'default', 'examples',
  ]);
  const types = new Set(['object', 'array', 'string', 'number', 'integer', 'boolean', 'null']);
  for (const key of Object.keys(node)) {
    assert.ok(allowed.has(key), `${where}: unsupported schema keyword "${key}"`);
  }
  if (node.type !== undefined) {
    assert.ok(types.has(node.type), `${where}: unsupported type "${node.type}"`);
  }
  if (node.type === 'object' && node.properties !== undefined) {
    assert.equal(typeof node.properties, 'object', `${where}: properties must be an object`);
    for (const [key, child] of Object.entries(node.properties)) {
      assertJsonSchemaSubset(child, `${where}.properties.${key}`);
    }
  }
  if (node.type === 'array' && node.items !== undefined) {
    assertJsonSchemaSubset(node.items, `${where}.items`);
  }
  if (node.oneOf !== undefined) {
    assert.ok(Array.isArray(node.oneOf) && node.oneOf.length >= 2, `${where}: oneOf needs at least two branches`);
    node.oneOf.forEach((branch, index) => assertJsonSchemaSubset(branch, `${where}.oneOf[${index}]`));
  }
}

const mod = await import('../index.js');
const { jsonSafe } = mod;

assert.equal(typeof mod.apply, 'function', 'the plugin must export `apply(ctx, config)`');
assert.deepEqual(mod.inject, ['tools'], 'the plugin declares its tools dependency');
assert.equal(mod.name, 'course-notes');

mod.apply(fakeCtx, {});

const expected = [
  'generate_course_notes',
  'check_notes_coverage',
  'probe_course_notes',
  'read_course_notes_report',
];
for (const toolName of expected) {
  assert.ok(registered.has(toolName), `tool not registered: ${toolName}`);
}
assert.equal(registered.size, expected.length, `unexpected extra tools: ${[...registered.keys()].join(', ')}`);

// render() must produce ContentBlock[]-compatible values, never empty strings.
for (const [toolName, definition] of registered) {
  const sample = { ok: true, summary: 'x', brief: 'y', report: 'z', content: 'w', artifacts: { outputDir: 'd', workDir: 'w', noteFiles: [] } };
  const rendered = definition.output.render({}, sample);
  assert.ok(Array.isArray(rendered), `${toolName}: render must return an array`);
  for (const block of rendered) {
    assert.equal(block.type, 'text', `${toolName}: only text blocks survive to the model`);
    assert.ok(typeof block.text === 'string' && block.text.length > 0, `${toolName}: empty text blocks are dropped`);
  }
}

// Argument validation must reject bad input with an actionable message.
await assert.rejects(
  () => registered.get('generate_course_notes').execute({}, { signal: new AbortController().signal }),
  /input_paths/,
  'generate_course_notes must reject a missing input_paths',
);
await assert.rejects(
  () => registered.get('generate_course_notes').execute({ input_paths: [] }, { signal: new AbortController().signal }),
  /input_paths/,
);
await assert.rejects(
  () => registered.get('generate_course_notes').execute(
    { input_paths: ['x'], stages: ['nonsense'] },
    { signal: new AbortController().signal },
  ),
  /unknown stage/,
  'an unknown stage must be rejected with the supported list',
);
await assert.rejects(
  () => registered.get('read_course_notes_report').execute({ output_dir: 'C:\\definitely\\not\\here' }),
  /artifact not found/,
);

// The probe tool must work without a live Host and report honestly.
const probe = await registered.get('probe_course_notes').execute({}, { signal: new AbortController().signal });
assert.equal(probe.ok, true, `probe should succeed; report:\n${probe.report}`);
assert.match(probe.report, /Python 解析后端/);
assert.match(probe.report, /Harness 服务/);
assert.match(probe.report, /web: ❌|web: ✅/);

// Regression: an `undefined` member makes the registry reject an otherwise
// successful call with `value is not lossless JSON`.  Every tool body must be
// lossless JSON, and `jsonSafe` enforces it at the boundary.
assertJsonSafe(probe, 'probe_course_notes result');
const unsafe = jsonSafe({ a: 1, b: undefined, c: { d: undefined, e: 'keep' } });
assert.deepEqual(unsafe, { a: 1, c: { e: 'keep' } }, 'jsonSafe must drop undefined members only');
assert.deepEqual(JSON.parse(JSON.stringify(unsafe)), unsafe, 'jsonSafe output survives a JSON round trip');

// Every tool must produce a renderable, JSON-clean body shape.
for (const [toolName, definition] of registered) {
  const sample = {
    ok: true,
    summary: 's',
    brief: 'b',
    report: 'r',
    content: 'c',
    path: undefined,
    reportPath: undefined,
    artifacts: { outputDir: 'o', workDir: 'w', noteFiles: [] },
  };
  const rendered = definition.output.render({}, jsonSafe(sample));
  assert.ok(Array.isArray(rendered), `${toolName}: render must return an array`);
  assertJsonSafe(rendered, `${toolName} render output`);
}

// Plugin unload must remove every tool.
for (const effect of effects) {
  if (typeof effect.dispose === 'function') effect.dispose();
}
assert.equal(registered.size, 0, 'disposing the plugin effects must unregister every tool');

/** Deep check that a value is lossless JSON with no `undefined` members. */
function assertJsonSafe(value, label) {
  const seen = new Set();
  const walk = (node, where) => {
    if (node === undefined) throw new Error(`${where} is undefined — the registry rejects this`);
    if (node === null) return;
    const type = typeof node;
    if (type === 'string' || type === 'number' || type === 'boolean') return;
    if (type !== 'object') throw new Error(`${where} is a ${type}, which is not JSON`);
    if (seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) {
      node.forEach((item, index) => walk(item, `${where}[${index}]`));
      return;
    }
    for (const [key, item] of Object.entries(node)) walk(item, `${where}.${key}`);
  };
  walk(value, label);
  assert.deepEqual(JSON.parse(JSON.stringify(value)), value, `${label} is not lossless JSON`);
}

console.log('OK  plugin contract: exports, 4 tool schemas, render shape, arg validation, probe, lossless-JSON, unload');
