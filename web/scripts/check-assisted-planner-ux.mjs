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
assert.match(page, /Find a skill by goal or name[\s\S]*?Goal matches use only skill names and API-reported descriptions, categories, inputs and outputs\. They do not infer capabilities\./, 'goal discovery must be grounded in declared skill metadata');
assert.match(page, /skillGoalMatchScore\(skill: SkillCatalogItem, query: string, terms: string\[\]\)[\s\S]*?skill\.description[\s\S]*?skill\.inputs\.map[\s\S]*?skill\.outputs\.map/, 'goal matching must use installed skill metadata only');
assert.match(page, /assisted-plan-review[\s\S]*?aria-label="Generated assisted draft"[\s\S]*?aria-label="Deterministically resolved plan"/, 'draft and resolved route must be shown as distinct review panels');
assert.match(page, /\.assisted-plan-review\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/, 'wide approval layout must compare draft and resolved plan side by side');
assert.match(page, /@media\(max-width:700px\)\{\.assisted-plan-review\{grid-template-columns:1fr\}\}/, 'approval panels must stack at narrow widths');
assert.match(page, /\(click\)="preview\(skill\)"[\s\S]*?Preview plan/, 'plan review must be explicitly requested');
assert.match(page, /aria-label="Plan preview"[\s\S]*?Review the selected route before starting/, 'resolved plan must be visible before execution');
assert.match(page, /readonly canRun = computed\(\(\) => !!this\.plan\(\) && this\.planReady\(\)[\s\S]*?draftReviewed\(\)/, 'assisted execution must require a successful reviewed plan');
assert.match(page, /typeof value\['plan_id'\] === 'string' && \/\^\[a-f0-9\]\{24\}\$\//, 'only a resolved plan with a valid review ID may be run');
assert.match(page, /The resolved plan changed after review[\s\S]*?Preview the current plan again/, 'a stale reviewed plan must be invalidated with a clear recovery action');
assert.match(page, /assistedDraftDetails\.set\(null\); this\.draftReviewed\.set\(false\)/, 'new previews and stale-plan failures must clear draft acceptance');

assert.match(backend, /assisted_planner_enabled: bool = False/, 'assisted drafts must default to disabled');
assert.match(backend, /if not self\.assisted_planner_enabled:[\s\S]*?raise PlanDraftError\("assisted planner is disabled"\)/);
assert.match(backend, /unknown = set\(draft\) - \{"skill_id", "components"\}/, 'draft schema must reject unknown top-level fields');
assert.match(backend, /set\(item\) != \{"node_id", "component_id"\}/, 'component entries must reject undeclared fields');
assert.match(backend, /if supplied != expected:/, 'draft components must match the installed skill exactly');
assert.match(prefs, /"assisted_planner_enabled": False/, 'global assisted planner opt-in must default off');
assert.match(api, /def draft_skill\([\s\S]*?defaults\["assisted_planner_enabled"\] is not True[\s\S]*?No local model is already loaded/, 'API must require opt-in and an already-loaded model');
assert.match(api, /backend\.generate\(planner_prompt, \{"temperature": 0\.1, "max_tokens": 256\}\)/, 'planner generation must be bounded');
assert.match(api, /if draft\.get\("skill_id"\) != skill_id:[\s\S]*?raise PlanDraftError\("planner draft skill_id must match the requested skill"\)[\s\S]*?plan = service\.resolve_assisted_draft\(draft, result\.get\("inputs", inputs\), \*\*draft_options\)/, 'model output must bind to the requested skill before strict deterministic validation with explicit selection options');
assert.match(api, /planned\.get\("plan_id"\) != expected_plan_id[\s\S]*?The plan changed after review/, 'server must reject execution when the reviewed plan is stale');
const service = await readFile(new URL('../src/app/core/skill.service.ts', import.meta.url), 'utf8');
assert.match(service, /expected_plan_id: expectedPlanId/, 'Skills must send the reviewed resolved-plan ID at execution');
assert.match(api, /skill_action = re\.fullmatch\([\s\S]*?\(plan\|run\|draft\)/, 'draft endpoint must be routed through the local API');

console.log('Assisted planner opt-in, loaded-model gate and strict-draft UX checks passed.');
