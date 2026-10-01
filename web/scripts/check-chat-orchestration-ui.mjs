import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = await readFile(resolve(root, 'src/app/pages/chat.page.ts'), 'utf8');

const requirements = [
  ['plan preview remains explicit', /previewChatPlan\(\)/],
  ['plan strip opens a plan inspector', /togglePlanInspector\(\)[\s\S]*?aria-label="Resolved chat plan"/],
  ['inspector reports selected route fields', /Capability[\s\S]*?Model[\s\S]*?Profile[\s\S]*?Runtime/],
  ['inspector exposes the inherited route concurrency budget', /max_parallel_routes \?\? 'unknown'/],
  ['inspector shows the chat input and output types', /Prompt · Text → Response · Text/],
  ['inspector exposes the selected route explanation', /Selection reason:[\s\S]*?why\.reasons/],
  ['alternatives require explicit selection', /ALTERNATIVES · SELECT TO PIN FOR THIS TURN[\s\S]*?replacePlanRoute\(route\)/],
  ['alternative selection is pinned for the next plan', /Alternative selected for this turn\. The next plan will pin this model and profile\./],
  ['guided approval submits the exact reviewed plan identity', /selection: this\.selectionForResolvedPlan\(plan, mode, text\), expected_plan_id: plan\?\.plan_id/],
  ['guided run pins every resolved route shown to the user', /selectionForResolvedPlan\(plan, mode, text\)[\s\S]*?pins\[node\.capability_id\] = \{[\s\S]*?model_id: node\.selected\.model_id/],
  ['explicit alternative is retained only for its matching prompt and selections', /this\.selectedPlanOverrideKey\(\) === this\.guidedPlanKey\(text\)/],
  ['guided approval becomes stale when global selection mode changes', /JSON\.stringify\(\[this\.selectionModeService\.mode\(\), text,/],
  ['plan does not invent timing or resource estimates', /Timing<\/dt><dd>Not started<\/dd>[\s\S]*?Resources<\/dt><dd>Not estimated by this plan/],
  ['suggested skill selection hands off an opaque attachment ID', /openAttachmentSkill\(item, skill\)[\s\S]*?queryParams: \{ skill: skill\.id, artifact: item\.artifact\.id \}/],
  ['the compatibility direct chat path remains', /fetch\(`\$\{this\.api\.baseUrl\(\)\}\/api\/chat`/],
  ['preview is labeled as read-only before inference', /Resolved locally · no inference started/],
];

const failures = requirements.filter(([, pattern]) => !pattern.test(source)).map(([label]) => label);
if (failures.length) {
  process.stderr.write(`Chat orchestration UX checks failed:\n${failures.map(item => `- ${item}`).join('\n')}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`Chat orchestration UX checks passed (${requirements.length} contracts).\n`);
}
