import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const page = await readFile(new URL('../src/app/pages/runs.page.ts', import.meta.url), 'utf8');
assert.match(page, /citations\(\)\.length/, 'run output should show citations when present');
assert.match(page, /aria-label="Document citations"/, 'citation region should be named for assistive technology');
assert.match(page, /start_char/);
assert.match(page, /end_char/);
assert.match(page, /document_name/);
assert.match(page, /citation\['quote'\]/, 'source quote should be shown as readable text');
assert.match(page, /Matched terms:[\s\S]*?lexical score[\s\S]*?\(heuristic\)/,
  'RAG citations should expose inspectable lexical matching without presenting it as calibrated relevance');
assert.match(page, /citationTerms\(citation\)[\s\S]*?slice\(0, 24\)/, 'citation terms should be bounded and type checked');
assert.match(page, /Number\.isFinite\(score\)/, 'citation scores should reject non-finite values');
assert.match(page, /output\.kind !== 'json'/, 'only typed JSON citation outputs should be parsed');
assert.match(page, /sandbox=""/, 'HTML preview must remain sandboxed');
assert.match(page, /\[download\]="artifact\.name"/, 'generated documents should remain saveable');
assert.match(page, /Open PDF preview/, 'PDF output should have a preview action');
assert.match(page, /retryArtifact\(artifact\)/, 'failed document previews should be retryable');
console.log('Run citation and document preview checks passed.');
