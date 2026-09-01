import assert from 'node:assert/strict';
import fs from 'node:fs';

const viewer = fs.readFileSync('public/graph-json-viewer.js','utf8');
const ui = fs.readFileSync('public/index.html','utf8');

for (const needle of [
  'unifiedOpenGraph',
  'applyForces',
  'dragNode',
  'jgv-node-size',
  'jgv-spacing',
  'jgv-repulsion',
  'Física: on',
  'Arraste um nó',
  'compactMini',
  'ge-shell-consistency',
  'requestAnimationFrame(tick)',
]) assert.ok(viewer.includes(needle), `viewer sem contrato: ${needle}`);

for (const type of ['directory','file','class','function','interface','config','dependency','endpoint','community','generic']) {
  assert.ok(viewer.includes(`${type}:`), `viewer sem tipo ${type}`);
}

assert.ok(ui.includes('./graph-json-viewer.js'), 'index não carrega viewer interno');
assert.ok(viewer.includes('project && project.hasGraphJson'), 'graph.json não é preferido para design unificado');
assert.ok(viewer.includes("window.openGraph = function unifiedOpenGraph"), 'openGraph não foi unificado');
assert.ok(viewer.includes("width:26px!important"), 'ações da sidebar não foram compactadas');
assert.ok(!viewer.includes('Math.min(28'), 'raio gigante antigo reapareceu');

console.log('V119_UNIFIED_FORCE_STATIC_PASS');
