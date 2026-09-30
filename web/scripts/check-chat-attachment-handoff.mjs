import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const chat = await readFile(new URL('../src/app/pages/chat.page.ts', import.meta.url), 'utf8');
const skills = await readFile(new URL('../src/app/pages/skills.page.ts', import.meta.url), 'utf8');
const artifactService = await readFile(new URL('../src/app/core/artifact.service.ts', import.meta.url), 'utf8');

assert.match(chat, /supportsAttachmentSkill\(item, skill\)/, 'offer a skill route only when its declared input supports the attachment kind');
assert.match(chat, /if \(kind === 'audio'\) return \['voice\.transcribe', 'voice\.conversation'\]/,
  'audio uploads should offer existing transcript-only and voice-conversation workflows');
assert.match(chat, /this\.router\.navigate\(\['\/skills'\], \{ queryParams: \{ skill: skill\.id, artifact: item\.artifact\.id \} \}\)/,
  'explicit selection must carry only skill and opaque artifact IDs');
assert.match(chat, /Attachments are staged for the suggested skills; sending a chat message remains text-only\./,
  'the ordinary chat send path must remain text-only and compatible');
assert.match(skills, /this\.route\.snapshot\.queryParamMap\.get\('artifact'\)/, 'Skills must consume the artifact ID handoff');
assert.match(skills, /listSessionArtifacts\(\)/, 'handoff must resolve against current session uploads');
assert.match(skills, /this\.sessionArtifacts\(\)\.find\(candidate => candidate\.id === artifactId\)/,
  'only an artifact returned by the owner-scoped session API may be attached');
assert.match(skills, /candidate\.artifact === artifact\.kind/, 'handoff must require an exact declared input kind');
assert.match(skills, /The attachment was not converted\./, 'unsupported attachments must not be silently transformed');
assert.match(skills, /multiple \$\{artifact\.kind\} inputs/, 'ambiguous routes require user selection of the intended input');
assert.match(artifactService, /value\.owner\.id === ownerId/, 'session listing must be scoped to the local session owner');

console.log('Chat attachment-to-skill handoff contract checks passed.');
