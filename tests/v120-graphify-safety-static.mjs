import assert from 'node:assert/strict';
import fs from 'node:fs';

const main = fs.readFileSync('main.js','utf8');
const preload = fs.readFileSync('preload.cjs','utf8');
const ui = fs.readFileSync('public/index.html','utf8');

for (const needle of [
  'graphify:update-check',
  'graphify:update',
  'graphify:preflight',
  'SMART_EXCLUDE_NAMES',
  'SMART_EXCLUDE_PATTERNS',
  '--no-label',
  '--no-viz',
  'uv tool upgrade graphifyy',
]) assert.ok(main.includes(needle), `main sem ${needle}`);

for (const needle of ['checkGraphifyUpdate','updateGraphify','preflightGraphify']) assert.ok(preload.includes(needle), `preload sem ${needle}`);
for (const needle of ['Graphify','Atualizar Graphify','Análise local primeiro','Pastas ignoradas']) assert.ok(ui.includes(needle), `UI sem ${needle}`);

assert.ok(!main.includes('if (labelCfg.canLabel && p && p.backend) steps.push(labelStep(true));'), 'generate ainda chama IA automaticamente');
console.log('V120_GRAPHIFY_SAFETY_STATIC_PASS');
