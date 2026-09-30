import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const page = await readFile(new URL('../src/app/pages/skills.page.ts', import.meta.url), 'utf8');
const service = await readFile(new URL('../src/app/core/skill.service.ts', import.meta.url), 'utf8');
const types = await readFile(new URL('../src/app/core/skill.types.ts', import.meta.url), 'utf8');

assert.match(page, /aria-label="Permissions used by this skill before running"/);
assert.match(page, /Declared by this skill · review before running/);
assert.match(page, /permissionLabel\(permission\.key\)[\s\S]*?permission\.value/);
assert.match(page, /loadSkillPermissions\(skillId\)/);
assert.match(page, /permissionErrors\(\)\[skill\.id\]/);
assert.match(service, /`\/api\/skills\/\$\{encodeURIComponent\(skillId\)\}`/,
  'permission data should come from the existing local skill-detail endpoint');
assert.match(service, /PERMISSION_OPTIONS/);
assert.match(service, /unknown permission dimension/);
assert.match(service, /invalid \$\{key\} permission/);
assert.match(types, /export type SkillPermissionKey/);
console.log('Skill permission-before-run UX checks passed.');
