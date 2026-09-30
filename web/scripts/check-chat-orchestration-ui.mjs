import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = await readFile(resolve(root, 'src/app/pages/chat.page.ts'), 'utf8');

const requirements = [
  ['plan preview remains explicit', /previewChatPlan\(\)/],
  ['plan strip opens a plan inspector', /togglePlanInspector\(\)[\s\S]*?aria-label="Resolved chat plan"/],
  ['inspector reports selected route fields', /Capability[\s\S]*?Model[\s\S]*?Profile[\s\S]*?Runtime/],
  ['inspector shows the chat input and output types', /Prompt · Text → Response · Text/],
  ['inspector exposes the selected route explanation', /Selection reason:[\s\S]*?why\.reasons/],
  ['alternatives require explicit selection', /ALTERNATIVES · SELECT TO PIN FOR THIS TURN[\s\S]*?replacePlanRoute\(route\)/],
  ['alternative selection is pinned for the next plan', /Alternative selected for this turn\. The next plan will pin this model and profile\./],
  ['plan does not invent timing or resource estimates', /Timing<\/dt><dd>Not started<\/dd>[\s\S]*?Resources<\/dt><dd>Not estimated by this plan/],
  ['skill catalog handoff explains the required re-selection', /Open Skills catalog[\s\S]*?Select the file again in the Skills workspace/],
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
