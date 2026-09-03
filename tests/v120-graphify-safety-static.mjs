import assert from "node:assert/strict";
import fs from "node:fs";
const main=fs.readFileSync("main.js","utf8");
for(const needle of ["ensureLatestGraphify","latestGraphifyVersion","preflightGraphifyProject","SMART_EXCLUDE_NAMES","SMART_EXCLUDE_PATTERNS",".graphifyignore","--no-cluster","--no-label","--no-viz","backups/","**/wineprefix/","*.zip"]){assert.ok(main.includes(needle),`main sem ${needle}`)}
assert.ok(main.includes('["tool", "upgrade", "graphifyy"]'));
assert.ok(!main.includes('if (labelCfg.canLabel && p && p.backend) steps.push(labelStep(true));'));
console.log("V120_GRAPHIFY_SAFETY_STATIC_PASS");
