import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const artifactService = await readFile(new URL('../src/app/core/artifact.service.ts', import.meta.url), 'utf8');
const skillsPage = await readFile(new URL('../src/app/pages/skills.page.ts', import.meta.url), 'utf8');
const runsPage = await readFile(new URL('../src/app/pages/runs.page.ts', import.meta.url), 'utf8');

assert.match(artifactService, /file\.size <= 0/, 'empty uploads must fail before network transfer');
assert.match(artifactService, /async listSessionArtifacts\(\)/, 'session uploads must be restorable after page reload');
assert.match(artifactService, /owner_type: 'session', owner_id: ownerId/, 'artifact listing must be owner scoped');
assert.match(artifactService, /value\.owner\.id === ownerId/, 'foreign owner envelopes must not enter the picker');
assert.match(artifactService, /value\.storage\.type === 'session'/, 'only session-backed uploads may be restored');
assert.match(artifactService, /!\/[\\\\/\\x00-\\x1f]/, 'filenames must not contain path separators or control characters');

assert.match(skillsPage, /Promise\.allSettled\(\[\s*this\.service\.list\(\), this\.artifactService\.listSessionArtifacts\(\)/,
  'catalog and upload restoration should settle independently');
assert.match(skillsPage, /Use a previous session upload/, 'recovered session artifacts must be selectable');
assert.match(skillsPage, /attachSessionArtifact\(/, 'selected artifacts must attach to their typed input');
assert.match(skillsPage, /sessionArtifactError\(\)/, 'restore errors must be visible while uploads remain available');
assert.match(skillsPage, /inputs\[port\.name\] = \{ \.\.\.attachment \}/, 'plan/run must send the validated envelope');
assert.match(skillsPage, /await this\.artifactService\.delete\(artifact\.id\)/, 'explicit deletion must remove the stored upload');

assert.match(runsPage, /computed\(\(\) => collectRunOutputs\(this\.service\.run\(\)\?\.outputs \?\? \[\]\)\)/,
  'outputs must follow snapshot updates after SSE completion/refresh');
assert.match(runsPage, /output\.kind === 'text'/, 'typed text outputs must have a readable view');
assert.match(runsPage, /output\.kind !== 'json'/, 'structured output parsing must require typed JSON');
assert.match(runsPage, /Retry preview/, 'failed artifact preview fetches must be retryable');
assert.match(runsPage, /sandbox=""/, 'HTML artifact previews must stay sandboxed');
for (const kind of ['text', 'chat_messages', 'json', 'image', 'audio', 'video', 'document', 'embedding_batch', 'rerank_candidates', 'file_reference', 'screen_frame', 'tool_result', 'model_reference']) {
  assert.match(artifactService, new RegExp(`'${kind}'`), `artifact service should accept typed kind ${kind}`);
  assert.ok(runsPage.includes(`'${kind}'`), `run output parser should accept typed kind ${kind}`);
}
console.log('Artifact session lifecycle and run output UX checks passed.');
