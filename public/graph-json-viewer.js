(function () {
  const PALETTE = ["#58a6ff", "#a855f7", "#3fb950", "#d29922", "#f85149", "#39c5bb", "#ff7b72", "#bc8cff", "#79c0ff", "#56d364"];

  function hash(value) {
    let h = 2166136261;
    for (const ch of String(value)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function colorFor(value) { return PALETTE[hash(value) % PALETTE.length]; }
  function escapeHtml(value) { return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }

  function mount(container, data) {
    container.innerHTML = "";
    const root = document.createElement("div");
    root.className = "json-graph-viewer";
    root.innerHTML = `
      <div class="jgv-toolbar">
        <div class="jgv-title">${data.mode === "communities" ? "Grafo grande · visão por comunidades" : "Visualização interna do graph.json"}</div>
        <div class="jgv-stats">${Number(data.stats?.nodes || 0).toLocaleString("pt-BR")} nós · ${Number(data.stats?.edges || 0).toLocaleString("pt-BR")} relações · ${Number(data.stats?.communities || 0).toLocaleString("pt-BR")} comunidades</div>
        <input class="jgv-search" placeholder="buscar nó/comunidade...">
        <button class="jgv-btn" type="button">Centralizar</button>
      </div>
      <canvas class="jgv-canvas"></canvas>
      <div class="jgv-detail"><div class="jgv-muted">Clique em um nó para ver detalhes.</div></div>
    `;
    container.appendChild(root);

    if (!document.getElementById("jgv-style")) {
      const style = document.createElement("style");
      style.id = "jgv-style";
      style.textContent = `
        .json-graph-viewer{position:absolute;inset:0;background:#0d1117;overflow:hidden}
        .jgv-toolbar{position:absolute;z-index:3;left:12px;right:12px;top:10px;display:flex;align-items:center;gap:9px;padding:8px 10px;border:1px solid #30363d;border-radius:10px;background:#161b22e8;backdrop-filter:blur(8px)}
        .jgv-title{font-size:12px;font-weight:700;color:#f0f6fc;white-space:nowrap}.jgv-stats{font-size:10px;color:#8b949e;white-space:nowrap}
        .jgv-search{margin-left:auto;width:220px;padding:6px 9px;font-size:11px}.jgv-btn{background:#21262d;border:1px solid #30363d;color:#c9d1d9;border-radius:7px;padding:6px 9px;font-size:11px;cursor:pointer}
        .jgv-canvas{position:absolute;inset:0;width:100%;height:100%;cursor:grab}.jgv-canvas.dragging{cursor:grabbing}
        .jgv-detail{position:absolute;z-index:3;right:12px;bottom:12px;width:300px;max-height:220px;overflow:auto;padding:11px;border:1px solid #30363d;border-radius:10px;background:#161b22e8;font-size:11px;line-height:1.45;color:#c9d1d9;backdrop-filter:blur(8px)}
        .jgv-detail strong{color:#f0f6fc}.jgv-muted{color:#8b949e}.jgv-chip{display:inline-block;margin:2px 3px 2px 0;padding:2px 5px;border-radius:999px;background:#21262d;color:#8b949e;font-size:9px}
      `;
      document.head.appendChild(style);
    }

    const canvas = root.querySelector(".jgv-canvas");
    const ctx = canvas.getContext("2d", { alpha: false });
    const detail = root.querySelector(".jgv-detail");
    const search = root.querySelector(".jgv-search");
    const resetBtn = root.querySelector(".jgv-btn");
    const nodes = (data.nodes || []).map((n) => ({ ...n, x: 0, y: 0 }));
    const nodeMap = new Map(nodes.map((n) => [String(n.id), n]));
    const edges = (data.edges || []).filter((e) => nodeMap.has(String(e.source)) && nodeMap.has(String(e.target)));

    let width = 1, height = 1, dpr = 1;
    let scale = 1, offsetX = 0, offsetY = 0;
    let dragging = false, startX = 0, startY = 0, lastX = 0, lastY = 0;
    let query = "";
    let selected = null;

    function layout() {
      const groups = new Map();
      for (const n of nodes) {
        const key = String(n.community ?? "unclustered");
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(n);
      }
      const groupList = [...groups.entries()];
      const groupRadius = Math.max(180, Math.min(900, 110 + Math.sqrt(nodes.length) * 18));
      groupList.forEach(([key, list], gi) => {
        const a = (Math.PI * 2 * gi) / Math.max(1, groupList.length) - Math.PI / 2;
        const gx = Math.cos(a) * groupRadius, gy = Math.sin(a) * groupRadius;
        const localRadius = 22 + Math.sqrt(list.length) * 14;
        list.forEach((n, i) => {
          const seed = hash(n.id), angle = ((i * 2.3999632297) + (seed % 100) / 100) % (Math.PI * 2);
          const radius = localRadius * Math.sqrt((i + 1) / Math.max(1, list.length));
          n.x = gx + Math.cos(angle) * radius; n.y = gy + Math.sin(angle) * radius;
        });
      });
      if (data.mode === "communities") {
        const r = Math.max(170, 35 * Math.sqrt(nodes.length));
        nodes.forEach((n, i) => { const a = i * 2.3999632297, rr = r * Math.sqrt((i + 1) / Math.max(1, nodes.length)); n.x = Math.cos(a) * rr; n.y = Math.sin(a) * rr; });
      }
    }

    function fit() {
      if (!nodes.length) return;
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const n of nodes) { minX = Math.min(minX, n.x); minY = Math.min(minY, n.y); maxX = Math.max(maxX, n.x); maxY = Math.max(maxY, n.y); }
      const gw = Math.max(200, maxX - minX), gh = Math.max(200, maxY - minY);
      scale = Math.max(.08, Math.min(1.6, Math.min((width - 80) / gw, (height - 130) / gh)));
      offsetX = width / 2 - ((minX + maxX) / 2) * scale;
      offsetY = height / 2 - ((minY + maxY) / 2) * scale + 25;
      draw();
    }

    function screen(n) { return { x: n.x * scale + offsetX, y: n.y * scale + offsetY }; }
    function radius(n) { if (data.mode === "communities") return Math.max(7, Math.min(28, 5 + Math.sqrt(Number(n.size || 1)) * 1.4)); return Math.max(2.4, Math.min(8, 2.4 + Math.log2(1 + Number(n.degree || 0)))); }
    function matches(n) { if (!query) return true; return `${n.label || ""} ${n.sourceFile || ""} ${n.communityLabel || ""}`.toLowerCase().includes(query); }

    function draw() {
      ctx.fillStyle = "#0d1117"; ctx.fillRect(0, 0, width, height); ctx.save();
      const maxEdges = scale < .25 ? Math.min(edges.length, 8000) : edges.length;
      for (let i = 0; i < maxEdges; i++) {
        const e = edges[i], a = nodeMap.get(String(e.source)), b = nodeMap.get(String(e.target));
        if (!a || !b) continue;
        const pa = screen(a), pb = screen(b), active = selected && (selected === a || selected === b);
        ctx.strokeStyle = active ? "#58a6ff88" : "#30363d55"; ctx.lineWidth = active ? 1.6 : Math.min(2.5, .45 + Math.log2(1 + Number(e.weight || 1)) * .25);
        ctx.beginPath(); ctx.moveTo(pa.x, pa.y); ctx.lineTo(pb.x, pb.y); ctx.stroke();
      }
      for (const n of nodes) {
        const p = screen(n), r = radius(n) * Math.max(.75, Math.min(1.6, scale)), hit = matches(n);
        ctx.globalAlpha = query && !hit ? .12 : 1; ctx.fillStyle = colorFor(n.community); ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill();
        if (selected === n || (query && hit)) { ctx.strokeStyle = selected === n ? "#ffffff" : "#d29922"; ctx.lineWidth = 2; ctx.stroke(); }
      }
      ctx.globalAlpha = 1; ctx.restore();
    }

    function pick(x, y) { let best = null, bestD = 18; for (const n of nodes) { const p = screen(n), d = Math.hypot(p.x - x, p.y - y); if (d < bestD) { best = n; bestD = d; } } return best; }
    function showDetail(n) {
      selected = n;
      if (!n) { detail.innerHTML = '<div class="jgv-muted">Clique em um nó para ver detalhes.</div>'; draw(); return; }
      const samples = Array.isArray(n.samples) ? n.samples.map((s) => `<span class="jgv-chip">${escapeHtml(s)}</span>`).join("") : "";
      detail.innerHTML = `<strong>${escapeHtml(n.label)}</strong><br><span class="jgv-muted">${data.mode === "communities" ? `${Number(n.count || n.size || 0).toLocaleString("pt-BR")} nós` : escapeHtml(n.type || "node")}</span>${n.communityLabel && data.mode !== "communities" ? `<br>Comunidade: ${escapeHtml(n.communityLabel)}` : ""}${n.sourceFile ? `<br>Arquivo: ${escapeHtml(n.sourceFile)}` : ""}${samples ? `<div style="margin-top:7px">${samples}</div>` : ""}`;
      draw();
    }

    function resize() {
      const rect = root.getBoundingClientRect(); width = Math.max(1, rect.width); height = Math.max(1, rect.height); dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.floor(width * dpr); canvas.height = Math.floor(height * dpr); canvas.style.width = `${width}px`; canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); draw();
    }

    canvas.addEventListener("wheel", (e) => { e.preventDefault(); const beforeX = (e.offsetX - offsetX) / scale, beforeY = (e.offsetY - offsetY) / scale, factor = e.deltaY < 0 ? 1.12 : .89; scale = Math.max(.04, Math.min(5, scale * factor)); offsetX = e.offsetX - beforeX * scale; offsetY = e.offsetY - beforeY * scale; draw(); }, { passive: false });
    canvas.addEventListener("pointerdown", (e) => { dragging = true; startX = lastX = e.clientX; startY = lastY = e.clientY; canvas.classList.add("dragging"); canvas.setPointerCapture(e.pointerId); });
    canvas.addEventListener("pointermove", (e) => { if (!dragging) return; offsetX += e.clientX - lastX; offsetY += e.clientY - lastY; lastX = e.clientX; lastY = e.clientY; draw(); });
    canvas.addEventListener("pointerup", (e) => { const moved = Math.hypot(e.clientX - startX, e.clientY - startY); dragging = false; canvas.classList.remove("dragging"); if (moved < 4) showDetail(pick(e.offsetX, e.offsetY)); });
    search.addEventListener("input", () => { query = search.value.trim().toLowerCase(); draw(); });
    resetBtn.addEventListener("click", fit);

    layout();
    const ro = new ResizeObserver(() => resize()); ro.observe(root); resize(); requestAnimationFrame(fit);
    return { destroy: () => ro.disconnect() };
  }

  window.GraphJsonViewer = { mount };
})();
