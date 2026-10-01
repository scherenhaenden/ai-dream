import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const source = await readFile(new URL('../src/app/core/canvas-renderers.ts', import.meta.url), 'utf8');
const javascript = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const renderer = await import(`data:text/javascript;base64,${Buffer.from(javascript).toString('base64')}`);

const markdown = renderer.renderSafeMarkdown([
  '# Heading',
  '',
  '- first **bold**',
  '- second `inline`',
  '',
  '1. one',
  '2. two',
  '',
  '```ts',
  '<script>alert(1)</script>',
  '```',
  '',
  '[safe](https://example.test/path?a=1&b=2)',
  '[unsafe](javascript:alert(1))',
  '',
  '| name | count |',
  '| --- | ---: |',
  '| alpha | 3 |',
].join('\n'));
assert.match(markdown, /<h1>Heading<\/h1>/);
assert.match(markdown, /<ul>[\s\S]*<li>first <strong>bold<\/strong><\/li>/);
assert.match(markdown, /<ol>[\s\S]*<li>one<\/li>/);
assert.match(markdown, /<pre><code>&lt;script&gt;alert\(1\)&lt;\/script&gt;<\/code><\/pre>/);
assert.match(markdown, /<a href="https:\/\/example\.test\/path\?a=1&amp;b=2"/);
assert.doesNotMatch(markdown, /href="javascript:/i);
assert.match(markdown, /<table>[\s\S]*<td>alpha<\/td>[\s\S]*<td>3<\/td>/);
assert.doesNotMatch(renderer.renderSafeMarkdown('<img src=x onerror=alert(1)>'), /<img/);

const table = renderer.parseJsonTableData('[{"name":"alpha","score":2},{"name":"beta","score":5}]');
assert.deepEqual(table.columns, ['name', 'score']);
assert.equal(table.rows.length, 2);
assert.equal(table.totalRows, 2);
const largeTable = renderer.parseJsonTableData(JSON.stringify(Array.from({ length: 201 }, (_, id) => ({ id }))));
assert.equal(largeTable.rows.length, 200);
assert.equal(largeTable.totalRows, 201);
assert.equal(renderer.parseJsonTableData('{"name":"not a table"}'), null);
assert.equal(renderer.parseJsonTableData('[]'), null);
assert.equal(renderer.parseJsonTableData(JSON.stringify(Array.from({ length: 1001 }, (_, id) => ({ id })))), null);

console.log('Canvas renderer fake-input checks passed.');
