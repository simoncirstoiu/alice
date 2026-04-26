// ============================================================
// STATE
// ============================================================
const CN = %%CLASS_NAMES_JS%%;          // {0:"person", 1:"bicycle", ...}
const CONF = %%CONF_JS%%;               // full config from alice.conf
const DEFAULT_CLASSES = %%DEFAULT_CLASSES_JS%%;
const FIRST_RUN = %%FIRST_RUN%%;
const DEVICE_INFO = %%DEVICE_INFO%%;
const UI_STATE = %%UI_STATE_JS%%;       // server-side UI state

// Fire-and-forget: persist UI state to server
function _saveUI(updates) {
  fetch('/api/ui/state', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(updates)
  }).catch(() => {});
}

let currentPage = UI_STATE.page || 'viewer';
let currentMode = UI_STATE.mode || 'dataset';
let filter = 'all';
let classFilter = -1;
let currentIdx = 0;
let totalImages = 0;
let currentSplit = '';
let currentName = '';
let boxes = [];
let selectedBox = -1;
let panelOpen = UI_STATE.panel_open !== false;
let panelTab = UI_STATE.panel_tab || 'edit';
let helpersEnabled = CONF.HELPERS_ENABLED !== false;

// Image state
let img = new Image();
let imgLoaded = false;
let zoom = 1.0;
let panX = 0, panY = 0;
let canvasW = 0, canvasH = 0;

// Drawing state
let drawing = false, drawStartX = 0, drawStartY = 0, drawCurX = 0, drawCurY = 0;
let dragging = false, dragIdx = -1, dragOffX = 0, dragOffY = 0, dragMoved = false;
let resizing = false, resizeIdx = -1, resizeHandle = '';
let scrollFrozen = false;
const HANDLE = 8;

// Undo
let undoStack = [];
const MAX_UNDO = 50;

// AI state
let modelOverride = null;
let confOverride = null;
let liveDetection = false;
let aiPreviewBoxes = [];
let aiModelStatus = 'idle'; // idle, loading, loaded

// Navigation counter — incremented on every image change, used to cancel stale async ops
let _navCounter = 0;

let _flashTimer = null;

let _filterDirty = false;

let _datasetTotalUnfiltered = -1;

let STATE_DATASET_PATH = '';

// Dependency cache — updated at startup and after install
let _depsInstalled = {};  // { "ultralytics": true, "cv2": false, ... }

function refreshDepsCache() {
  return fetch('/api/deps/check').then(r => r.json()).then(deps => {
    for (const d of deps) _depsInstalled[d.import] = d.installed;
  }).catch(() => {});
}

function requireDep(importName, friendlyName) {
  if (_depsInstalled[importName]) return true;
  toast(`${friendlyName} is not installed. Go to Settings → System to install dependencies.`, true);
  return false;
}

function requireModel() {
  const aiSel = document.getElementById('aiModel');
  let model = aiSel ? aiSel.value : '';
  // Fallback when AI tab is not rendered: resolve from override / CONF default
  if (!model) {
    const target = (modelOverride || CONF.DEFAULT_MODEL || '').split('/').pop();
    model = (window._modelsList || []).find(m => m.split('/').pop() === target) || '';
  }
  if (model && (window._modelsList || []).length > 0) return true;
  if ((window._modelsList || []).length === 0) {
    toast('No models available. Download a model from Settings first.', true);
  } else {
    toast('No model selected. Select a model in the AI panel.', true);
  }
  return false;
}

// Video state
let videoStepSize = 5;
let videoPlayFps = 10;
let videoPlaying = false;
let videoPlayTimer = null;
let videoTotalFrames = 0;
let videoCurrentFrame = 0;
let videoCurrentClip = '';

// Trainer state
let trainerStep = UI_STATE.trainer_step || 0;
let trainerTab = UI_STATE.trainer_tab || 'config';
let trainerStepsOpen = true;
let trainerDataset = ''; // Independent dataset for trainer, defaults to viewer dataset

// Color map for classes
const CLASS_COLORS = {
  0:'#34d399', 2:'#4f8cff', 15:'#fbbf24', 16:'#fb923c',
  1:'#f472b6', 3:'#a78bfa', 5:'#22d3ee', 7:'#6ee7b7',
};
function boxColor(cls) {
  if (CLASS_COLORS[cls]) return CLASS_COLORS[cls];
  const hue = (cls * 137.5) % 360;
  return `hsl(${hue},70%,60%)`;
}

// ============================================================
// INITIALIZATION
// ============================================================
const canvas = document.getElementById('mainCanvas');
const ctx = canvas.getContext('2d');

function init() {
  resizeCanvas();
  requestAnimationFrame(() => {
    resizeCanvas();
    if (imgLoaded) { fitImage(); render(); }
  });
  window.addEventListener('resize', resizeCanvas);

  const dsel = document.getElementById('datasetSel');
  if (dsel) STATE_DATASET_PATH = dsel.value;

  // Load settings into Settings page
  loadSettingsUI();

  // Helpers toggle
  updateHelpersToggle();

  // Restore UI state from server-injected UI_STATE (no localStorage)
  if (currentPage && currentPage !== 'viewer') switchPage(currentPage);
  if (currentMode && currentMode !== 'dataset') switchMode(currentMode);
  if (UI_STATE.settings_tab) setSettingsTab(UI_STATE.settings_tab);
  const p = document.getElementById('panel');
  if (p) p.classList.toggle('collapsed', !panelOpen);
  if (panelTab) setPanelTab(panelTab);

  // Load initial data
  if (currentMode === 'dataset') loadInfo();

  // Panel tabs for default mode
  updatePanelTabs();

  // Update sidebar toggle position
  updateSidebarToggle();

  document.addEventListener('keydown', onKeyDown);

  document.addEventListener('change', (e) => {
    if (e.target && e.target.tagName === 'SELECT') {
      e.target.blur();
    }
  });

  // Check GPU status for sidebar — poll every 5s
  updateSidebarGpu();
  setInterval(updateSidebarGpu, 5000);

  // Sync AI model status from server
  syncAiModelStatus();
  setInterval(syncAiModelStatus, 5000);

  // Cache dependency status
  refreshDepsCache();

  // Init trainer dataset from selector (defaults to viewer dataset)
  const tds = document.getElementById('trainerDatasetSel');
  if (tds) trainerDataset = tds.value;

  // Background refresh — poll /api/version every 2s, reload on change
  setInterval(backgroundRefresh, 2000);

  // Check for missing dependencies at startup
  Promise.all([
    fetch('/api/deps/check').then(r => r.json()),
    fetch('/api/deps/status').then(r => r.json())
  ]).then(([deps, dStatus]) => {
    const missing = deps.filter(d => !d.installed);
    if (missing.length === 0) return;
    // Don't show deps modal if welcome card is visible — welcome card handles it
    if (FIRST_RUN) return;
    // Don't show deps modal if install is already in progress
    if (dStatus.running) return;
    const names = missing.map(d => d.name).join(', ');
    const modal = document.createElement('div');
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:99999;display:flex;align-items:center;justify-content:center';
    modal.innerHTML = `
      <div style="background:var(--bg2);border:1px solid var(--bd2);border-radius:12px;padding:28px;max-width:440px;width:90%">
        <div style="font-size:var(--fs-lg);font-weight:700;color:var(--t0b);margin-bottom:8px">Missing Dependencies</div>
        <div style="font-size:var(--fs-sm);color:var(--t1);line-height:1.6;margin-bottom:20px">
          ${missing.length} package${missing.length > 1 ? 's' : ''} not installed: <span style="color:var(--acy);font-family:var(--font)">${names}</span>
          <br>Install them now for full functionality?
        </div>
        <div style="display:flex;gap:10px">
          <button class="btn flex-1" onclick="this.closest('div[style*=fixed]').remove()">Later</button>
          <button class="btn primary flex-1" onclick="this.closest('div[style*=fixed]').remove();switchPage('settings');setTimeout(()=>{setSettingsTab('system');setTimeout(installMissingDeps,300)},200)">Install Now</button>
        </div>
      </div>`;
    document.body.appendChild(modal);
  }).catch(() => {});

  // Show welcome card on first run
  if (FIRST_RUN) showWelcome();
}

let _lastVersions = { dataset: -1, live: -1, video: -1 };

function backgroundRefresh() {
  fetch('/api/version').then(r => r.json()).then(v => {
    _datasetTotalUnfiltered = v.total;

    // Dataset
    if (_lastVersions.dataset >= 0 && v.dataset !== _lastVersions.dataset) {
      totalImages = v.total;
      if (currentPage === 'viewer' && currentMode === 'dataset') {
        document.getElementById('imgTotal').textContent = v.total;
        if (v.total === 0 && !currentName) { clearCanvas(); }
        else if (currentSplit && currentName) {
          // Resolve current image position by name after re-sort
          fetch(`/api/flist?f=${filter}&c=${classFilter}`).then(r => r.json()).then(list => {
            const newIdx = list.findIndex(x => x.split === currentSplit && x.name === currentName);
            if (newIdx >= 0) {
              currentIdx = newIdx;
              document.getElementById('imgIdx').textContent = newIdx + 1;
              document.getElementById('imgTotal').textContent = list.length;
            } else {
              // Image left current filter (e.g. was empty, now has boxes)
              // Don't yank the image away — keep showing it, just update counter
              document.getElementById('imgTotal').textContent = list.length;
            }
          }).catch(() => {});
        } else {
          if (currentIdx >= v.total) currentIdx = Math.max(0, v.total - 1);
          if (v.total > 0) loadImage(currentIdx);
        }
      }
    }
    _lastVersions.dataset = v.dataset;

    // Live
    if (_lastVersions.live >= 0 && v.live !== _lastVersions.live) {
      if (currentPage === 'viewer' && currentMode === 'live') {
        document.getElementById('liveTotal').textContent = v.live_total;
        // Don't reload current image — just update the count
      }
    }
    _lastVersions.live = v.live;

    // Video
    if (_lastVersions.video >= 0 && v.video !== _lastVersions.video) {
      if (currentPage === 'viewer' && currentMode === 'video') {
        loadVideoList();
      }
    }
    _lastVersions.video = v.video;
  }).catch(() => {});
}

function updateSidebarGpu() {
  fetch('/api/gpu').then(r => r.json()).then(d => {
    const nameEl = document.getElementById('gpuName');
    const dot = document.getElementById('gpuDot');
    const details = document.getElementById('gpuDetails');
    if (!nameEl) return;
    if (d.mode === 'cpu') {
      nameEl.textContent = d.gpu_name || 'CPU Mode';
      if (dot) dot.style.background = 'var(--acy)';
      if (details) {
        details.style.display = '';
        const t = document.getElementById('gpuDetTemp');
        const v = document.getElementById('gpuDetVram');
        const p = document.getElementById('gpuDetPower');
        const u = document.getElementById('gpuDetUtil');
        if (t) t.textContent = d.temp ? d.temp + '°C' : '-';
        if (v) v.textContent = d.mem_used && d.mem_total ? d.mem_used + '/' + d.mem_total + ' MiB' : '-';
        if (p) p.textContent = d.cores ? d.cores + ' cores' : '-';
        if (u) u.textContent = d.load ? d.load : '-';
      }
    } else if (d.ok && d.temp) {
      nameEl.textContent = d.gpu_name || 'GPU';
      if (dot) dot.style.background = 'var(--acg)';
      if (details) {
        details.style.display = '';
        const t = document.getElementById('gpuDetTemp');
        const v = document.getElementById('gpuDetVram');
        const p = document.getElementById('gpuDetPower');
        const u = document.getElementById('gpuDetUtil');
        if (t) t.textContent = d.temp + '°C';
        if (v) v.textContent = d.vram_used + '/' + d.vram_total + ' MiB';
        if (p) p.textContent = d.power + 'W';
        if (u) u.textContent = d.util + '%';
      }
    } else if (d.ok) {
      nameEl.textContent = d.gpu_name || 'GPU Available';
      if (dot) dot.style.background = 'var(--acg)';
    } else {
      nameEl.textContent = 'GPU: ' + (d.error || 'N/A');
      if (dot) dot.style.background = 'var(--acr)';
      if (details) details.style.display = 'none';
    }
  }).catch(() => {
    const nameEl = document.getElementById('gpuName');
    if (nameEl) nameEl.textContent = 'GPU: N/A';
  });
}

function syncAiModelStatus() {
  fetch('/api/ai/status').then(r => r.json()).then(d => {
    // Check if we even have a model selected
    const aiSel = document.getElementById('aiModel');
    const selectedModel = aiSel ? aiSel.value.split('/').pop() : '';
    const hasModel = selectedModel && (window._modelsList || []).length > 0;

    if (!hasModel) {
      aiModelStatus = 'idle';
    } else if (d.loaded && d.model === selectedModel) {
      aiModelStatus = 'loaded';
    } else if (aiModelStatus !== 'loading') {
      aiModelStatus = 'idle';
    }
    // Update status indicator in-place without full panel re-render
    const dots = document.querySelectorAll('.ai-status-dot');
    const texts = document.querySelectorAll('.ai-status-text');
    let color, label;
    if (!hasModel) {
      color = 'var(--acr)'; label = '○ No model selected';
    } else if (aiModelStatus === 'loaded') {
      color = '#22c55e'; label = '● Model ready';
    } else if (aiModelStatus === 'loading') {
      color = 'var(--acy)'; label = '◌ Loading...';
    } else {
      color = 'var(--t2)'; label = '○ Not loaded';
    }
    dots.forEach(el => el.style.background = color);
    texts.forEach(el => { el.style.color = color; el.textContent = label; });
  }).catch(() => {});
}

function cancelFlash() {
  if (_flashTimer) { clearInterval(_flashTimer); _flashTimer = null; }
}

function resizeCanvas() {
  const area = document.getElementById('canvasArea');
  if (!area) return;
  canvasW = area.clientWidth;
  canvasH = area.clientHeight;
  canvas.width = canvasW;
  canvas.height = canvasH;
  canvas.style.width = canvasW + 'px';
  canvas.style.height = canvasH + 'px';
  if (imgLoaded) fitImage();
  render();
}

// ============================================================
// PAGE / MODE NAVIGATION
// ============================================================
function switchPage(page) {
  currentPage = page;
  _saveUI({page: page});
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById('page-' + page).classList.add('active');

  document.querySelectorAll('.sidebar-item[data-page]').forEach(el => {
    el.classList.toggle('active', el.dataset.page === page);
  });

  // Show/hide source section + viewer panel toggle
  const srcSection = document.getElementById('sourceSection');
  const panelToggleBtn = document.getElementById('panelToggle');
  if (page === 'viewer') {
    if (srcSection) srcSection.style.display = '';
    if (panelToggleBtn) panelToggleBtn.style.display = '';
  } else {
    if (srcSection) srcSection.style.display = 'none';
    if (panelToggleBtn) panelToggleBtn.style.display = 'none';
  }

  if (page === 'trainer') { if (typeof _updateTrainerToolbarTitle === 'function') _updateTrainerToolbarTitle(); renderTrainerStep(); }
  if (page === 'settings') { loadSettingsUI(); loadDependencies(); loadPythonInfo(); }
  if (page === 'viewer') {
    // Reload data for current mode when switching back to viewer
    setTimeout(() => {
      resizeCanvas();
      if (currentMode === 'dataset') loadInfo();
      else if (currentMode === 'live') loadLive();
      else if (currentMode === 'video') loadVideoList();
    }, 50);
  }
}

function switchMode(mode) {
  currentMode = mode;
  _saveUI({mode: mode});
  currentIdx = 0;

  // Clear previous state
  boxes = [];
  aiPreviewBoxes = [];
  selectedBox = -1;
  imgLoaded = false;
  ctx.clearRect(0, 0, canvasW, canvasH);
  // Clear selection
  document.getElementById('selectionBadge').style.display = 'none';
  document.getElementById('selectionBadge').style.display = 'none';

  document.querySelectorAll('.sidebar-item[data-mode]').forEach(el => {
    const isActive = el.dataset.mode === mode;
    el.classList.toggle('mode-active', isActive);
    const badge = el.querySelector('.sidebar-badge');
    if (badge) badge.style.display = isActive ? '' : 'none';
  });

  // Show correct toolbar
  document.getElementById('toolbar-dataset').style.display = mode === 'dataset' ? '' : 'none';
  document.getElementById('toolbar-live').style.display = mode === 'live' ? '' : 'none';
  document.getElementById('toolbar-video').style.display = mode === 'video' ? '' : 'none';
  document.getElementById('toolbar-video2').style.display = mode === 'video' ? '' : 'none';

  // Reset panel tab per mode
  if (mode === 'dataset') panelTab = 'edit';
  else if (mode === 'live') panelTab = 'ai';
  else if (mode === 'video') panelTab = 'ai';

  updatePanelTabs();
  hideGallery();

  // Load data for mode
  if (mode === 'dataset') loadInfo();
  else if (mode === 'live') loadLive();
  else if (mode === 'video') loadVideoList();
}

// ============================================================
// SIDEBAR
// ============================================================
function toggleSidebar() {
  const sb = document.getElementById('sidebar');
  sb.classList.toggle('collapsed');
  updateSidebarToggle();
}

function updateSidebarToggle() {
  const sb = document.getElementById('sidebar');
  const btn = document.getElementById('sidebarToggle');
  const collapsed = sb.classList.contains('collapsed');
  // Update inline button arrow and label
  const arrow = btn.querySelector('.arrow');
  if (arrow) arrow.textContent = collapsed ? '›' : '‹';
  // Resize canvas after sidebar change
  setTimeout(resizeCanvas, 250);
}

// ============================================================
// RIGHT PANEL
// ============================================================
function togglePanel() {
  panelOpen = !panelOpen;
  _saveUI({panel_open: panelOpen});
  const p = document.getElementById('panel');
  p.classList.toggle('collapsed', !panelOpen);
  updatePanelToggle();
  setTimeout(resizeCanvas, 250);
}

function updatePanelToggle() {
  const btn = document.getElementById('panelToggle');
  if (!btn) return;
  const arrow = btn.querySelector('.arrow');
  if (arrow) arrow.textContent = panelOpen ? '›' : '‹';
}

function updatePanelTabs() {
  const tabsEl = document.getElementById('panelTabs');
  const bodyEl = document.getElementById('panelBody');
  let tabs = [];

  if (currentMode === 'dataset') {
    tabs = [
      {id:'edit', label:'Edit', icon:'edit', tip:'Edit bounding boxes, manage annotations, quick actions.'},
      {id:'ai', label:'AI', icon:'ai', tip:'Run AI detection on the current image.'},
      {id:'dupes', label:'Dupes', icon:'dupes', tip:'Find and compare duplicate images using pHash.'},
      {id:'stats', label:'Stats', icon:'stats', tip:'Dataset statistics: image counts, class distribution.'},
    ];
  } else if (currentMode === 'live') {
    tabs = [
      {id:'ai', label:'AI', icon:'ai', tip:'Run AI detection on the current snapshot.'},
      {id:'transfer', label:'Info', icon:'info', tip:'Transfer snapshot to dataset or view info.'},
    ];
  } else if (currentMode === 'video') {
    tabs = [
      {id:'ai', label:'AI', icon:'ai', tip:'Run AI detection on the current frame.'},
      {id:'scanner', label:'Scanner', icon:'search', tip:'Scan all frames automatically and find interesting ones.'},
      {id:'export', label:'Export', icon:'export', tip:'Export video frames to dataset.'},
    ];
  }

  const icons = {
    edit: '<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>',
    ai: '<path d="M12 2a4 4 0 0 1 4 4v1h2a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h2V6a4 4 0 0 1 4-4z"/><circle cx="9" cy="13" r="1"/><circle cx="15" cy="13" r="1"/>',
    stats: '<path d="M18 20V10"/><path d="M12 20V4"/><path d="M6 20v-6"/>',
    dupes: '<rect x="8" y="2" width="13" height="13" rx="2"/><path d="M3 7a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h11"/>',
    copy: '<rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
    search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>',
    info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
    export: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
  };

  let html = '';
  for (const t of tabs) {
    const active = t.id === panelTab ? ' active' : '';
    const svgInner = icons[t.icon] || '';
    html += `<div class="panel-tab${active}" data-tab="${t.id}" data-tip="${t.tip}" onclick="setPanelTab('${t.id}')">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${svgInner}</svg>
      ${t.label}
    </div>`;
  }
  tabsEl.innerHTML = html;
  renderPanelContent();
}

function setPanelTab(tab) {
  panelTab = tab;
  _saveUI({panel_tab: tab});
  document.querySelectorAll('.panel-tab').forEach(el => {
    el.classList.toggle('active', el.dataset.tab === tab);
  });
  renderPanelContent();
}

function renderPanelContent() {
  const tip = document.getElementById('tipPopup');
  if (tip) tip.style.display = 'none';
  const body = document.getElementById('panelBody');
  if (panelTab === 'edit' && currentMode === 'dataset') body.innerHTML = renderEditTab();
  else if (panelTab === 'ai') body.innerHTML = renderAITab();
  else if (panelTab === 'stats' && currentMode === 'dataset') body.innerHTML = renderStatsTab();
  else if (panelTab === 'dupes' && currentMode === 'dataset') body.innerHTML = renderDupesTab();
  else if (panelTab === 'transfer' && currentMode === 'live') body.innerHTML = renderTransferTab();
  else if (panelTab === 'scanner' && currentMode === 'video') body.innerHTML = renderScannerTab();
  else if (panelTab === 'export' && currentMode === 'video') { body.innerHTML = renderExportTab(); initExportTab(); }
  else body.innerHTML = '';
}

// ============================================================
// DATASET MODE - LOADING & NAVIGATION
// ============================================================
function loadInfo() {
  fetch(`/api/info?f=${filter}&c=${classFilter}`)
    .then(r => r.json())
    .then(d => {
      totalImages = d.total;
      document.getElementById('imgTotal').textContent = totalImages;
      if (currentIdx >= totalImages) currentIdx = Math.max(0, totalImages - 1);
      if (totalImages > 0) {
        if (filter === 'all' && classFilter === -1) {
          _datasetTotalUnfiltered = d.total;
        }
        loadImage(currentIdx);
      } else {
        if (filter === 'all' && classFilter === -1) {
          _datasetTotalUnfiltered = 0;
          clearCanvas();
        } else if (_datasetTotalUnfiltered >= 0) {
          clearCanvas();
        } else {
          fetch('/api/version').then(r => r.json()).then(v => {
            _datasetTotalUnfiltered = v.total;
            clearCanvas();
          }).catch(() => clearCanvas());
        }
      }
    });
}

function loadImage(idx) {
  if (idx < 0 || idx >= totalImages) return;
  _navCounter++;
  cancelFlash();
  currentIdx = idx;
  document.getElementById('imgIdx').textContent = idx + 1;

  fetch(`/api/meta?f=${filter}&c=${classFilter}&i=${idx}`)
    .then(r => r.json())
    .then(d => {
      currentSplit = d.split;
      currentName = d.name;
      boxes = d.box_data || [];
      selectedBox = -1;
      aiPreviewBoxes = [];
      undoStack = [];
      // Reset dupe cache for new image
      if (typeof _dupeResultsHTML !== 'undefined') _dupeResultsHTML = '';
      window._dupeList = [];
      window._dupeCurrentIdx = 0;

      img = new Image();
      img.onload = () => {
        imgLoaded = true;
        const es = document.getElementById('emptyState');
        if (es) es.style.display = 'none';
        fitImage();
        render();
        updatePanelInfo();
        flashPersonBoxes();

        // Auto AI in live detection mode (dataset)
        if (liveDetection && currentMode === 'dataset') runPreview();
      };
      img.src = `/img/raw?f=${filter}&c=${classFilter}&i=${idx}&t=${Date.now()}`;
    });
}

function clearCanvas() {
  imgLoaded = false;
  boxes = [];
  selectedBox = -1;
  ctx.clearRect(0, 0, canvasW, canvasH);
  const tfi = document.getElementById('toolbarFileInfo');
  if (tfi) tfi.textContent = '';
  document.getElementById('selectionBadge').style.display = 'none';
  const es = document.getElementById('emptyState');
  const est = document.getElementById('emptyStateText');
  if (es) {
    es.style.display = 'flex';
    if (est) {
      if (currentMode === 'live') {
        est.innerHTML = 'No live snapshots found.<br><span style="font-size:var(--fs-sm);color:var(--t3)">Check that LIVE_DIR is configured in Settings and Frigate is generating snapshots.</span>';
      } else if (currentMode === 'video') {
        est.innerHTML = 'No video clips found.<br><span style="font-size:var(--fs-sm);color:var(--t3)">Check that EXPORTS_DIR is configured in Settings and contains video files.</span>';
      } else {
        const hasActiveFilter = (filter !== 'all' || classFilter !== -1);
        const datasetHasImages = (_datasetTotalUnfiltered > 0);
        if (hasActiveFilter && datasetHasImages) {
          est.innerHTML = 'No images match the active filter.<br><span style="font-size:var(--fs-sm);color:var(--t3)">Try a different split or class, or clear the filter.</span>';
        } else {
          est.innerHTML = 'No images in dataset.<br><span style="font-size:var(--fs-sm);color:var(--t3)">Use Live mode to import snapshots, or run the Export step in Trainer.</span>';
        }
      }
    }
  }
}

function updatePanelInfo() {
  if (panelTab === 'edit' || panelTab === 'dupes') renderPanelContent();
  const tfi = document.getElementById('toolbarFileInfo');
  if (tfi) tfi.textContent = `/${currentSplit}/${currentName} • ${boxes.length} boxes`;
}

function setFilter(f) {
  filter = f;
  currentIdx = 0;
  _filterDirty = false;
  document.querySelectorAll('#toolbar-dataset [data-filter]').forEach(el => {
    el.classList.toggle('active', el.dataset.filter === f);
  });
  loadInfo();
}

function setClassFilter(c) {
  classFilter = c;
  currentIdx = 0;
  _filterDirty = false;
  loadInfo();
}

function navigate(delta) {
  if (currentMode === 'dataset') {
    if (_filterDirty) {
      _filterDirty = false;
      fetch(`/api/info?f=${filter}&c=${classFilter}`)
        .then(r => r.json())
        .then(d => {
          totalImages = d.total;
          document.getElementById('imgTotal').textContent = totalImages;
          if (totalImages === 0) { clearCanvas(); return; }
          if (currentIdx >= totalImages) currentIdx = totalImages - 1;
          let newIdx = currentIdx + delta;
          if (newIdx < 0) newIdx = totalImages - 1;
          else if (newIdx >= totalImages) newIdx = 0;
          loadImage(newIdx);
        })
        .catch(() => {
          let newIdx = currentIdx + delta;
          if (newIdx < 0) newIdx = totalImages - 1;
          else if (newIdx >= totalImages) newIdx = 0;
          if (totalImages > 0) loadImage(newIdx);
        });
      return;
    }
    let newIdx = currentIdx + delta;
    if (newIdx < 0) newIdx = totalImages - 1;
    else if (newIdx >= totalImages) newIdx = 0;
    if (totalImages > 0) loadImage(newIdx);
  } else if (currentMode === 'live') {
    navigateLive(delta);
  }
}

// ============================================================
// CANVAS RENDERING
// ============================================================
function fitImage() {
  if (!imgLoaded) return;
  const iw = img.naturalWidth, ih = img.naturalHeight;
  const scale = Math.min((canvasW - 4) / iw, (canvasH - 4) / ih);
  zoom = scale;
  panX = (canvasW - iw * zoom) / 2;
  panY = (canvasH - ih * zoom) / 2;
}

function render() {
  ctx.clearRect(0, 0, canvasW, canvasH);
  if (!imgLoaded) return;

  const iw = img.naturalWidth, ih = img.naturalHeight;

  ctx.save();
  ctx.translate(panX, panY);
  ctx.scale(zoom, zoom);

  // Draw image
  ctx.drawImage(img, 0, 0, iw, ih);

  // Draw boxes
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i];
    const color = boxColor(b.cls);
    const x = (b.xc - b.w / 2) * iw;
    const y = (b.yc - b.h / 2) * ih;
    const w = b.w * iw;
    const h = b.h * ih;

    ctx.strokeStyle = color;
    ctx.lineWidth = i === selectedBox ? 3 / zoom : 2 / zoom;
    ctx.strokeRect(x, y, w, h);
    // Label background
    const label = CN[b.cls] || String(b.cls);
    ctx.font = `${Math.max(11, 13 / zoom)}px -apple-system, sans-serif`;
    const tm = ctx.measureText(label);
    const lh = 16 / zoom;
    ctx.save();
    ctx.globalAlpha = 0.8;
    ctx.fillStyle = color;
    ctx.fillRect(x, y - lh, tm.width + 8 / zoom, lh);
    ctx.restore();
    ctx.fillStyle = '#000';
    ctx.fillText(label, x + 4 / zoom, y - 4 / zoom);

    // Selection handles
    if (i === selectedBox) {
      const hs = HANDLE / zoom;
      ctx.fillStyle = color;
      // corners
      ctx.fillRect(x - hs/2, y - hs/2, hs, hs);
      ctx.fillRect(x + w - hs/2, y - hs/2, hs, hs);
      ctx.fillRect(x - hs/2, y + h - hs/2, hs, hs);
      ctx.fillRect(x + w - hs/2, y + h - hs/2, hs, hs);
      // midpoints
      ctx.fillRect(x + w/2 - hs/2, y - hs/2, hs, hs);
      ctx.fillRect(x + w/2 - hs/2, y + h - hs/2, hs, hs);
      ctx.fillRect(x - hs/2, y + h/2 - hs/2, hs, hs);
      ctx.fillRect(x + w - hs/2, y + h/2 - hs/2, hs, hs);
    }
  }

  // AI preview boxes (dashed)
  for (const b of aiPreviewBoxes) {
    const color = boxColor(b.cls);
    const x = (b.xc - b.w / 2) * iw;
    const y = (b.yc - b.h / 2) * ih;
    const w = b.w * iw;
    const h = b.h * ih;

    ctx.strokeStyle = color;
    ctx.lineWidth = 2 / zoom;
    ctx.setLineDash([6 / zoom, 4 / zoom]);
    ctx.strokeRect(x, y, w, h);
    ctx.setLineDash([]);

    const label = `${CN[b.cls] || b.cls} ${(b.conf || 0).toFixed(2)}`;
    ctx.font = `${Math.max(10, 12 / zoom)}px 'JetBrains Mono', monospace`;
    ctx.fillStyle = color;
    ctx.fillText(label, x, y - 4 / zoom);
  }

  ctx.restore();

  // Drawing in progress
  if (drawing) {
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    const x = Math.min(drawStartX, drawCurX);
    const y = Math.min(drawStartY, drawCurY);
    const w = Math.abs(drawCurX - drawStartX);
    const h = Math.abs(drawCurY - drawStartY);
    ctx.strokeRect(x, y, w, h);
    ctx.setLineDash([]);
  }

  // Selection badge
  updateSelectionBadge();
}

function updateSelectionBadge() {
  const badge = document.getElementById('selectionBadge');
  if (selectedBox >= 0 && selectedBox < boxes.length) {
    const b = boxes[selectedBox];
    const color = boxColor(b.cls);
    const label = (CN[b.cls] || String(b.cls)).toUpperCase();
    badge.style.display = '';
    badge.style.background = color + '22';
    badge.style.border = `1px solid ${color}55`;
    badge.style.color = color;
    const classNum = boxes.filter((x, i) => x.cls === b.cls && i <= selectedBox).length;
    const classTotal = boxes.filter(x => x.cls === b.cls).length;
    badge.textContent = `${label} ${classNum}/${classTotal}`;
  } else {
    badge.style.display = 'none';
  }
}

// Person flash animation — single flash on person boxes, cancelled on navigation
function flashPersonBoxes() {
  const personBoxes = boxes.filter(b => b.cls === 0);
  if (personBoxes.length === 0) return;
  _doFlash(personBoxes, false);
}

function flashPreviewPersons() {
  const persons = aiPreviewBoxes.filter(b => b.cls === 0);
  if (persons.length === 0 || !imgLoaded) return;
  _doFlash(persons, true);
}

function _doFlash(targetBoxes, isPreview) {
  cancelFlash();
  const navId = _navCounter;
  let step = 0;
  _flashTimer = setInterval(() => {
    if (_navCounter !== navId) { cancelFlash(); return; }
    step++;
    if (step > 2) { cancelFlash(); render(); return; }
    render();
    if (step === 1) {
      const iw = img.naturalWidth, ih = img.naturalHeight;
      ctx.save();
      ctx.translate(panX, panY);
      ctx.scale(zoom, zoom);
      for (const b of targetBoxes) {
        const x = (b.xc - b.w / 2) * iw;
        const y = (b.yc - b.h / 2) * ih;
        const w = b.w * iw;
        const h = b.h * ih;
        ctx.fillStyle = 'rgba(52, 211, 153, 0.25)';
        ctx.fillRect(x, y, w, h);
        ctx.strokeStyle = '#34d399';
        ctx.lineWidth = 3 / zoom;
        ctx.strokeRect(x, y, w, h);
      }
      ctx.restore();
    }
  }, 200);
}

// ============================================================
// CANVAS MOUSE EVENTS
// ============================================================
function canvasToImg(cx, cy) {
  return { x: (cx - panX) / zoom, y: (cy - panY) / zoom };
}

function imgToNorm(ix, iy) {
  return { x: ix / img.naturalWidth, y: iy / img.naturalHeight };
}

canvas.addEventListener('mousedown', function(e) {
  if (!imgLoaded) return;
  const rect = canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left, my = e.clientY - rect.top;

  if (e.button === 2) {
    // Right click — works on all modes
    e.preventDefault();
    if (currentMode === 'dataset') {
      const ip = canvasToImg(mx, my);
      const np = imgToNorm(ip.x, ip.y);
      const hitIdx = findBoxAt(np.x, np.y);
      if (hitIdx >= 0) {
        selectedBox = hitIdx;
        render();
        renderPanelContent();
        showBoxContextMenu(e, hitIdx);
      } else {
        selectedBox = -1;
        render();
        renderPanelContent();
        showImageContextMenu(e);
      }
    } else {
      // Live/Video — image context menu only
      showImageContextMenu(e);
    }
    return;
  }

  // Left click — only dataset mode for draw/drag/resize
  if (currentMode !== 'dataset') return;

  if (e.button === 0) {
    // Left click — check resize handles first, then drag, then draw
    const ip = canvasToImg(mx, my);
    const np = imgToNorm(ip.x, ip.y);

    // Check resize handles on selected box
    if (selectedBox >= 0) {
      const handle = getResizeHandle(mx, my, selectedBox);
      if (handle) {
        pushUndo();
        resizing = true;
        resizeIdx = selectedBox;
        resizeHandle = handle;
        return;
      }
    }

    // Check if clicking inside a box to drag
    const hitIdx = findBoxAt(np.x, np.y);
    if (hitIdx >= 0) {
      pushUndo();
      selectedBox = hitIdx;
      dragging = true;
      dragIdx = hitIdx;
      dragMoved = false;
      const b = boxes[hitIdx];
      dragOffX = np.x - b.xc;
      dragOffY = np.y - b.yc;
      render();
      renderPanelContent();
      return;
    }

    // Clicked empty area — deselect
    if (selectedBox >= 0) {
      selectedBox = -1;
      render();
      renderPanelContent();
    }

    // Start drawing new box
    pushUndo();
    drawing = true;
    drawStartX = mx;
    drawStartY = my;
    drawCurX = mx;
    drawCurY = my;
  }
});

canvas.addEventListener('mousemove', function(e) {
  if (!imgLoaded) return;
  const rect = canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left, my = e.clientY - rect.top;

  if (drawing) {
    drawCurX = mx;
    drawCurY = my;
    render();
    return;
  }

  if (dragging && dragIdx >= 0) {
    const ip = canvasToImg(mx, my);
    const np = imgToNorm(ip.x, ip.y);
    const b = boxes[dragIdx];
    let nx = np.x - dragOffX, ny = np.y - dragOffY;
    // Clamp so box stays inside image
    nx = Math.max(b.w/2, Math.min(1 - b.w/2, nx));
    ny = Math.max(b.h/2, Math.min(1 - b.h/2, ny));
    b.xc = nx;
    b.yc = ny;
    dragMoved = true;
    render();
    return;
  }

  if (resizing && resizeIdx >= 0) {
    const ip = canvasToImg(mx, my);
    const np = imgToNorm(ip.x, ip.y);
    // Clamp resize coords to image bounds
    const cx = Math.max(0, Math.min(1, np.x));
    const cy = Math.max(0, Math.min(1, np.y));
    resizeBox(resizeIdx, resizeHandle, cx, cy);
    render();
    return;
  }

  // Dynamic cursor: resize handles → resize cursors, inside box → move, else → crosshair
  if (currentMode === 'dataset' && selectedBox >= 0) {
    const handle = getResizeHandle(mx, my, selectedBox);
    if (handle) {
      const cursorMap = {tl:'nw-resize',tr:'ne-resize',bl:'sw-resize',br:'se-resize',tm:'n-resize',bm:'s-resize',ml:'w-resize',mr:'e-resize'};
      canvas.style.cursor = cursorMap[handle] || 'crosshair';
      return;
    }
  }
  if (currentMode === 'dataset') {
    const ip = canvasToImg(mx, my);
    const np = imgToNorm(ip.x, ip.y);
    const hitIdx = findBoxAt(np.x, np.y);
    canvas.style.cursor = hitIdx >= 0 ? 'move' : 'crosshair';
  } else {
    canvas.style.cursor = 'default';
  }
});

canvas.addEventListener('mouseup', function(e) {
  if (drawing) {
    drawing = false;
    const ip1 = canvasToImg(drawStartX, drawStartY);
    const ip2 = canvasToImg(drawCurX, drawCurY);
    const np1 = imgToNorm(ip1.x, ip1.y);
    const np2 = imgToNorm(ip2.x, ip2.y);

    // Clamp to image bounds [0, 1]
    const cx1 = Math.max(0, Math.min(1, Math.min(np1.x, np2.x)));
    const cx2 = Math.max(0, Math.min(1, Math.max(np1.x, np2.x)));
    const cy1 = Math.max(0, Math.min(1, Math.min(np1.y, np2.y)));
    const cy2 = Math.max(0, Math.min(1, Math.max(np1.y, np2.y)));
    const w = cx2 - cx1, h = cy2 - cy1;

    if (w > 0.005 && h > 0.005) {
      const newCls = parseInt(document.getElementById('newBoxClass')?.value || '0');
      boxes.push({ cls: newCls, xc: cx1 + w/2, yc: cy1 + h/2, w: w, h: h });
      selectedBox = boxes.length - 1;
      saveBoxes();
    }
    render();
    renderPanelContent();
    return;
  }

  if (dragging) {
    dragging = false;
    dragIdx = -1;
    if (dragMoved) saveBoxes();
    dragMoved = false;
    return;
  }

  if (resizing) {
    resizing = false;
    resizeIdx = -1;
    resizeHandle = '';
    saveBoxes();
    return;
  }
});

canvas.addEventListener('contextmenu', e => e.preventDefault());

canvas.addEventListener('wheel', function(e) {
  if (scrollFrozen) return;
  e.preventDefault();

  if (e.ctrlKey) {
    // Zoom
    if (!imgLoaded) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    const factor = e.deltaY < 0 ? 1.1 : 0.9;
    // Min zoom = fit size
    const iw = img.naturalWidth, ih = img.naturalHeight;
    const minZoom = Math.min(canvasW / iw, canvasH / ih) * 0.995;
    let newZoom = zoom * factor;
    if (newZoom <= minZoom) {
      zoom = minZoom;
      panX = (canvasW - iw * zoom) / 2;
      panY = (canvasH - ih * zoom) / 2;
    } else {
      const zf = newZoom / zoom;
      panX = mx - (mx - panX) * zf;
      panY = my - (my - panY) * zf;
      zoom = newZoom;
    }
    render();
  } else {
    // Navigate images
    scrollFrozen = true;
    setTimeout(() => scrollFrozen = false, 200);
    navigate(e.deltaY > 0 ? 1 : -1);
  }
}, { passive: false });

// Middle click freeze
canvas.addEventListener('mousedown', function(e) {
  if (e.button === 1) {
    e.preventDefault();
    scrollFrozen = true;
    setTimeout(() => scrollFrozen = false, 500);
  }
});

// ============================================================
// BOX HELPERS
// ============================================================
function findBoxAt(nx, ny) {
  // Find smallest box containing point (prefer smaller for overlaps)
  let best = -1, bestArea = Infinity;
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i];
    const x1 = b.xc - b.w/2, x2 = b.xc + b.w/2;
    const y1 = b.yc - b.h/2, y2 = b.yc + b.h/2;
    if (nx >= x1 && nx <= x2 && ny >= y1 && ny <= y2) {
      const area = b.w * b.h;
      if (area < bestArea) { best = i; bestArea = area; }
    }
  }
  return best;
}

function getResizeHandle(mx, my, idx) {
  const b = boxes[idx];
  const iw = img.naturalWidth, ih = img.naturalHeight;
  const x = (b.xc - b.w/2) * iw * zoom + panX;
  const y = (b.yc - b.h/2) * ih * zoom + panY;
  const w = b.w * iw * zoom;
  const h = b.h * ih * zoom;
  const hs = HANDLE;

  const corners = [
    { name: 'tl', cx: x, cy: y },
    { name: 'tr', cx: x+w, cy: y },
    { name: 'bl', cx: x, cy: y+h },
    { name: 'br', cx: x+w, cy: y+h },
    { name: 'tm', cx: x+w/2, cy: y },
    { name: 'bm', cx: x+w/2, cy: y+h },
    { name: 'ml', cx: x, cy: y+h/2 },
    { name: 'mr', cx: x+w, cy: y+h/2 },
  ];
  for (const c of corners) {
    if (Math.abs(mx - c.cx) <= hs && Math.abs(my - c.cy) <= hs) return c.name;
  }
  return null;
}

function resizeBox(idx, handle, nx, ny) {
  const b = boxes[idx];
  let x1 = b.xc - b.w/2, x2 = b.xc + b.w/2;
  let y1 = b.yc - b.h/2, y2 = b.yc + b.h/2;

  if (handle.includes('l')) x1 = nx;
  if (handle.includes('r')) x2 = nx;
  if (handle.includes('t')) y1 = ny;
  if (handle.includes('b')) y2 = ny;
  if (handle === 'tm' || handle === 'bm') { /* keep x */ }
  if (handle === 'ml' || handle === 'mr') { /* keep y */ }

  if (x2 > x1 && y2 > y1) {
    b.w = x2 - x1;
    b.h = y2 - y1;
    b.xc = x1 + b.w/2;
    b.yc = y1 + b.h/2;
  }
}

// ============================================================
// SAVE / UNDO
// ============================================================
function saveBoxes() {
  if (currentMode !== 'dataset') return;
  _filterDirty = true;
  fetch('/api/save', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({ split: currentSplit, name: currentName, boxes: boxes })
  });
}

function pushUndo() {
  undoStack.push({
    split: currentSplit,
    name: currentName,
    boxes: JSON.parse(JSON.stringify(boxes))
  });
  if (undoStack.length > MAX_UNDO) undoStack.shift();
}

function popUndo() {
  if (undoStack.length === 0) return;
  const entry = undoStack[undoStack.length - 1];
  // Only restore if we're still on the same image
  if (entry.split !== currentSplit || entry.name !== currentName) {
    undoStack = [];
    return;
  }
  undoStack.pop();
  boxes = entry.boxes;
  selectedBox = -1;
  saveBoxes();
  render();
  renderPanelContent();
}

function deleteSelected() {
  if (selectedBox < 0 || selectedBox >= boxes.length) return;
  pushUndo();
  boxes.splice(selectedBox, 1);
  selectedBox = -1;
  saveBoxes();
  render();
  renderPanelContent();
}

function replaceClass(idx, newCls) {
  if (idx < 0 || idx >= boxes.length) return;
  pushUndo();
  boxes[idx].cls = newCls;
  saveBoxes();
  render();
  renderPanelContent();
}

// ============================================================
// DATASET SWITCH
// ============================================================
function switchDataset(path) {
  if (path === '__create__') {
    openCreateDatasetDialog();
    const sel = document.getElementById('datasetSel');
    if (sel) sel.value = STATE_DATASET_PATH || '';
    return;
  }
  fetch('/api/switch', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({ path: path })
  }).then(r => r.json()).then(d => {
    if (d.ok) {
      STATE_DATASET_PATH = path;
      currentIdx = 0;
      loadInfo();
    }
  });
}

function openCreateDatasetDialog() {
  const existing = document.getElementById('createDatasetModal');
  if (existing) existing.remove();
  const m = document.createElement('div');
  m.id = 'createDatasetModal';
  m.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:99999;display:flex;align-items:center;justify-content:center';
  m.innerHTML = `
    <div style="background:var(--bg2);border:1px solid var(--bd2);border-radius:12px;padding:24px;width:min(440px,92vw)">
      <div style="font-size:var(--fs-lg);font-weight:700;color:var(--t0b);margin-bottom:14px">Create New Dataset</div>
      <div style="font-size:var(--fs-sm);color:var(--t1);margin-bottom:8px">Name</div>
      <input id="newDatasetName" class="text-inp w-full" type="text" placeholder="my-dataset" autocomplete="off" style="margin-bottom:6px">
      <div style="font-size:var(--fs-xs);color:var(--t2);margin-bottom:18px">Allowed: letters, digits, dash, underscore, dot. Max 64 chars.</div>
      <div id="newDatasetError" style="font-size:var(--fs-sm);color:var(--acr);margin-bottom:12px;display:none"></div>
      <div style="display:flex;gap:10px;justify-content:flex-end">
        <button class="btn" onclick="closeCreateDatasetDialog()">Cancel</button>
        <button class="btn primary" onclick="submitCreateDataset()">Create</button>
      </div>
    </div>`;
  document.body.appendChild(m);
  const inp = document.getElementById('newDatasetName');
  if (inp) {
    inp.focus();
    inp.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); submitCreateDataset(); }
      else if (e.key === 'Escape') { e.preventDefault(); closeCreateDatasetDialog(); }
    });
  }
}

function closeCreateDatasetDialog() {
  document.getElementById('createDatasetModal')?.remove();
}

function submitCreateDataset() {
  const inp = document.getElementById('newDatasetName');
  const err = document.getElementById('newDatasetError');
  if (!inp) return;
  const name = inp.value.trim();
  if (!name) {
    if (err) { err.textContent = 'Name is required'; err.style.display = 'block'; }
    return;
  }
  fetch('/api/dataset/create', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({ name: name })
  }).then(r => r.json()).then(d => {
    if (d.ok) {
      STATE_DATASET_PATH = d.path;
      const sel = document.getElementById('datasetSel');
      if (sel && Array.isArray(d.datasets)) {
        sel.innerHTML = '';
        for (const ds of d.datasets) {
          const opt = document.createElement('option');
          opt.value = ds.path;
          opt.textContent = ds.name;
          if (ds.path === d.path) opt.selected = true;
          sel.appendChild(opt);
        }
        const optCreate = document.createElement('option');
        optCreate.value = '__create__';
        optCreate.textContent = '+ Create New Dataset';
        sel.appendChild(optCreate);
      }
      const tsel = document.getElementById('trainerDatasetSel');
      if (tsel && Array.isArray(d.datasets)) {
        const tcurrent = tsel.value;
        tsel.innerHTML = '';
        for (const ds of d.datasets) {
          const opt = document.createElement('option');
          opt.value = ds.path;
          opt.textContent = ds.name;
          if (ds.path === tcurrent) opt.selected = true;
          tsel.appendChild(opt);
        }
      }
      closeCreateDatasetDialog();
      toast(`Dataset "${d.name}" created`);
      currentIdx = 0;
      loadInfo();
    } else {
      if (err) { err.textContent = d.error || 'Could not create dataset'; err.style.display = 'block'; }
    }
  }).catch(e => {
    if (err) { err.textContent = 'Network error'; err.style.display = 'block'; }
  });
}

// ============================================================
// SETTINGS
// ============================================================
function loadSettingsUI() {
  const fields = [
    'DEFAULT_DATASET','DATASETS_ROOT','MODELS_DIR','LIVE_DIR','EXPORTS_DIR','FRIGATE_DB',
    'DEFAULT_PORT','EPOCHS','BATCH_SIZE','LEARNING_RATE','LR_FINAL','IMAGE_SIZE','FREEZE_LAYERS',
    'DEFAULT_CONFIDENCE','DEDUP_BOX_SIM','DEDUP_PHASH_SIM','DEDUP_NMS_SIM'
  ];
  for (const f of fields) {
    const el = document.getElementById('s_' + f);
    if (el && CONF[f] !== undefined) el.value = CONF[f];
  }
  // Model selects — match by basename since CONF stores basename but options have full paths
  for (const f of ['DEFAULT_MODEL','TEACHER_MODEL','STUDENT_MODEL']) {
    const el = document.getElementById('s_' + f);
    if (!el || !CONF[f]) continue;
    const target = CONF[f].split('/').pop();
    for (const opt of el.options) {
      if (opt.textContent === target || opt.value.endsWith('/' + target)) {
        el.value = opt.value;
        break;
      }
    }
  }
  // Sort order
  const sortEl = document.getElementById('s_SORT_ORDER');
  if (sortEl && CONF.SORT_ORDER) sortEl.value = CONF.SORT_ORDER;
  // Dedup toggles
  const dedupToggles = {DEDUP_BOXES:'s_DEDUP_BOXES_toggle', DEDUP_PHASH:'s_DEDUP_PHASH_toggle', DEDUP_NMS:'s_DEDUP_NMS_toggle', AUGMENTATION:'s_AUGMENTATION_toggle'};
  for (const [key, id] of Object.entries(dedupToggles)) {
    const el = document.getElementById(id);
    if (el) el.classList.toggle('on', CONF[key] === true || CONF[key] === 'true');
  }
  updateHelpersToggle();
}

function saveSettings() {
  const data = {};
  const fields = [
    'DEFAULT_DATASET','DATASETS_ROOT','MODELS_DIR','LIVE_DIR','EXPORTS_DIR','FRIGATE_DB',
    'DEFAULT_PORT','DEFAULT_CONFIDENCE',
    'EPOCHS','BATCH_SIZE','LEARNING_RATE','LR_FINAL','IMAGE_SIZE','FREEZE_LAYERS',
    'DEDUP_BOX_SIM','DEDUP_PHASH_SIM','DEDUP_NMS_SIM'
  ];
  for (const f of fields) {
    const el = document.getElementById('s_' + f);
    if (el) data[f] = el.value;
  }
  // Model selects — save basename only
  for (const f of ['DEFAULT_MODEL','TEACHER_MODEL','STUDENT_MODEL']) {
    const el = document.getElementById('s_' + f);
    if (el) data[f] = el.value.split('/').pop();
  }
  data.HELPERS_ENABLED = helpersEnabled;
  data.DEFAULT_CLASSES = getSelectedClasses().join(', ');
  const sortEl = document.getElementById('s_SORT_ORDER');
  if (sortEl) data.SORT_ORDER = sortEl.value;
  // Dedup toggles
  data.DEDUP_BOXES = document.getElementById('s_DEDUP_BOXES_toggle')?.classList.contains('on') || false;
  data.DEDUP_PHASH = document.getElementById('s_DEDUP_PHASH_toggle')?.classList.contains('on') || false;
  data.DEDUP_NMS = document.getElementById('s_DEDUP_NMS_toggle')?.classList.contains('on') || false;
  data.AUGMENTATION = document.getElementById('s_AUGMENTATION_toggle')?.classList.contains('on') ?? true;

  fetch('/api/settings/save', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(data)
  }).then(r => r.json()).then(d => {
    if (d.ok) {
      Object.assign(CONF, d.conf);
      toast('Settings saved to alice.conf');
      const cfSel = document.getElementById('classFilterSel');
      if (cfSel) {
        const current = cfSel.value;
        const cfClasses = (CONF.DEFAULT_CLASSES || []).map(x => parseInt(x))
          .filter(n => !isNaN(n));
        const sortedUnique = Array.from(new Set(cfClasses)).sort((a, b) => a - b);
        cfSel.innerHTML = '<option value="-1">All classes</option>';
        for (const c of sortedUnique) {
          const opt = document.createElement('option');
          opt.value = String(c);
          opt.textContent = `${c}: ${CN[c] || c}`;
          cfSel.appendChild(opt);
        }
        const stillThere = (current === '-1') ||
          sortedUnique.includes(parseInt(current));
        if (stillThere) {
          cfSel.value = current;
        } else {
          cfSel.value = '-1';
          if (typeof setClassFilter === 'function') setClassFilter(-1);
        }
      }
      // Refresh live camera dropdown if cameras were rescanned
      if (d.cameras && Array.isArray(d.cameras)) {
        const sel = document.getElementById('liveCamSel');
        if (sel) {
          const current = sel.value;
          // Keep "All cameras" option, rebuild the rest
          sel.innerHTML = '<option value="all">All cameras</option>';
          d.cameras.forEach(cam => {
            const opt = document.createElement('option');
            opt.value = cam;
            opt.textContent = cam;
            if (cam === current) opt.selected = true;
            sel.appendChild(opt);
          });
        }
      }
    }
  });
}

function resetSettings() {
  fetch('/api/settings/defaults').then(r => r.json()).then(d => {
    Object.assign(CONF, d);
    loadSettingsUI();
    toast('Settings reset to defaults');
  });
}

function toggleHelpers() {
  helpersEnabled = !helpersEnabled;
  updateHelpersToggle();
}

function updateHelpersToggle() {
  const el = document.getElementById('helpersToggle');
  if (!el) return;
  el.classList.toggle('on', helpersEnabled);
}

// ============================================================
// CLASS PICKER (for Settings)
// ============================================================
function getSelectedClasses() {
  const checkboxes = document.querySelectorAll('#classPickerList input[type="checkbox"]:checked');
  return Array.from(checkboxes).map(cb => parseInt(cb.value));
}

function initClassPicker() {
  const container = document.getElementById('classPickerContainer');
  if (!container) return;
  const selected = new Set(CONF.DEFAULT_CLASSES || []);
  let html = '<div class="class-picker-list" id="classPickerList">';
  for (const [id, name] of Object.entries(CN)) {
    const checked = selected.has(parseInt(id)) ? ' checked' : '';
    html += `<label>
      <input type="checkbox" value="${id}"${checked}>
      <span>${name}</span>
      <span style="font-size:var(--fs-sm);color:var(--t3);margin-left:auto;font-family:var(--font)">${id}</span>
    </label>`;
  }
  html += '</div>';
  container.innerHTML = html;
}

