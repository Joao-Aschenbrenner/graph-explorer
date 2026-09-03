import assert from "node:assert/strict";
import fs from "node:fs";

const main = fs.readFileSync("main.js", "utf8");

// ── 1. Env allowlist positiva ────────────────────────────────
assert.ok(main.includes("GRAPHIFY_BASE_ENV_KEYS"), "sem allowlist de env");
assert.ok(!/\{\s*\.\.\.process\.env\s*\}/.test(main), "process.env inteiro ainda é propagado em algum lugar");
assert.ok(main.includes("function buildGraphifyBaseEnv"), "sem buildGraphifyBaseEnv");
assert.ok(
  /const GRAPHIFY_BASE_ENV_KEYS = \[/.test(main) && /"PATH", "Path"/.test(main),
  "allowlist de env não contém PATH"
);

// A allowlist deve ser limitada (não pode conter wildcard ou spread)
const keysMatch = main.match(/const GRAPHIFY_BASE_ENV_KEYS = \[([\s\S]*?)\];/);
assert.ok(keysMatch, "não foi possível extrair GRAPHIFY_BASE_ENV_KEYS");
const envKeys = keysMatch[1].split(",").map((k) => k.trim().replace(/"/g, "")).filter(Boolean);
assert.ok(envKeys.length > 5 && envKeys.length < 40, "allowlist de env fora do tamanho esperado");
for (const key of envKeys) {
  assert.ok(/^[A-Za-z_][A-Za-z0-9_]*$/.test(key), `chave de env inválida na allowlist: ${key}`);
}

// ── 2. Sanitização ────────────────────────────────────────────
assert.ok(main.includes("function sanitizeEnvValue"), "sem sanitizeEnvValue");
assert.ok(/replace\(\/\[\\0\\r\\n\]\/g/.test(main) || main.includes("replace(/[\\0\\r\\n]/g"), "sanitizeEnvValue não remove NUL/CR/LF");

// ── 3. API key somente via env ────────────────────────────────
assert.ok(main.includes("OPENAI_API_KEY: sanitizeEnvValue") || /env\.OPENAI_API_KEY = sanitizeEnvValue/.test(main), "API key não sanitizada em env");
// A chave nunca entra em args: buildSteps não referencia apiKey
const buildStepsMatch = main.match(/function buildSteps\([\s\S]*?\n\}/);
assert.ok(buildStepsMatch, "sem buildSteps");
assert.ok(!/apiKey|providerKey|credential/i.test(buildStepsMatch[0]), "buildSteps referencia credencial (deve ir só por env)");
// spawn é sempre comando fixo: graphify/taskkill/uv, ou variável guardada por allowlist
const spawnLines = main.split("\n").filter((l) => /spawn\(/.test(l) && !l.trim().startsWith("//"));
for (const line of spawnLines) {
  const m = line.match(/spawn\(\s*([^,]+)/);
  const cmd = m ? m[1].trim() : "";
  const isFixed = /^["'](graphify|taskkill|uv)["']$/.test(cmd);
  const isGuarded = cmd !== "command" ? false : /RUNTOOL_COMMANDS\.has\(command\)/.test(main);
  assert.ok(isFixed || isGuarded, `spawn com comando não fixo nem guardado: ${cmd} em: ${line.trim()}`);
}

// ── 4. Allowlist de operações e args ──────────────────────────
assert.ok(main.includes("GRAPHIFY_OPERATIONS"), "sem allowlist de operações");
assert.ok(main.includes("GRAPHIFY_ARGS_FIRST"), "sem allowlist de primeiro arg");
assert.ok(main.includes("GRAPHIFY_ARGS_FLAGS"), "sem allowlist de flags");
assert.ok(main.includes("function validateGraphifyArgs"), "sem validateGraphifyArgs");

// Operação inválida é rejeitada em buildSteps
assert.ok(/if \(!GRAPHIFY_OPERATIONS\.has\(operation\)\) throw/.test(main), "buildSteps não rejeita operação inválida");

// ── 5. PID validado no cancelamento ───────────────────────────
const killTreeMatch = main.match(/function killTree\([\s\S]*?\n\}/);
assert.ok(killTreeMatch, "sem killTree");
assert.ok(killTreeMatch[0].includes("Number.isInteger(numeric)"), "killTree sem validação Number.isInteger");
assert.ok(killTreeMatch[0].includes("numeric <= 0"), "killTree sem checagem de pid positivo");
assert.ok(!killTreeMatch[0].includes("..."), "killTree não deve usar spread em pid");

// ── 6. shell nunca usado no spawn do graphify ─────────────────
const spawnStepMatch = main.match(/function spawnStep\([\s\S]*?\n\}/);
assert.ok(spawnStepMatch, "sem spawnStep");
assert.ok(spawnStepMatch[0].includes('spawn("graphify"'), "spawnStep não usa comando fixo graphify");
assert.ok(!/shell:\s*true/.test(main), "algum spawn usa shell:true");

console.log("GRAPHIFY_ENV_ALLOWLIST=PASS");