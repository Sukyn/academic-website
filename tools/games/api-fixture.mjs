// Run the real API handlers with a test database transport. Relative imports
// remain intact when compiling a deployment fixture, and become file URLs
// when loading the handler directly from a data URL.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { websiteFile } from '../quantum-golf/website.mjs';

export async function compileApiFixture(path, { neonReplacement, absoluteImports = true } = {}) {
  let source = await readFile(websiteFile(path), 'utf8');
  if (neonReplacement) {
    const replaced = source.replace(/import\s*\{\s*neon\s*\}\s*from\s*(['"])@neondatabase\/serverless\1;/, neonReplacement);
    assert.notEqual(replaced, source, 'The Neon transport must be replaced in the test fixture');
    source = replaced;
  }
  if (absoluteImports) source = source.replace(/from\s*(['"])\.\.\/(src\/lib\/[^'"]+)\1/g,
    (_, _quote, dependency) => `from '${websiteFile(dependency).href}'`);
  return ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext },
  }).outputText;
}

export async function loadApiFixture(path, options) {
  const source = await compileApiFixture(path, options);
  return (await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)).default;
}
