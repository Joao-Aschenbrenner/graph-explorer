(function () {
  'use strict';

  const COMMUNITY_PALETTE = ['#58a6ff','#a855f7','#3fb950','#d29922','#f85149','#39c5bb','#ff7b72','#bc8cff','#79c0ff','#56d364'];
  const GOLDEN_ANGLE = 2.399963229728653;
  const PHYSICS_EDGE_LIMIT = 12000;
  const LABEL_NODE_LIMIT = 36;

  const TYPE_META = {
    directory:  { label: 'Pasta / módulo', color: '#6ea8fe', icon: 'folder' },
    file:       { label: 'Arquivo', color: '#8ec5ff', icon: 'file' },
    class:      { label: 'Classe / componente', color: '#b388ff', icon: 'class' },
    function:   { label: 'Função / método', color: '#59d98e', icon: 'function' },
    interface:  { label: 'Interface / contrato', color: '#6ee7f2', icon: 'interface' },
    config:     { label: 'Config / manifesto', color: '#f6c453', icon: 'config' },
    dependency: { label: 'Dependência externa', color: '#ff9f5a', icon: 'dependency' },
    endpoint:   { label: 'Endpoint / API', color: '#ff7272', icon: 'endpoint' },
    community:  { label: 'Comunidade', color: '#d98cff', icon: 'community' },
    generic:    { label: 'Outro', color: '#9aa7b8', icon: 'generic' }
  };

  const ICON_PATHS = {
    folder: ['M3 6h6l2 2h10v10H3z'],
    file: ['M6 3h8l4 4v14H6z','M14 3v5h5'],
    class: ['M4 4h16v16H4z','M8 8h8M8 12h8M8 16h5'],
    function: ['M16 4h-2c-2 0-3 1-3 3v10c0 2-1 3-3 3H6','M7 11h9','M14 8l3 3-3 3'],
    interface: ['M12 3l8 9-8 9-8-9z','M9 12h6'],
    config: ['M4 7h10M18 7h2M4 12h4M12 12h8M4 17h9M17 17h3','M14 5v4M10 10v4M15 15v4'],
    dependency: ['M4 7l8-4 8 4-8 4z','M4 12l8 4 8-4','M4 17l8 4 8-4'],
    endpoint: ['M4 12h10','M11 8l4 4-4 4','M18 5h2v14h-2'],
    community: ['M7 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6','M17 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6','M12 22a4 4 0 1 0 0-8 4 4 0 0 0 0 8','M9 7l2 7M15 7l-2 7'],
    generic: ['M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16','M9 12h6']
  };

  const PATH_CACHE = new Map();

  function hash(value) {
    let h = 2166136261;
    for (const ch of String(value)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
  function typeMeta(type) { return TYPE_META[type] || TYPE_META.generic; }
  function communityColor(value) { return COMMUNITY_PALETTE[hash(value) % COMMUNITY_PALETTE.length]; }
  function escapeHtml(value) { return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

  function iconPaths(type) {
    const icon = typeMeta(type).icon;
    if (!PATH_CACHE.has(icon)) PATH_CACHE.set(icon, (ICON_PATHS[icon] || ICON_PATHS.generic).map(d => new Path2D(d)));
    return PATH_CACHE.get(icon);
  }

  function iconSvg(type, color = '#c9d1d9') {
    const paths = ICON_PATHS[typeMeta(type).icon] || ICON_PATHS.generic;
    return `<svg viewBox="0 0 24 24" aria-hidden="true">${paths.map(d => `<path d="${d}" fill="none" stroke="${color}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>`).join('')}</svg>`;
  }

  function installShellOverrides() {
    if (document.getElementById('ge-shell-consistency')) return;
    const style = document.createElement('style');
    style.id = 'ge-shell-consistency';
    style.textContent = `
      .sidebar{width:252px!important;min-width:252px!important;padding:10px 8px!important;overflow-x:hidden!important}
      .status-legend{padding:7px!important;margin:3px 3px 8px!important}
      .status-legend-row{font-size:9px!important;margin:2px 0!important}
      .proj{position:relative!important;min-height:34px!important;padding:5px 6px!important;gap:6px!important;overflow:hidden!important}
      .proj .name{font-size:12px!important;line-height:1.2!important}
      .proj .acts{margin-left:auto!important;gap:3px!important;max-width:94px!important;flex:none!important}
      .proj:hover .acts,.proj.active .acts{display:flex!important}
      .mini{width:26px!important;height:26px!important;padding:0!important;display:inline-grid!important;place-items:center!important;border-radius:7px!important;font-size:0!important;flex:none!important}
      .mini svg{width:13px!important;height:13px!important;pointer-events:none!important}
      .ws-path{font-size:9px!important;padding-bottom:6px!important;white-space:nowrap!important;overflow:hidden!important;text-overflow:ellipsis!important}
    `;
    document.head.appendChild(style);
  }

  function compactActionIcon(label) {
    const key = String(label || '').toLowerCase();
    if (key.includes('atual')) return '<svg viewBox="0 0 24 24" fill="none"><path d="M20 12a8 8 0 1 1-2.3-5.7M20 5v5h-5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    if (key.includes('nome') || key.includes('otimiz')) return '<svg viewBox="0 0 24 24" fill="none"><path d="M12 3l1.8 4.2L18 9l-4.2 1.8L12 15l-1.8-4.2L6 9l4.2-1.8zM18.5 15.5l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>';
    if (key.includes('reag')) return '<svg viewBox="0 0 24 24" fill="none"><circle cx="7" cy="7" r="2" stroke="currentColor" stroke-width="1.8"/><circle cx="17" cy="7" r="2" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="17" r="2" stroke="currentColor" stroke-width="1.8"/><path d="M8.6 8.3l2.3 6M15.4 8.3l-2.3 6M9 7h6" stroke="currentColor" stroke-width="1.5"/></svg>';
    return '<svg viewBox="0 0 24 24" fill="none"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
  }

  function mount(container, data) {
    container.innerHTML = '';
    const root = document.createElement('div');
    root.className = 'json-graph-viewer';
    root.innerHTML = `
      <div class="jgv-toolbar">
        <div class="jgv-heading">
          <div class="jgv-title">${data.mode === 'communities' ? 'Grafo grande · visão por comunidades' : 'Grafo interativo'}</div>
          <div class="jgv-stats">${Number(data.stats?.nodes || 0).toLocaleString('pt-BR')} nós · ${Number(data.stats?.edges || 0).toLocaleString('pt-BR')} relações · ${Number(data.stats?.communities || 0).toLocaleString('pt-BR')} comunidades</div>
        </div>
        <input class="jgv-search" placeholder="buscar nó/comunidade...">
        <button class="jgv-btn jgv-physics active" type="button" title="Ligar/desligar física">Física: on</button>
        <button class="jgv-btn jgv-adjust" type="button" title="Ajustar visual">Ajustar</button>
        <button class="jgv-btn jgv-center" type="button">Centralizar</button>
      </div>
      <div class="jgv-controls hidden">
        <label><span>Tamanho dos nós</span><input class="jgv-node-size" type="range" min="0.55" max="1.8" value="1" step="0.05"><output>1.00×</output></label>
        <label><span>Distância</span><input class="jgv-spacing" type="range" min="0.65" max="2.0" value="1" step="0.05"><output>1.00×</output></label>
        <label><span>Força</span><input class="jgv-repulsion" type="range" min="0.55" max="1.8" value="1" step="0.05"><output>1.00×</output></label>
        <label class="jgv-check"><input class="jgv-labels" type="checkbox" checked><span>Etiquetas</span></label>
      </div>
      <canvas class="jgv-canvas"></canvas>
      <div class="jgv-tooltip hidden"></div>
      <div class="jgv-legend"></div>
      <div class="jgv-detail"><div class="jgv-muted">Arraste um nó para mover a rede. As conexões puxam os vizinhos como molas.</div></div>
      <div class="jgv-help">Arraste nó · arraste vazio = mover tela · scroll = zoom</div>
    `;
    container.appendChild(root);

    if (!document.getElementById('jgv-style')) {
      const style = document.createElement('style');
      style.id = 'jgv-style';
      style.textContent = `
        .json-graph-viewer{position:absolute;inset:0;background:radial-gradient(circle at 50% 45%,rgba(88,166,255,.035),transparent 38%),#080d14;overflow:hidden;color:#c9d1d9}
        .json-graph-viewer:before{content:"";position:absolute;inset:0;pointer-events:none;opacity:.22;background-image:linear-gradient(rgba(255,255,255,.014) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.014) 1px,transparent 1px);background-size:36px 36px}
        .jgv-toolbar{position:absolute;z-index:5;left:10px;right:10px;top:8px;height:48px;display:flex;align-items:center;gap:8px;padding:6px 8px;border:1px solid #26313d;border-radius:10px;background:#101720ed;box-shadow:0 10px 28px #0007;backdrop-filter:blur(10px)}
        .jgv-heading{display:flex;flex-direction:column;min-width:0}.jgv-title{font-size:12px;font-weight:750;color:#f0f6fc;white-space:nowrap}.jgv-stats{font-size:9px;color:#708093;white-space:nowrap;margin-top:2px}
        .jgv-search{margin-left:auto;width:210px;padding:6px 9px;font-size:10px;background:#0a1119;border:1px solid #2c3744;color:#dbe7f5;border-radius:7px}.jgv-search:focus{outline:none;border-color:#58a6ff}
        .jgv-btn{height:30px;background:#17212c;border:1px solid #303c49;color:#cbd6e2;border-radius:7px;padding:0 9px;font-size:10px;cursor:pointer}.jgv-btn:hover{border-color:#58a6ff;color:#fff}.jgv-btn.active{color:#7ee787;border-color:#2f7d46;background:#10231a}
        .jgv-controls{position:absolute;z-index:6;right:12px;top:64px;width:245px;padding:10px;border:1px solid #2a3542;border-radius:10px;background:#101720f3;box-shadow:0 14px 30px #0009;backdrop-filter:blur(10px)}
        .jgv-controls.hidden{display:none}.jgv-controls label{display:grid;grid-template-columns:92px 1fr 42px;align-items:center;gap:7px;margin:7px 0;font-size:9px;color:#8794a4}.jgv-controls input[type=range]{width:100%;accent-color:#58a6ff}.jgv-controls output{text-align:right;color:#c9d1d9;font-variant-numeric:tabular-nums}.jgv-controls .jgv-check{grid-template-columns:18px 1fr;margin-top:9px}.jgv-controls .jgv-check input{accent-color:#58a6ff}
        .jgv-canvas{position:absolute;inset:0;width:100%;height:100%;cursor:grab}.jgv-canvas.panning{cursor:grabbing}.jgv-canvas.node-drag{cursor:move}
        .jgv-tooltip{position:absolute;z-index:7;pointer-events:none;max-width:300px;padding:7px 9px;border:1px solid #344050;border-radius:8px;background:#0d1520f4;color:#dce6f2;box-shadow:0 8px 24px #0009;font-size:10px;line-height:1.35;backdrop-filter:blur(8px)}.jgv-tooltip.hidden{display:none}.jgv-tooltip-head{display:flex;align-items:center;gap:7px;font-weight:700;color:#fff}.jgv-tooltip-head svg{width:14px;height:14px;flex:none}.jgv-tooltip-meta{margin-top:3px;color:#7f8d9d}
        .jgv-legend{position:absolute;z-index:4;left:10px;top:66px;width:174px;max-height:245px;overflow:auto;padding:8px;border:1px solid #26313d;border-radius:9px;background:#101720de;color:#aeb9c7;font-size:9px;box-shadow:0 9px 24px #0006;backdrop-filter:blur(8px)}.jgv-legend-title{font-size:8px;letter-spacing:.08em;text-transform:uppercase;color:#66778a;margin-bottom:6px}.jgv-legend-row{display:flex;align-items:center;gap:6px;margin:4px 0}.jgv-legend-row svg{width:12px;height:12px;flex:none}.jgv-legend-count{margin-left:auto;color:#637183;font-variant-numeric:tabular-nums}
        .jgv-detail{position:absolute;z-index:4;right:10px;bottom:10px;width:300px;max-height:220px;overflow:auto;padding:10px;border:1px solid #26313d;border-radius:9px;background:#101720e8;font-size:10px;line-height:1.45;color:#c9d1d9;box-shadow:0 10px 26px #0007;backdrop-filter:blur(8px)}.jgv-detail-head{display:flex;align-items:center;gap:8px}.jgv-detail-head svg{width:18px;height:18px;flex:none}.jgv-detail strong{color:#f0f6fc}.jgv-muted{color:#7c8998}.jgv-chip{display:inline-block;margin:3px 3px 2px 0;padding:2px 6px;border-radius:999px;background:#1a2430;border:1px solid #2b3744;color:#8f9dae;font-size:9px}.jgv-sep{height:1px;background:#26313d;margin:8px 0}
        .jgv-help{position:absolute;z-index:4;left:50%;bottom:10px;transform:translateX(-50%);padding:5px 8px;border:1px solid #26313d;border-radius:7px;background:#101720d8;color:#6f7c8d;font-size:8px;pointer-events:none}
      `;
      document.head.appendChild(style);
    }

    const canvas = root.querySelector('.jgv-canvas');
    const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
    const detail = root.querySelector('.jgv-detail');
    const search = root.querySelector('.jgv-search');
    const centerBtn = root.querySelector('.jgv-center');
    const physicsBtn = root.querySelector('.jgv-physics');
    const adjustBtn = root.querySelector('.jgv-adjust');
    const controls = root.querySelector('.jgv-controls');
    const nodeSizeInput = root.querySelector('.jgv-node-size');
    const spacingInput = root.querySelector('.jgv-spacing');
    const repulsionInput = root.querySelector('.jgv-repulsion');
    const labelsInput = root.querySelector('.jgv-labels');
    const tooltip = root.querySelector('.jgv-tooltip');
    const legend = root.querySelector('.jgv-legend');

    const nodes = (data.nodes || []).map((n, i) => ({ ...n, x: 0, y: 0, vx: 0, vy: 0, fx: null, fy: null, _rank: i }));
    const nodeMap = new Map(nodes.map(n => [String(n.id), n]));
    const edges = (data.edges || []).filter(e => nodeMap.has(String(e.source)) && nodeMap.has(String(e.target))).map(e => ({ ...e, a: nodeMap.get(String(e.source)), b: nodeMap.get(String(e.target)) }));
    const physicsEdges = [...edges].sort((a,b) => Number(b.weight || 1) - Number(a.weight || 1)).slice(0, PHYSICS_EDGE_LIMIT);
    const adjacency = new Map(nodes.map(n => [String(n.id), new Set()]));
    for (const e of edges) { adjacency.get(String(e.source))?.add(String(e.target)); adjacency.get(String(e.target))?.add(String(e.source)); }

    const typeCounts = data.stats?.typeCounts || nodes.reduce((acc,n)=>{acc[n.type]=(acc[n.type]||0)+1;return acc;},{});
    const topLabels = new Set([...nodes].sort((a,b)=>Number(b.degree || b.size || 0)-Number(a.degree || a.size || 0)).slice(0, LABEL_NODE_LIMIT).map(n=>String(n.id)));

    let width = 1, height = 1, dpr = 1;
    let scale = 1, offsetX = 0, offsetY = 0;
    let query = '';
    let selected = null, hovered = null, dragNode = null;
    let panning = false, pointerStart = null, lastPointer = null;
    let physicsOn = true, labelsOn = true, nodeScale = 1, spacingScale = 1, repulsionScale = 1;
    let alpha = 1, raf = 0, destroyed = false;
    let lastFrame = performance.now();

    function initialLayout() {
      if (data.mode === 'communities') {
        const extent = clamp(250 + Math.sqrt(nodes.length) * 21, 340, 1150);
        nodes.forEach((n,i)=>{
          const rr = extent * Math.sqrt((i + .65) / Math.max(1,nodes.length));
          const angle = i * GOLDEN_ANGLE + (hash(n.id)%31)/50;
          n.x = Math.cos(angle) * rr; n.y = Math.sin(angle) * rr;
        });
        return;
      }
      const groups = new Map();
      for (const n of nodes) { const k=String(n.community ?? 'unclustered'); if(!groups.has(k)) groups.set(k,[]); groups.get(k).push(n); }
      const gs=[...groups.entries()].sort((a,b)=>b[1].length-a[1].length);
      const field = clamp(260 + Math.sqrt(nodes.length)*27, 360, 1950);
      gs.forEach(([key,list],gi)=>{
        const rr = gs.length > 1 ? field*Math.sqrt((gi+.55)/gs.length) : 0;
        const ga = gi*GOLDEN_ANGLE + (hash(key)%47)/80;
        const gx=Math.cos(ga)*rr, gy=Math.sin(ga)*rr;
        const local=clamp(42+Math.sqrt(list.length)*22,58,500)*spacingScale;
        list.forEach((n,i)=>{const nr=local*Math.sqrt((i+.6)/Math.max(1,list.length));const a=i*GOLDEN_ANGLE+(hash(n.id)%100)/100;n.x=gx+Math.cos(a)*nr;n.y=gy+Math.sin(a)*nr;});
      });
    }

    function nodeRadius(n) {
      if (data.mode === 'communities') return clamp(4.2 + Math.log2(2 + Number(n.size || 1)) * .85, 5, 12) * nodeScale;
      return clamp(2.2 + Math.log2(2 + Number(n.degree || 0)) * .32, 2.2, 5.4) * nodeScale;
    }
    function nodeColor(n) { return data.mode === 'communities' ? communityColor(n.community) : typeMeta(n.type).color; }
    function screen(n) { return { x:n.x*scale+offsetX, y:n.y*scale+offsetY }; }
    function graphPoint(sx,sy){return {x:(sx-offsetX)/scale,y:(sy-offsetY)/scale};}
    function matches(n){if(!query)return true;return `${n.label||''} ${n.sourceFile||''} ${n.communityLabel||''} ${typeMeta(n.type).label}`.toLowerCase().includes(query);}

    function fit() {
      if (!nodes.length) return;
      let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
      for(const n of nodes){minX=Math.min(minX,n.x);minY=Math.min(minY,n.y);maxX=Math.max(maxX,n.x);maxY=Math.max(maxY,n.y);}
      const gw=Math.max(220,maxX-minX),gh=Math.max(220,maxY-minY);
      scale=clamp(Math.min((width-110)/gw,(height-150)/gh),.045,1.65);
      offsetX=width/2-((minX+maxX)/2)*scale;offsetY=height/2-((minY+maxY)/2)*scale+24;
      draw();
    }

    function applyForces(dt) {
      if (!physicsOn || alpha < .003 || !nodes.length) return;
      const linkDistance=(data.mode==='communities'?78:58)*spacingScale;
      const spring=.012*alpha;
      for(const e of physicsEdges){
        const a=e.a,b=e.b; if(!a||!b)continue;
        const dx=b.x-a.x,dy=b.y-a.y; let d=Math.hypot(dx,dy)||.001;
        const desired=linkDistance*(1+Math.min(1.1,Math.log2(1+Number(e.weight||1))*.08));
        const f=(d-desired)*spring; const nx=dx/d,ny=dy/d;
        if(a.fx==null){a.vx+=nx*f;a.vy+=ny*f;} if(b.fx==null){b.vx-=nx*f;b.vy-=ny*f;}
      }

      const cellSize=clamp(linkDistance*1.25,42,180), grid=new Map();
      for(let i=0;i<nodes.length;i++){const n=nodes[i],cx=Math.floor(n.x/cellSize),cy=Math.floor(n.y/cellSize),k=`${cx},${cy}`;if(!grid.has(k))grid.set(k,[]);grid.get(k).push(i);}
      const repel=120*repulsionScale*alpha;
      for(let i=0;i<nodes.length;i++){
        const a=nodes[i],cx=Math.floor(a.x/cellSize),cy=Math.floor(a.y/cellSize);
        for(let ox=-1;ox<=1;ox++)for(let oy=-1;oy<=1;oy++){
          const bucket=grid.get(`${cx+ox},${cy+oy}`);if(!bucket)continue;
          for(const j of bucket){if(j<=i)continue;const b=nodes[j];let dx=b.x-a.x,dy=b.y-a.y,d2=dx*dx+dy*dy;if(d2<.01){dx=.1;dy=.1;d2=.02;}const d=Math.sqrt(d2),minSep=(nodeRadius(a)+nodeRadius(b))*3.4+7*spacingScale;let f=repel/Math.max(28,d2);if(d<minSep)f+=(minSep-d)*.045*alpha;const nx=dx/d,ny=dy/d;if(a.fx==null){a.vx-=nx*f;a.vy-=ny*f;}if(b.fx==null){b.vx+=nx*f;b.vy+=ny*f;}}
        }
      }
      const centerForce=.0012*alpha;
      for(const n of nodes){if(n.fx!=null){n.x=n.fx;n.y=n.fy;n.vx=n.vy=0;continue;}n.vx+=(-n.x)*centerForce;n.vy+=(-n.y)*centerForce;const damping=Math.pow(.84,dt/16.67);n.vx*=damping;n.vy*=damping;n.x+=n.vx*(dt/16.67);n.y+=n.vy*(dt/16.67);}
      alpha*=Math.pow(.992,dt/16.67);
    }

    function drawIcon(n,p,r){
      if (r < 4.8 && n!==hovered && n!==selected) return;
      ctx.save();ctx.translate(p.x,p.y);const s=clamp(r/13,.26,.62);ctx.scale(s,s);ctx.translate(-12,-12);ctx.strokeStyle='#081018';ctx.lineWidth=2.35/s;ctx.lineCap='round';ctx.lineJoin='round';for(const path of iconPaths(n.type))ctx.stroke(path);ctx.restore();
    }

    function drawLabel(n,p,r,force=false){
      if(!labelsOn)return;
      const should=force || n===hovered || n===selected || (topLabels.has(String(n.id)) && scale>.45) || (data.mode==='communities' && Number(n.size||0)>100 && scale>.2);
      if(!should)return;
      const text=String(n.label||n.id);ctx.font=`${n===selected?'600 ':' '}10px -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif`;const tw=Math.min(240,ctx.measureText(text).width+10);const x=p.x+r+5,y=p.y-8;ctx.fillStyle='#08111bdc';ctx.fillRect(x-3,y-2,tw,16);ctx.fillStyle=n===selected?'#fff':'#c8d3df';ctx.fillText(text,x,y+10,tw-6);
    }

    function draw(){
      ctx.setTransform(dpr,0,0,dpr,0,0);ctx.fillStyle='#080d14';ctx.fillRect(0,0,width,height);
      const focusIds=selected?adjacency.get(String(selected.id)):null;
      const edgeLimit=scale<.22?Math.min(edges.length,12000):edges.length;
      for(let i=0;i<edgeLimit;i++){
        const e=edges[i],a=e.a,b=e.b;if(!a||!b)continue;const pa=screen(a),pb=screen(b);const active=selected&&(selected===a||selected===b);const dimmed=selected&&!active;
        ctx.globalAlpha=query&&(!matches(a)&&!matches(b))?.05:(dimmed?.08:1);ctx.strokeStyle=active?'#8bc4ff':'#6f8298';ctx.lineWidth=active?1.35:clamp(.28+Math.log2(1+Number(e.weight||1))*.08,.3,.8);ctx.beginPath();ctx.moveTo(pa.x,pa.y);ctx.lineTo(pb.x,pb.y);ctx.stroke();
      }
      ctx.globalAlpha=1;
      for(const n of nodes){
        const p=screen(n),r=nodeRadius(n)*clamp(scale,.62,1.45),hit=matches(n),neighbor=!selected||selected===n||focusIds?.has(String(n.id));ctx.globalAlpha=query&&!hit?.09:(selected&&!neighbor?.14:1);const color=nodeColor(n);ctx.fillStyle=color;ctx.beginPath();ctx.arc(p.x,p.y,r,0,Math.PI*2);ctx.fill();
        if(n===selected||n===hovered||query&&hit){ctx.strokeStyle=n===selected?'#ffffff':n===hovered?'#b7d7ff':'#f6c453';ctx.lineWidth=n===selected?2:1.4;ctx.stroke();}
        drawIcon(n,p,r);drawLabel(n,p,r);
      }
      ctx.globalAlpha=1;
    }

    function tick(now){
      if(destroyed)return;const dt=clamp(now-lastFrame,8,34);lastFrame=now;applyForces(dt);draw();raf=requestAnimationFrame(tick);
    }

    function pick(x,y){let best=null,bestD=22;for(const n of nodes){const p=screen(n),d=Math.hypot(p.x-x,p.y-y),r=nodeRadius(n)*clamp(scale,.62,1.45);if(d<Math.max(bestD,r+6)){best=n;bestD=d;}}return best;}
    function showTooltip(n,x,y){hovered=n;if(!n){tooltip.classList.add('hidden');draw();return;}const meta=typeMeta(n.type),count=data.mode==='communities'?`${Number(n.count||n.size||0).toLocaleString('pt-BR')} nós`:`${Number(n.degree||0)} conexões`;tooltip.innerHTML=`<div class="jgv-tooltip-head">${iconSvg(n.type,meta.color)}<span>${escapeHtml(n.label)}</span></div><div class="jgv-tooltip-meta">${escapeHtml(meta.label)} · ${count}</div>`;tooltip.style.left=`${Math.min(width-310,x+12)}px`;tooltip.style.top=`${Math.max(62,Math.min(height-90,y+12))}px`;tooltip.classList.remove('hidden');draw();}
    function showDetail(n){selected=n;if(!n){detail.innerHTML='<div class="jgv-muted">Arraste um nó para mover a rede. Clique para destacar conexões.</div>';draw();return;}const meta=typeMeta(n.type),neighbors=adjacency.get(String(n.id))?.size||0,samples=Array.isArray(n.samples)?n.samples.map(s=>`<span class="jgv-chip">${escapeHtml(s)}</span>`).join(''):'';detail.innerHTML=`<div class="jgv-detail-head">${iconSvg(n.type,meta.color)}<div><strong>${escapeHtml(n.label)}</strong><div class="jgv-muted">${escapeHtml(meta.label)}</div></div></div><div class="jgv-sep"></div>${data.mode==='communities'?`${Number(n.count||n.size||0).toLocaleString('pt-BR')} nós na comunidade`:`${neighbors} conexões diretas`}${n.communityLabel&&data.mode!=='communities'?`<br>Comunidade: ${escapeHtml(n.communityLabel)}`:''}${n.sourceFile?`<br>Arquivo: ${escapeHtml(n.sourceFile)}`:''}${samples?`<div style="margin-top:7px">${samples}</div>`:''}`;draw();}

    function renderLegend(){const entries=Object.entries(typeCounts).filter(([,count])=>Number(count)>0).sort((a,b)=>Number(b[1])-Number(a[1]));legend.innerHTML='<div class="jgv-legend-title">Tipos detectados</div>'+entries.map(([type,count])=>{const m=typeMeta(type);return `<div class="jgv-legend-row">${iconSvg(type,m.color)}<span>${escapeHtml(m.label)}</span><span class="jgv-legend-count">${Number(count).toLocaleString('pt-BR')}</span></div>`;}).join('');}

    function resize(){const rect=root.getBoundingClientRect();width=Math.max(1,rect.width);height=Math.max(1,rect.height);dpr=Math.min(2,window.devicePixelRatio||1);canvas.width=Math.floor(width*dpr);canvas.height=Math.floor(height*dpr);canvas.style.width=`${width}px`;canvas.style.height=`${height}px`;draw();}
    function reheat(amount=.55){alpha=Math.max(alpha,amount);}
    function updateControl(input){const out=input.parentElement.querySelector('output');if(out)out.value=`${Number(input.value).toFixed(2)}×`;}

    canvas.addEventListener('wheel',e=>{e.preventDefault();const before=graphPoint(e.offsetX,e.offsetY),factor=e.deltaY<0?1.12:.89;scale=clamp(scale*factor,.035,5);offsetX=e.offsetX-before.x*scale;offsetY=e.offsetY-before.y*scale;draw();},{passive:false});
    canvas.addEventListener('pointerdown',e=>{pointerStart={x:e.clientX,y:e.clientY};lastPointer={x:e.clientX,y:e.clientY};const n=pick(e.offsetX,e.offsetY);if(n){dragNode=n;const gp=graphPoint(e.offsetX,e.offsetY);n.fx=gp.x;n.fy=gp.y;reheat(.9);canvas.classList.add('node-drag');}else{panning=true;canvas.classList.add('panning');}canvas.setPointerCapture(e.pointerId);});
    canvas.addEventListener('pointermove',e=>{const n=pick(e.offsetX,e.offsetY);if(dragNode){const gp=graphPoint(e.offsetX,e.offsetY);dragNode.fx=gp.x;dragNode.fy=gp.y;dragNode.x=gp.x;dragNode.y=gp.y;reheat(.85);showTooltip(dragNode,e.offsetX,e.offsetY);return;}if(panning){offsetX+=e.clientX-lastPointer.x;offsetY+=e.clientY-lastPointer.y;lastPointer={x:e.clientX,y:e.clientY};draw();return;}showTooltip(n,e.offsetX,e.offsetY);});
    canvas.addEventListener('pointerup',e=>{const moved=pointerStart?Math.hypot(e.clientX-pointerStart.x,e.clientY-pointerStart.y):99;if(dragNode){const released=dragNode;released.fx=null;released.fy=null;dragNode=null;reheat(.72);canvas.classList.remove('node-drag');if(moved<4)showDetail(released);}else if(panning){panning=false;canvas.classList.remove('panning');if(moved<4)showDetail(pick(e.offsetX,e.offsetY));}pointerStart=null;});
    canvas.addEventListener('pointerleave',()=>{if(!dragNode&&!panning)showTooltip(null,0,0);});
    search.addEventListener('input',()=>{query=search.value.trim().toLowerCase();draw();});
    centerBtn.addEventListener('click',fit);
    physicsBtn.addEventListener('click',()=>{physicsOn=!physicsOn;physicsBtn.textContent=`Física: ${physicsOn?'on':'off'}`;physicsBtn.classList.toggle('active',physicsOn);if(physicsOn)reheat(.9);});
    adjustBtn.addEventListener('click',()=>controls.classList.toggle('hidden'));
    nodeSizeInput.addEventListener('input',()=>{nodeScale=Number(nodeSizeInput.value);updateControl(nodeSizeInput);reheat(.35);draw();});
    spacingInput.addEventListener('input',()=>{spacingScale=Number(spacingInput.value);updateControl(spacingInput);reheat(.95);});
    repulsionInput.addEventListener('input',()=>{repulsionScale=Number(repulsionInput.value);updateControl(repulsionInput);reheat(.85);});
    labelsInput.addEventListener('change',()=>{labelsOn=labelsInput.checked;draw();});

    renderLegend();initialLayout();const ro=new ResizeObserver(()=>resize());ro.observe(root);resize();requestAnimationFrame(()=>{fit();reheat(1);});raf=requestAnimationFrame(tick);

    return { destroy(){destroyed=true;cancelAnimationFrame(raf);ro.disconnect();} };
  }

  installShellOverrides();
  window.GraphJsonViewer = { mount };

  window.addEventListener('load', () => {
    const legacyOpenGraph = window.openGraph;
    if (typeof legacyOpenGraph === 'function' && typeof window.openJsonGraph === 'function') {
      window.openGraph = function unifiedOpenGraph(project) {
        if (project && project.hasGraphJson) return window.openJsonGraph(project);
        return legacyOpenGraph(project);
      };
    }

    if (typeof window.mini === 'function') {
      window.mini = function compactMini(label, fn) {
        const b = document.createElement('button');
        b.className = 'mini';
        b.innerHTML = compactActionIcon(label);
        b.title = label;
        b.setAttribute('aria-label', label);
        b.onclick = e => { e.stopPropagation(); fn(); };
        return b;
      };
    }
  }, { once: true });
})();
