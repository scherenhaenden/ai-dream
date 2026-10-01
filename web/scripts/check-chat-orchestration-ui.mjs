import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = await readFile(resolve(root, 'src/app/pages/chat.page.ts'), 'utf8');

const requirements = [
  ['plan preview remains explicit', /previewChatPlan\(\)/],
  ['plan strip opens a plan inspector', /togglePlanInspector\(\)[\s\S]*?aria-label="Resolved chat plan"/],
  ['inspector reports capability, selected component/model, route, profile, and runtime', /Capability[\s\S]*?Component \/ model[\s\S]*?Route[\s\S]*?Profile[\s\S]*?Runtime/],
  ['inspector exposes the inherited route concurrency budget', /max_parallel_routes \?\? 'unknown'/],
  ['inspector derives workflow input types from API plan data without inventing output types', /planNodeIo\(node, plan\)[\s\S]*?plan\?\.input_kinds[\s\S]*?Outputs not reported by plan/],
  ['inspector shows reported node status and an honest fallback', /planNodeStatus\(node\)[\s\S]*?node\?\.status[\s\S]*?node\?\.state[\s\S]*?Plan resolved · run not started/],
  ['inspector never invents missing timing data', /planNodeTiming\(node\)[\s\S]*?Not reported by plan/],
  ['inspector shows only route-reported resource evidence', /planNodeResources\(node\)[\s\S]*?estimated_vram_bytes[\s\S]*?available_vram_bytes[\s\S]*?No estimate or observation reported/],
  ['inspector exposes the selected route explanation', /Selection reason:[\s\S]*?why\.reasons/],
  ['missing selected route explanation is called out explicitly', /Selection reason:[\s\S]*?Not reported by plan/],
  ['alternatives require explicit selection', /ALTERNATIVES · SELECT TO PIN FOR THIS TURN[\s\S]*?replacePlanRoute\(route\)/],
  ['alternative selection is pinned for the next plan', /Alternative selected for this turn\. The next plan will pin this model and profile\./],
  ['guided approval submits the exact reviewed plan identity', /selection: this\.selectionForResolvedPlan\(plan, mode, text\), expected_plan_id: plan\?\.plan_id/],
  ['guided run pins every resolved route shown to the user', /selectionForResolvedPlan\(plan, mode, text\)[\s\S]*?pins\[node\.capability_id\] = \{[\s\S]*?model_id: node\.selected\.model_id/],
  ['explicit alternative is retained only for its matching prompt and selections', /this\.selectedPlanOverrideKey\(\) === this\.guidedPlanKey\(text\)/],
  ['guided approval becomes stale when global selection mode changes', /JSON\.stringify\(\[this\.selectionModeService\.mode\(\), text,/],
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
