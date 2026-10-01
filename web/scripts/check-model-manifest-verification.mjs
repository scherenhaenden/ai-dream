import { readFileSync } from 'node:fs';

const page = readFileSync(new URL('../src/app/pages/models.page.ts', import.meta.url), 'utf8');
const service = readFileSync(new URL('../src/app/core/capability.service.ts', import.meta.url), 'utf8');

const checks = [
  ['verification button requires advertised local verifier', /@if \(manifest\.verification_available\)[\s\S]*?Verify with local runtime/.test(page)],
  ['unavailable verifier is explained', /no runtime probe is configured on this host/.test(page)],
  ['button makes the local runtime probe explicit', /Starts the configured local runtime and performs its bounded minimal capability probe/.test(page)],
  ['verification result refreshes manifest and profiles', /async verifyModelManifest\([\s\S]*?refreshModelEvidence\(modelId\), this\.refreshProfiles\(\)/.test(page)],
  ['failed probe is not reported as promoted', /did not verify capabilities\. No verified profile was promoted/.test(page)],
  ['service uses the model manifest verify endpoint', /\/api\/model-manifests\/\$\{encodeURIComponent\(manifestId\)\}\/verify/.test(service)],
];

for (const [label, passed] of checks) {
  if (!passed) throw new Error(`model manifest verification contract failed: ${label}`);
}
console.log(`model manifest verification contract: ${checks.length}/${checks.length} passed`);
