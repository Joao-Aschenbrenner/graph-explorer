import fs from "fs";

const file = "main.js";
let text = fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");
const oldText = `      const models = (payload.models || []).map((m) => ({ id: m.name || m.model, label: m.name || m.model, profile: modelProfile(m.name || m.model, m), tier: "local", compatible: true, meta: m?.details?.parameter_size || "" })).filter((m) => m.id);
      return { ok: true, models, source: "ollama", refreshedAt: new Date().toISOString() };`;
const newText = `      const models = (payload.models || []).map((m) => ({ id: m.name || m.model, label: m.name || m.model, profile: modelProfile(m.name || m.model, m), tier: "local", compatible: true, meta: m?.details?.parameter_size || "" })).filter((m) => m.id);
      const parameterBillions = (value) => {
        const match = String(value || "").match(/([\\d.]+)\\s*B/i);
        return match ? Number(match[1]) : NaN;
      };
      const sized = models.filter((m) => Number.isFinite(parameterBillions(m.meta))).sort((a, b) => parameterBillions(a.meta) - parameterBillions(b.meta));
      if (sized.length >= 3) {
        sized.forEach((m) => { m.profile = "balanced"; });
        sized[0].profile = "fast";
        sized[sized.length - 1].profile = "quality";
        sized[Math.floor((sized.length - 1) / 2)].profile = "balanced";
      } else if (sized.length === 2) {
        sized[0].profile = "fast";
        sized[1].profile = "quality";
      } else if (sized.length === 1) {
        sized[0].profile = "balanced";
      }
      return { ok: true, models, source: "ollama", refreshedAt: new Date().toISOString() };`;
if (!text.includes(oldText)) throw new Error("Não encontrou bloco Ollama para presets relativos");
text = text.replace(oldText, newText);
fs.writeFileSync(file, text, "utf8");
console.log("V115_OLLAMA_PROFILES_APPLIED");
