import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { parseTemplate } from '@angular/compiler';

const pagesDir = path.resolve('src/app/pages');
const files = fs.readdirSync(pagesDir).filter((file) => file.endsWith('.ts')).sort();
const failures = [];
let checked = 0;

for (const file of files) {
  const absolute = path.join(pagesDir, file);
  const source = ts.createSourceFile(file, fs.readFileSync(absolute, 'utf8'), ts.ScriptTarget.Latest, true);
  const visit = (node) => {
    if (ts.isPropertyAssignment(node) && node.name.getText(source) === 'template' && ts.isNoSubstitutionTemplateLiteral(node.initializer)) {
      checked += 1;
      const parsed = parseTemplate(node.initializer.text, file);
      for (const error of parsed.errors || []) failures.push(`${file}: ${error.toString()}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exitCode = 1;
} else {
  console.log(`Angular page templates parse: ${checked} inline templates.`);
}
