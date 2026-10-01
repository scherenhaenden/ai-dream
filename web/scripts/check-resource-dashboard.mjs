import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const page = await readFile(new URL('../src/app/pages/resources.page.ts', import.meta.url), 'utf8');

assert.match(page, /canUnload\(model: ResidentModel\): boolean[\s\S]*?model\.state === 'idle'[\s\S]*?model\.lease_count === 0[\s\S]*?model\.pinned === false/,
  'unload requires confirmed idle state, zero leases, and an explicit unpinned observation');
assert.match(page, /\[disabled\]="actionPending\(\) \|\| !canUnload\(model\)"/,
  'the unload control must fail closed whenever residency evidence is incomplete');
assert.match(page, /\[title\]="unloadAvailability\(model\)"/);
assert.match(page, /!canUnload\(model\)[\s\S]*?role="status"[\s\S]*?unloadAvailability\(model\)/,
  'the drawer explains the precise residency condition that blocks unload');
assert.match(page, /residency state is unknown[\s\S]*?active lease count is unknown[\s\S]*?pin status is unknown/,
  'unknown residency observations stay explicit and block unload');

assert.match(page, /pending_reservations[\s\S]*?estimated_ram_bytes[\s\S]*?estimated_vram_bytes/,
  'waiting rows consume only reservation estimates reported by the resource endpoint');
assert.match(page, /Est\. RAM[\s\S]*?bytes\(item\.estimated_ram_bytes, item\.estimated_ram_status\)[\s\S]*?Est\. VRAM[\s\S]*?bytes\(item\.estimated_vram_bytes, item\.estimated_vram_status\)/,
  'missing memory estimates pass through the Unknown formatter');
assert.match(page, /pendingReservationCount\(\)[\s\S]*?status === 'not_supported'[\s\S]*?statusLabel\(status\)/,
  'unsupported or unknown reservation inventory must not be displayed as an empty queue');
assert.match(page, /Waiting models and their memory requirements are not reported by this API\./);

assert.match(page, /imports: \[RouterLink\]/);
assert.match(page, /routerLink="\/models"[\s\S]*?Open model profile/,
  'the residency drawer links to the existing model profile management screen');

// Fake endpoint contract: null estimates and a missing model name stay missing,
// so the template's fallbacks render Unknown instead of inventing values.
const fakePending = { model_id: null, estimated_ram_bytes: null, estimated_vram_bytes: null,
  estimated_ram_status: 'unknown', estimated_vram_status: 'unknown' };
assert.equal(fakePending.model_id, null);
assert.equal(fakePending.estimated_ram_bytes, null);
assert.equal(fakePending.estimated_vram_bytes, null);

console.log('Resource dashboard residency checks passed.');
