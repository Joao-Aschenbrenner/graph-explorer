(function () {
  const COMMUNITY_PALETTE = ["#58a6ff", "#a855f7", "#3fb950", "#d29922", "#f85149", "#39c5bb", "#ff7b72", "#bc8cff", "#79c0ff", "#56d364"];
  const GOLDEN_ANGLE = 2.399963229728653;

  const TYPE_META = {
    directory:  { label: "Pasta / módulo", color: "#6ea8fe", icon: "folder" },
    file:       { label: "Arquivo", color: "#8ec5ff", icon: "file" },
    class:      { label: "Classe / componente", color: "#b388ff", icon: "class" },
    function:   { label: "Função / método", color: "#59d98e", icon: "function" },
    interface:  { label: "Interface / contrato", color: "#6ee7f2", icon: "interface" },
    config:     { label: "Config / manifesto", color: "#f6c453", icon: "config" },
    dependency: { label: "Dependência externa", color: "#ff9f5a", icon: "dependency" },
    endpoint:   { label: "Endpoint / API", color: "#ff7272", icon: "endpoint" },
    community:  { label: "Comunidade", color: "#d98cff", icon: "community" },
    generic:    { label: "Outro", color: "#9aa7b8", icon: "generic" }
  };

  const ICON_PATHS = {
    folder: ["M3 6h6l2 2h10v10H3z"],
    file: ["M6 3h8l4 4v14H6z", "M14 3v5h5"],
    class: ["M4 4h16v16H4z", "M8 8h8M8 12h8M8 16h5"],
    function: ["M16 4h-2c-2 0-3 1-3 3v10c0 2-1 3-3 3H6", "M7 11h9", "M14 8l3 3-3 3"],
    interface: ["M12 3l8 9-8 9-8-9z", "M9 12h6"],
    config: ["M4 7h10M18 7h2M4 12h4M12 12h8M4 17h9M17 17h3", "M14 5v4M10 10v4M15 15v4"],
    dependency: ["M4 7l8-4 8 4-8 4z", "M4 12l8 4 8-4", "M4 17l8 4 8-4"],
    endpoint: ["M4 12h10", "M11 8l4 4-4 4", "M18 5h2v14h-2"],
    community: ["M7 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6", "M17 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6", "M12 22a4 4 0 1 0 0-8 4 4 0 0 0 0 8", "M9 7l2 7M15 7l-2 7"],
    generic: ["M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16", "M9 12h6"]
  };

  const PATH_CACHE = new Map();

  function hash(value) {
    let h = 2166136261;
    for (const ch of String(value)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }

  function communityColor(value) { return COMMUNITY_PALETTE[hash(value) % COMMUNITY_PALETTE.length]; }
  function typeMeta(type) { return TYPE_META[type] || TYPE_META.generic; }
  function escapeHtml(value) { return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
  function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }

  function iconPaths(type) {
    const icon = typeMeta(type).icon;
    if (!PATH_CACHE.has(icon)) PATH_CACHE.set(icon, (ICON_PATHS[icon] || ICON_PATHS.generic).map((path) => new Path2D(path)));
    return PATH_CACHE.get(icon);
  }

  function iconSvg(type, color = "#c9d1d9") {
    const icon = typeMeta(type).icon;
    const paths = ICON_PATHS[icon] || ICON_PATHS.generic;
    return `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${paths.map((d) => `<path d="${d}" fill="none" stroke="${color}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>`).join("")}</svg>`;
  }

  function mount(container, data) {
    container.innerHTML = "";
    const root = document.createElement("div");
    root.className = "json-graph-viewer";
    root.innerHTML = `
      <div class="jgv-toolbar">
        <div class="jgv-heading">
          <div class="jgv-title">${data.mode === "communities" ? "Grafo grande · visão por comunidades" : "Visualização interna do graph.json"}</div>
          <div class="jgv-stats">${Number(data.stats?.nodes || 0).toLocaleString("pt-BR")} nós · ${Number(data.stats?.edges || 0).toLocaleString("pt-BR")} relações · ${Number(data.stats?.communities || 0).toLocaleString("pt-BR")} comunidades</div>
        </div>
        <input class="jgv-search" placeholder="buscar nó/comunidade...">
        <button class="jgv-btn" type="button">Centralizar</button>
      </div>
      <canvas class="jgv-canvas"></canvas>
      <div class="jgv-tooltip hidden"></div>
      <div class="jgv-legend"></div>
      <div class="jgv-detail"><div class="jgv-muted">Passe o mouse ou clique em um nó para explorar.</div></div>
    `;
    container.appendChild(root);

    if (!document.getElementById("jgv-style")) {
      const style = document.createElement("style");
      style.id = "jgv-style";
      style.textContent = `
        .json-graph-viewer{position:absolute;inset:0;background:radial-gradient(circle at 50% 45%,rgba(88,166,255,.045),transparent 34%),#090d14;overflow:hidden}
        .json-graph-viewer:before{content:"";position:absolute;inset:0;pointer-events:none;opacity:.28;background-image:linear-gradient(rgba(255,255,255,.018) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.018) 1px,transparent 1px);background-size:32px 32px}
        .jgv-toolbar{position:absolute;z-index:4;left:12px;right:12px;top:10px;display:flex;align-items:center;gap:12px;padding:8px 10px;border:1px solid #28313d;border-radius:11px;background:#111821e8;box-shadow:0 12px 28px #0007;backdrop-filter:blur(10px)}
        .jgv-heading{display:flex;flex-direction:column;min-width:0}.jgv-title{font-size:12px;font-weight:750;color:#f0f6fc;white-space:nowrap}.jgv-stats{font-size:10px;color:#768394;white-space:nowrap;margin-top:2px}
        .jgv-search{margin-left:auto;width:230px;padding:7px 9px;font-size:11px;background:#0b1119;border:1px solid #2d3744;color:#dbe7f5;border-radius:7px}.jgv-search:focus{outline:none;border-color:#58a6ff}
        .jgv-btn{background:#18212c;border:1px solid #344050;color:#d5deea;border-radius:7px;padding:7px 10px;font-size:11px;cursor:pointer}.jgv-btn:hover{border-color:#58a6ff;color:#fff}
        .jgv-canvas{position:absolute;inset:0;width:100%;height:100%;cursor:grab}.jgv-canvas.dragging{cursor:grabbing}
        .jgv-tooltip{position:absolute;z-index:6;pointer-events:none;max-width:280px;padding:7px 9px;border:1px solid #344050;border-radius:8px;background:#101722f2;color:#dce6f2;box-shadow:0 8px 24px #0009;font-size:10px;line-height:1.35;backdrop-filter:blur(8px)}
        .jgv-tooltip.hidden{display:none}.jgv-tooltip-head{display:flex;align-items:center;gap:7px;font-weight:700;color:#fff}.jgv-tooltip-head svg{width:14px;height:14px;flex:none}.jgv-tooltip-meta{margin-top:3px;color:#7f8d9d}
        .jgv-legend{position:absolute;z-index:4;left:12px;bottom:12px;width:210px;max-height:240px;overflow:auto;padding:9px 10px;border:1px solid #28313d;border-radius:10px;background:#111821df;color:#aeb9c7;font-size:10px;box-shadow:0 10px 24px #0006;backdrop-filter:blur(8px)}
        .jgv-legend-title{font-size:9px;letter-spacing:.08em;text-transform:uppercase;color:#6f7c8d;margin-bottom:7px}.jgv-legend-row{display:flex;align-items:center;gap:7px;margin:5px 0}.jgv-legend-row svg{width:13px;height:13px;flex:none}.jgv-legend-count{margin-left:auto;color:#637183;font-variant-numeric:tabular-nums}
        .jgv-detail{position:absolute;z-index:4;right:12px;bottom:12px;width:320px;max-height:240px;overflow:auto;padding:11px;border:1px solid #28313d;border-radius:10px;background:#111821e8;font-size:11px;line-height:1.45;color:#c9d1d9;box-shadow:0 10px 26px #0007;backdrop-filter:blur(8px)}
        .jgv-detail-head{display:flex;align-items:center;gap:8px}.jgv-detail-head svg{width:18px;height:18px;flex:none}.jgv-detail strong{color:#f0f6fc}.jgv-muted{color:#7c8998}.jgv-chip{display:inline-block;margin:3px 3px 2px 0;padding:2px 6px;border-radius:999px;background:#1a2430;border:1px solid #2b3744;color:#8f9dae;font-size:9px}.jgv-sep{height:1px;background:#26313d;margin:8px 0}
      `;
      document.head.appendChild(style);
    }

    const canvas = root.querySelector(".jgv-canvas");
    const ctx = canvas.getContext("2d", { alpha: false });
    const detail = root.querySelector(".jgv-detail");
    const search = root.querySelector(".jgv-search");
    const resetBtn = root.querySelector(".jgv-btn");
    const tooltip = root.querySelector(".jgv-tooltip");
    const legend = root.querySelector(".jgv-legend");

    const nodes = (data.nodes || []).map((n) => ({ ...n, x: 0, y: 0 }));
    const nodeMap = new Map(nodes.map((n) => [String(n.id), n]));
    const edges = (data.edges || []).filter((e) => nodeMap.has(String(e.source)) && nodeMap.has(String(e.target)));
    const adjacency = new Map(nodes.map((n) => [String(n.id), new Set()]));
    for (const e of edges) {
      adjacency.get(String(e.source))?.add(String(e.target));
      adjacency.get(String(e.target))?.add(String(e.source));
    }

    let width = 1, height = 1, dpr = 1;
    let scale = 1, offsetX = 0, offsetY = 0;
    let dragging = false, startX = 0, startY = 0, lastX = 0, lastY = 0;
    let query = "";
    let selected = null;
    let hovered = null;
    let hoverFrame = 0;
    let hoverPoint = { x: 0, y: 0 };

    const largestCommunities = data.mode === "communities" ? new Set([...nodes].sort((a, b) => Number(b.size || 0) - Number(a.size || 0)).slice(0, 14).map((n) => String(n.id))) : new Set();

    function layout() {
      if (data.mode === "communities") {
        const extent = clamp(180 + Math.sqrt(nodes.length) * 18, 260, 980);
        nodes.forEach((n, i) => {
          const rr = extent * Math.sqrt((i + 0.65) / Math.max(1, nodes.length));
          const angle = i * GOLDEN_ANGLE + (hash(n.id) % 31) / 50;
          n.x = Math.cos(angle) * rr;
          n.y = Math.sin(angle) * rr;
        });
        return;
      }

      const groups = new Map();
      for (const n of nodes) {
        const key = String(n.community ?? "unclustered");
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(n);
      }

      const groupList = [...groups.entries()].sort((a, b) => b[1].length - a[1].length);
      const fieldRadius = clamp(180 + Math.sqrt(nodes.length) * 24, 320, 1800);
      groupList.forEach(([key, list], gi) => {
        let gx = 0, gy = 0;
        if (groupList.length > 1) {
          const rr = fieldRadius * Math.sqrt((gi + 0.55) / groupList.length);
          const angle = gi * GOLDEN_ANGLE + (hash(key) % 47) / 80;
          gx = Math.cos(angle) * rr;
          gy = Math.sin(angle) * rr;
        }
        const localRadius = clamp(36 + Math.sqrt(list.length) * 20, 56, 460);
        list.forEach((n, i) => {
          const rr = localRadius * Math.sqrt((i + 0.6) / Math.max(1, list.length));
          const angle = i * GOLDEN_ANGLE + (hash(n.id) % 100) / 100;
          n.x = gx + Math.cos(angle) * rr;
          n.y = gy + Math.sin(angle) * rr;
        });
      });
    }

    function fit() {
      if (!nodes.length) return;
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const n of nodes) { minX = Math.min(minX, n.x); minY = Math.min(minY, n.y); maxX = Math.max(maxX, n.x); maxY = Math.max(maxY, n.y); }
      const gw = Math.max(220, maxX - minX), gh = Math.max(220, maxY - minY);
      scale = clamp(Math.min((width - 100) / gw, (height - 150) / gh), .055, 1.55);
      offsetX = width / 2 - ((minX + maxX) / 2) * scale;
      offsetY = height / 2 - ((minY + maxY) / 2) * scale + 24;
      draw();
    }

    function screen(n) { return { x: n.x * scale + offsetX, y: n.y * scale + offsetY }; }
    function baseRadius(n) {
      if (data.mode === "communities") return clamp(4.8 + Math.log2(1 + Number(n.size || 1)) * .82, 5.5, 12.5);
      return clamp(2.15 + Math.log2(1 + Number(n.degree || 0)) * .38, 2.2, 5.25);
    }
    function screenRadius(n) {
      const zoomFactor = clamp(Math.sqrt(Math.max(scale, .01)), .72, 1.35);
      let r = baseRadius(n) * zoomFactor;
      if (n === hovered) r += 1.2;
      if (n === selected) r += 1.8;
      return r;
    }
    function matches(n) {
      if (!query) return true;
      return `${n.label || ""} ${n.sourceFile || ""} ${n.communityLabel || ""} ${n.type || ""} ${n.dominantType || ""}`.toLowerCase().includes(query);
    }
    function focusNode() { return selected || hovered; }
    function isNeighbor(n, focus) { return focus ? adjacency.get(String(focus.id))?.has(String(n.id)) || false : false; }

    function drawIcon(n, p, r) {
      const iconType = data.mode === "communities" ? "community" : (n.type || "generic");
      const always = data.mode === "communities" && r >= 6.1;
      const focused = n === selected || n === hovered;
      const close = scale >= .82 && r >= 4.1;
      if (!always && !focused && !close) return;
      const iconSize = clamp(r * 1.25, 5, data.mode === "communities" ? 12 : 8.5);
      ctx.save();
      ctx.translate(p.x - iconSize / 2, p.y - iconSize / 2);
      ctx.scale(iconSize / 24, iconSize / 24);
      ctx.strokeStyle = focused ? "#ffffff" : "#0b1119";
      ctx.lineWidth = focused ? 2.4 : 2.1;
      ctx.lineCap = "round"; ctx.lineJoin = "round";
      for (const path of iconPaths(iconType)) ctx.stroke(path);
      ctx.restore();
    }

    function drawLabel(n, p, r) {
      const show = n === selected || n === hovered || (data.mode === "communities" && largestCommunities.has(String(n.id)) && scale >= .34);
      if (!show) return;
      const label = String(n.label || "");
      if (!label) return;
      ctx.save();
      ctx.font = `${n === selected || n === hovered ? 600 : 500} 10px system-ui,Segoe UI,sans-serif`;
      const text = label.length > 34 ? label.slice(0, 31) + "…" : label;
      const tw = ctx.measureText(text).width;
      const x = p.x + r + 6, y = p.y - 6;
      ctx.fillStyle = "rgba(9,13,20,.88)"; ctx.strokeStyle = "rgba(79,96,117,.55)"; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.roundRect(x - 4, y - 9, tw + 8, 16, 5); ctx.fill(); ctx.stroke();
      ctx.fillStyle = n === selected || n === hovered ? "#f5f9ff" : "#b5c0cd"; ctx.fillText(text, x, y + 2); ctx.restore();
    }

    function draw() {
      ctx.fillStyle = "#090d14"; ctx.fillRect(0, 0, width, height);
      const focus = focusNode();
      const maxEdges = scale < .22 ? Math.min(edges.length, 12000) : edges.length;
      ctx.save(); ctx.lineCap = "round";
      for (let i = 0; i < maxEdges; i++) {
        const e = edges[i], a = nodeMap.get(String(e.source)), b = nodeMap.get(String(e.target));
        if (!a || !b) continue;
        const pa = screen(a), pb = screen(b);
        const active = focus && (focus === a || focus === b);
        const selectedActive = selected && (selected === a || selected === b);
        const dim = selected && !selectedActive;
        ctx.globalAlpha = dim ? .18 : 1;
        ctx.strokeStyle = selectedActive ? "rgba(125,211,252,.86)" : active ? "rgba(194,224,255,.62)" : "rgba(145,166,192,.24)";
        ctx.lineWidth = selectedActive ? 1.55 : active ? 1.05 : clamp(.42 + Math.log2(1 + Number(e.weight || 1)) * .16, .42, 1.35);
        ctx.beginPath(); ctx.moveTo(pa.x, pa.y); ctx.lineTo(pb.x, pb.y); ctx.stroke();
      }
      ctx.restore();

      for (const n of nodes) {
        const p = screen(n), r = screenRadius(n), hit = matches(n), related = selected && (selected === n || isNeighbor(n, selected));
        const type = data.mode === "communities" ? "community" : (n.type || "generic");
        const meta = typeMeta(type), communityStroke = communityColor(n.community);
        const dimForSearch = query && !hit, dimForSelection = selected && !related;
        ctx.save(); ctx.globalAlpha = dimForSearch ? .08 : dimForSelection ? .16 : .94;
        if (n === selected || n === hovered) { ctx.shadowColor = n === selected ? "#8cd8ff" : meta.color; ctx.shadowBlur = n === selected ? 12 : 8; }
        ctx.fillStyle = data.mode === "communities" ? communityStroke : meta.color;
        ctx.strokeStyle = n === selected ? "#ffffff" : n === hovered ? "#dcecff" : communityStroke;
        ctx.lineWidth = n === selected ? 2.1 : n === hovered ? 1.7 : data.mode === "communities" ? 1.15 : .75;
        ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        if (data.mode !== "communities" && r > 3) {
          ctx.fillStyle = "rgba(7,11,17,.22)"; ctx.beginPath(); ctx.arc(p.x - r * .26, p.y - r * .3, Math.max(.6, r * .22), 0, Math.PI * 2); ctx.fill();
        }
        ctx.restore();
        drawIcon(n, p, r); drawLabel(n, p, r);
      }

      if (selected) {
        const p = screen(selected);
        ctx.save(); ctx.strokeStyle = "rgba(88,166,255,.22)"; ctx.lineWidth = 1; ctx.setLineDash([4, 6]);
        ctx.beginPath(); ctx.arc(p.x, p.y, screenRadius(selected) + 7, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
      }
    }

    function pick(x, y) {
      let best = null, bestD = data.mode === "communities" ? 15 : 11;
      for (const n of nodes) {
        const p = screen(n), d = Math.hypot(p.x - x, p.y - y);
        if (d <= Math.max(bestD, screenRadius(n) + 4) && d < bestD + 4) { best = n; bestD = d; }
      }
      return best;
    }

    function detailType(n) { return data.mode === "communities" ? typeMeta(n.dominantType || "generic") : typeMeta(n.type || "generic"); }

    function showDetail(n) {
      selected = n;
      if (!n) { detail.innerHTML = '<div class="jgv-muted">Passe o mouse ou clique em um nó para explorar.</div>'; draw(); return; }
      const meta = detailType(n);
      const samples = Array.isArray(n.samples) ? n.samples.map((s) => `<span class="jgv-chip">${escapeHtml(s)}</span>`).join("") : "";
      const connectionCount = adjacency.get(String(n.id))?.size || Number(n.degree || 0);
      const typeLine = data.mode === "communities" ? `Comunidade · predominante: ${escapeHtml(meta.label)}` : escapeHtml(meta.label);
      detail.innerHTML = `<div class="jgv-detail-head">${iconSvg(data.mode === "communities" ? "community" : (n.type || "generic"), meta.color)}<div><strong>${escapeHtml(n.label)}</strong><br><span class="jgv-muted">${typeLine}</span></div></div><div class="jgv-sep"></div>${data.mode === "communities" ? `<div>${Number(n.count || n.size || 0).toLocaleString("pt-BR")} nós internos</div>` : ""}<div>${Number(connectionCount || 0).toLocaleString("pt-BR")} conexões diretas</div>${n.communityLabel && data.mode !== "communities" ? `<div>Comunidade: ${escapeHtml(n.communityLabel)}</div>` : ""}${n.sourceFile ? `<div>Arquivo: ${escapeHtml(n.sourceFile)}</div>` : ""}${samples ? `<div style="margin-top:7px">${samples}</div>` : ""}`;
      draw();
    }

    function renderLegend() {
      const counts = data.stats?.typeCounts || {};
      const entries = Object.entries(TYPE_META).filter(([key]) => key === "community" ? data.mode === "communities" : Number(counts[key] || 0) > 0);
      const rows = entries.map(([key, meta]) => {
        const count = key === "community" ? Number(data.stats?.visibleCommunities || data.stats?.communities || nodes.length) : Number(counts[key] || 0);
        return `<div class="jgv-legend-row">${iconSvg(key, meta.color)}<span>${escapeHtml(meta.label)}</span><span class="jgv-legend-count">${count.toLocaleString("pt-BR")}</span></div>`;
      }).join("");
      legend.innerHTML = `<div class="jgv-legend-title">Tipos detectados</div>${rows || '<div class="jgv-muted">Sem classificação disponível</div>'}`;
    }

    function showTooltip(n, x, y) {
      if (!n) { tooltip.classList.add("hidden"); return; }
      const meta = detailType(n);
      tooltip.innerHTML = `<div class="jgv-tooltip-head">${iconSvg(data.mode === "communities" ? "community" : (n.type || "generic"), meta.color)}<span>${escapeHtml(n.label)}</span></div><div class="jgv-tooltip-meta">${data.mode === "communities" ? `${Number(n.count || n.size || 0).toLocaleString("pt-BR")} nós · ${escapeHtml(meta.label)}` : `${escapeHtml(meta.label)} · ${Number(adjacency.get(String(n.id))?.size || n.degree || 0).toLocaleString("pt-BR")} conexões`}</div>`;
      const pad = 16, tw = 290;
      tooltip.style.left = `${Math.max(pad, Math.min(width - tw - pad, x + 14))}px`;
      tooltip.style.top = `${Math.max(70, Math.min(height - 70, y + 14))}px`;
      tooltip.classList.remove("hidden");
    }

    function updateHover(x, y) {
      hoverPoint = { x, y };
      if (hoverFrame) return;
      hoverFrame = requestAnimationFrame(() => {
        hoverFrame = 0;
        const next = pick(hoverPoint.x, hoverPoint.y);
        if (next !== hovered) { hovered = next; draw(); }
        showTooltip(hovered, hoverPoint.x, hoverPoint.y);
      });
    }

    function resize() {
      const rect = root.getBoundingClientRect(); width = Math.max(1, rect.width); height = Math.max(1, rect.height); dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.floor(width * dpr); canvas.height = Math.floor(height * dpr); canvas.style.width = `${width}px`; canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); draw();
    }

    canvas.addEventListener("wheel", (e) => {
      e.preventDefault(); const beforeX = (e.offsetX - offsetX) / scale, beforeY = (e.offsetY - offsetY) / scale, factor = e.deltaY < 0 ? 1.12 : .89;
      scale = clamp(scale * factor, .035, 5); offsetX = e.offsetX - beforeX * scale; offsetY = e.offsetY - beforeY * scale; draw();
    }, { passive: false });

    canvas.addEventListener("pointerdown", (e) => {
      dragging = true; startX = lastX = e.clientX; startY = lastY = e.clientY; canvas.classList.add("dragging"); canvas.setPointerCapture(e.pointerId); tooltip.classList.add("hidden");
    });
    canvas.addEventListener("pointermove", (e) => {
      if (dragging) { offsetX += e.clientX - lastX; offsetY += e.clientY - lastY; lastX = e.clientX; lastY = e.clientY; draw(); return; }
      updateHover(e.offsetX, e.offsetY);
    });
    canvas.addEventListener("pointerleave", () => { if (!dragging) { hovered = null; tooltip.classList.add("hidden"); draw(); } });
    canvas.addEventListener("pointerup", (e) => {
      const moved = Math.hypot(e.clientX - startX, e.clientY - startY); dragging = false; canvas.classList.remove("dragging"); if (moved < 4) showDetail(pick(e.offsetX, e.offsetY));
    });
    search.addEventListener("input", () => { query = search.value.trim().toLowerCase(); draw(); });
    resetBtn.addEventListener("click", fit);

    layout(); renderLegend();
    const ro = new ResizeObserver(() => resize()); ro.observe(root); resize(); requestAnimationFrame(fit);
    return { destroy: () => { ro.disconnect(); if (hoverFrame) cancelAnimationFrame(hoverFrame); } };
  }

  window.GraphJsonViewer = { mount };
})();
