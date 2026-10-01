import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const python = await readFile(new URL('../../aidream/artifacts/contracts.py', import.meta.url), 'utf8');
const typescript = await readFile(new URL('../src/app/core/artifact.types.ts', import.meta.url), 'utf8');

function pythonLiteral(name) {
  const match = python.match(new RegExp(`${name}: TypeAlias = Literal\\[([\\s\\S]*?)\\]`))
    || python.match(new RegExp(`${name} = Literal\\[([\\s\\S]*?)\\]`));
  assert.ok(match, `Python contract should declare ${name}`);
  return [...match[1].matchAll(/"([^"]+)"/g)].map(item => item[1]).sort();
}

function typescriptUnion(name) {
  const match = typescript.match(new RegExp(`export type ${name} =([\\s\\S]*?);`));
  assert.ok(match, `TypeScript contract should declare ${name}`);
  return [...match[1].matchAll(/'([^']+)'/g)].map(item => item[1]).sort();
}

for (const name of ['ArtifactKind', 'ArtifactLifetime', 'ArtifactStorageType', 'ArtifactOwnerType']) {
  assert.deepEqual(typescriptUnion(name), pythonLiteral(name), `${name} must match across Python and TypeScript`);
}

const pythonEnvelope = python.match(/class ArtifactEnvelope\(TypedDict\):([\s\S]*?)\n(?=def validate_artifact_envelope)/)?.[1];
const typescriptEnvelope = typescript.match(/export interface ArtifactEnvelope \{([\s\S]*?)\n\}/)?.[1];
assert.ok(pythonEnvelope, 'Python should declare the typed ArtifactEnvelope');
assert.ok(typescriptEnvelope, 'TypeScript should declare the ArtifactEnvelope mirror');
const pythonFields = [...pythonEnvelope.matchAll(/^\s{4}([a-z_]+):/gm)].map(item => item[1]).sort();
const typescriptFields = [...typescriptEnvelope.matchAll(/^\s{2}([a-z_]+)\??:/gm)].map(item => item[1]).sort();
assert.deepEqual(typescriptFields, pythonFields, 'required envelope fields must match across languages');
assert.match(typescriptEnvelope, /schema_version: 1;/, 'the TypeScript mirror must remain v1-only');
assert.match(python, /value\["schema_version"\] != 1/, 'Python must fail closed on future envelope versions');
assert.match(python, /unsupported fields/, 'unknown v1 top-level fields must not be silently discarded');
assert.match(typescript, /metadata: Record<string, ArtifactJsonValue>/,
  'bounded metadata is the designated forward-compatible JSON extension bag');

console.log('Python/TypeScript artifact schema contract checks passed.');
