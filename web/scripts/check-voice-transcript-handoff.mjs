import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [runs, skills, apiTest] = await Promise.all([
  readFile(new URL('../src/app/pages/runs.page.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/app/pages/skills.page.ts', import.meta.url), 'utf8'),
  readFile(new URL('../../tests/test_document_skill_api.py', import.meta.url), 'utf8'),
]);

assert.match(runs, /run\.skill_id === 'voice\.transcribe'.*run\.state === 'succeeded'.*output\.kind === 'text'/s,
  'transcript handoff must be limited to successful voice.transcribe text outputs');
assert.match(runs, /reviewTranscript\(output, run\)/,
  'the user must explicitly click to start the transcript handoff');
assert.match(runs, /voiceTranscriptHandoff:\s*\{\s*runId:\s*run\.id,\s*transcript\s*\}/,
  'the handoff should carry the run identity and transcript through navigation state');
assert.match(skills, /consumeTranscriptHandoff\(\)/,
  'Skills must consume the one-time navigation state');
assert.match(skills, /transcript\.length > 16_000/,
  'transcript state must have a bounded size');
assert.match(skills, /this\.inputKey\(skill\.id, 'transcript'\).*transcript/s,
  'handoff must prefill the declared voice.respond transcript input');
assert.match(skills, /\[rows\]="skill\.id === 'voice\.respond' && input\.name === 'transcript' \? 8 : 3"/,
  'voice.respond transcript must use the editable multiline composer');
assert.match(skills, /editable draft\. Review or edit it, preview the plan, then choose Run skill\. Nothing was sent or started\./,
  'the UI must explain review and explicit execution requirements');
const consumer = skills.match(/private consumeTranscriptHandoff\(\): void \{([\s\S]*?)\n  \}\n  private consumeAttachmentHandoff/);
assert.ok(consumer, 'could not isolate transcript consumer for no-auto-run contract');
assert.doesNotMatch(consumer[1], /\.(?:planSkill|startSkill|executeSkill|runSkill|plan|run)\s*\(/,
  'consuming a transcript handoff must not plan or start work automatically');
assert.match(apiTest, /test_voice_respond_uses_only_explicit_reviewed_transcript_then_synthesizes/,
  'the fake API test must cover explicit reviewed transcript input');
assert.match(apiTest, /reviewed_transcript/,
  'the fake API contract must distinguish the user-reviewed transcript value');

console.log('Voice transcript handoff static contract passed.');
