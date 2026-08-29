import fs from "fs";

const file = "ge-qa-full.mjs";
let text = fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");
function replace(oldText, newText, label) {
  if (!text.includes(oldText)) throw new Error(`QA patch não encontrou: ${label}`);
  console.log(`[QA v1.1.5] ${label}`);
  text = text.replace(oldText, newText);
}

replace(
`    const requiredProviders = ["none","openai","anthropic","gemini","deepseek","kimi","ollama","azure","bedrock","nvidia","openrouter","groq","lmstudio","vllm","custom"];
    gate("FRESH_SETUP_PROVIDERS",
      requiredProviders.every(p=>freshSetup.options.includes(p)) && freshSetup.options.length === 15 && freshSetup.selected === "none" && freshSetup.width >= 300,`,
`    const requiredProviders = ["none","ollama","lmstudio","vllm","opencode_zen","gemini","nvidia","openrouter","groq","opencode_go","openai","anthropic","deepseek","kimi","mistral","azure","bedrock","custom"];
    gate("FRESH_SETUP_PROVIDERS",
      requiredProviders.every(p=>freshSetup.options.includes(p)) && freshSetup.options.length === 18 && freshSetup.selected === "none" && freshSetup.width >= 300,`,
"18 providers");

replace(
`    log("Test: SAVE_AND_OPEN");`,
`    log("Test: MODEL_CATALOG_DYNAMIC");
    const catalogRaw = await withTimeout("MODEL_CATALOG_DYNAMIC", ev(qaWindow, \`(async()=>{
      const r = await window.graphExplorer.listModels({
        provider:"nvidia", endpoint:"${fixtureEndpointEsc}", apiKey:"qa-fixture-key"
      });
      return JSON.stringify(r);
    })()\`), 30000);
    const catalog = normalizeResult(catalogRaw) || {};
    gate("MODEL_CATALOG_DYNAMIC", catalog.ok === true && Array.isArray(catalog.models) && catalog.models.some(m=>m.id === "qa-model"),
      \`ok=${catalog.ok} models=${Array.isArray(catalog.models) ? catalog.models.length : 0}\`);

    log("Test: SAVE_AND_OPEN");`,
"dynamic catalog gate");

replace(
`      document.getElementById('providerSelect').value='nvidia';
      document.getElementById('providerSelect').dispatchEvent(new Event('change'));
      document.getElementById('endpointInput').value='${fixtureEndpointEsc}';
      document.getElementById('modelInput').value='qa-model';
      document.getElementById('keyInput').value='qa-fixture-key';`,
`      document.getElementById('providerSelect').value='nvidia';
      document.getElementById('providerSelect').dispatchEvent(new Event('change'));
      document.getElementById('endpointInput').value='${fixtureEndpointEsc}';
      document.getElementById('keyInput').value='qa-fixture-key';
      await refreshModels({
        provider:'nvidia', endpoint:'${fixtureEndpointEsc}', apiKey:'qa-fixture-key',
        select:document.getElementById('modelSelect'), meta:document.getElementById('modelMeta'),
        profiles:document.getElementById('modelProfiles'), preferred:'qa-model', force:true
      });
      document.getElementById('modelSelect').value='qa-model';`,
"SAVE_AND_OPEN modelSelect");

if (text.includes("modelInput")) throw new Error("QA ainda contém modelInput após patch");
fs.writeFileSync(file, text, "utf8");
console.log("V115_FULL_QA_PATCHED");
