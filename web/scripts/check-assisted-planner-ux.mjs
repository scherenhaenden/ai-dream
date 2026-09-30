import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const page = await readFile(new URL('../src/app/pages/skills.page.ts', import.meta.url), 'utf8');
const backend = await readFile(new URL('../../aidream/orchestration.py', import.meta.url), 'utf8');
const api = await readFile(new URL('../../aidream/http_api.py', import.meta.url), 'utf8');
const prefs = await readFile(new URL('../../aidream/capabilities/preferences.py', import.meta.url), 'utf8');

assert.match(page, /Enable the global opt-in above to request a draft/, 'drafting must be explicitly opt-in');
assert.match(page, /Generate assisted draft/, 'draft inference must require an explicit action');
assert.match(page, /Blocked: load a local model in Chat or Runtime/, 'missing loaded model must be explained');
assert.match(page, /I reviewed the validated draft and resolved plan/, 'assisted execution must be gated on review');
assert.match(page, /\(click\)="preview\(skill\)"[\s\S]*?Preview plan/, 'plan review must be explicitly requested');
assert.match(page, /aria-label="Plan preview"[\s\S]*?Review the selected route before starting/, 'resolved plan must be visible before execution');
assert.match(page, /readonly canRun = computed\(\(\) => !!this\.plan\(\) && this\.planReady\(\)[\s\S]*?draftReviewed\(\)/, 'assisted execution must require a successful reviewed plan');

assert.match(backend, /assisted_planner_enabled: bool = False/, 'assisted drafts must default to disabled');
assert.match(backend, /if not self\.assisted_planner_enabled:[\s\S]*?raise PlanDraftError\("assisted planner is disabled"\)/);
assert.match(backend, /unknown = set\(draft\) - \{"skill_id", "components"\}/, 'draft schema must reject unknown top-level fields');
assert.match(backend, /set\(item\) != \{"node_id", "component_id"\}/, 'component entries must reject undeclared fields');
assert.match(backend, /if supplied != expected:/, 'draft components must match the installed skill exactly');
assert.match(prefs, /"assisted_planner_enabled": False/, 'global assisted planner opt-in must default off');
assert.match(api, /def draft_skill\([\s\S]*?defaults\["assisted_planner_enabled"\] is not True[\s\S]*?No local model is already loaded/, 'API must require opt-in and an already-loaded model');
assert.match(api, /backend\.generate\(planner_prompt, \{"temperature": 0\.1, "max_tokens": 256\}\)/, 'planner generation must be bounded');
assert.match(api, /resolve_assisted_draft\([\s\S]*?draft, inputs, mode=selection\.get\("mode"\)/, 'model output must pass strict deterministic draft validation');
assert.match(api, /skill_action = re\.fullmatch\([\s\S]*?\(plan\|run\|draft\)/, 'draft endpoint must be routed through the local API');

console.log('Assisted planner opt-in, loaded-model gate and strict-draft UX checks passed.');
