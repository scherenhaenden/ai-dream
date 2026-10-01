import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = relative => readFile(new URL(relative, import.meta.url), 'utf8');
const [workspace, canvasPage, routes, runsPage, chatPage, artifactTypes, renderers] = await Promise.all([
  read('../src/app/core/canvas-workspace.service.ts'),
  read('../src/app/pages/canvas.page.ts'),
  read('../src/app/app.routes.ts'),
  read('../src/app/pages/runs.page.ts'),
  read('../src/app/pages/chat.page.ts'),
  read('../src/app/core/artifact.types.ts'),
  read('../src/app/core/canvas-renderers.ts'),
]);

for (const kind of ['markdown', 'json', 'code', 'image', 'audio', 'html', 'pdf', 'document']) {
  assert.match(workspace, new RegExp(`'${kind}'`), `Canvas should retain ${kind} tabs`);
  if (kind !== 'document') {
    assert.match(canvasPage, new RegExp(`tab\.kind === '${kind}'`), `Canvas should render ${kind} outputs`);
  }
}
assert.match(canvasPage, /tab\.artifact && previewUrl\(tab\)[\s\S]*?Download \{\{ tab\.title \}\}/,
  'generic document artifacts should remain downloadable');
assert.match(renderers, /renderSafeMarkdown[\s\S]*?<h\$\{level\}>[\s\S]*?markdownCells\(line\)[\s\S]*?codeFence[\s\S]*?renderInlineMarkdown/,
  'Markdown view should support headings, tables, fenced code and safe inline formatting');
assert.match(renderers, /https\?:\\\/\\\/\|mailto:/,
  'Markdown links must be restricted to safe protocols');
assert.match(renderers, /escapeHtml\(source\)/,
  'Markdown input must be escaped before renderer markup is generated');
assert.match(canvasPage, /View as table/);
assert.match(canvasPage, /table-scroll/);
assert.match(canvasPage, /View JSON/,
  'JSON record arrays should offer a reversible tabular view');
assert.match(renderers, /parsed\.length > 1000[\s\S]*?slice\(0, 50\)/,
  'tabular rendering must bound rows and columns');
assert.doesNotMatch(artifactTypes, /['"]code_patch['"]|['"]patch['"]/,
  'do not imply a diff view until a patch artifact kind is declared');
assert.doesNotMatch(canvasPage, /diff-view|renderDiff/,
  'Canvas should not render arbitrary text as a code patch diff');
assert.match(workspace, /sessionStorage\.setItem\(STORAGE_KEY/, 'tabs should persist within the browser session');
assert.match(workspace, /artifact\.owner\.type.*artifact\.owner\.id.*artifact\.id/s,
  'artifact tab identity should remain stable for one owner-scoped artifact');
assert.match(workspace, /registerText\([\s\S]*?\}, false\)/, 'new output registration must be background-only');
assert.match(workspace, /openText\([\s\S]*?this\.activate\(tab\.id\)/,
  'only an explicit Open in Canvas action should select a tab');
assert.match(workspace, /if \(activate \|\| !existingActive/,
  'background output registration must preserve an already selected tab');
assert.match(workspace, /sameTabContent\(existing, tab\)[\s\S]*?return existing/,
  'unchanged output refreshes must preserve stable tab timestamps');
assert.match(workspace, /closedIds\.has\(tab\.id\)/, 'a user-closed tab must not be reopened by refresh events');
assert.match(canvasPage, /sandbox=""/, 'HTML artifact previews must be sandboxed');
assert.match(canvasPage, /HTML source/, 'HTML artifacts should expose their source beside the preview');
assert.match(canvasPage, /Open image[\s\S]*?Save image/, 'image artifacts should include open and save actions');
assert.match(canvasPage, /Download audio/, 'audio artifacts should include a direct download action beside the player');
assert.match(canvasPage, /artifact\.media_type[\s\S]*?artifactSize\(artifact\.size_bytes\)[\s\S]*?lifetimeLabel\(artifact\.lifetime\)/,
  'artifact tabs should expose media type, size, and retention lifetime');
assert.match(canvasPage, /textarea class="text-preview code-preview code-editor"[\s\S]*?editCode\(tab, \$event\)/,
  'code tabs should provide a local editable code surface');
assert.match(canvasPage, /document-preview[\s\S]*?Download \{\{ tab\.title \}\}/,
  'text document artifacts should preview and remain downloadable');
assert.match(workspace, /updateText\(id: string, content: string\)/,
  'local code edits should persist in the active session workspace');
assert.match(canvasPage, /role="tablist"[\s\S]*?role="tab"/, 'Canvas outputs should be navigable tabs');
assert.match(canvasPage, /onTabKeydown\(tab, \$event\)[\s\S]*?role="tabpanel"[\s\S]*?aria-labelledby/,
  'Canvas tabs should expose a linked tab panel and keyboard navigation handler');
assert.match(canvasPage, /event\.key === 'ArrowRight'[\s\S]*?event\.key === 'ArrowLeft'[\s\S]*?event\.key === 'Home'[\s\S]*?event\.key === 'End'/,
  'Canvas tab keyboard navigation should support arrows, Home, and End');
assert.match(canvasPage, /class="close-tab"[\s\S]*?closeTab\(tab\.id\)/,
  'closing a tab should use the focus-managed action');
assert.match(canvasPage, /closeTab\(id: string\)[\s\S]*?this\.workspace\.close\(id\)[\s\S]*?requestAnimationFrame\([\s\S]*?canvas-tab-\$\{focusId\}[\s\S]*?canvas-empty-heading/,
  'keyboard tab close should focus the remaining selected tab or the empty-state heading');
assert.match(canvasPage, /id="canvas-empty-heading" tabindex="-1"/,
  'the empty Canvas state should be programmatically focusable after closing the last tab');
assert.match(routes, /path: 'canvas'.*canvas\.page/, 'Canvas should have a stable route');
assert.match(runsPage, /Open in Canvas[\s\S]*?openArtifactInCanvas\(artifact\)/,
  'Run artifact outputs should expose an explicit Canvas action');
assert.match(runsPage, /openValueInCanvas\(output\)/, 'Run text and JSON values should open in Canvas');
assert.match(chatPage, /messageCanvasArtifacts\(message\)[\s\S]*?Open .*? in Canvas/,
  'Chat code blocks should have individual Canvas actions');
assert.match(chatPage, /Open response in Canvas/, 'Chat Markdown responses should open in Canvas');
assert.match(chatPage, /registerText\(markdownId[\s\S]*?registerText\(artifact\.id/,
  'new Chat results should register stable background tabs without navigation');
assert.doesNotMatch(chatPage, /if \(artifact && artifact\.messageKey !== this\.lastCanvasArtifactKey\)[\s\S]*?canvasOpen\.set\(true\)/,
  'new Chat code must not open or replace the inline preview automatically');
assert.match(chatPage, /Inline code preview/, 'the optional Chat preview must remain distinct from persistent Canvas');

console.log('Persistent Canvas workspace integration checks passed.');
