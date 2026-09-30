import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const page = await readFile(new URL('../src/app/pages/skills.page.ts', import.meta.url), 'utf8');
const backend = await readFile(new URL('../../aidream/orchestration.py', import.meta.url), 'utf8');

assert.match(page, /AI-assisted draft unavailable/, 'UI must not claim an LLM planner is available');
assert.match(page, /preview is deterministic route resolution/, 'preview must identify its deterministic source');
assert.match(page, /\(click\)="preview\(skill\)"[\s\S]*?Preview plan/, 'plan review must be explicitly requested');
assert.match(page, /aria-label="Plan preview"[\s\S]*?Review the selected route before starting/, 'resolved plan must be visible before execution');
assert.match(page, /readonly canRun = computed\(\(\) => !!this\.plan\(\) && this\.planReady\(\)/, 'execution must require a successful reviewed plan');

assert.match(backend, /assisted_planner_enabled: bool = False/, 'assisted drafts must default to disabled');
assert.match(backend, /if not self\.assisted_planner_enabled:[\s\S]*?raise PlanDraftError\("assisted planner is disabled"\)/);
assert.match(backend, /unknown = set\(draft\) - \{"skill_id", "components"\}/, 'draft schema must reject unknown top-level fields');
assert.match(backend, /set\(item\) != \{"node_id", "component_id"\}/, 'component entries must reject undeclared fields');
assert.match(backend, /if supplied != expected:/, 'draft components must match the installed skill exactly');

console.log('Assisted planner UX and disabled strict-draft contract checks passed.');
