// ============================================================
// SETTINGS UI — model download, deps, welcome screen
// ============================================================

// ============================================================
// MODEL DOWNLOAD
// ============================================================
function downloadModel(filename) {
  const status = document.getElementById('modelDownloadStatus');
  if (status) { status.style.display = ''; status.innerHTML = `<span style="color:var(--acy)">⬇ Downloading ${filename}...</span>`; }

  fetch('/api/models/download', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({ filename: filename })
  }).then(r => r.json()).then(d => {
    if (d.ok) {
      if (status) status.innerHTML = `<span style="color:var(--acg)">✓ Downloaded ${filename} (${d.size || '?'})</span>`;
      loadModelsList();
    } else {
      if (status) status.innerHTML = `<span style="color:var(--acr)">✗ ${d.error || 'Download failed'}</span>`;
    }
  }).catch(e => {
    if (status) status.innerHTML = `<span style="color:var(--acr)">✗ ${e.message}</span>`;
  });
}

// ============================================================
// SETTINGS TABS
// ============================================================
let currentSettingsTab = 'paths';

function setSettingsTab(tab) {
  currentSettingsTab = tab;
  _saveUI({settings_tab: tab});
  document.querySelectorAll('[data-stab]').forEach(el => {
    el.classList.toggle('active', el.dataset.stab === tab);
  });
  document.querySelectorAll('.settings-panel').forEach(el => {
    el.classList.toggle('active', el.id === 'stab-' + tab);
  });
  if (tab === 'system') { loadDependencies(); loadPythonInfo(); loadDeviceSettings(); }
}

// ============================================================
// DEPENDENCY CHECK
// ============================================================
let _depsPollTimer = null;

function loadDependencies() {
  // Fetch both deps check and install status
  return Promise.all([
    fetch('/api/deps/check').then(r => r.json()),
    fetch('/api/deps/status').then(r => r.json())
  ]).then(([deps, status]) => {
    const el = document.getElementById('depsContainer');
    if (!el) return;

    const installedSet = new Set(status.installed || []);
    const currentPkg = status.current || '';
    const isRunning = status.running || false;

    let html = '';
    let hasMissing = false;
    for (const d of deps) {
      const ok = d.installed || installedSet.has(d.name);
      const isInstalling = isRunning && d.name === currentPkg;
      if (!ok && !isInstalling) hasMissing = true;

      let borderColor, bgColor, dotStyle, verText;
      if (ok) {
        borderColor = 'rgba(34,197,94,0.3)';
        bgColor = 'rgba(34,197,94,0.04)';
        dotStyle = 'ok';
        verText = '<span style="color:var(--acg);font-weight:600">' + (d.version || 'Installed ✓') + '</span>';
      } else if (isInstalling) {
        borderColor = 'rgba(249,115,22,0.4)';
        bgColor = 'rgba(249,115,22,0.06)';
        dotStyle = 'installing';
        verText = '<span style="color:var(--aco);font-weight:600">Installing...</span>';
      } else {
        borderColor = 'rgba(248,113,113,0.4)';
        bgColor = 'rgba(248,113,113,0.06)';
        dotStyle = 'missing';
        verText = '<span style="color:var(--acr);font-weight:600">Not installed</span>';
      }
      const dotCls = dotStyle === 'installing' ? 'missing' : dotStyle;
      const dotExtra = dotStyle === 'installing' ? 'style="background:var(--aco)"' : '';
      const reqLabel = d.required ? '<span style="color:var(--acr);font-size:var(--fs-xs);font-weight:600;margin-left:8px">REQUIRED</span>' : '<span style="color:var(--t3);font-size:var(--fs-xs);margin-left:8px">optional</span>';
      html += `<div class="dep-item" data-dep="${d.name}" style="border-color:${borderColor};background:${bgColor}">
        <div class="dep-dot ${dotCls}" ${dotExtra}></div>
        <div style="flex:1">
          <div class="dep-name">${d.name}${reqLabel}</div>
          <div class="dep-desc">${d.desc}</div>
        </div>
        <div class="dep-ver">${verText}</div>
      </div>`;
    }
    el.innerHTML = html;

    // Update button and status text
    const btn = document.getElementById('installDepsBtn');
    const statusEl = document.getElementById('depsInstallStatus');

    if (isRunning) {
      if (btn) { btn.disabled = true; btn.textContent = `Installing ${status.done}/${status.total}...`; btn.style.display = ''; }
      if (statusEl) { statusEl.style.display = ''; statusEl.innerHTML = `<span style="color:var(--acy)">Installing ${currentPkg}... (${status.done + 1}/${status.total})</span>`; }
      startDepsPoll();
    } else {
      if (btn) { btn.disabled = false; btn.textContent = '⬇ Install Missing Dependencies'; btn.style.display = hasMissing ? '' : 'none'; }
      if (status.installed && status.installed.length > 0 && statusEl) {
        let msg = '';
        if (status.installed.length) msg += `<span style="color:var(--acg)">✓ Installed: ${status.installed.join(', ')}</span>`;
        if (status.errors && status.errors.length) msg += `<br><span style="color:var(--acr)">✗ Failed: ${status.errors.join('; ')}</span>`;
        statusEl.style.display = '';
        statusEl.innerHTML = msg;
      }
      stopDepsPoll();
    }
  });
}

function startDepsPoll() {
  if (_depsPollTimer) return;
  _depsPollTimer = setInterval(() => {
    if (currentPage === 'settings') loadDependencies();
    else {
      // Still poll status even if not on settings page, stop when done
      fetch('/api/deps/status').then(r => r.json()).then(s => {
        if (!s.running) stopDepsPoll();
      });
    }
  }, 1500);
}

function stopDepsPoll() {
  if (_depsPollTimer) { clearInterval(_depsPollTimer); _depsPollTimer = null; }
  refreshDepsCache();
}

async function installMissingDeps() {
  const btn = document.getElementById('installDepsBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Starting...'; }

  fetch('/api/deps/install', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: '{}'
  }).then(r => r.json()).then(d => {
    if (d.ok) {
      startDepsPoll();
      setTimeout(loadDependencies, 500);
    }
  });
}

function loadPythonInfo() {
  fetch('/api/deps/python').then(r => r.json()).then(d => {
    const el = document.getElementById('pythonInfo');
    if (!el) return;
    el.innerHTML = `Python: ${d.version || '?'}<br>Executable: ${d.executable || '?'}<br>Platform: ${d.platform || '?'}`;
  });
}

// ============================================================
// WELCOME CARD (first run)
// ============================================================
function showWelcome() {
  const overlay = document.createElement('div');
  overlay.id = 'welcomeOverlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.75);z-index:100000;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(4px)';

  const yoloModels = [
    { file: 'yolo11n.pt', desc: 'Nano — fastest, lowest accuracy', size: '5.4 MB' },
    { file: 'yolo11s.pt', desc: 'Small — good balance', size: '18.4 MB' },
    { file: 'yolo11m.pt', desc: 'Medium — recommended starting point', size: '38.8 MB' },
    { file: 'yolo11l.pt', desc: 'Large — higher accuracy', size: '49.0 MB' },
    { file: 'yolo11x.pt', desc: 'XLarge — best accuracy, slowest', size: '109.3 MB' },
  ];

  let modelBtns = '';
  for (const m of yoloModels) {
    modelBtns += `<div style="display:flex;align-items:center;gap:10px;padding:var(--pad-md) 12px;border-radius:8px;background:var(--bg2);border:1px solid var(--bd)">
      <div style="flex:1;min-width:0">
        <div style="font-size:var(--fs-sm);font-weight:600;color:var(--t0b);font-family:var(--font)">${m.file}</div>
        <div style="font-size:var(--fs-xs);color:var(--t2);font-family:var(--fontUI)">${m.desc} · ${m.size}</div>
      </div>
      <button class="btn sm" onclick="welcomeDownloadModel('${m.file}', this)" style="flex-shrink:0;color:var(--ac);border-color:rgba(59,130,246,0.3)">Download</button>
    </div>`;
  }

  overlay.innerHTML = `
    <div style="background:var(--bg1);border:1px solid var(--bd2);border-radius:16px;padding:var(--pad-xl);max-width:clamp(480px,50vw,720px);width:92%;max-height:90vh;overflow-y:auto;box-shadow:0 24px 80px rgba(0,0,0,0.5)">
      <div style="text-align:center;margin-bottom:24px">
        <div style="display:inline-flex;align-items:center;justify-content:center;width:56px;height:56px;border-radius:14px;background:linear-gradient(135deg, var(--ac), #a78bfa);margin-bottom:12px">
          <span style="font-size:var(--fs-3xl);font-weight:800;color:#fff;font-family:var(--font)">A</span>
        </div>
        <div style="font-size:var(--fs-2xl);font-weight:700;color:var(--t0b);font-family:var(--fontUI)">Welcome to Alice <span style="font-size:var(--fs-base);font-weight:500;color:var(--t2)">v${CONF.VERSION || ''}</span></div>
        <div style="font-size:var(--fs-sm);color:var(--t2);font-family:var(--fontUI);margin-top:4px">All-in-one AI-powered image annotation, training, and dataset management toolkit</div>
      </div>

      <div style="display:flex;flex-direction:column;gap:16px;margin-bottom:24px">

        <div style="padding:var(--pad-lg);border-radius:10px;background:var(--bg2);border:1px solid var(--bd)">
          <div style="font-size:var(--fs-base);font-weight:600;color:var(--t0b);margin-bottom:6px;font-family:var(--fontUI)">1. Hardware Detected</div>
          <div id="welcomeDeviceInfo" style="font-size:var(--fs-sm);color:var(--t1);line-height:1.6;font-family:var(--font)">Detecting...</div>
          <div style="font-size:var(--fs-xs);color:var(--t3);margin-top:6px;font-family:var(--fontUI)">
            You can change this later in <strong style="color:var(--t2);cursor:pointer" onclick="dismissWelcome();switchPage('settings');setTimeout(()=>setSettingsTab('system'),200)">Settings → System</strong>
          </div>
        </div>

        <div style="padding:var(--pad-lg);border-radius:10px;background:var(--bg2);border:1px solid var(--bd)">
          <div style="font-size:var(--fs-base);font-weight:600;color:var(--t0b);margin-bottom:6px;font-family:var(--fontUI)">2. Configure Paths</div>
          <div style="font-size:var(--fs-sm);color:var(--t1);line-height:1.6;font-family:var(--fontUI)">
            Open <strong style="color:var(--ac);cursor:pointer" onclick="dismissWelcome();switchPage('settings')">Settings</strong> and set up your paths:
          </div>
          <div style="font-size:var(--fs-sm);color:var(--t2);line-height:1.8;font-family:var(--font);margin-top:6px;padding-left:12px">
            <strong style="color:var(--t1)">LIVE_DIR</strong> — Frigate clips folder (for live snapshots)<br>
            <strong style="color:var(--t1)">EXPORTS_DIR</strong> — Frigate exports folder (for video analysis)<br>
            <strong style="color:var(--t1)">FRIGATE_DB</strong> — path to frigate.db (for auto-export in trainer)
          </div>
        </div>

        <div style="padding:var(--pad-lg);border-radius:10px;background:var(--bg2);border:1px solid var(--bd)">
          <div style="font-size:var(--fs-base);font-weight:600;color:var(--t0b);margin-bottom:6px;font-family:var(--fontUI)">3. Download a YOLO Model</div>
          <div style="font-size:var(--fs-sm);color:var(--t1);line-height:1.6;font-family:var(--fontUI);margin-bottom:10px">
            You need at least one model for AI detection. Pick one to download now:
          </div>
          <div style="display:flex;flex-direction:column;gap:6px" id="welcomeModelList">
            ${modelBtns}
          </div>
          <div id="welcomeModelStatus" style="font-size:var(--fs-sm);margin-top:8px;font-family:var(--font);display:none"></div>
        </div>

        <div style="padding:var(--pad-lg);border-radius:10px;background:var(--bg2);border:1px solid var(--bd)">
          <div style="font-size:var(--fs-base);font-weight:600;color:var(--t0b);margin-bottom:6px;font-family:var(--fontUI)">4. Build Your Dataset</div>
          <div style="font-size:var(--fs-sm);color:var(--t1);line-height:1.6;font-family:var(--fontUI)">
            Use <strong>Live mode</strong> to browse Frigate snapshots and transfer them to your dataset.
            Or use the <strong style="color:var(--ac);cursor:pointer" onclick="dismissWelcome();switchPage('trainer')">Trainer</strong>
            pipeline to auto-export from Frigate DB, deduplicate, annotate with a teacher model, and fine-tune.
          </div>
        </div>

        <div style="padding:var(--pad-lg);border-radius:10px;background:var(--bg2);border:1px solid var(--bd)">
          <div style="font-size:var(--fs-base);font-weight:600;color:var(--t0b);margin-bottom:6px;font-family:var(--fontUI)">5. Dependencies</div>
          <div style="font-size:var(--fs-sm);color:var(--t1);line-height:1.6;font-family:var(--fontUI)">
            Some features require extra packages (ultralytics, opencv, numpy).
          </div>
          <div id="welcomeDepsStatus" style="font-size:var(--fs-sm);color:var(--t2);font-family:var(--font);margin-top:8px">Checking...</div>
          <div style="display:flex;gap:8px;margin-top:10px">
            <button class="btn sm" id="welcomeInstallDepsBtn" onclick="welcomeInstallDeps()" style="display:none;color:var(--ac);border-color:rgba(59,130,246,0.3)">⬇ Install All</button>
            <button class="btn sm" onclick="dismissWelcome();switchPage('settings');setTimeout(()=>setSettingsTab('system'),200)" style="color:var(--t2);border-color:var(--bd)">Open Settings → System</button>
          </div>
        </div>

      </div>

      <div style="display:flex;justify-content:center">
        <button class="btn btn-lg primary" onclick="dismissWelcome()">Get Started</button>
      </div>
    </div>`;

  document.body.appendChild(overlay);
  welcomeDetectDevice();
  welcomeCheckDeps();
}

function dismissWelcome() {
  const overlay = document.getElementById('welcomeOverlay');
  if (overlay) overlay.remove();
  stopWelcomeDepsPoll();
  fetch('/api/first-run/dismiss', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: '{}'
  }).catch(() => {});
  // If deps still missing after dismiss, show the classic deps modal (but not if installing)
  Promise.all([
    fetch('/api/deps/check').then(r => r.json()),
    fetch('/api/deps/status').then(r => r.json())
  ]).then(([deps, dStatus]) => {
    if (dStatus.running) return;
    const missing = deps.filter(d => !d.installed);
    if (missing.length === 0) return;
    const names = missing.map(d => d.name).join(', ');
    const modal = document.createElement('div');
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:99999;display:flex;align-items:center;justify-content:center';
    modal.innerHTML = `
      <div style="background:var(--bg2);border:1px solid var(--bd2);border-radius:12px;padding:var(--pad-xl);max-width:440px;width:90%">
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
}

let _welcomeMissingDeps = [];
let _welcomeDepsPollTimer = null;

function welcomeCheckDeps() {
  const status = document.getElementById('welcomeDepsStatus');
  const btn = document.getElementById('welcomeInstallDepsBtn');

  Promise.all([
    fetch('/api/deps/check').then(r => r.json()),
    fetch('/api/deps/status').then(r => r.json())
  ]).then(([deps, dStatus]) => {
    _welcomeMissingDeps = deps.filter(d => !d.installed);
    const isRunning = dStatus.running || false;

    if (isRunning) {
      const cur = dStatus.current || '';
      if (status) status.innerHTML = `<span style="color:var(--acy)">Installing ${cur}... (${dStatus.done + 1}/${dStatus.total})</span>`;
      if (btn) { btn.style.display = ''; btn.disabled = true; btn.textContent = 'Installing...'; }
      startWelcomeDepsPoll();
    } else if (_welcomeMissingDeps.length === 0) {
      if (status) status.innerHTML = '<span style="color:var(--acg)">✓ All dependencies installed</span>';
      if (btn) btn.style.display = 'none';
      stopWelcomeDepsPoll();
    } else {
      const names = _welcomeMissingDeps.map(d => d.name).join(', ');
      let msg = `<span style="color:var(--acy)">${_welcomeMissingDeps.length} missing: ${names}</span>`;
      if (dStatus.installed && dStatus.installed.length > 0) {
        msg += `<br><span style="color:var(--acg)">✓ Previously installed: ${dStatus.installed.join(', ')}</span>`;
      }
      if (dStatus.errors && dStatus.errors.length > 0) {
        msg += `<br><span style="color:var(--acr)">✗ Failed: ${dStatus.errors.join('; ')}</span>`;
      }
      if (status) status.innerHTML = msg;
      if (btn) { btn.style.display = ''; btn.disabled = false; btn.textContent = '⬇ Install All'; }
      stopWelcomeDepsPoll();
    }
  }).catch(() => {
    if (status) status.innerHTML = '<span style="color:var(--t3)">Could not check</span>';
  });
}

function startWelcomeDepsPoll() {
  if (_welcomeDepsPollTimer) return;
  _welcomeDepsPollTimer = setInterval(welcomeCheckDeps, 1500);
}

function stopWelcomeDepsPoll() {
  if (_welcomeDepsPollTimer) { clearInterval(_welcomeDepsPollTimer); _welcomeDepsPollTimer = null; }
}

async function welcomeInstallDeps() {
  const btn = document.getElementById('welcomeInstallDepsBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Starting...'; }

  fetch('/api/deps/install', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: '{}'
  }).then(r => r.json()).then(d => {
    if (d.ok) {
      startWelcomeDepsPoll();
      setTimeout(welcomeCheckDeps, 500);
    }
  });
}

function welcomeDownloadModel(filename, btn) {
  const status = document.getElementById('welcomeModelStatus');
  if (status) { status.style.display = ''; status.innerHTML = `<span style="color:var(--acy)">⬇ Downloading ${filename}...</span>`; }
  btn.disabled = true;
  btn.textContent = '...';

  fetch('/api/models/download', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({ filename: filename })
  }).then(r => r.json()).then(d => {
    if (d.ok) {
      if (status) status.innerHTML = `<span style="color:var(--acg)">✓ Downloaded ${filename} (${d.size || '?'})</span>`;
      btn.textContent = '✓';
      btn.style.color = 'var(--acg)';
      btn.style.borderColor = 'rgba(34,197,94,0.3)';
      loadModelsList();
    } else {
      if (status) status.innerHTML = `<span style="color:var(--acr)">✗ ${d.error || 'Failed'}</span>`;
      btn.disabled = false;
      btn.textContent = 'Retry';
    }
  }).catch(e => {
    if (status) status.innerHTML = `<span style="color:var(--acr)">✗ ${e.message}</span>`;
    btn.disabled = false;
    btn.textContent = 'Retry';
  });
}

// ============================================================
// DEVICE DETECTION (welcome + settings)
// ============================================================

function welcomeDetectDevice() {
  const el = document.getElementById('welcomeDeviceInfo');
  if (!el) return;
  if (typeof DEVICE_INFO !== 'undefined' && DEVICE_INFO.effective) {
    _renderDeviceInfo(el, DEVICE_INFO);
    return;
  }
  fetch('/api/device/detect').then(r => r.json()).then(d => {
    _renderDeviceInfo(el, d);
  }).catch(() => {
    el.innerHTML = '<span style="color:var(--t3)">Could not detect hardware</span>';
  });
}

function _renderDeviceInfo(el, d) {
  if (d.effective === 'nvidia') {
    const name = (d.info || d.detected || {}).gpu_name || 'NVIDIA GPU';
    const cuda = (d.info || d.detected || {}).cuda_version || '?';
    const vram = (d.info || d.detected || {}).vram_mb || '?';
    el.innerHTML = '<span style="color:var(--acg)">&#10003; ' + name + '</span>' +
      '<br><span style="color:var(--t2)">CUDA ' + cuda + ' &middot; ' + vram + ' MiB VRAM</span>' +
      '<br><span style="color:var(--t2)">Training and inference will use GPU acceleration.</span>';
  } else {
    el.innerHTML = '<span style="color:var(--acy)">No NVIDIA GPU detected &mdash; CPU mode</span>' +
      '<br><span style="color:var(--t2)">Training and inference will run on CPU (slower but functional).</span>';
  }
}

function loadDeviceSettings() {
  fetch('/api/device/detect').then(r => r.json()).then(d => {
    const el = document.getElementById('deviceSettingsContainer');
    if (!el) return;
    const confVal = d.conf || 'auto';
    const eff = d.effective || 'cpu';
    const det = d.detected || {};
    let detectedHtml = '';
    if (det.type === 'nvidia') {
      detectedHtml = '<span style="color:var(--acg)">&#10003; ' + (det.gpu_name || 'NVIDIA GPU') + '</span> &middot; CUDA ' + (det.cuda_version || '?') + ' &middot; ' + (det.vram_mb || '?') + ' MiB';
    } else {
      detectedHtml = '<span style="color:var(--acy)">No NVIDIA GPU detected</span>';
    }
    el.innerHTML = '<div style="font-size:var(--fs-sm);color:var(--t1);margin-bottom:12px;line-height:1.6">' +
      '<strong>Detected:</strong> ' + detectedHtml + '<br>' +
      '<strong>Active mode:</strong> <span style="color:var(--t0b)">' + (eff === 'nvidia' ? 'NVIDIA GPU' : 'CPU') + '</span></div>' +
      '<div style="display:flex;align-items:center;gap:12px">' +
      '<label style="font-size:var(--fs-sm);color:var(--t1);font-family:var(--fontUI)">Device:</label>' +
      '<select class="sel" id="deviceSelect" onchange="setDevice(this.value)" style="min-width:160px">' +
      '<option value="auto"' + (confVal === 'auto' ? ' selected' : '') + '>Auto (detect at startup)</option>' +
      '<option value="nvidia"' + (confVal === 'nvidia' ? ' selected' : '') + '>NVIDIA GPU</option>' +
      '<option value="cpu"' + (confVal === 'cpu' ? ' selected' : '') + '>CPU</option>' +
      '</select></div>' +
      '<div id="deviceChangeStatus" style="font-size:var(--fs-sm);margin-top:8px;display:none"></div>';
  });
}

function setDevice(value) {
  const status = document.getElementById('deviceChangeStatus');
  fetch('/api/device/set', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({ device: value })
  }).then(r => r.json()).then(d => {
    if (d.ok) {
      if (status) {
        status.style.display = '';
        status.innerHTML = '<span style="color:var(--acg)">&#10003; Device set to ' + value + ' (effective: ' + d.effective + ')</span>' +
          '<br><span style="color:var(--acy)">Dependencies may need reinstalling for the new device profile.</span>';
      }
      setTimeout(loadDependencies, 500);
    } else {
      if (status) { status.style.display = ''; status.innerHTML = '<span style="color:var(--acr)">&#10007; ' + d.error + '</span>'; }
    }
  }).catch(e => {
    if (status) { status.style.display = ''; status.innerHTML = '<span style="color:var(--acr)">&#10007; ' + e.message + '</span>'; }
  });
}
