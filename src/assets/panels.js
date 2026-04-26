// ============================================================
// PIPELINE CONSTANTS
// ============================================================
const STEP_KEY_MAP = { 'Export': 'export', 'Dedup': 'dedup', 'Annotate': 'annotate', 'Train': 'train', 'ONNX Export': 'onnx' };
const STEP_ID_MAP = { 'Export': 0, 'Dedup': 1, 'Annotate': 2, 'Train': 3, 'ONNX Export': 4 };

// ============================================================
// PANEL TAB RENDERERS
// ============================================================

function renderEditTab() {
  let html = `<div class="sec-label">Annotations (${boxes.length} boxes)</div>`;
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i];
    const name = CN[b.cls] || String(b.cls);
    const color = boxColor(b.cls);
    const sel = i === selectedBox ? ' selected' : '';
    html += `<div class="box-item${sel}" onclick="selectBox(${i})">
      <div class="box-dot" style="background:${color}"></div>
      <div style="flex:1">
        <div class="box-name">${name}</div>
      </div>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--bd2)" stroke-width="2" style="cursor:pointer;flex-shrink:0" onclick="event.stopPropagation();deleteBox(${i})"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
    </div>`;
  }

  html += '<div class="divider"></div>';
  html += '<div class="sec-label">Quick Actions</div>';
  html += `<div class="flex gap-6 flex-wrap">
    <button class="btn sm" onclick="popUndo()" data-tip="Undo last box edit (Ctrl+Z)">↩ Undo</button>
    <button class="btn sm" onclick="openCopyMove('copy')" data-tip="Copy this image + label to another dataset">Copy</button>
    <button class="btn sm" onclick="openCopyMove('move')" data-tip="Move this image + label to another dataset">Move</button>
    <button class="btn sm danger" onclick="deleteImage()" data-tip="Permanently delete this image and its label file">Delete</button>
  </div>`;

  html += '<div class="divider"></div>';
  html += '<div class="sec-label" data-tip="Class assigned to newly drawn bounding boxes">New Box Class</div>';
  const defaultClasses = CONF.DEFAULT_CLASSES || [0, 2, 15, 16];
  html += '<select class="sel w-full" id="newBoxClass">';
  for (const c of defaultClasses) {
    html += `<option value="${c}">${c}: ${CN[c] || c}</option>`;
  }
  html += '</select>';
  html += '<div class="text-hint">Click + drag on canvas to draw. Right-click to select.</div>';

  html += '<div class="divider"></div>';
  html += '<div class="sec-label">Keyboard Shortcuts</div>';
  html += '<div style="font-size:var(--fs-sm);color:var(--t2);font-family:var(--font);line-height:2.4">';
  const shortcuts = [
    ['← →','Navigate images'],['D','Delete selected box'],['P','Set to Person class'],
    ['A','AI Analyse (save)'],['M','Copy/Move dialog'],['E','Toggle panel'],
    ['G','Gallery view'],['J','Jump to image #'],['Ctrl+Z','Undo'],['Right-click','Context menu']
  ];
  for (const [key, desc] of shortcuts) {
    html += `<div style="display:flex;gap:10px;align-items:center">
      <span class="keycap">${key}</span>
      <span style="font-size:var(--fs-sm)">${desc}</span>
    </div>`;
  }
  html += '</div>';

  return html;
}

function renderAITab() {
  const defaultModel = CONF.DEFAULT_MODEL || '';
  const activeModel = modelOverride || defaultModel;
  const activeConf = confOverride !== null ? confOverride : (CONF.DEFAULT_CONFIDENCE || 0.7);
  const modelMod = modelOverride !== null;
  const confMod = confOverride !== null;
  const anyMod = modelMod || confMod;

  let html = '<div class="flex items-center justify-between">';
  html += `<div class="sec-label" style="margin-bottom:6px" data-tip="AI model for detection. Yellow dot means overridden from Settings default.">Model${modelMod ? '<span class="mod-dot"></span>' : ''} / Confidence${confMod ? '<span class="mod-dot"></span>' : ''}</div>`;
  if (anyMod) html += `<span style="font-size:var(--fs-sm);color:var(--acy);cursor:pointer" onclick="resetAIDefaults()" data-tip="Revert model and confidence to Settings defaults">↺ Reset</span>`;
  html += '</div>';

  // Model + Confidence on same row
  html += '<div style="display:flex;gap:8px;margin-bottom:6px">';
  html += '<select class="sel" style="flex:1;min-width:0" id="aiModel" onchange="onAIModelChange(this.value)" data-tip="Select model for detection.">';
  const models = (window._modelsList || []);
  for (const m of models) {
    const name = m.split('/').pop();
    const sel = name === activeModel.split('/').pop() ? ' selected' : '';
    html += `<option value="${m}"${sel}>${name}</option>`;
  }
  html += '</select>';
  html += `<input type="number" class="num-inp${confMod ? ' modified' : ''}" id="aiConf" value="${activeConf}" min="0.05" max="0.99" step="0.05" style="width:65px" onchange="onAIConfChange(this.value)" data-tip="Confidence threshold.">`;
  html += '</div>';

  // Model status
  const hasModels = (window._modelsList || []).length > 0;
  let statusColor, statusText;
  if (!hasModels) {
    statusColor = 'var(--acr)'; statusText = '○ No models available';
  } else if (aiModelStatus === 'loaded') {
    statusColor = '#22c55e'; statusText = '● Model ready';
  } else if (aiModelStatus === 'loading') {
    statusColor = 'var(--acy)'; statusText = '◌ Loading...';
  } else {
    statusColor = 'var(--t2)'; statusText = '○ Not loaded';
  }
  html += `<div class="flex items-center gap-6" style="margin-bottom:14px"><span class="ai-status-dot" style="width:7px;height:7px;border-radius:50%;background:${statusColor};display:inline-block"></span><span class="ai-status-text" style="font-size:var(--fs-sm);color:${statusColor};font-family:var(--font)">${statusText}</span></div>`;

  html += '<div class="sec-label" data-tip="Which COCO classes to detect. Configure in Settings → AI Defaults.">Classes (from Settings)</div>';
  html += '<div class="flex gap-4 flex-wrap mb-4" style="gap:5px">';
  const classes = CONF.DEFAULT_CLASSES || [0,2,15,16];
  for (const c of classes) {
    html += `<span style="font-size:var(--fs-sm);padding:3px 10px;border-radius:6px;background:rgba(59,130,246,0.1);color:#60a5fa;font-weight:500">${CN[c] || c}</span>`;
  }
  html += '</div>';
  html += '<div class="text-hint" style="margin-bottom:14px">Edit in Settings → AI Defaults</div>';

  // Live detection toggle
  if (currentMode === 'video' || currentMode === 'live' || currentMode === 'dataset') {
    const modeLabel = currentMode === 'video' ? 'Auto-analyse on frame change' :
                      currentMode === 'live' ? 'Auto-analyse on snapshot change' :
                      'Auto-analyse on image change';
    html += `<div class="live-toggle${liveDetection ? ' on' : ''}" data-tip="When ON, automatically runs AI detection every time you navigate to a new image/frame.">
      <div>
        <div style="font-size:var(--fs-base);font-weight:600;color:var(--t0)">Live Detection</div>
        <div style="font-size:var(--fs-sm);color:var(--t2);margin-top:3px">${modeLabel}</div>
      </div>
      <div class="toggle-switch${liveDetection ? ' on' : ''}" onclick="toggleLiveDetection()">
        <div class="toggle-knob"></div>
      </div>
    </div>`;
  }

  html += '<div class="divider"></div>';
  html += `<button class="btn btn-lg primary w-full mb-4" onclick="runAnalyse()" data-tip="Run AI detection on current image. In Dataset mode, merges results into existing boxes and saves.">
    ◎ Analyse (A)
  </button>`;

  if (currentMode === 'dataset') {
    html += '<button class="btn btn-lg w-full mb-4" style="border-color:rgba(139,92,246,0.3);color:var(--acp)" onclick="runPreview()" data-tip="Preview AI detections as dashed boxes without saving to label file.">▶ Preview (no save)</button>';
  }

  // Show detected boxes list (aiPreviewBoxes)
  if (aiPreviewBoxes.length > 0) {
    html += '<div class="divider"></div>';
    html += `<div class="sec-label">AI Detections (${aiPreviewBoxes.length})</div>`;
    for (let i = 0; i < aiPreviewBoxes.length; i++) {
      const b = aiPreviewBoxes[i];
      const name = CN[b.cls] || String(b.cls);
      const color = boxColor(b.cls);
      const conf = (b.conf || 0).toFixed(2);
      html += `<div class="box-item" onclick="flashSingleBox(${i}, true)" data-tip="Click to flash this detection on the image">
        <div class="box-dot" style="background:${color}"></div>
        <div style="flex:1">
          <div class="box-name">${name}</div>
        </div>
        <span class="box-conf">${conf}</span>
      </div>`;
    }
  }

  // Show saved boxes list (dataset mode)
  if (currentMode === 'dataset' && boxes.length > 0 && aiPreviewBoxes.length === 0) {
    html += '<div class="divider"></div>';
    html += `<div class="sec-label">Saved Boxes (${boxes.length})</div>`;
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      const name = CN[b.cls] || String(b.cls);
      const color = boxColor(b.cls);
      const sel = i === selectedBox ? ' selected' : '';
      html += `<div class="box-item${sel}" onclick="flashSingleBox(${i}, false)" data-tip="Click to flash this box on the image">
        <div class="box-dot" style="background:${color}"></div>
        <div style="flex:1">
          <div class="box-name">${name}</div>
        </div>
      </div>`;
    }
  }

  return html;
}

// Flash a single box on the canvas
function flashSingleBox(idx, isPreview) {
  const boxList = isPreview ? aiPreviewBoxes : boxes;
  if (idx >= boxList.length || !imgLoaded) return;
  const b = boxList[idx];
  const color = boxColor(b.cls);
  const iw = img.naturalWidth, ih = img.naturalHeight;
  let count = 0;
  const timer = setInterval(() => {
    count++;
    if (count > 4) { clearInterval(timer); render(); return; }
    render();
    if (count % 2 === 1) {
      ctx.save();
      ctx.translate(panX, panY);
      ctx.scale(zoom, zoom);
      const x = (b.xc - b.w/2) * iw, y = (b.yc - b.h/2) * ih;
      const w = b.w * iw, h = b.h * ih;
      ctx.fillStyle = color + '40';
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = color;
      ctx.lineWidth = 4 / zoom;
      ctx.strokeRect(x, y, w, h);
      ctx.restore();
    }
  }, 180);
}

function renderStatsTab() {
  let html = '<div class="sec-label">Dataset Statistics</div><div id="statsContent">Loading...</div>';
  // Fetch stats async
  fetch('/api/stats').then(r => r.json()).then(d => {
    const el = document.getElementById('statsContent');
    if (!el) return;
    let h = '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px">';
    const cards = [
      { label: 'Total', value: d.total, color: 'var(--t0)' },
      { label: 'Train', value: d.train, color: 'var(--ac)' },
      { label: 'Val', value: d.val, color: 'var(--aco)' },
      { label: 'Annotated', value: d.annotated, color: 'var(--acg)' },
      { label: 'Empty', value: d.empty, color: 'var(--acr)' },
      { label: 'Total Boxes', value: d.total_boxes, color: 'var(--acp)' },
    ];
    for (const c of cards) {
      h += `<div style="background:var(--bg2);border-radius:8px;padding:var(--pad-md) 14px;border:1px solid var(--bd)">
        <div style="font-size:var(--fs-2xl);font-weight:700;color:${c.color};font-family:var(--font)">${typeof c.value === 'number' ? c.value.toLocaleString() : c.value}</div>
        <div style="font-size:var(--fs-sm);color:var(--t2);margin-top:3px">${c.label}</div>
      </div>`;
    }
    h += '</div><div class="divider"></div><div class="sec-label">Class Distribution</div>';

    const cc = d.class_counts || {};
    const maxCount = Math.max(...Object.values(cc), 1);
    const sortedCls = Object.keys(cc).sort((a,b) => cc[b] - cc[a]);
    for (const cls of sortedCls) {
      const name = CN[cls] || cls;
      const count = cc[cls];
      const pct = (count / maxCount * 100).toFixed(0);
      h += `<div style="margin-bottom:10px">
        <div style="display:flex;justify-content:space-between;margin-bottom:4px">
          <span style="font-size:var(--fs-base);color:var(--t1)">${name}</span>
          <span style="font-size:var(--fs-sm);color:var(--t2);font-family:var(--font)">${count}</span>
        </div>
        <div style="height:5px;background:var(--bg3);border-radius:3px"><div style="height:100%;width:${pct}%;border-radius:3px;background:linear-gradient(90deg,var(--ac),var(--acp))"></div></div>
      </div>`;
    }
    el.innerHTML = h;
  });
  return html;
}

// Dupe state cache
let _dupeThreshold = 90;
let _dupeResultsHTML = '';

function renderDupesTab() {
  let html = '<div class="sec-label">Duplicate Detection</div>';
  html += '<div style="font-size:var(--fs-base);color:var(--t2);margin-bottom:14px;line-height:1.6">Find visually similar images using perceptual hashing (pHash).</div>';
  html += '<div class="sec-label" style="font-size:var(--fs-base);font-weight:500;color:var(--t1);margin-bottom:6px">Similarity Threshold</div>';
  html += `<div style="display:flex;align-items:center;gap:6px;margin-bottom:14px"><input type="number" class="num-inp" id="dupeThreshold" value="${_dupeThreshold}" min="50" max="100" step="1" style="flex:1" onchange="_dupeThreshold=parseInt(this.value)||90"><span style="font-size:var(--fs-base);color:var(--t2)">%</span></div>`;
  html += '<button class="btn btn-lg w-full" onclick="scanDupes()">◇ Find Similar Images</button>';
  html += '<div class="divider"></div>';
  if (_dupeResultsHTML) {
    html += `<div id="dupeResults">${_dupeResultsHTML}</div>`;
  } else {
    html += '<div id="dupeResults"><div style="font-size:var(--fs-sm);color:var(--t3);text-align:center;padding:var(--pad-xl)">Select an image and click to find duplicates</div></div>';
  }
  return html;
}

function renderTransferTab() {
  let html = '<div class="sec-label">Transfer to Dataset</div>';
  html += '<div class="sec-label" style="margin-top:8px">Destination Dataset</div>';
  html += '<select class="sel w-full mb-6" id="transferDataset">';
  // Will be populated dynamically
  html += '</select>';

  html += '<div class="sec-label">Split</div>';
  html += `<div class="flex gap-6 mb-6">
    <button class="btn sm active" id="transferTrain" onclick="setTransferSplit('train')">Train</button>
    <button class="btn sm" id="transferVal" onclick="setTransferSplit('val')">Val</button>
  </div>`;

  html += '<div class="divider"></div>';
  html += `<div class="flex gap-6">
    <button class="btn sm flex-1" onclick="transferLive('copy')">Copy (M)</button>
    <button class="btn sm flex-1" onclick="transferLive('move')">Move</button>
  </div>`;

  // Populate datasets async
  setTimeout(() => {
    fetch('/api/datasets').then(r => r.json()).then(ds => {
      const sel = document.getElementById('transferDataset');
      if (!sel) return;
      sel.innerHTML = ds.map(d => `<option value="${d.path}">${d.name}</option>`).join('');
    });
  }, 50);

  return html;
}

let transferSplit = 'train';
function setTransferSplit(s) {
  transferSplit = s;
  document.getElementById('transferTrain').classList.toggle('active', s === 'train');
  document.getElementById('transferVal').classList.toggle('active', s === 'val');
}

function renderScannerTab() {
  let html = '<div class="sec-label">Video Scanner</div>';
  html += `<div class="mb-4">
    <div class="sec-label">Scan Step (every N frames)</div>
    <input type="number" class="num-inp" id="scanStep" value="25" min="1" max="500" style="width:60px">
  </div>`;
  html += `<div class="mb-4">
    <div class="sec-label">Min Detections</div>
    <input type="number" class="num-inp" id="scanMinDet" value="1" min="1" max="20" style="width:60px">
  </div>`;
  html += `<div class="flex gap-6 mb-6">
    <button class="btn sm primary flex-1" id="scanBtn" onclick="videoScanAll()">▶ Scan All Frames</button>
    <button class="btn sm danger" id="scanStopBtn" onclick="videoScanStop()" style="display:none">■ Stop</button>
  </div>`;
  html += '<div id="scanProgress" style="display:none" class="mb-6"></div>';
  html += '<div class="divider"></div>';
  html += '<div id="scanResults"></div>';
  html += `<div class="flex gap-6 mt-2" id="scanActions" style="display:none">
    <button class="btn sm flex-1" style="color:var(--acg)" onclick="videoExportAllScanned()">Export All</button>
    <button class="btn sm" onclick="clearScanResults()">Clear</button>
  </div>`;
  return html;
}

// ============================================================
// AI FUNCTIONS
// ============================================================
function onAIModelChange(val) {
  const defaultModel = CONF.DEFAULT_MODEL || '';
  const basename = val.split('/').pop();
  modelOverride = (basename === defaultModel || val === defaultModel) ? null : val;
  renderPanelContent();
}

function onAIConfChange(val) {
  const def = parseFloat(CONF.DEFAULT_CONFIDENCE || 0.7);
  const v = parseFloat(val);
  confOverride = (Math.abs(v - def) < 0.001) ? null : val;
  renderPanelContent();
}

function resetAIDefaults() {
  modelOverride = null;
  confOverride = null;
  renderPanelContent();
}

function toggleLiveDetection() {
  // If enabling, check deps and model first
  if (!liveDetection) {
    if (!requireDep('ultralytics', 'Ultralytics')) return;
    if (!requireModel()) return;
  }
  liveDetection = !liveDetection;
  // Capture AI params BEFORE re-render destroys the dropdown
  const params = liveDetection && imgLoaded ? getAIParams() : null;
  renderPanelContent();
  if (params) {
    if (currentMode === 'dataset') runPreview();
    else if (currentMode === 'live') runLiveAI();
    else if (currentMode === 'video') runVideoAI();
  }
}

function getAIParams() {
  let model = document.getElementById('aiModel')?.value;
  if (!model) {
    // AI tab not rendered — resolve from CONF + _modelsList
    const target = (modelOverride || CONF.DEFAULT_MODEL || '').split('/').pop();
    model = (window._modelsList || []).find(m => m.split('/').pop() === target) || CONF.DEFAULT_MODEL || '';
  }
  const conf = parseFloat(document.getElementById('aiConf')?.value || confOverride || CONF.DEFAULT_CONFIDENCE || 0.7);
  const classes = CONF.DEFAULT_CLASSES || [0, 2, 15, 16];
  return { model, conf, classes };
}

function runAnalyse() {
  if (!requireDep('ultralytics', 'Ultralytics')) return;
  if (!requireModel()) return;
  aiModelStatus = 'loading';
  renderPanelContent();
  if (currentMode === 'dataset') {
    const navId = _navCounter;
    const p = getAIParams();
    fetch('/api/ai', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ split: currentSplit, name: currentName, model: p.model, conf: p.conf, classes: p.classes })
    }).then(r => r.json()).then(d => {
      aiModelStatus = 'loaded';
      if (_navCounter !== navId) return;
      if (d.ok) {
        boxes = d.boxes;
        aiPreviewBoxes = [];
        if (d.added === 0 && d.total === 0) toast('No objects found');
        else toast(`AI: +${d.added} added, ${d.skipped} skipped (${d.total} total)`);
        render();
        renderPanelContent();
      } else {
        toast(d.error || 'AI error', true);
        renderPanelContent();
      }
    });
  } else if (currentMode === 'live') {
    runLiveAI();
  } else if (currentMode === 'video') {
    runVideoAI();
  }
}

function runPreview() {
  if (currentMode !== 'dataset') return;
  if (!requireDep('ultralytics', 'Ultralytics')) return;
  if (!requireModel()) return;
  aiModelStatus = 'loading';
  renderPanelContent();
  const navId = _navCounter;
  const p = getAIParams();
  fetch('/api/preview/ai', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({ split: currentSplit, name: currentName, model: p.model, conf: p.conf, classes: p.classes })
  }).then(r => r.json()).then(d => {
    aiModelStatus = 'loaded';
    if (_navCounter !== navId) return;
    if (d.ok) {
      aiPreviewBoxes = d.boxes;
      if (d.boxes.length === 0) toast('No objects found');
      render();
      flashPreviewPersons();
    }
    renderPanelContent();
  });
}

// ============================================================
// LIVE MODE
// ============================================================
let liveIdx = 0;

function loadLive() {
  const cam = document.getElementById('liveCamSel')?.value || 'all';
  const hours = parseInt(document.getElementById('liveHours')?.value || '24');
  fetch(`/api/live/info?cam=${cam}&hours=${hours}`)
    .then(r => r.json())
    .then(d => {
      document.getElementById('liveTotal').textContent = d.total;
      if (d.total > 0) loadLiveImage(0);
      else clearCanvas();
    });
}

function loadLiveImage(idx) {
  _navCounter++;
  cancelFlash();
  liveIdx = idx;
  document.getElementById('liveIdx').textContent = idx + 1;
  aiPreviewBoxes = [];
  boxes = [];
  selectedBox = -1;
  undoStack = [];
  const cam = document.getElementById('liveCamSel')?.value || 'all';
  const hours = parseInt(document.getElementById('liveHours')?.value || '24');
  fetch(`/api/live/meta?i=${idx}&cam=${encodeURIComponent(cam)}&hours=${hours}`)
    .then(r => r.json())
    .then(d => {
      currentName = d.name;
      img = new Image();
      img.onload = () => {
        imgLoaded = true;
        const es = document.getElementById('emptyState');
        if (es) es.style.display = 'none';
        fitImage();
        render();
        document.getElementById('liveFileInfo').textContent = `${d.camera} • ${d.mtime_str}`;
        // Auto AI in live detection mode
        if (liveDetection) runLiveAI();
      };
      img.src = `/img/live?i=${idx}&cam=${encodeURIComponent(cam)}&hours=${hours}&t=${Date.now()}`;
    });
}

function navigateLive(delta) {
  const total = parseInt(document.getElementById('liveTotal')?.textContent || '0');
  if (total === 0) return;
  let newIdx = liveIdx + delta;
  if (newIdx < 0) newIdx = total - 1;
  else if (newIdx >= total) newIdx = 0;
  loadLiveImage(newIdx);
}

function runLiveAI() {
  if (!requireDep('ultralytics', 'Ultralytics')) return;
  if (!requireModel()) return;
  aiModelStatus = 'loading';
  renderPanelContent();
  const navId = _navCounter;
  const p = getAIParams();
  const liveCam = document.getElementById('liveCamSel')?.value || 'all';
  const liveHours = parseInt(document.getElementById('liveHours')?.value || '24');
  fetch('/api/live/ai', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({ index: liveIdx, model: p.model, conf: p.conf, classes: p.classes, cam: liveCam, hours: liveHours })
  }).then(r => r.json()).then(d => {
    aiModelStatus = 'loaded';
    if (_navCounter !== navId) return;
    if (d.ok) {
      aiPreviewBoxes = d.boxes;
      if (d.boxes.length === 0) toast('No objects found');
      render();
      flashPreviewPersons();
    }
    renderPanelContent();
  });
}

function transferLive(action) {
  let dst = document.getElementById('transferDataset')?.value;
  if (!dst) dst = CONF.DEFAULT_DATASET || '';
  if (!dst) { toast('No dataset selected. Open Transfer tab or set Default Dataset in Settings.', true); return; }
  fetch('/api/copymove', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({
      src_split: '', src_name: currentName,
      dst_dataset: dst, dst_split: transferSplit,
      action: action, live: true
    })
  }).then(r => r.json()).then(d => {
    if (d.ok) toast(`${action}: ${currentName} → ${transferSplit}`);
    else toast(d.error || 'Error', true);
  });
}

// ============================================================
// VIDEO MODE
// ============================================================
function loadVideoList() {
  fetch('/api/video/list').then(r => r.json()).then(d => {
    if (d.ok && d.clips.length > 0) {
      loadVideoClip(d.clips[0].path);
    } else {
      clearCanvas();
    }
  });
}

function loadVideoClip(path) {
  videoCurrentClip = path;
  videoCurrentFrame = 0;
  fetch(`/api/video/info?path=${encodeURIComponent(path)}`)
    .then(r => r.json())
    .then(d => {
      if (d.ok) {
        videoTotalFrames = d.total_frames;
        document.getElementById('videoTotalFrames').textContent = videoTotalFrames;
        document.getElementById('videoSeekbar').max = videoTotalFrames - 1;
        loadVideoFrame(0);
      }
    });
}

function loadVideoFrame(frame) {
  _navCounter++;
  cancelFlash();
  videoCurrentFrame = frame;
  document.getElementById('videoFrame').textContent = frame;
  document.getElementById('videoSeekbar').value = frame;
  undoStack = [];

  // Update time display
  const fps = videoPlayFps || 10;
  const sec = Math.floor(frame / 25); // approximate
  const totalSec = Math.floor(videoTotalFrames / 25);
  document.getElementById('videoTime').textContent =
    `${Math.floor(sec/60)}:${String(sec%60).padStart(2,'0')} / ${Math.floor(totalSec/60)}:${String(totalSec%60).padStart(2,'0')}`;

  img = new Image();
  img.onload = () => {
    imgLoaded = true;
    const es = document.getElementById('emptyState');
    if (es) es.style.display = 'none';
    fitImage();
    aiPreviewBoxes = [];
    render();

    // Live detection
    if (liveDetection) runVideoAI();
  };
  img.src = `/api/video/frame?path=${encodeURIComponent(videoCurrentClip)}&frame=${frame}&t=${Date.now()}`;
}

function videoStep(delta) {
  const newFrame = Math.max(0, Math.min(videoTotalFrames - 1, videoCurrentFrame + delta));
  if (newFrame !== videoCurrentFrame) loadVideoFrame(newFrame);
}

function videoSeek(val) {
  loadVideoFrame(parseInt(val));
}

function videoTogglePlay() {
  videoPlaying = !videoPlaying;
  document.getElementById('videoPlayBtn').textContent = videoPlaying ? '⏸' : '▶';
  if (videoPlaying) {
    videoPlayTimer = setInterval(() => {
      if (videoCurrentFrame >= videoTotalFrames - 1) {
        videoTogglePlay();
        return;
      }
      videoStep(1);
    }, 1000 / videoPlayFps);
  } else {
    clearInterval(videoPlayTimer);
  }
}

// ============================================================
// VIDEO EXPORT TAB
// ============================================================
let _vexpSplit = 'auto';
let _vexpRunning = false;
let _vexpStep = 5;
let _vexpDataset = '';
// Persistent state survives tab switches
let _vexpProgress = { pct: 0, label: '', count: '', exported: 0, skipped: 0, done: false, stopped: false, visible: false };

function renderExportTab() {
  const totalFrames = videoTotalFrames;
  const est = Math.ceil(totalFrames / _vexpStep);
  const p = _vexpProgress;
  const running = _vexpRunning;

  let html = '';

  // Every N-th frame
  html += '<div class="sec-label">Every N-th frame</div>';
  html += '<div class="flex gap-6 mb-6" style="align-items:center">';
  html += '<input type="number" class="num-inp" id="vexpStep" value="' + _vexpStep + '" min="1" max="1000" style="width:60px"' + (running ? ' disabled' : '') + '>';
  html += '<span class="text-sm text-t2 font-ui" id="vexpEstimate">' + est + ' images</span>';
  html += '</div>';

  // Dataset
  html += '<div class="sec-label">Dataset</div>';
  html += '<select class="sel mb-4" id="vexpDataset" style="width:100%"' + (running ? ' disabled' : '') + '><option>Loading...</option></select>';

  // Split
  html += '<div class="sec-label">Split</div>';
  html += '<div class="flex gap-6 mb-6">';
  html += '<button class="btn sm flex-1' + (_vexpSplit === 'auto' ? ' active' : '') + '" id="vexpSplitAuto" onclick="vexpSetSplit(\'auto\')"' + (running ? ' disabled' : '') + '>Auto (90/10)</button>';
  html += '<button class="btn sm flex-1' + (_vexpSplit === 'train' ? ' active' : '') + '" id="vexpSplitTrain" onclick="vexpSetSplit(\'train\')"' + (running ? ' disabled' : '') + '>Train</button>';
  html += '<button class="btn sm flex-1' + (_vexpSplit === 'val' ? ' active' : '') + '" id="vexpSplitVal" onclick="vexpSetSplit(\'val\')"' + (running ? ' disabled' : '') + '>Val</button>';
  html += '</div>';

  // Progress
  var pVis = p.visible || running;
  html += '<div id="vexpProgress" style="' + (pVis ? '' : 'display:none;') + 'margin-bottom:14px">';
  html += '<div class="flex justify-between text-xs text-t2 font-ui mb-2">';
  html += '<span id="vexpProgressLabel">' + (p.label || 'Exporting...') + '</span>';
  html += '<span id="vexpProgressCount">' + (p.count || '0/0') + '</span>';
  html += '</div>';
  var barColor = p.done ? (p.stopped ? 'var(--acr)' : 'var(--acg)') : 'var(--acg)';
  html += '<div class="progress-bar"><div class="progress-fill" id="vexpProgressBar" style="width:' + p.pct + '%;background:' + barColor + '"></div></div>';
  html += '</div>';

  // Buttons
  if (running) {
    html += '<div class="flex gap-6" id="vexpRunningButtons">';
    html += '<button class="btn sm danger flex-1" onclick="vexpStop()">\u25a0 Stop</button>';
    html += '</div>';
  } else if (p.done) {
    html += '<div class="flex gap-6" id="vexpButtons">';
    html += '<button class="btn sm flex-1" id="vexpStartBtn" onclick="vexpReset()">\u2713 Done</button>';
    html += '</div>';
  } else {
    html += '<div class="flex gap-6" id="vexpButtons">';
    html += '<button class="btn sm primary flex-1" id="vexpStartBtn" onclick="vexpStart()" style="color:var(--acg);border-color:rgba(34,197,94,0.3)">\u2913 Export</button>';
    html += '</div>';
  }

  return html;
}

function initExportTab() {
  // Populate datasets async
  setTimeout(function() {
    fetch('/api/datasets').then(function(r) { return r.json(); }).then(function(ds) {
      var sel = document.getElementById('vexpDataset');
      if (!sel) return;
      var viewerDs = (document.getElementById('datasetSel') || {}).value || CONF.DEFAULT_DATASET || '';
      sel.innerHTML = ds.map(function(d) {
        var selected = d.path === viewerDs ? ' selected' : '';
        if (d.path === _vexpDataset) selected = ' selected';
        return '<option value="' + d.path + '"' + selected + '>' + d.name + '</option>';
      }).join('');
      // Persist selection
      sel.addEventListener('change', function() { _vexpDataset = sel.value; });
    });
  }, 50);

  // Estimate updater + persist step
  var stepInput = document.getElementById('vexpStep');
  if (stepInput) {
    stepInput.addEventListener('input', function() {
      var step = parseInt(stepInput.value) || 5;
      _vexpStep = step;
      var est = document.getElementById('vexpEstimate');
      if (est) est.textContent = Math.ceil(videoTotalFrames / step) + ' images';
    });
  }
}

function videoExportFrame() {
  // Context menu / keyboard shortcut -> switch to Export tab
  setPanelTab('export');
}

function vexpSetSplit(split) {
  _vexpSplit = split;
  ['auto','train','val'].forEach(function(s) {
    var btn = document.getElementById('vexpSplit' + s.charAt(0).toUpperCase() + s.slice(1));
    if (btn) btn.classList.toggle('active', s === split);
  });
}

function vexpResolveSplit(idx) {
  if (_vexpSplit === 'train') return 'train';
  if (_vexpSplit === 'val') return 'val';
  return (idx % 10 === 0) ? 'val' : 'train';
}

function vexpStop() {
  _vexpRunning = false;
}

function vexpReset() {
  _vexpRunning = false;
  _vexpProgress = { pct: 0, label: '', count: '', exported: 0, skipped: 0, done: false, stopped: false, visible: false };
  renderPanelContent();
}

async function vexpStart() {
  var dst = (document.getElementById('vexpDataset') || {}).value || _vexpDataset || '';
  if (!dst) { toast('No dataset selected', true); return; }
  if (!videoCurrentClip) { toast('No video loaded', true); return; }

  // Persist settings
  _vexpStep = parseInt((document.getElementById('vexpStep') || {}).value) || 5;
  _vexpDataset = dst;

  var step = _vexpStep;
  var totalFrames = videoTotalFrames;
  var frames = [];
  for (var f = 0; f < totalFrames; f += step) frames.push(f);

  _vexpRunning = true;
  _vexpProgress = { pct: 0, label: 'Exporting...', count: '0/' + frames.length, exported: 0, skipped: 0, done: false, stopped: false, visible: true };
  renderPanelContent();

  var exported = 0, skipped = 0;

  for (var i = 0; i < frames.length; i++) {
    if (!_vexpRunning) break;

    var frame = frames[i];
    var split = vexpResolveSplit(i);
    var pct = Math.round((i + 1) / frames.length * 100);

    _vexpProgress.pct = pct;
    _vexpProgress.count = (i + 1) + '/' + frames.length;
    _vexpProgress.label = 'Exporting... ' + exported + ' saved, ' + skipped + ' skipped';
    _vexpProgress.exported = exported;
    _vexpProgress.skipped = skipped;

    // Update DOM directly if elements exist (user is on this tab)
    var barEl = document.getElementById('vexpProgressBar');
    var countEl = document.getElementById('vexpProgressCount');
    var labelEl = document.getElementById('vexpProgressLabel');
    if (barEl) barEl.style.width = pct + '%';
    if (countEl) countEl.textContent = _vexpProgress.count;
    if (labelEl) labelEl.textContent = _vexpProgress.label;

    try {
      var res = await fetch('/api/video/export', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ path: videoCurrentClip, frame: frame, dst_dataset: dst, dst_split: split })
      }).then(function(r) { return r.json(); });
      if (res.ok) exported++;
      else skipped++;
    } catch (e) {
      skipped++;
    }
  }

  var stopped = !_vexpRunning;
  _vexpRunning = false;
  _vexpProgress.done = true;
  _vexpProgress.stopped = stopped;
  _vexpProgress.pct = 100;
  _vexpProgress.exported = exported;
  _vexpProgress.skipped = skipped;
  _vexpProgress.label = stopped
    ? 'Stopped \u2014 ' + exported + ' exported, ' + skipped + ' skipped'
    : 'Done \u2014 ' + exported + ' exported, ' + skipped + ' skipped';
  _vexpProgress.count = frames.length + '/' + frames.length;

  // Re-render to show Done state with correct buttons
  if (panelTab === 'export') renderPanelContent();

  toast(stopped ? 'Stopped: ' + exported + ' exported' : 'Exported ' + exported + ' frames (' + skipped + ' skipped)');
}




function runVideoAI() {
  if (!requireDep('ultralytics', 'Ultralytics')) return;
  if (!requireModel()) return;
  const navId = _navCounter;
  const p = getAIParams();
  fetch('/api/video/ai', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({ path: videoCurrentClip, frame: videoCurrentFrame, model: p.model, conf: p.conf, classes: p.classes })
  }).then(r => r.json()).then(d => {
    if (_navCounter !== navId) return;
    if (d.ok) {
      aiPreviewBoxes = d.boxes;
      if (d.boxes.length === 0) toast('No objects found');
      render();
    }
  });
}

// Video scanner
let scanRunning = false;
let scanResults = [];

function videoScanAll() {
  if (scanRunning) return;
  if (!requireDep('ultralytics', 'Ultralytics')) return;
  if (!requireModel()) return;
  scanRunning = true;
  scanResults = [];
  const step = parseInt(document.getElementById('scanStep')?.value || '25');
  const minDet = parseInt(document.getElementById('scanMinDet')?.value || '1');
  document.getElementById('scanStopBtn').style.display = '';
  document.getElementById('scanBtn').textContent = 'Scanning...';

  const totalFrames = videoTotalFrames;
  let frame = 0;

  function scanNext() {
    if (!scanRunning || frame >= totalFrames) {
      scanRunning = false;
      document.getElementById('scanStopBtn').style.display = 'none';
      document.getElementById('scanBtn').textContent = '▶ Scan All Frames';
      updateScanResults();
      return;
    }

    // Progress
    const pct = Math.round(frame / totalFrames * 100);
    const progEl = document.getElementById('scanProgress');
    if (progEl) {
      progEl.style.display = '';
      progEl.innerHTML = `<div class="flex justify-between text-xs text-t2 font-ui mb-2"><span>Scanning...</span><span>${frame}/${totalFrames}</span></div>
        <div class="progress-bar"><div class="progress-fill" style="width:${pct}%;background:var(--acp)"></div></div>`;
    }

    const p = getAIParams();
    fetch('/api/video/ai', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ path: videoCurrentClip, frame: frame, model: p.model, conf: p.conf, classes: p.classes })
    }).then(r => r.json()).then(d => {
      if (d.ok && d.boxes.length >= minDet) {
        const sec = Math.floor(frame / 25);
        const classNames = [...new Set(d.boxes.map(b => CN[b.cls] || b.cls))].join(', ');
        scanResults.push({ frame, time: `${Math.floor(sec/60)}:${String(sec%60).padStart(2,'0')}`, dets: d.boxes.length, classes: classNames, boxes: d.boxes });
        updateScanResults();
      }
      frame += step;
      setTimeout(scanNext, 10);
    });
  }
  scanNext();
}

function videoScanStop() {
  scanRunning = false;
}

function updateScanResults() {
  const el = document.getElementById('scanResults');
  const actions = document.getElementById('scanActions');
  if (!el) return;
  if (scanResults.length === 0) {
    el.innerHTML = '<div class="text-sm text-t2">No results yet</div>';
    if (actions) actions.style.display = 'none';
    return;
  }
  if (actions) actions.style.display = '';
  let html = `<div class="sec-label">Results (${scanResults.length} frames)</div>`;
  for (let i = 0; i < scanResults.length; i++) {
    const r = scanResults[i];
    const active = r.frame === videoCurrentFrame ? ' active' : '';
    html += `<div class="scan-result${active}" onclick="loadScanFrame(${i})">
      <span style="color:var(--acp);font-weight:600;min-width:45px">F${r.frame}</span>
      <span style="color:var(--t2);min-width:30px">${r.time}</span>
      <span style="color:var(--t0);flex:1">${r.classes}</span>
      <span class="badge badge-ac">${r.dets}</span>
    </div>`;
  }
  el.innerHTML = html;
}

function loadScanFrame(scanIdx) {
  const r = scanResults[scanIdx];
  if (!r) return;
  // Load frame, then apply boxes from scan data
  videoCurrentFrame = r.frame;
  document.getElementById('videoFrame').textContent = r.frame;
  document.getElementById('videoSeekbar').value = r.frame;
  undoStack = [];
  const sec = Math.floor(r.frame / 25);
  const totalSec = Math.floor(videoTotalFrames / 25);
  document.getElementById('videoTime').textContent =
    `${Math.floor(sec/60)}:${String(sec%60).padStart(2,'0')} / ${Math.floor(totalSec/60)}:${String(totalSec%60).padStart(2,'0')}`;
  img = new Image();
  img.onload = () => {
    imgLoaded = true;
    fitImage();
    aiPreviewBoxes = r.boxes || [];
    render();
    updateScanResults();
  };
  img.src = `/api/video/frame?path=${encodeURIComponent(videoCurrentClip)}&frame=${r.frame}&t=${Date.now()}`;
}

function videoExportAllScanned() {
  const dst = CONF.DEFAULT_DATASET || '';
  let count = 0;
  const promises = scanResults.map(r =>
    fetch('/api/video/export', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ path: videoCurrentClip, frame: r.frame, dst_dataset: dst, dst_split: 'train' })
    }).then(res => res.json()).then(d => { if (d.ok) count++; })
  );
  Promise.all(promises).then(() => toast(`Exported ${count} frames`));
}

function clearScanResults() {
  scanResults = [];
  updateScanResults();
  const progEl = document.getElementById('scanProgress');
  if (progEl) progEl.style.display = 'none';
}

// ============================================================
// DUPLICATE SCANNING
// ============================================================
function scanDupes() {
  const threshold = parseInt(document.getElementById('dupeThreshold')?.value || _dupeThreshold);
  _dupeThreshold = threshold;
  const el = document.getElementById('dupeResults');
  if (el) el.innerHTML = '<div style="display:flex;align-items:center;gap:10px;padding:var(--pad-xl);justify-content:center"><div style="width:16px;height:16px;border:2px solid var(--acp);border-top-color:transparent;border-radius:50%;animation:spin 0.8s linear infinite"></div><span style="font-size:var(--fs-sm);color:var(--t1)">Scanning for duplicates...</span></div><style>@keyframes spin{to{transform:rotate(360deg)}}</style>';
  fetch(`/api/dupes/find?split=${currentSplit}&name=${currentName}&threshold=${threshold}`)
    .then(r => r.json())
    .then(d => {
      const el = document.getElementById('dupeResults');
      if (!el || !d.ok) return;
      window._dupeList = d.results || [];
      window._dupeCurrentIdx = 0;
      if (d.results.length === 0) {
        _dupeResultsHTML = '<div style="font-size:var(--fs-sm);color:var(--t3);text-align:center;padding:var(--pad-xl)">No similar images found</div>';
        el.innerHTML = _dupeResultsHTML;
        return;
      }
      let html = `<div style="font-size:var(--fs-sm);color:var(--acg);margin-bottom:10px">Found: ${d.results.length} similar images</div>`;
      for (let i = 0; i < d.results.length; i++) {
        const r = d.results[i];
        html += `<div class="dupe-item" style="cursor:pointer" onclick="window._dupeCurrentIdx=${i};showDupeSplitView('${r.split}','${r.name.replace(/'/g,"\\'")}',${r.similarity})">
          <div style="font-size:var(--fs-sm);font-weight:700;color:var(--acy);font-family:var(--font);min-width:45px">${r.similarity}%</div>
          <div class="dupe-info">
            <div class="dupe-name">${r.name}</div>
            <div class="dupe-split">${r.split}</div>
          </div>
        </div>`;
      }
      _dupeResultsHTML = html;
      el.innerHTML = html;
    });
}

function showDupeSplitView(dupeSplit, dupeName, similarity) {
  // Store all dupes for navigation
  window._dupeList = window._dupeList || [];
  window._dupeCurrentIdx = 0;
  // Find index if navigating
  for (let i = 0; i < window._dupeList.length; i++) {
    if (window._dupeList[i].name === dupeName && window._dupeList[i].split === dupeSplit) {
      window._dupeCurrentIdx = i;
      break;
    }
  }

  const overlay = document.getElementById('galleryOverlay');
  const origSrc = `/img/raw?f=${filter}&c=${classFilter}&i=${currentIdx}&t=${Date.now()}`;
  const dupeSrc = `/img/byname?split=${dupeSplit}&name=${encodeURIComponent(dupeName)}&t=${Date.now()}`;
  const dupeCount = window._dupeList.length;
  const dupeIdx = window._dupeCurrentIdx;

  overlay.style.display = '';
  overlay.innerHTML = `
    <div style="display:flex;flex-direction:column;height:100%;padding:var(--pad-md);gap:8px">
      <div style="display:flex;gap:12px;flex:1;min-height:0">
        <!-- Original -->
        <div style="flex:1;display:flex;flex-direction:column;min-width:0">
          <div style="display:flex;align-items:center;justify-content:space-between;padding:var(--pad-sm) 0">
            <span style="font-size:var(--fs-sm);font-weight:700;color:var(--ac);font-family:var(--font)">CURRENT</span>
            <span style="font-size:var(--fs-xs);color:var(--t2);font-family:var(--font);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${currentSplit}/${currentName}</span>
          </div>
          <div style="flex:1;background:var(--bg2);border-radius:8px;border:1px solid var(--bd);overflow:hidden;position:relative" oncontextmenu="event.preventDefault();showDupeContextMenu(event,'${currentSplit}','${currentName.replace(/'/g,"\\'")}')">
            <canvas id="dupeCanvasOrig" style="width:100%;height:100%"></canvas>
            <button onclick="showDupeFullscreen('orig')" style="position:absolute;top:8px;right:8px;width:32px;height:32px;border-radius:6px;background:rgba(0,0,0,0.7);border:1px solid var(--bd2);color:var(--t0);cursor:pointer;font-size:var(--fs-lg);display:flex;align-items:center;justify-content:center" data-tip="View fullscreen">⛶</button>
          </div>
        </div>
        <!-- Duplicate -->
        <div style="flex:1;display:flex;flex-direction:column;min-width:0">
          <div style="display:flex;align-items:center;justify-content:space-between;padding:var(--pad-sm) 0;gap:8px">
            <div style="display:flex;align-items:center;gap:8px;min-width:0">
              <span style="font-size:var(--fs-sm);font-weight:700;color:var(--aco);font-family:var(--font);flex-shrink:0">SIMILAR</span>
              <span style="font-size:var(--fs-sm);font-weight:700;color:var(--acy);font-family:var(--font);flex-shrink:0">${similarity}%</span>
              <span style="font-size:var(--fs-xs);color:var(--t2);font-family:var(--font);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${dupeSplit}/${dupeName}</span>
            </div>
          </div>
          <div style="flex:1;background:var(--bg2);border-radius:8px;border:1px solid var(--bd);overflow:hidden;position:relative" oncontextmenu="event.preventDefault();showDupeContextMenu(event,'${dupeSplit}','${dupeName.replace(/'/g,"\\'")}')">
            <canvas id="dupeCanvasDupe" style="width:100%;height:100%"></canvas>
            <button onclick="showDupeFullscreen('dupe')" style="position:absolute;top:8px;right:8px;width:32px;height:32px;border-radius:6px;background:rgba(0,0,0,0.7);border:1px solid var(--bd2);color:var(--t0);cursor:pointer;font-size:var(--fs-lg);display:flex;align-items:center;justify-content:center" data-tip="View fullscreen">⛶</button>
          </div>
        </div>
      </div>
      <!-- Bottom bar: navigation + close -->
      <div style="display:flex;align-items:center;justify-content:center;gap:12px;padding:var(--pad-sm) 0;flex-shrink:0">
        <button class="btn sm" onclick="navigateDupe(-1)" ${dupeIdx <= 0 ? 'disabled' : ''}>‹</button>
        <span style="font-size:var(--fs-base);font-family:var(--font);color:var(--t1)">${dupeIdx + 1}/${dupeCount}</span>
        <button class="btn sm" onclick="navigateDupe(1)" ${dupeIdx >= dupeCount - 1 ? 'disabled' : ''}>›</button>
        <button class="btn sm danger" style="margin-left:16px" onclick="document.getElementById('galleryOverlay').style.display='none'">✕ Close</button>
      </div>
    </div>`;

  // Store refs for fullscreen
  window._dupeOrigSrc = origSrc;
  window._dupeDupeSrc = dupeSrc;
  window._dupeOrigBoxes = boxes;
  window._dupeDupeBoxes = [];
  window._dupeOrigLabel = `${currentSplit}/${currentName}`;
  window._dupeDupeLabel = `${dupeSplit}/${dupeName}`;

  const origImg = new Image();
  origImg.onload = () => {
    window._dupeOrigImg = origImg;
    drawDupeCanvas('dupeCanvasOrig', origImg, boxes);
  };
  origImg.src = origSrc;

  const dupeImg = new Image();
  dupeImg.onload = () => {
    window._dupeDupeImg = dupeImg;
    fetch(`/api/meta/byname?split=${dupeSplit}&name=${encodeURIComponent(dupeName)}`)
      .then(r => r.json())
      .then(d => {
        window._dupeDupeBoxes = d.box_data || [];
        drawDupeCanvas('dupeCanvasDupe', dupeImg, window._dupeDupeBoxes);
      })
      .catch(() => { drawDupeCanvas('dupeCanvasDupe', dupeImg, []); });
  };
  dupeImg.src = dupeSrc;
}

function navigateDupe(delta) {
  const list = window._dupeList || [];
  if (!list.length) return;
  let idx = (window._dupeCurrentIdx || 0) + delta;
  if (idx < 0 || idx >= list.length) return;
  window._dupeCurrentIdx = idx;
  const d = list[idx];
  showDupeSplitView(d.split, d.name, d.similarity);
}

function showDupeContextMenu(e, imgSplit, imgName) {
  closeCtxMenu();
  const m = document.createElement('div');
  m.id = 'imgCtxMenu';
  m.style.cssText = `position:fixed;left:${e.clientX}px;top:${e.clientY}px;z-index:99999;background:var(--bg2);border:1px solid var(--bd2);border-radius:var(--radius);padding:var(--pad-xs) 0;min-width:clamp(170px,12vw,270px);box-shadow:0 8px 30px rgba(0,0,0,0.7)`;

  const shortName = imgName.length > 25 ? imgName.substring(0,22) + '...' : imgName;
  m.innerHTML = `
    <div style="padding:var(--pad-xs) var(--pad-md);font-size:var(--fs-xs);color:var(--t2);font-family:var(--font)">${imgSplit}/${shortName}</div>
    <div style="height:1px;background:var(--bd);margin:2px 0"></div>
    <div class="ctx-item" onclick="closeCtxMenu();dupeContextCopyMove('copy','${imgSplit}','${imgName.replace(/'/g,"\\'")}')">📋 Copy to...</div>
    <div class="ctx-item" onclick="closeCtxMenu();dupeContextCopyMove('move','${imgSplit}','${imgName.replace(/'/g,"\\'")}')">📦 Move to...</div>
    <div style="height:1px;background:var(--bd);margin:2px 0"></div>
    <div class="ctx-item" style="color:var(--acr)" onclick="closeCtxMenu();dupeContextDelete('${imgSplit}','${imgName.replace(/'/g,"\\'")}')">🗑 Delete Image</div>`;
  document.body.appendChild(m);

  const rect = m.getBoundingClientRect();
  if (rect.right > window.innerWidth) m.style.left = (window.innerWidth - rect.width - 8) + 'px';
  if (rect.bottom > window.innerHeight) m.style.top = (window.innerHeight - rect.height - 8) + 'px';

  setTimeout(() => {
    document.addEventListener('click', closeCtxMenu, {once:true});
  }, 10);
}

function dupeContextDelete(imgSplit, imgName) {
  if (!confirm(`Delete ${imgName}?`)) return;
  fetch('/api/del', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({ split: imgSplit, name: imgName })
  }).then(r => r.json()).then(d => {
    if (d.ok) {
      toast('Deleted: ' + imgName);
      window._dupeList = (window._dupeList || []).filter(x => !(x.split === imgSplit && x.name === imgName));
      if (window._dupeList.length > 0) {
        const idx = Math.min(window._dupeCurrentIdx || 0, window._dupeList.length - 1);
        window._dupeCurrentIdx = idx;
        const next = window._dupeList[idx];
        showDupeSplitView(next.split, next.name, next.similarity);
      } else {
        document.getElementById('galleryOverlay').style.display = 'none';
      }
      scanDupes();
    } else toast(d.error || 'Delete failed', true);
  });
}

function dupeContextCopyMove(action, imgSplit, imgName) {
  // Temporarily override currentSplit/currentName for the copy/move dialog
  const savedSplit = currentSplit;
  const savedName = currentName;
  currentSplit = imgSplit;
  currentName = imgName;
  openCopyMove(action);
  // Restore after dialog opens
  setTimeout(() => {
    currentSplit = savedSplit;
    currentName = savedName;
  }, 100);
}

function showDupeFullscreen(which) {
  const imgObj = which === 'orig' ? window._dupeOrigImg : window._dupeDupeImg;
  const boxList = which === 'orig' ? window._dupeOrigBoxes : window._dupeDupeBoxes;
  const label = which === 'orig' ? window._dupeOrigLabel : window._dupeDupeLabel;
  const color = which === 'orig' ? 'var(--ac)' : 'var(--aco)';
  if (!imgObj) return;

  const old = document.getElementById('dupeFullscreenOverlay');
  if (old) old.remove();

  const d = document.createElement('div');
  d.id = 'dupeFullscreenOverlay';
  d.style.cssText = 'position:fixed;inset:0;z-index:99998;background:rgba(0,0,0,0.95);display:flex;flex-direction:column;padding:var(--pad-lg)';
  d.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;flex-shrink:0">
      <span style="font-size:var(--fs-md);font-weight:600;color:${color};font-family:var(--font)">${label}</span>
      <button class="btn sm danger" style="font-size:var(--fs-base);padding:var(--pad-md) 18px" onclick="document.getElementById('dupeFullscreenOverlay').remove()">✕ Close</button>
    </div>
    <div style="flex:1;display:flex;align-items:center;justify-content:center;min-height:0">
      <canvas id="dupeFullscreenCanvas" style="max-width:100%;max-height:100%"></canvas>
    </div>`;
  document.body.appendChild(d);

  requestAnimationFrame(() => {
    const canvas = document.getElementById('dupeFullscreenCanvas');
    if (!canvas) return;
    const container = canvas.parentElement;
    const cw = container.clientWidth;
    const ch = container.clientHeight;
    const iw = imgObj.naturalWidth, ih = imgObj.naturalHeight;
    const scale = Math.min(cw / iw, ch / ih) * 0.98;
    canvas.width = iw * scale;
    canvas.height = ih * scale;
    const ctx2 = canvas.getContext('2d');
    ctx2.drawImage(imgObj, 0, 0, canvas.width, canvas.height);

    for (const b of boxList) {
      const bColor = boxColor(b.cls);
      const x = (b.xc - b.w / 2) * canvas.width;
      const y = (b.yc - b.h / 2) * canvas.height;
      const w = b.w * canvas.width;
      const h = b.h * canvas.height;
      ctx2.strokeStyle = bColor;
      ctx2.lineWidth = 2;
      ctx2.strokeRect(x, y, w, h);
      const lbl = CN[b.cls] || String(b.cls);
      ctx2.font = '13px -apple-system, sans-serif';
      const tm = ctx2.measureText(lbl);
      ctx2.save();
      ctx2.globalAlpha = 0.8;
      ctx2.fillStyle = bColor;
      ctx2.fillRect(x, y - 18, tm.width + 8, 18);
      ctx2.restore();
      ctx2.fillStyle = '#000';
      ctx2.fillText(lbl, x + 4, y - 4);
    }
  });
}

function drawDupeCanvas(canvasId, image, boxList) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const container = canvas.parentElement;
  const cw = container.clientWidth;
  const ch = container.clientHeight;
  canvas.width = cw;
  canvas.height = ch;
  const ctx2 = canvas.getContext('2d');

  const iw = image.naturalWidth, ih = image.naturalHeight;
  const scale = Math.min(cw / iw, ch / ih) * 0.98;
  const dx = (cw - iw * scale) / 2;
  const dy = (ch - ih * scale) / 2;

  ctx2.drawImage(image, dx, dy, iw * scale, ih * scale);

  for (const b of boxList) {
    const color = boxColor(b.cls);
    const x = (b.xc - b.w / 2) * iw * scale + dx;
    const y = (b.yc - b.h / 2) * ih * scale + dy;
    const w = b.w * iw * scale;
    const h = b.h * ih * scale;
    ctx2.strokeStyle = color;
    ctx2.lineWidth = 2;
    ctx2.strokeRect(x, y, w, h);
    const label = CN[b.cls] || String(b.cls);
    ctx2.font = '12px -apple-system, sans-serif';
    const tm = ctx2.measureText(label);
    ctx2.save();
    ctx2.globalAlpha = 0.8;
    ctx2.fillStyle = color;
    ctx2.fillRect(x, y - 16, tm.width + 8, 16);
    ctx2.restore();
    ctx2.fillStyle = '#000';
    ctx2.fillText(label, x + 4, y - 4);
  }
}

// ============================================================
// COPY/MOVE & DELETE IMAGE
// ============================================================
// ============================================================
// COPY/MOVE DIALOG
// ============================================================
function openCopyMove(defaultAction) {
  // Remove existing
  const old = document.getElementById('copyMoveDialog');
  if (old) old.remove();

  const isLive = currentMode === 'live';
  const srcName = currentName || '';

  const d = document.createElement('div');
  d.id = 'copyMoveDialog';
  d.style.cssText = 'position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.6)';
  d.innerHTML = `
    <div style="background:var(--bg2);border:1px solid var(--bd2);border-radius:var(--radiusL);padding:var(--pad-xl);width:360px;max-width:90vw">
      <div style="font-size:var(--fs-base);font-weight:700;color:var(--t0);margin-bottom:14px">Copy / Move Image</div>
      <div style="font-size:var(--fs-xs);color:var(--t2);margin-bottom:12px;font-family:var(--font);word-break:break-all">${srcName}</div>
      <div class="sec-label">Action</div>
      <div class="flex gap-6 mb-6">
        <button class="btn sm ${defaultAction==='copy'?'active':''}" id="cmActionCopy" onclick="document.getElementById('cmActionCopy').className='btn sm active';document.getElementById('cmActionMove').className='btn sm'">Copy</button>
        <button class="btn sm ${defaultAction==='move'?'active':''}" id="cmActionMove" onclick="document.getElementById('cmActionMove').className='btn sm active';document.getElementById('cmActionCopy').className='btn sm'">Move</button>
      </div>
      <div class="sec-label">Destination Dataset</div>
      <select class="sel w-full mb-6" id="cmDataset"></select>
      <div class="sec-label">Split</div>
      <div class="flex gap-6 mb-6">
        <button class="btn sm active" id="cmSplitTrain" onclick="document.getElementById('cmSplitTrain').className='btn sm active';document.getElementById('cmSplitVal').className='btn sm'">Train</button>
        <button class="btn sm" id="cmSplitVal" onclick="document.getElementById('cmSplitVal').className='btn sm active';document.getElementById('cmSplitTrain').className='btn sm'">Val</button>
      </div>
      <div class="flex gap-8">
        <button class="btn btn-lg primary flex-1" onclick="executeCopyMove()">Confirm</button>
        <button class="btn" onclick="document.getElementById('copyMoveDialog').remove()">Cancel</button>
      </div>
    </div>`;
  document.body.appendChild(d);
  d.addEventListener('click', function(e) { if (e.target === d) d.remove(); });

  // Populate datasets
  fetch('/api/datasets').then(r => r.json()).then(ds => {
    const sel = document.getElementById('cmDataset');
    if (!sel) return;
    sel.innerHTML = ds.map(dd => {
      const selected = dd.path === CONF.DEFAULT_DATASET ? ' selected' : '';
      return `<option value="${dd.path}"${selected}>${dd.name}</option>`;
    }).join('');
  });
}

function executeCopyMove() {
  const action = document.getElementById('cmActionCopy')?.classList.contains('active') ? 'copy' : 'move';
  const dst = document.getElementById('cmDataset')?.value;
  const split = document.getElementById('cmSplitTrain')?.classList.contains('active') ? 'train' : 'val';
  const isLive = currentMode === 'live';
  if (!dst) { toast('No dataset selected', true); return; }

  fetch('/api/copymove', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({
      src_split: isLive ? '' : currentSplit, src_name: currentName,
      dst_dataset: dst, dst_split: split,
      action: action, live: isLive
    })
  }).then(r => r.json()).then(d => {
    document.getElementById('copyMoveDialog')?.remove();
    if (d.ok) {
      toast(`${action}: ${currentName} → ${split}`);
      if (action === 'move' && !isLive) loadInfo();
    } else toast(d.error || 'Error', true);
  });
}

// ============================================================
// RIGHT-CLICK CONTEXT MENU ON BOX
// ============================================================
function showBoxContextMenu(e, boxIdx) {
  closeCtxMenu();

  const b = boxes[boxIdx];
  const name = CN[b.cls] || String(b.cls);

  const m = document.createElement('div');
  m.id = 'boxCtxMenu';
  m.style.cssText = `position:fixed;left:${e.clientX}px;top:${e.clientY}px;z-index:9999;background:var(--bg2);border:1px solid var(--bd2);border-radius:var(--radius);padding:var(--pad-xs) 0;min-width:clamp(160px,12vw,260px);box-shadow:0 8px 30px rgba(0,0,0,0.7)`;

  const classes = CONF.DEFAULT_CLASSES || [0,2,15,16];
  let classItems = '';
  for (const c of classes) {
    if (c === b.cls) continue;
    classItems += `<div class="ctx-item" onclick="replaceClass(${boxIdx},${c});closeCtxMenu()">→ ${CN[c] || c}</div>`;
  }

  m.innerHTML = `
    <div style="padding:var(--pad-xs) var(--pad-md);font-size:var(--fs-xs);color:var(--t2);font-family:var(--fontUI)">${name} [${boxIdx}]</div>
    <div style="height:1px;background:var(--bd);margin:2px 0"></div>
    ${classItems ? '<div style="padding:var(--pad-xs) var(--pad-md);font-size:var(--fs-xs);color:var(--t2)">Change class to:</div><div class="ctx-class-list">' + classItems + '</div>' : ''}
    <div style="height:1px;background:var(--bd);margin:2px 0"></div>
    <div class="ctx-item" style="color:var(--acr)" onclick="deleteBox(${boxIdx});closeCtxMenu()">Delete</div>`;
  document.body.appendChild(m);

  fitMenuToViewport(m, e.clientX, e.clientY);

  // Close on click outside
  setTimeout(() => {
    document.addEventListener('click', closeCtxMenu, {once:true});
  }, 10);
}

function fitMenuToViewport(menu, anchorX, anchorY) {
  const margin = 8;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const r = menu.getBoundingClientRect();

  let left = anchorX;
  let top = anchorY;

  if (left + r.width > vw - margin) {
    left = anchorX - r.width;
    if (left < margin) left = Math.max(margin, vw - r.width - margin);
  }

  if (top + r.height > vh - margin) {
    top = anchorY - r.height;
    if (top < margin) top = Math.max(margin, vh - r.height - margin);
  }

  menu.style.left = left + 'px';
  menu.style.top = top + 'px';
}

function closeCtxMenu() {
  document.getElementById('boxCtxMenu')?.remove();
  document.getElementById('imgCtxMenu')?.remove();
}

// Right-click context menu on image (no box)
function showImageContextMenu(e) {
  closeCtxMenu();
  const m = document.createElement('div');
  m.id = 'imgCtxMenu';
  m.style.cssText = `position:fixed;left:${e.clientX}px;top:${e.clientY}px;z-index:9999;background:var(--bg2);border:1px solid var(--bd2);border-radius:var(--radius);padding:var(--pad-xs) 0;min-width:clamp(170px,12vw,270px);box-shadow:0 8px 30px rgba(0,0,0,0.7)`;

  const name = currentName || 'image';
  const shortName = name.length > 25 ? name.substring(0,22) + '...' : name;

  let items = `<div style="padding:var(--pad-xs) var(--pad-md);font-size:var(--fs-xs);color:var(--t2);font-family:var(--font)">${shortName}</div>
    <div style="height:1px;background:var(--bd);margin:2px 0"></div>
    <div class="ctx-item" onclick="closeCtxMenu();openCopyMove('copy')">📋 Copy to...</div>
    <div class="ctx-item" onclick="closeCtxMenu();openCopyMove('move')">📦 Move to...</div>
    <div style="height:1px;background:var(--bd);margin:2px 0"></div>
    <div class="ctx-item" onclick="closeCtxMenu();runAnalyse()">🤖 AI Analyse</div>`;

  if (currentMode === 'dataset') {
    items += `<div class="ctx-item" onclick="closeCtxMenu();runPreview()">👁 AI Preview</div>
    <div style="height:1px;background:var(--bd);margin:2px 0"></div>
    <div class="ctx-item" style="color:var(--acr)" onclick="closeCtxMenu();deleteImage()">🗑 Delete Image</div>`;
  }

  if (currentMode === 'video') {
    items += `<div style="height:1px;background:var(--bd);margin:2px 0"></div>
    <div class="ctx-item" style="color:var(--acg)" onclick="closeCtxMenu();videoExportFrame()">⤓ Export</div>`;
  }

  m.innerHTML = items;
  document.body.appendChild(m);

  fitMenuToViewport(m, e.clientX, e.clientY);

  setTimeout(() => {
    document.addEventListener('click', closeCtxMenu, {once:true});
  }, 10);
}

function deleteImage() {
  if (!confirm(`Delete ${currentName}?`)) return;
  const tip = document.getElementById('tipPopup');
  if (tip) tip.style.display = 'none';
  fetch('/api/del', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({ split: currentSplit, name: currentName })
  }).then(r => r.json()).then(d => {
    if (d.ok) { toast('Deleted'); loadInfo(); }
  });
}

function selectBox(idx) {
  selectedBox = idx;
  render();
  renderPanelContent();
}

function deleteBox(idx) {
  pushUndo();
  boxes.splice(idx, 1);
  if (selectedBox >= boxes.length) selectedBox = boxes.length - 1;
  saveBoxes();
  render();
  renderPanelContent();
}

// ============================================================
// GALLERY VIEW
// ============================================================
let galleryOpen = false;

function toggleGallery() {
  galleryOpen = !galleryOpen;
  const overlay = document.getElementById('galleryOverlay');
  if (galleryOpen) {
    overlay.style.display = '';
    renderGallery();
  } else {
    overlay.style.display = 'none';
  }
}

function hideGallery() {
  galleryOpen = false;
  document.getElementById('galleryOverlay').style.display = 'none';
}

function renderGallery() {
  const overlay = document.getElementById('galleryOverlay');

  if (currentMode === 'dataset') {
    // Dataset gallery — fetch file list for metadata
    fetch(`/api/flist?f=${filter}&c=${classFilter}`).then(r => r.json()).then(flist => {
      let html = '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:10px">';
      const count = flist.length;
      for (let i = 0; i < count; i++) {
        const item = flist[i];
        const selBorder = i === currentIdx ? 'border:2px solid var(--ac);' : 'border:1px solid var(--bd);';
        const selBg = i === currentIdx ? 'background:linear-gradient(135deg,rgba(59,130,246,0.15),rgba(139,92,246,0.1));' : 'background:var(--bg2);';
        const splitColor = item.split === 'train' ? 'background:rgba(59,130,246,0.2);color:#60a5fa' : 'background:rgba(249,115,22,0.2);color:#fb923c';
        const boxesColor = item.boxes > 0 ? 'background:rgba(34,197,94,0.15);color:#22c55e' : 'background:rgba(248,113,113,0.15);color:#f87171';
        html += `<div style="aspect-ratio:16/10;border-radius:10px;${selBorder}${selBg}cursor:pointer;overflow:hidden;position:relative" onclick="galleryClick(${i})">
          <img src="/img/thumb?f=${filter}&c=${classFilter}&i=${i}" style="width:100%;height:100%;object-fit:cover" loading="lazy">
          <div style="position:absolute;bottom:0;left:0;right:0;padding:var(--pad-xl) 10px 8px;background:linear-gradient(transparent,rgba(0,0,0,0.85))">
            <div style="color:var(--t0);font-weight:600;font-size:var(--fs-sm);font-family:var(--font);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${item.name.substring(0,22)}${item.name.length>22?'...':''}</div>
            <div style="display:flex;gap:5px;margin-top:4px">
              <span style="padding:2px 6px;border-radius:4px;font-size:var(--fs-xs);font-weight:600;${splitColor}">${item.split}</span>
              <span style="padding:2px 6px;border-radius:4px;font-size:var(--fs-xs);${boxesColor}">${item.boxes} boxes</span>
            </div>
          </div>
        </div>`;
      }
      html += '</div>';
      overlay.innerHTML = html;
    });

  } else if (currentMode === 'live') {
    // Live gallery — snapshot thumbnails
    const cam = document.getElementById('liveCamSel')?.value || 'all';
    const hours = parseInt(document.getElementById('liveHours')?.value || '24');
    fetch(`/api/live/list?cam=${encodeURIComponent(cam)}&hours=${hours}`).then(r => r.json()).then(list => {
      let html = '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:10px">';
      const count = list.length;
      for (let i = 0; i < count; i++) {
        const item = list[i];
        const sel = i === liveIdx ? 'border:2px solid var(--acg);' : 'border:1px solid var(--bd);';
        html += `<div style="aspect-ratio:16/10;background:var(--bg2);border-radius:8px;${sel}cursor:pointer;overflow:hidden;position:relative" onclick="galleryClickLive(${i})">
          <img src="/img/live?i=${i}&cam=${encodeURIComponent(cam)}&hours=${hours}" style="width:100%;height:100%;object-fit:cover" loading="lazy">
          <div style="position:absolute;bottom:0;left:0;right:0;padding:var(--pad-lg) 8px 4px;background:linear-gradient(transparent,rgba(0,0,0,0.85))">
            <div style="font-size:var(--fs-xs);font-family:var(--font);color:var(--t0)">${item.camera}</div>
            <div style="font-size:var(--fs-xs);color:var(--t2)">${item.mtime_str}</div>
          </div>
        </div>`;
      }
      html += '</div>';
      overlay.innerHTML = html;
    });

  } else if (currentMode === 'video') {
    // Video gallery — tabs: Clips / Frames
    const showFrames = window._videoGalleryMode === 'frames';
    let tabsHtml = `<div style="display:flex;gap:6px;margin-bottom:12px">
      <button class="btn filter${!showFrames?' active':''}" onclick="window._videoGalleryMode='clips';renderGallery()">Clips</button>
      <button class="btn filter${showFrames?' active':''}" onclick="window._videoGalleryMode='frames';renderGallery()">Frames</button>
    </div>`;

    if (!showFrames) {
      // Clips view
      fetch('/api/video/list').then(r => r.json()).then(d => {
        const clips = d.clips || d || [];
        let html = tabsHtml + '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px">';
        for (let i = 0; i < clips.length; i++) {
          const clip = clips[i];
          const isActive = clip.path === videoCurrentClip;
          const sel = isActive ? 'border:2px solid var(--acp);background:rgba(139,92,246,0.08);' : 'border:1px solid var(--bd);background:var(--bg2);';
          const sizeMB = clip.size ? (clip.size / 1024 / 1024).toFixed(1) + ' MB' : '';
          html += `<div style="border-radius:10px;${sel}cursor:pointer;padding:var(--pad-lg) 16px;transition:all 0.15s" onclick="galleryClickVideo('${clip.path.replace(/'/g, "\\'")}')">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="${isActive ? 'var(--acp)' : 'var(--t2)'}" stroke-width="2"><polygon points="23 7 16 12 23 17"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>
              <span style="font-size:var(--fs-base);font-weight:600;color:var(--t0);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${clip.name}</span>
            </div>
            <div style="font-size:var(--fs-sm);color:var(--t2);font-family:var(--font);display:flex;gap:12px">
              ${sizeMB ? '<span>' + sizeMB + '</span>' : ''}
              ${clip.mtime_str ? '<span>' + clip.mtime_str + '</span>' : ''}
            </div>
          </div>`;
        }
        html += '</div>';
        overlay.innerHTML = html;
      });
    } else {
      // Frames view — sample frames from current clip
      if (!videoCurrentClip || videoTotalFrames <= 0) {
        overlay.innerHTML = tabsHtml + '<div style="text-align:center;padding:40px;color:var(--t2)">No clip loaded. Select a clip first.</div>';
        return;
      }
      const step = Math.max(1, videoStepSize);
      let html = tabsHtml + `<div style="font-size:var(--fs-sm);color:var(--t2);margin-bottom:8px">Showing every ${step} frames from current clip (${videoTotalFrames} total)</div>`;
      html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:10px">';
      for (let f = 0; f < videoTotalFrames; f += step) {
        const isActive = f === videoCurrentFrame;
        const sel = isActive ? 'border:2px solid var(--acp);' : 'border:1px solid var(--bd);';
        const sec = Math.floor(f / 25);
        const timeStr = `${Math.floor(sec/60)}:${String(sec%60).padStart(2,'0')}`;
        html += `<div style="aspect-ratio:16/10;background:var(--bg2);border-radius:8px;${sel}cursor:pointer;overflow:hidden;position:relative" onclick="galleryClickVideoFrame(${f})">
          <img src="/api/video/frame?path=${encodeURIComponent(videoCurrentClip)}&frame=${f}" style="width:100%;height:100%;object-fit:cover" loading="lazy">
          <div style="position:absolute;bottom:0;left:0;right:0;padding:var(--pad-lg) 8px 6px;background:linear-gradient(transparent,rgba(0,0,0,0.85))">
            <div style="font-size:var(--fs-xs);font-family:var(--font);color:var(--t0)">F${f} · ${timeStr}</div>
          </div>
        </div>`;
      }
      html += '</div>';
      overlay.innerHTML = html;
    }
  }
}

function galleryClick(idx) {
  hideGallery();
  loadImage(idx);
}

function galleryClickLive(idx) {
  hideGallery();
  loadLiveImage(idx);
}

function galleryClickVideo(path) {
  hideGallery();
  loadVideoClip(path);
}

function galleryClickVideoFrame(frame) {
  hideGallery();
  loadVideoFrame(frame);
}

// ============================================================
// JUMP TO
// ============================================================
function jumpTo() {
  const val = prompt('Jump to image number (1-based):', String(currentIdx + 1));
  if (!val) return;
  const num = parseInt(val);
  if (!isNaN(num) && num >= 1 && num <= totalImages) {
    loadImage(num - 1);
  }
}

function jumpToLive() {
  const total = parseInt(document.getElementById('liveTotal')?.textContent || '0');
  const val = prompt('Jump to snapshot number (1-based):', String(liveIdx + 1));
  if (!val) return;
  const num = parseInt(val);
  if (!isNaN(num) && num >= 1 && num <= total) {
    loadLiveImage(num - 1);
  }
}

// ============================================================
// KEYBOARD SHORTCUTS
// ============================================================
function onKeyDown(e) {
  // Don't handle if in input/select
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') return;

  if (currentPage === 'viewer') {
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      if (currentMode === 'video') videoStep(videoStepSize);
      else navigate(1);
    }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (currentMode === 'video') videoStep(-videoStepSize);
      else navigate(-1);
    }
    else if (e.key === 'd' || e.key === 'D' || e.key === 'Delete') { deleteSelected(); }
    else if (e.key === 'p' || e.key === 'P') { if (selectedBox >= 0) replaceClass(selectedBox, 0); }
    else if (e.key === 'a' || e.key === 'A') { runAnalyse(); }
    else if (e.key === 'e' || e.key === 'E') { togglePanel(); }
    else if (e.key === 'g' || e.key === 'G') { toggleGallery(); }
    else if (e.key === 'j' || e.key === 'J') { jumpTo(); }
    else if (e.key === 'm' || e.key === 'M') {
      openCopyMove('copy');
    }
    else if (e.key === 'z' && e.ctrlKey) { e.preventDefault(); popUndo(); }
    else if (e.key === ' ' && currentMode === 'video') { e.preventDefault(); videoTogglePlay(); }
    else if (e.key === 'Home' && currentMode === 'video') { e.preventDefault(); loadVideoFrame(0); }
    else if (e.key === 'End' && currentMode === 'video') { e.preventDefault(); loadVideoFrame(videoTotalFrames - 1); }
  }
}

// ============================================================
// TOAST NOTIFICATIONS
// ============================================================
function toast(msg, isError) {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);padding:var(--pad-md) 20px;border-radius:8px;font-size:var(--fs-sm);font-family:var(--fontUI);z-index:99999;transition:opacity 0.3s;pointer-events:none;';
    document.body.appendChild(el);
  }
  el.style.background = isError ? 'var(--acr)' : 'var(--acg)';
  el.style.color = isError ? '#fff' : '#000';
  el.textContent = msg;
  el.style.opacity = '1';
  clearTimeout(el._timer);
  el._timer = setTimeout(() => { el.style.opacity = '0'; }, 3000);
}

// ============================================================
// MODEL LIST (for selects)
// ============================================================
function showConfigError(title, message, settingsTab) {
  const modal = document.createElement('div');
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:99999;display:flex;align-items:center;justify-content:center';
  modal.innerHTML = `
    <div style="background:var(--bg2);border:1px solid var(--acr);border-radius:12px;padding:var(--pad-xl);max-width:440px;width:90%">
      <div style="font-size:var(--fs-lg);font-weight:700;color:var(--acr);margin-bottom:8px">${title}</div>
      <div style="font-size:var(--fs-sm);color:var(--t1);line-height:1.6;margin-bottom:20px">${message}</div>
      <div style="display:flex;gap:10px">
        <button class="btn flex-1" onclick="this.closest('div[style*=fixed]').remove()">Close</button>
        <button class="btn primary flex-1" onclick="this.closest('div[style*=fixed]').remove();switchPage('settings');setTimeout(()=>setSettingsTab('${settingsTab}'),200)">Go to Settings</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
}

function loadModelsList() {
  fetch('/api/models').then(r => r.json()).then(d => {
    window._modelsList = d.models || [];

    // Settings model dropdowns — always reflect CONF values
    const confModelKeys = {s_DEFAULT_MODEL: 'DEFAULT_MODEL', s_TEACHER_MODEL: 'TEACHER_MODEL', s_STUDENT_MODEL: 'STUDENT_MODEL'};
    ['s_DEFAULT_MODEL', 's_TEACHER_MODEL', 's_STUDENT_MODEL'].forEach(id => {
      const sel = document.getElementById(id);
      if (!sel) return;
      const confBasename = (CONF[confModelKeys[id]] || '').split('/').pop();
      sel.innerHTML = '';
      if (window._modelsList.length === 0) {
        sel.innerHTML = '<option value="" disabled selected>No models found</option>';
      } else {
        window._modelsList.forEach(m => {
          const name = m.split('/').pop();
          const opt = document.createElement('option');
          opt.value = m;
          opt.textContent = name;
          if (name === confBasename) opt.selected = true;
          sel.appendChild(opt);
        });
      }
    });

    // AI panel model dropdown — always CONF.DEFAULT_MODEL unless manually overridden
    const aiSel = document.getElementById('aiModel');
    if (aiSel) {
      const targetBasename = (modelOverride || CONF.DEFAULT_MODEL || '').split('/').pop();
      aiSel.innerHTML = '';
      window._modelsList.forEach(m => {
        const name = m.split('/').pop();
        const opt = document.createElement('option');
        opt.value = m;
        opt.textContent = name;
        if (name === targetBasename) opt.selected = true;
        aiSel.appendChild(opt);
      });
    }

    // Re-render trainer if on that page AND no job running
    if (currentPage === 'trainer' && !trainerPollTimer) renderTrainerStep();
  });
}

// ============================================================
// TOOLTIP SYSTEM
// ============================================================
function initTooltips() {
  const popup = document.getElementById('tipPopup');
  if (!popup) return;

  document.addEventListener('mouseover', function(e) {
    if (!helpersEnabled) return;
    const target = e.target.closest('[data-tip]');
    if (!target) return;
    const text = target.getAttribute('data-tip');
    if (!text) return;

    const rect = target.getBoundingClientRect();
    popup.textContent = text;
    popup.style.display = '';

    // Measure popup dimensions
    const pw = popup.offsetWidth;
    const ph = popup.offsetHeight;

    // Horizontal — center on target, clamp to viewport
    let left = rect.left + rect.width / 2 - pw / 2;
    left = Math.max(8, Math.min(window.innerWidth - pw - 8, left));

    // Vertical — prefer above, flip below if no room
    let top;
    const flipBelow = rect.top < ph + 16;
    if (flipBelow) {
      top = rect.bottom + 8;
      // Clamp bottom edge
      if (top + ph > window.innerHeight - 8) top = window.innerHeight - ph - 8;
    } else {
      top = rect.top - ph - 8;
      if (top < 8) top = 8;
    }

    popup.style.left = left + 'px';
    popup.style.top = top + 'px';
    popup.style.bottom = '';
    popup.style.transform = '';
  });

  document.addEventListener('mouseout', function(e) {
    const target = e.target.closest('[data-tip]');
    if (target) {
      popup.style.display = 'none';
    }
  });
}


// ============================================================
// INIT
// ============================================================
window.addEventListener('DOMContentLoaded', () => {
  // Recover trainer/pipeline state FIRST for instant UI on refresh
  _recoverTrainerState();
  loadModelsList();
  initClassPicker();
  initTooltips();
  init();
  updatePanelToggle();
  updateSidebarToggle();
});

function _recoverTrainerState() {
  return fetch('/api/trainer/status').then(r => r.json()).then(allStatus => {
    const pipelineState = allStatus._pipeline;
    const stepIdMap = STEP_ID_MAP;

    // Recover server-persisted reports (renderTrainerStep will display them inline)
    if (allStatus._reports) {
      _serverReports = allStatus._reports;
    }

    if (pipelineState && pipelineState.steps && pipelineState.steps.length > 0) {
      const selected = pipelineState.steps.map(name => ({ id: stepIdMap[name] ?? 0, name }));
      const total = selected.length;
      const startTime = Date.now();

      pipelineRunning = true;
      window._pipelineAborted = false;
      trainerTab = 'config';
      _setPipelineBtn(true);

      _renderPipelineShell(selected, total);

      // Render completed steps immediately
      const stepKeyMap = STEP_KEY_MAP;
      for (const s of selected) {
        const key = stepKeyMap[s.name];
        const d = key ? allStatus[key] : null;
        if (d && d.result) {
          const ok = d.result.ok !== false;
          let detail = '';
          if (key === 'export')     detail = `${d.result.exported||0} new, ${d.result.existing||0} reused`;
          else if (key === 'dedup') detail = `-${(d.result.steps||[]).reduce((a,x)=>a+(x.removed||0),0)} removed`;
          else if (key === 'annotate') detail = `${d.result.annotated||0} labeled, ${d.result.total_boxes||0} boxes`;
          else if (key === 'train') detail = d.result.output ? d.result.output.split('/').pop() : 'complete';
          else if (key === 'onnx')  detail = d.result.output ? d.result.output.split('/').pop() : 'exported';
          _plStepDone(s, ok, detail);
          if (key === 'train' && d.epochs && d.epochs.length > 0) {
            const scroll = document.getElementById('plEpochScroll');
            const container = document.getElementById('plEpochContainer');
            if (scroll && container) {
              container.style.display = '';
              for (const ep of d.epochs) _appendEpochRow(scroll, ep);
            }
          }
        }
      }

      // Resume polling
      _pollPipeline(selected, total, startTime);
      return;
    }

    // No pipeline — recover individual module state
    let anyRunning = false;
    for (const [step, d] of Object.entries(allStatus)) {
      if (step === '_pipeline' || step === '_reports') continue;
      if (d && d.running && _stepState[step]) {
        _stepState[step].running = true;
        _stepState[step].startTime = Date.now();
        if (step === 'train') _individualEpochCount = 0;
        anyRunning = true;
      }
    }
    if (anyRunning) startTrainerPoll();

    // Show individual step reports recovered from server (if not already showing pipeline report)
    if (!allStatus._reports?.pipeline) {
      const stepKeys = ['export', 'dedup', 'annotate', 'train', 'onnx'];
      const currentStepKey = stepKeys[trainerStep];
      if (currentStepKey && _serverReports[currentStepKey]) {
        _stepState[currentStepKey].pendingReport = _serverReports[currentStepKey];
      }
    }
  }).catch(e => {
    console.log('Recovery fetch failed:', e);
  });
}
