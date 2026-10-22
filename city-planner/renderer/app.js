'use strict';
const $ = id => document.getElementById(id);
const settings = ['elevation', 'flatness', 'sea', 'roughness', 'moisture', 'riverDensity', 'riverWidth', 'lakeCount', 'lakeSize', 'delta'];
const units = { riverWidth: 'm', lakeCount: '座', lakeSize: 'km' };
const presets = {
  island: { name: '翡翠海岛', elevation: 65, sea: 42, roughness: 55, moisture: 65 },
  bay: { name: '碧水海湾', elevation: 70, sea: 42, roughness: 58, moisture: 72 },
  mountains: { name: '苍翠山脉', elevation: 90, sea: 30, roughness: 80, moisture: 52 },
  archipelago: { name: '星罗群岛', elevation: 70, sea: 43, roughness: 62, moisture: 78 },
  desert: { name: '无垠沙海', elevation: 48, sea: 22, roughness: 42, moisture: 10 },
  hills: { name: '青野丘陵', elevation: 45, sea: 39, roughness: 35, moisture: 80 },
  tundra: { name: '寂静冻原', elevation: 62, sea: 44, roughness: 65, moisture: 32 }
};
for (const [key, preset] of Object.entries(presets)) Object.assign(preset, { flatness: 0, riverDensity: key === 'desert' ? 0 : key === 'bay' ? 70 : 55, riverWidth: 90, lakeCount: key === 'desert' ? 1 : 3, lakeSize: 2, delta: 65 });
let selected = 'bay', view = 'vector', contour = false, grid = false;
let terrain = null, heightData = null, wetData = null, waterData = null, sedimentData = null, busy = false, generation = 0;
let seaLevelMeters = 0;
let vectorLayers = null, oceanMask = null, lakeMask = null, measuring = false, measurePoints = [], measureHover = null;
let zoom = 1, panX = 0, panY = 0, drag = null, debounce, lastViewport=null;
let toastTimer, requestVersion = 0, queued = false;
let terrainDirty = true;
const terrainStateChanged = () => window.dispatchEvent(new CustomEvent('terrain-state'));
const map = $('map'), ctx = map.getContext('2d');
const source = document.createElement('canvas'), sourceCtx = source.getContext('2d');

function toast(text) {
  $('toast').textContent = text;
  $('toast').classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $('toast').classList.remove('visible'), 3000);
}
function config() {
  return { preset: selected, bayStyle: 'random', seed: $('seed').value.trim() || 'SHANHAI-2026', resolution: Number($('resolution').value), widthKm: Number($('widthKm').value), heightKm: Number($('heightKm').value), ...Object.fromEntries(settings.map(key => [key, Number($(key).value)])) };
}
function updateRanges() {
  for (const key of settings) {
    const el = $(key), value = Number(el.value);
    $(key + '-value').innerHTML = `${value}<span>${units[key] || '%'}</span>`;
    const percent = (value - Number(el.min)) / (Number(el.max) - Number(el.min)) * 100;
    el.style.background = `linear-gradient(to right,var(--ui-blue,#63815a) ${percent}%,#d9e8fc ${percent}%)`;
  }
}
function persist() {
  try { localStorage.setItem('shanhai-settings-v1', JSON.stringify(config())); } catch { /* Optional local preference storage. */ }
}
function restore() {
  try {
    const saved = JSON.parse(localStorage.getItem('shanhai-settings-v1'));
    if (saved && presets[saved.preset]) {
      selected = saved.preset;
      for (const key of settings) $(key).value = Number.isFinite(saved[key]) ? saved[key] : presets[selected][key];
      for (const key of ['widthKm', 'heightKm']) if (Number.isFinite(saved[key])) $(key).value = saved[key];
      if ([768, 1024, 1536, 2048, 4096].includes(saved.resolution)) $('resolution').value = saved.resolution;
      if (typeof saved.seed === 'string') $('seed').value = saved.seed.slice(0, 80);
    }
  } catch { /* Ignore corrupted saved preferences. */ }
  updatePresetButtons(); updateRanges();
}
function updatePresetButtons() {
  const deposits = selected === 'bay';
  $('delta').disabled = !deposits;
  $('delta-control').classList.toggle('disabled', !deposits);
  document.querySelectorAll('[data-preset]').forEach(button => {
    const active = button.dataset.preset === selected;
    button.classList.toggle('selected', active); button.setAttribute('aria-pressed', String(active));
  });
}
function selectPreset(preset) {
  selected = preset;
  for (const key of settings) $(key).value = presets[preset][key];
  updateRanges(); updatePresetButtons(); scheduleGenerate();
}
function scheduleGenerate() {
  if (document.body.dataset.screen !== 'terrain' || window.CityApp?.working) return;
  clearTimeout(debounce);
  // Invalidate a response immediately when its input controls become stale.
  requestVersion++;
  terrainDirty = true; terrainStateChanged();
  debounce = setTimeout(generate, 320);
}
function decode(base64) {
  const binary = atob(base64), bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
async function generate() {
  if (document.body.dataset.screen !== 'terrain' || window.CityApp?.active) return;
  clearTimeout(debounce);
  terrainDirty = true; terrainStateChanged();
  for (const key of ['widthKm', 'heightKm']) {
    if (!$(key).value || !$(key).reportValidity()) {
      queued=false; $('loading').hidden=true;
      $('generate').querySelector('span').textContent='生成地形';
      $('footer-status').textContent='请填写 1–1000 km 的地图宽度与高度';
      return;
    }
  }
  if (busy) { queued = true; return; }
  const version = ++requestVersion, options = config();
  busy = true;
  $('loading').hidden = false; $('map-error').hidden = true;
  $('export').disabled = true;
  $('generate').querySelector('span').textContent = '正在生成…';
  $('footer-status').textContent = 'PYTHON ENGINE · GENERATING';
  persist();
  try {
    const result = window.terrainAPI ? await window.terrainAPI.generate(options) : await fetch('/api/generate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(options)
    }).then(async response => {
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || '无法连接地形引擎');
      return result;
    });
    if (version !== requestVersion || window.CityApp?.active) return;
    installTerrain(result);
  } catch (error) {
    if (version !== requestVersion) return;
    $('error-message').textContent = error.message;
    $('map-error').hidden = false;
    $('footer-status').textContent = 'ENGINE ERROR · 点击重新尝试';
  } finally {
    busy = false;
    if (queued) { queued = false; generate(); }
    else if (version === requestVersion) { $('loading').hidden = true;
      $('export').disabled = !terrain || !$('map-error').hidden;
      $('generate').querySelector('span').textContent = '生成地形';
    }
    terrainStateChanged();
  }
}
function installTerrain(result) {
    terrain = result;
    terrainDirty = false;
    $('terrain-empty').hidden = true;
    const heights = TerrainHeights.decode(result);
    heightData = heights.elevation;
    seaLevelMeters = heights.sea;
    wetData = decode(result.moisture);
    waterData = heights.water;
    sedimentData = result.sediment ? decode(result.sediment) : new Uint8Array(result.width * result.height);
    oceanMask = MapGeometry.unpackMask(decode(result.waterBodies.ocean),heightData.length);
    lakeMask = MapGeometry.unpackMask(decode(result.waterBodies.lakes),heightData.length);
    vectorLayers = buildVectorLayers();
    measurePoints = []; measureHover = null;
    updateMeasureHint();
    generation++;
    renderTerrain(); fit();
    $('map-name').textContent = presets[result.config.preset]?.name || '自定义地形';
    $('map-number').textContent = `NO. ${String(generation).padStart(3, '0')}`;
    $('stat-size').innerHTML = `${result.config.widthKm} × ${result.config.heightKm}<small> km</small>`;
    $('stat-size').title = `输出精度：${result.width} × ${result.height} px · 每像素约 ${(result.config.widthKm * 1000 / result.width).toFixed(2)} m`;
    $('hydrology-stats').textContent = `${result.stats.riverCount} 段河道 · ${result.stats.lakeCount} 座湖泊（${result.stats.lakeOutletCount || 0} 座有出口）`;
    $('stat-altitude').innerHTML = `${result.stats.maxElevation.toLocaleString()}<small> m</small>`;
    $('stat-land').innerHTML = `${result.stats.landPercent}<small> %</small>`;
    $('stat-time').innerHTML = `${(result.stats.generationMs / 1000).toFixed(2)}<small> s</small>`;
    $('footer-status').textContent = `SEED ${result.config.seed} · PYTHON + ELECTRON`;
    window.dispatchEvent(new CustomEvent('terrain-ready'));
}

function installCityTerrain(result) {
  // A saved city owns its terrain even if the initial world request is still
  // running. Invalidate both its response and any debounced/queued generation.
  requestVersion++;
  queued=false;
  clearTimeout(debounce);
  $('loading').hidden=true;
  $('map-error').hidden=true;
  $('generate').querySelector('span').textContent='生成地形';
  installTerrain(result);
  $('export').disabled=false;
}

const palettes = {
  natural: [[0,[163,184,135]],[.065,[142,168,110]],[.22,[105,143,79]],[.44,[85,119,69]],[.61,[116,133,94]],[.75,[153,156,132]],[.86,[183,187,170]],[1,[236,240,226]]],
  desert: [[0,[221,212,166]],[.2,[219,193,133]],[.4,[210,173,109]],[.64,[195,155,100]],[.85,[177,140,102]],[1,[230,215,178]]],
  tundra: [[0,[169,181,149]],[.15,[147,165,139]],[.35,[136,155,141]],[.5,[177,188,175]],[.7,[215,224,216]],[1,[244,247,238]]],
  height: [[0,[82,126,114]],[.15,[134,167,115]],[.35,[180,192,124]],[.55,[217,198,129]],[.75,[193,150,112]],[1,[245,239,218]]]
};
function gradient(stops, value) {
  value = Math.max(0, Math.min(1, value));
  for (let i = 1; i < stops.length; i++) {
    if (value <= stops[i][0]) {
      const t = (value - stops[i - 1][0]) / (stops[i][0] - stops[i - 1][0]);
      return stops[i][1].map((c, channel) => stops[i - 1][1][channel] * (1 - t) + c * t);
    }
  }
  return stops[stops.length - 1][1];
}
function renderTerrain() {
  if (!terrain) return;
  const { width: w, height: h, config: cfg } = terrain;
  source.width = w; source.height = h;
  if (view === 'vector') { updateLegend(); draw(); return; }
  const image = sourceCtx.createImageData(w, h), pixels = image.data;
  const sea = seaLevelMeters;
  const slopeX = 1 / (2 * cfg.widthKm * 1000 / w);
  const slopeY = 1 / (2 * cfg.heightKm * 1000 / h);
  const palette = view === 'height' ? palettes.height : cfg.preset === 'desert' ? palettes.desert : cfg.preset === 'tundra' ? palettes.tundra : palettes.natural;
  // Keep the existing range for low-relief maps; extend it through tall peaks.
  // Stats round down to whole metres, so include that final metre of relief.
  const maxHeight = sea + Math.max(3000, terrain.stats.maxElevation + 1);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x, actualHeight = heightData[i];
      const localWater = waterData[i];
      // River water is rendered from continuous geometry below, never baked
      // into the texture. Restore a bank-coloured underlay to remove blue pixels.
      const v = !oceanMask[i] && localWater > actualHeight
        ? Math.max(actualHeight,localWater+1.8,sea+.072) : actualHeight;
      const dx = (heightData[y * w + Math.min(w - 1, x + 1)] - heightData[y * w + Math.max(0, x - 1)]);
      const dy = (heightData[Math.min(h - 1, y + 1) * w + x] - heightData[Math.max(0, y - 1) * w + x]);
      let color, shade = 1;
      const grain = (((x * 374761393 + y * 668265263) ^ (x * y * 1274126177)) >>> 0) % 100 / 100 - .5;
      const waterLevel = Math.max(sea, localWater);
      if (oceanMask[i]) {
        const depth = localWater > sea && v > sea ? Math.min(.55, .18 + (waterLevel - v) / 900) : Math.min(1, (sea - v) / 1944);
        color = gradient([[0,[164,204,179]],[.13,[121,178,163]],[.4,[83,144,147]],[1,[51,103,119]]], depth);
        if (lakeMask[i]) {
          const riverDepth = Math.min(1, Math.max(0, (waterLevel - v) / 8));
          color = gradient([[0,[122,170,151]],[.25,[80,147,150]],[.7,[56,126,137]],[1,[41,107,125]]], riverDepth);
        } else if (view === 'terrain' && sedimentData[i] > 0) {
          const marsh = sedimentData[i] / 255 * Math.max(0, 1 - (sea - v) / 64.8);
          color = color.map((c, channel) => c * (1 - marsh * .7) + [91,135,119][channel] * marsh * .7);
        }
        shade = 1 + grain * .018;
      } else {
        const altitude = Math.min(1, (v - sea) / (maxHeight - sea));
        color = gradient(palette, altitude);
        if (view === 'terrain' && cfg.preset !== 'desert' && cfg.preset !== 'tundra') {
          const dryness = Math.max(0, .54 - wetData[i] / 255) * (1 - altitude) * .6;
          color = color.map((c, channel) => c * (1 - dryness) + [193,178,117][channel] * dryness);
        }
        if (view === 'terrain' && sedimentData[i] > 0) {
          const alluvial = gradient([[0,[107,130,89]],[.25,[111,142,87]],[.65,[139,158,101]],[1,[153,167,113]]], Math.min(1, (v - sea) / 28.8));
          const blend = sedimentData[i] / 255;
          color = color.map((c, channel) => c * (1 - blend) + alluvial[channel] * blend);
        }
        // Physical slopes with modest relief exaggeration; map extent and
        // output resolution must not turn gentle banks into visual cliffs.
        const nx = -dx * slopeX * 2.5, ny = -dy * slopeY * 2.5;
        const light = Math.max(-.5, (-.52 * nx - .62 * ny + .59) / Math.sqrt(nx * nx + ny * ny + 1));
        shade = view === 'height' ? .93 + light * .12 : .76 + light * .39 + grain * .035;
        if ((v - sea) < 1.2 && view === 'terrain') {
          const sand = 1 - sedimentData[i] / 255;
          color = color.map((c, channel) => c * (1 - sand) + [210,215,167][channel] * sand);
          shade = shade * (1 - sand) + .99 * sand;
        }
      }
      pixels[i * 4] = Math.min(255, color[0] * shade);
      pixels[i * 4 + 1] = Math.min(255, color[1] * shade);
      pixels[i * 4 + 2] = Math.min(255, color[2] * shade);
      pixels[i * 4 + 3] = 255;
    }
  }
  sourceCtx.putImageData(image, 0, 0);
  updateLegend(); draw();
}
function updateLegend() {
  const entries = window.CityScene?.effectiveQuality==='map' ? [[window.CityMapRenderer.palette.water,'水域'],[window.CityMapRenderer.palette.land,'陆地'],[window.CityMapRenderer.palette.park,'公园绿地']] : view === 'vector' ? [['#91bec6','海洋'],['#65a1af','河湖'],['#e7eddb','陆地'],['#abc0a1','高地'],['#819a77',`等高线 · ${vectorLayers?.interval || 0} m`]] : view === 'height' ? [['#386874','海洋'],['#528e72','低地'],['#b4c07c','中地'],['#d9c681','高地'],['#c19670','山地'],['#f5efda','高峰']] :
    [['#386874','深海'],['#8ebeb0','浅海'],['#d7d2a2','沙滩'],[terrain?.config.preset === 'desert' ? '#d2ad6d' : '#678452',terrain?.config.preset === 'desert' ? '沙丘' : '植被'],['#a8a58c','山岩'],['#93cbd0','河湖']];
  $('legend').replaceChildren();
  const title = document.createElement('span'); title.className = 'legend-title'; title.textContent = view === 'height' ? '相对高程' : '地貌图例'; $('legend').append(title);
  entries.forEach(([color, label]) => { const item = document.createElement('span'), swatch = document.createElement('i'); swatch.className = 'swatch'; swatch.style.backgroundColor = color; item.append(swatch, document.createTextNode(label)); $('legend').append(item); });
}
function vectorPaths(rings, width, height) {
  const fill = new Path2D(), stroke = new Path2D();
  MapGeometry.traceContours(rings,width,height,fill,stroke);
  return { fill, stroke };
}
function riverPath(channel, width, height) {
  const {left,right,points,radii} = MapGeometry.riverBanks(channel,width,height), path = new Path2D();
  if (points.length < 2) return path;
  function edge(vertices) {
    for (let i = 1; i < vertices.length-1; i++) {
      const p = vertices[i], q = vertices[i+1];
      path.quadraticCurveTo(p[0],p[1],(p[0]+q[0])/2,(p[1]+q[1])/2);
    }
    path.lineTo(...vertices[vertices.length-1]);
  }
  path.moveTo(...left[0]); edge(left);
  const last = points.length-1, end = points[last];
  const endAngle = Math.atan2(left[last][1]-end[1],left[last][0]-end[0]);
  path.arc(...end,radii[last],endAngle,endAngle-Math.PI,true);
  edge([...right].reverse());
  const start = points[0], startAngle = Math.atan2(right[0][1]-start[1],right[0][0]-start[0]);
  path.arc(...start,radii[0],startAngle,startAngle-Math.PI,true); path.closePath();
  return path;
}
function buildVectorLayers() {
  const { width, height } = terrain, sea = seaLevelMeters;
  const signed = new Float32Array(heightData.length);
  for (let i = 0; i < signed.length; i++) signed[i] = oceanMask[i] ? 1 : -1;
  const oceanPaths = vectorPaths(MapGeometry.contours(signed,width,height),width,height);
  const ocean = oceanPaths.fill;
  for (let i = 0; i < signed.length; i++) signed[i] = lakeMask[i] ? 1 : -1;
  const lakePaths = vectorPaths(MapGeometry.contours(signed,width,height),width,height);
  const lakes = lakePaths.fill;
  const rivers = terrain.channels.map(channel => riverPath(channel,width,height));
  const water = new Path2D(); water.addPath(ocean); water.addPath(lakes);
  const waterStroke = new Path2D(); waterStroke.addPath(oceanPaths.stroke); waterStroke.addPath(lakePaths.stroke);
  const interval = Math.max(5,MapGeometry.niceFloor(terrain.stats.maxElevation/7));
  const levels = [], step = Math.max(1,Math.ceil(Math.max(width,height)/1024));
  for (let meters = interval; meters < terrain.stats.maxElevation; meters += interval) {
    const level = sea + meters;
    const paths = vectorPaths(MapGeometry.contours(heightData,width,height,level,step),width,height);
    levels.push({ meters, path: paths.fill, stroke: paths.stroke });
  }
  const land = new Path2D(); land.rect(0,0,width,height); land.addPath(water);
  const riverClip = new Path2D(); riverClip.rect(0,0,width,height); riverClip.addPath(ocean);
  return { ocean, water, waterStroke, lakes, rivers, riverClip, land, levels, interval };
}
function paintMap(context, g, phase='all') {
  if(phase==='overlay'){window.CityApp?.paint(context,g,phase);return;}
  const scale=Math.min(terrain.width*g.scale/terrain.grid.widthMeters,terrain.height*g.scale/terrain.grid.heightMeters);
  const quality=window.CityScene?.resolveQuality(zoom)||'map',flat=quality==='map';
  syncDisplayControls(quality);
  context.save();
  context.translate(g.left,g.top); context.scale(g.scale,g.scale);
  context.beginPath(); context.rect(0,0,source.width,source.height); context.clip();
  if (view === 'vector') {
    context.fillStyle = flat?window.CityMapRenderer.palette.land:'#e7eddb'; context.fillRect(0,0,source.width,source.height);
    for (const level of flat?[]:vectorLayers.levels) {
      context.fillStyle = flat?'#a9cba20b':'#63875713'; context.fill(level.path,'evenodd');
    }
    context.fillStyle = flat?window.CityMapRenderer.palette.water:'#91bec6'; context.fill(vectorLayers.ocean,'evenodd');
  } else {
    context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high';
    context.drawImage(source,0,0);
  }
  if(!flat&&view!=='height')window.CityScene?.ground(context,g,terrain,vectorLayers);
  if (!flat && (view === 'height' || contour)) {
    context.save(); context.clip(vectorLayers.land,'evenodd');
    context.strokeStyle = view === 'vector' ? '#70856570' : '#42583b66';
    context.lineWidth = .65/g.scale;
    for (const level of vectorLayers.levels) context.stroke(level.stroke);
    context.restore();
  }
  // One smooth ribbon per shared reach. A receiving-sea clip prevents coloured
  // channel extensions floating beyond their mouths.
  context.save(); context.clip(vectorLayers.riverClip,'evenodd');
  context.fillStyle = flat?window.CityMapRenderer.palette.water:view === 'vector' ? '#65a1af' : '#4b929e';
  for (const river of vectorLayers.rivers) context.fill(river);
  context.restore();
  context.fillStyle = flat?window.CityMapRenderer.palette.water:view === 'vector' ? '#65a1af' : '#4b929e';
  context.fill(vectorLayers.lakes,'evenodd');
  if(!flat&&view!=='height')window.CityScene?.water(context,terrain,vectorLayers);
  context.strokeStyle = flat?window.CityMapRenderer.palette.shore:view === 'vector' ? '#426f765e' : '#375e5838';
  context.lineWidth = .6/g.scale; context.stroke(vectorLayers.waterStroke);
  if (grid) {
    context.strokeStyle = view === 'vector' ? '#617b6b55' : '#eef5de65';
    context.lineWidth = .7/g.scale; context.setLineDash([3/g.scale,4/g.scale]);
    for (let i = 1; i < 10; i++) {
      context.beginPath(); context.moveTo(source.width*i/10,0); context.lineTo(source.width*i/10,source.height);
      context.moveTo(0,source.height*i/10); context.lineTo(source.width,source.height*i/10); context.stroke();
    }
  }
  context.restore();
  window.CityApp?.paint(context, g, phase);
}
function updateMeasureHint() {
  $('measure-hint').hidden = !measuring;
  $('measure-hint').textContent = measurePoints.length === 2
    ? `${MapGeometry.formatDistance(MapGeometry.distance(...measurePoints,terrain.config.widthKm*1000,terrain.config.heightKm*1000))} · 点击重新测量 · Esc 退出`
    : measurePoints.length ? '点击终点完成测距 · Esc 退出' : '点击地图上的起点和终点 · Esc 退出';
}
function paintMeasurement(context, g) {
  const points = measurePoints.length === 1 && measureHover ? [measurePoints[0],measureHover] : measurePoints;
  if (!measuring || !points.length) return;
  const screen = points.map(([x,y]) => [g.left+x*source.width*g.scale,g.top+y*source.height*g.scale]);
  context.save(); context.lineWidth = 2; context.strokeStyle = '#b45735'; context.fillStyle = '#fffdf5';
  if (screen.length === 2) {
    context.setLineDash([6,4]); context.beginPath(); context.moveTo(...screen[0]); context.lineTo(...screen[1]); context.stroke(); context.setLineDash([]);
    const text = MapGeometry.formatDistance(MapGeometry.distance(...points,terrain.config.widthKm*1000,terrain.config.heightKm*1000));
    context.font = '12px sans-serif';
    const width = context.measureText(text).width+20;
    const x = Math.max(width/2+4,Math.min(g.width-width/2-4,(screen[0][0]+screen[1][0])/2));
    const y = Math.max(30,Math.min(g.height-12,(screen[0][1]+screen[1][1])/2-12));
    context.fillRect(x-width/2,y-19,width,26); context.fillStyle = '#884126'; context.textAlign = 'center'; context.fillText(text,x,y-2);
  }
  context.fillStyle = '#fffdf5';
  for (const [x,y] of screen) { context.beginPath(); context.arc(x,y,4,0,Math.PI*2); context.fill(); context.stroke(); }
  context.restore();
}
function currentScale(g, pixels = 140) {
  return MapGeometry.scaleBar(terrain.config.widthKm*1000/(source.width*g.scale),pixels);
}
function geometry() {
  const width = map.clientWidth, height = map.clientHeight;
  const scale = terrain ? Math.max(width / source.width, height / source.height) * zoom : 1;
  return { width, height, scale, left: (width - source.width * scale) / 2 + panX, top: (height - source.height * scale) / 2 + panY };
}
function clampPan() {
  if (!terrain) return;
  const g = geometry();
  const maxX = Math.max(0, (source.width * g.scale - g.width) / 2), maxY = Math.max(0, (source.height * g.scale - g.height) / 2);
  panX = Math.max(-maxX, Math.min(maxX, panX)); panY = Math.max(-maxY, Math.min(maxY, panY));
}
const frameDraw = window.FrameScheduler.create(renderFrame);
let zooming=false,zoomSettleTimer=null,baseLightMinute=null,baseMaterialRevision=null;
function paintCachedBase(context,g,preview=false){
  const scene=window.CityScene,time=scene.time;
  scene.setTime((baseLightMinute??Math.floor(time/60))*60);
  try{return preview?scene.withPreview(()=>paintMap(context,g,'base')):paintMap(context,g,'base');}
  finally{scene.setTime(time);}
}
const panCache = window.FrameScheduler.createPanCache((context,g)=>paintCachedBase(context,g),{
  incremental:true,previewPaint:(context,g)=>paintCachedBase(context,g,true)
});
function invalidatePan(){panCache.invalidate();baseLightMinute=null;baseMaterialRevision=null;}
function sampleBaseLight(progressive){
  const minute=Math.floor(window.CityScene.time/60),revision=window.CityScene.materialRevision||0;
  if(baseLightMinute===minute&&baseMaterialRevision===revision||baseLightMinute!==null&&(panCache.pending||drag||zooming))return;
  // A fast simulation clock must not restart unfinished tiles every tick.
  // Structural edits call invalidatePan and still take effect immediately.
  window.CityScene.commitMaterials?.();
  if(baseLightMinute===null||!panCache.refresh())panCache.invalidate();
  baseLightMinute=minute;baseMaterialRevision=revision;
}
function baseNeedsRefresh(){return baseLightMinute!==Math.floor(window.CityScene.time/60)||baseMaterialRevision!==(window.CityScene.materialRevision||0);}
function rebaseViewportPan(ratio){
  const previousPanX=panX,previousPanY=panY;panX*=ratio;panY*=ratio;clampPan();
  if(drag){drag.panX+=panX-previousPanX;drag.panY+=panY-previousPanY;}
}
function draw() { invalidatePan();frameDraw.flush(); }
function requestDraw(viewportOnly=false) { if(viewportOnly!==true)invalidatePan();frameDraw.request(); }
// Traffic is composited after the cached ground/building layer. It stays live
// during gestures without forcing the static scenery to be baked every frame.
function requestAnimation(){frameDraw.request();}
function renderFrame() {
  const dpr = window.devicePixelRatio || 1, width = map.clientWidth, height = map.clientHeight;
  if (map.width !== Math.round(width * dpr) || map.height !== Math.round(height * dpr)) { map.width = Math.round(width * dpr); map.height = Math.round(height * dpr); }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, width, height);
  if (!terrain) return;
  if(width<=0||height<=0)return;
  if(lastViewport?.terrain===terrain&&(lastViewport.width!==width||lastViewport.height!==height)){
    // Pan is stored in CSS pixels. Rebase it with the fitted map scale so the
    // same world coordinate stays centred on fullscreen/inspector/window resize.
    const ratio=Math.max(width/source.width,height/source.height)/Math.max(lastViewport.width/source.width,lastViewport.height/source.height);
    rebaseViewportPan(ratio);
  }
  lastViewport={terrain,width,height};
  clampPan(); const g = geometry();
  const metricScale=Math.min(terrain.width*g.scale/terrain.grid.widthMeters,terrain.height*g.scale/terrain.grid.heightMeters);
  const detail=window.CityScene?.resolveQuality(zoom)==='high'&&window.CityScene.settings.renderer==='textures';
  let reused=false;
  if(detail&&!measuring&&window.CityApp?.canCacheBase){
    // A refinement batch shares one minute sample. New light waits for that
    // batch; atmosphere/traffic stay live, and explicit edits invalidate now.
    if(!drag&&!zooming)window.CityScene.setMaterialView?.(g,dpr);
    sampleBaseLight(metricScale>=1.2);
    reused=panCache.draw(ctx,g,dpr,Boolean(drag||zooming));
    if(!reused&&panCache.prepare(g,dpr,metricScale>=1.2))reused=panCache.draw(ctx,g,dpr);
    if(reused&&!drag&&!zooming&&panCache.pending){
      // New zoom densities first show complete massing. Refine small regions
      // at rest instead of synchronously baking hundreds of detailed roofs.
      panCache.refine(6);ctx.clearRect(0,0,width,height);panCache.draw(ctx,g,dpr);
      if(panCache.pending||baseNeedsRefresh())frameDraw.request();
    }
    if(reused)paintMap(ctx,g,'overlay');
  }else{
    panCache.invalidate();
  }
  if(!reused)paintMap(ctx,g);
  paintMeasurement(ctx,g);
  $('zoom-value').textContent = `${Math.round(zoom * 100)}%`;
  $('zoom-in').disabled = zoom >= 512; $('zoom-out').disabled = zoom <= 1;
  const ruler = currentScale(g,Math.max(60,Math.min(140,g.width*.25)));
  $('scale-bar').style.width = `${ruler.pixels}px`;
  $('scale-label').textContent = MapGeometry.formatDistance(ruler.meters);
  $('scale-mid').textContent = MapGeometry.formatDistance(ruler.meters/2);
  $('map-scale').title = `标尺长度 ${ruler.pixels.toFixed(1)} 屏幕像素 = ${MapGeometry.formatDistance(ruler.meters)}`;
}
function fit() { lastViewport=null; zoom = 1; panX = 0; panY = 0; draw(); }
function setZoom(next, anchorX = map.clientWidth / 2, anchorY = map.clientHeight / 2) {
  if (!terrain) return;
  next = Math.max(1, Math.min(512, next));
  const ratio = next / zoom,previousPanX=panX,previousPanY=panY;
  panX = (panX - anchorX + map.clientWidth / 2) * ratio + anchorX - map.clientWidth / 2;
  panY = (panY - anchorY + map.clientHeight / 2) * ratio + anchorY - map.clientHeight / 2;
  zoom = next; clampPan();zooming=true;
  // Keep a held pointer's origin consistent if wheel/pinch input interleaves.
  if(drag){drag.panX+=panX-previousPanX;drag.panY+=panY-previousPanY;}
  clearTimeout(zoomSettleTimer);
  zoomSettleTimer=setTimeout(()=>{zoomSettleTimer=null;zooming=false;requestAnimation();},160);
  requestDraw(true);
}
async function exportPNG() {
  if (!terrain || busy) return;
  const filename = `shanhai-${terrain.config.preset}-${terrain.config.seed.replace(/[^a-zA-Z0-9_-]/g, '_')}.png`;
  const exported = document.createElement('canvas'); exported.width = source.width; exported.height = source.height;
  const ec = exported.getContext('2d'), g = {left:0,top:0,scale:1,width:source.width,height:source.height};
  paintMap(ec,g); paintMeasurement(ec,g);
  // Export gets its own metric scale, independent of the viewport zoom.
  const factor = Math.max(1,source.width/1200), ruler = currentScale(g,140*factor);
  ec.save(); ec.translate(24*factor,source.height-28*factor); ec.scale(factor,factor);
  const length = ruler.pixels/factor;
  ec.fillStyle = '#f7faf0ed'; ec.fillRect(-10,-21,length+20,45);
  ec.strokeStyle = '#35594b'; ec.lineWidth = 1;
  ec.beginPath(); ec.moveTo(0,-7); ec.lineTo(0,0); ec.lineTo(length,0); ec.lineTo(length,-7); ec.moveTo(length/2,0); ec.lineTo(length/2,-5); ec.stroke();
  ec.font = '10px sans-serif'; ec.fillStyle = '#35594b'; ec.fillText('0',0,15);
  ec.textAlign = 'right'; ec.fillText(MapGeometry.formatDistance(ruler.meters),length,15); ec.restore();
  try {
    const dataUrl = exported.toDataURL('image/png');
    if (window.terrainAPI) {
      const result = await window.terrainAPI.exportPNG({ dataUrl, filename });
      if (!result.canceled) toast('地图已保存为 PNG');
    } else { const anchor = document.createElement('a'); anchor.href = dataUrl; anchor.download = filename; anchor.click(); toast('地图已导出为 PNG'); }
  } catch (error) { toast(`导出失败：${error.message}`); }
}
function thumbnails() {
  document.querySelectorAll('[data-preset]').forEach((button, index) => {
    const canvas = button.querySelector('canvas'), context = canvas.getContext('2d'), w = canvas.width, h = canvas.height, image = context.createImageData(w, h);
    const type = button.dataset.preset;
    const f = (x, y) => .5 + Math.sin(x * .054 + Math.sin(y * .075) * 1.8 + index) * .12 + Math.cos(y * .1 + Math.sin(x * .05) * 1.4) * .13 + Math.sin(x * .19 + y * .17) * .045 + Math.cos(x * .38 - y * .27) * .018;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let v = f(x, y), color;
      if (type === 'island') v += .12 - Math.pow(Math.hypot((x - w / 2) / w * 1.8, (y - h / 2) / h * 1.7), 2) * .5;
      if (type === 'bay') v = .48 + Math.tanh((Math.abs(y / h - .5) - .33 * x / w) * 9) * .16 + (f(x,y) - .5) * .3;
      if (type === 'archipelago') v = f(x * 1.8, y * 1.8) - .10;
      if (type === 'desert') v = .45 + Math.sin(x * .16 + Math.sin(y * .06) * 2) * .10;
      const sea = type === 'island' || type === 'archipelago' || type === 'bay' ? .4 : .24;
      color = v < sea ? gradient([[0,[139,181,161]],[1,[66,125,131]]],(sea-v)*4) : gradient(type === 'desert' ? palettes.desert : type === 'tundra' ? palettes.tundra : palettes.natural,(v-sea)*1.7);
      const shade = Math.max(.65, Math.min(1.15, .96 + (f(x-1,y-1)-f(x+1,y+1))*4));
      const i = (y*w+x)*4; image.data[i]=color[0]*shade; image.data[i+1]=color[1]*shade; image.data[i+2]=color[2]*shade; image.data[i+3]=255;
    }
    context.putImageData(image,0,0);
  });
}

for (const key of settings) $(key).addEventListener('input', () => { updateRanges(); scheduleGenerate(); });
document.querySelectorAll('[data-preset]').forEach(button => button.addEventListener('click', () => selectPreset(button.dataset.preset)));
// The same two modes are available while preparing terrain and planning a city.
$('map-frame').insertAdjacentHTML('beforeend','<div class="map-view-switch" role="group" aria-label="显示模式"><button data-view="high" aria-pressed="false">精细视图</button><button data-view="map" aria-pressed="true">地图视图</button><span id="map-view-auto">缩放自动切换</span></div>');
function syncDisplayControls(quality){
  const automatic=quality==='map'&&window.CityScene?.settings.quality!=='map';
  if(document.body.dataset.mapView!==quality){document.body.dataset.mapView=quality;updateLegend();window.CityApp?.refreshLegend();}
  document.querySelectorAll('[data-view]').forEach(b=>{
    const chosen=b.dataset.view===quality;
    if(b.classList.contains('active')!==chosen){b.classList.toggle('active',chosen);b.setAttribute('aria-pressed',String(chosen));}
  });
  const field=$('city-render-quality');if(field&&field.value!==quality)field.value=quality;
  const note=automatic?'已自动切换 · 放大至 7200% 进入精细视图':quality==='map'?'地图视图 · 点击精细视图查看细节':'精细视图 · 缩小自动切换地图';
  for(const id of ['map-view-auto','city-view-note'])if($(id)&&$(id).textContent!==note)$(id).textContent=note;
}
function setDisplayMode(quality,{focus=true}={}){
  window.CityScene?.configure({quality});
  try{localStorage.setItem('shanhai-scene-v1',JSON.stringify(window.CityScene.settings));}catch{}
  if(terrain&&quality==='high'&&focus){
    if(zoom<window.CityScene.detailZoom){setZoom(window.CityScene.detailZoom);return;}
  }
  if(terrain)syncDisplayControls(window.CityScene.resolveQuality(zoom));
  requestDraw();
}
document.querySelectorAll('[data-view]').forEach(button=>button.addEventListener('click',()=>setDisplayMode(button.dataset.view)));
$('reset').addEventListener('click', () => { selectPreset(selected); toast('已恢复当前地貌的默认参数'); });
$('resolution').addEventListener('change', scheduleGenerate);
for (const key of ['widthKm', 'heightKm']) {
  $(key).addEventListener('input', scheduleGenerate);
  $(key).addEventListener('change', scheduleGenerate);
}
$('seed').addEventListener('input', scheduleGenerate);
$('shuffle-seed').addEventListener('click', () => { $('seed').value = String(crypto.getRandomValues(new Uint32Array(1))[0]); scheduleGenerate(); });
$('generate').addEventListener('click', generate);
$('retry').addEventListener('click', generate);
$('export').addEventListener('click', exportPNG);
$('contours').addEventListener('click', () => { contour = !contour; $('contours').classList.toggle('active', contour); $('contours').setAttribute('aria-pressed', String(contour)); draw(); });
$('measure').addEventListener('click', () => {
  measuring = !measuring; measurePoints = []; measureHover = null; drag = null;
  $('measure').classList.toggle('active',measuring); $('measure').setAttribute('aria-pressed',String(measuring));
  map.classList.toggle('measuring',measuring); updateMeasureHint(); draw(); map.focus();
});
$('grid').addEventListener('click', () => { grid = !grid; $('grid').classList.toggle('active', grid); $('grid').setAttribute('aria-pressed', String(grid)); draw(); });
$('zoom-in').addEventListener('click', () => setZoom(zoom * 1.25));
$('zoom-out').addEventListener('click', () => setZoom(zoom / 1.25));
$('fit').addEventListener('click', fit);
$('fullscreen').addEventListener('click', async () => {
  try { if (document.fullscreenElement) await document.exitFullscreen(); else await $('map-frame').requestFullscreen(); }
  catch { toast('当前环境不支持全屏显示'); }
});
map.addEventListener('wheel', event => { event.preventDefault(); const rect = map.getBoundingClientRect(); setZoom(zoom * Math.exp(-event.deltaY * .0012), event.clientX - rect.left, event.clientY - rect.top); }, { passive: false });
map.addEventListener('pointerdown', event => {
  if (!terrain || busy) return;
  if (measuring) {
    const rect = map.getBoundingClientRect(), point = MapGeometry.screenToMap(event.clientX-rect.left,event.clientY-rect.top,geometry(),source.width,source.height);
    if (point) { measurePoints = measurePoints.length === 1 ? [...measurePoints,point] : [point]; measureHover = null; updateMeasureHint(); draw(); }
    return;
  }
  drag = { x: event.clientX, y: event.clientY, panX, panY }; map.setPointerCapture(event.pointerId);
});
map.addEventListener('pointermove', event => {
  if (measuring && terrain && measurePoints.length === 1) {
    const rect = map.getBoundingClientRect();
    measureHover = MapGeometry.screenToMap(event.clientX-rect.left,event.clientY-rect.top,geometry(),source.width,source.height); requestDraw(); return;
  }
  if (!drag) return; panX = drag.panX + event.clientX - drag.x; panY = drag.panY + event.clientY - drag.y; clampPan(); requestDraw(true);
});
function finishPan(){if(!drag)return;drag=null;requestDraw(true);}
map.addEventListener('pointerup', finishPan);
map.addEventListener('pointercancel', finishPan);
map.addEventListener('lostpointercapture', finishPan);
window.addEventListener('blur', finishPan);
map.addEventListener('keydown', event => {
  if (event.key === 'Escape' && measuring) { $('measure').click(); return; }
  if (event.key.startsWith('Arrow')) { event.preventDefault(); if (event.key === 'ArrowLeft') panX += 30; if (event.key === 'ArrowRight') panX -= 30; if (event.key === 'ArrowUp') panY += 30; if (event.key === 'ArrowDown') panY -= 30; draw(); }
  if (event.key === '+' || event.key === '=') setZoom(zoom * 1.25);
  if (event.key === '-') setZoom(zoom / 1.25);
  if (event.key === '0') fit();
});
document.addEventListener('keydown', event => { if (document.body.dataset.screen === 'terrain' && !document.querySelector('dialog[open]') && event.key === 'Enter' && !['BUTTON','SELECT'].includes(event.target.tagName)) { event.preventDefault(); generate(); } });
new ResizeObserver(requestDraw).observe($('map-frame'));
restore(); thumbnails();
window.MapWorkspace = {
  get terrain() { return terrain; }, get busy() { return busy; },
  paintOverview(context, g) {
    if (!terrain || !vectorLayers) return;
    context.save(); context.translate(g.left,g.top); context.scale(g.scale,g.scale);
    context.fillStyle='#dce9cc'; context.fillRect(0,0,terrain.width,terrain.height);
    for (const level of vectorLayers.levels) { context.fillStyle='#63875716'; context.fill(level.path,'evenodd'); }
    context.fillStyle='#9ed9ed'; context.fill(vectorLayers.ocean,'evenodd');
    context.save(); context.clip(vectorLayers.riverClip,'evenodd');
    for (const river of vectorLayers.rivers) context.fill(river);
    context.restore(); context.fill(vectorLayers.lakes,'evenodd'); context.restore();
  },
  get canConfirm() { return Boolean(terrain) && !busy && !terrainDirty; },
  get geometry() { return geometry(); },get panCacheStats(){return panCache.stats;}, draw, requestDraw, requestAnimation, toast, fit, setDisplayMode, installTerrain:installCityTerrain,
  cancelGeneration() {
    requestVersion++; queued=false; clearTimeout(debounce);
    $('loading').hidden=true;
    $('generate').querySelector('span').textContent='生成地形';
    terrainStateChanged();
  },
  newTerrain(preferences) {
    this.cancelGeneration(); terrain=null; terrainDirty=true; vectorLayers=null;
    ctx.clearRect(0,0,map.width,map.height);
    $('terrain-empty').hidden=false; $('map-error').hidden=true; $('export').disabled=true;
    $('map-name').textContent='地形预览'; $('map-number').textContent='待生成';
    for (const id of ['stat-size','stat-altitude','stat-land','stat-time']) $(id).textContent='—';
    $('hydrology-stats').textContent='生成地形后确认，开始城市规划';
    $('footer-status').textContent='调整参数 · 生成地形 · 确认并保存';
    if (preferences) { $('resolution').value=preferences.resolution; this.applyDisplay(preferences); }
    terrainStateChanged();
  },
  applyDisplay(preferences) {
    setDisplayMode(preferences.view==='map'?'map':'high',{focus:false});
    if(contour!==preferences.contours)$('contours').click();
    if(grid!==preferences.grid)$('grid').click();
  },
  toWorld(x,y) {
    if (!terrain) return null;
    const p=MapGeometry.screenToMap(x,y,geometry(),source.width,source.height);
    return p ? [p[0]*terrain.grid.widthMeters,p[1]*terrain.grid.heightMeters] : null;
  },
  focus(point, scale=4) {
    lastViewport=null;zoom=Math.max(1,Math.min(512,scale)); const g=geometry();
    panX=(.5-point[0]/terrain.grid.widthMeters)*source.width*g.scale;
    panY=(.5-point[1]/terrain.grid.heightMeters)*source.height*g.scale; draw();
  },
  async demoTerrain() {
    selected='hills';
    for (const key of settings) $(key).value=presets.hills[key];
    $('widthKm').value=8; $('heightKm').value=8; $('resolution').value=768;
    $('flatness').value=90; $('elevation').value=20; $('sea').value=15;
    $('riverDensity').value=0; $('lakeCount').value=0; $('seed').value='SHANHAI-CITY';
    updateRanges(); updatePresetButtons(); await generate();
  }
};
