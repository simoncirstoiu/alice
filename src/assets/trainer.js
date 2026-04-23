// ============================================================
// TRAINER UI — step renderers, pipeline, polling, recovery
// ============================================================

// Server-persisted reports — survive page refresh until user dismisses
let _serverReports = {}; // populated from /api/trainer/status._reports

function _saveReport(step, report) {
  _serverReports[step] = report;
  fetch('/api/trainer/report/save', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({ step, report })
  }).catch(() => {});
}

function _dismissReport(step) {
  _serverReports[step] = null;
  fetch('/api/trainer/report/dismiss', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({ step })
  }).catch(() => {});
}

// ============================================================
// TRAINER
// ============================================================
function setTrainerDataset(path) {
  trainerDataset = path;
  fetch('/api/trainer/set-dataset', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({ path: path })
  }).then(r => r.json()).then(d => {
    if (d.ok) toast('Trainer dataset: ' + path.split('/').pop());
    else toast(d.error || 'Invalid dataset', true);
  });
}

function getTrainerDataset() {
  // Return trainer-specific dataset, fallback to viewer dataset
  return trainerDataset || document.getElementById('trainerDatasetSel')?.value || CONF.DEFAULT_DATASET || '';
}

function setTrainerStep(idx) {
  trainerStep = idx;
  trainerTab = 'config';
  _saveUI({trainer_step: idx, trainer_tab: 'config'});
  document.querySelectorAll('.step-item').forEach(el => {
    const s = parseInt(el.dataset.step);
    el.classList.toggle('active', s === idx);
    el.classList.toggle('done', s < idx);
  });
  document.querySelectorAll('[data-ttab]').forEach(el => {
    el.classList.toggle('active', el.dataset.ttab === 'config');
  });
  _updateTrainerToolbarTitle();
  renderTrainerStep();
}

function setTrainerTab(tab) {
  trainerTab = tab;
  _saveUI({trainer_tab: tab});
  document.querySelectorAll('[data-ttab]').forEach(el => {
    el.classList.toggle('active', el.dataset.ttab === tab);
  });
  _updateTrainerToolbarTitle();
  renderTrainerStep();
}

const _STEP_TITLES = ['Export Dataset', 'Deduplication', 'Annotate', 'Train', 'ONNX Export'];
function _updateTrainerToolbarTitle() {
  const el = document.getElementById('trainerToolbarTitle');
  if (!el) return;
  if (trainerTab === 'gpu') el.textContent = 'Device Status';
  else if (trainerTab === 'logs') el.textContent = 'Training Logs';
  else el.textContent = _STEP_TITLES[trainerStep] || 'Config';
}

function toggleTrainerSteps() {
  trainerStepsOpen = !trainerStepsOpen;
  const el = document.getElementById('trainerSteps');
  el.classList.toggle('collapsed', !trainerStepsOpen);
  const btn = document.getElementById('trainerToggle');
  const arrow = btn.querySelector('.arrow');
  if (arrow) arrow.textContent = trainerStepsOpen ? '›' : '‹';
}

let pipelineRunning = false;
let pipelineHTML = '';

// Persistent store for trainer form values — survives tab switches
let trainerFormValues = {};

function saveTrainerFormValue(id, value) {
  trainerFormValues[id] = value;
}

function getTrainerFormValue(id, fallback) {
  // Try DOM first, then stored, then fallback
  const el = document.getElementById(id);
  if (el) {
    const v = el.type === 'checkbox' ? el.checked : el.value;
    trainerFormValues[id] = v;
    return v;
  }
  if (trainerFormValues[id] !== undefined) return trainerFormValues[id];
  return fallback;
}

// Auto-save all trainer inputs on change (delegated)
document.addEventListener('change', function(e) {
  const el = e.target;
  if (!el.id) return;
  const trainerIds = ['exportMaxImages','exportDB','exportClips','exportDataset','exportInputDir',
    'dedupBoxes','dedupPhash','dedupNms','dedupBoxIou','dedupPhashSim','dedupNmsIou',
    'annotateTeacher','annotateConf','annotateMerge',
    'trainModel','trainEpochs','trainBatch','trainImgsz','trainLR','trainLRF','trainFreeze',
    'onnxModel','onnxImgsz','onnxOpset','onnxSimplify','onnxHalf','onnxDynamic'];
  if (trainerIds.includes(el.id)) {
    trainerFormValues[el.id] = el.type === 'checkbox' ? el.checked : el.value;
  }
});
document.addEventListener('input', function(e) {
  const el = e.target;
  if (!el.id) return;
  if (el.id === 'exportMaxImages' || el.id === 'dedupBoxIou' || el.id === 'dedupPhashSim' || 
      el.id === 'dedupNmsIou' || el.id === 'annotateConf' || el.id === 'trainEpochs' ||
      el.id === 'trainBatch' || el.id === 'trainLR' || el.id === 'trainLRF' || 
      el.id === 'trainImgsz' || el.id === 'trainFreeze' || el.id === 'onnxImgsz' || el.id === 'onnxOpset') {
    trainerFormValues[el.id] = el.value;
  }
});

function renderTrainerStep() {
  const el = document.getElementById('trainerContent');
  if (!el) return;

  // Config tab: show pipeline report if exists (persisted on server), or pipeline progress
  if (trainerTab === 'config') {
    const pipelineReport = _serverReports.pipeline;
    if (pipelineReport && !pipelineRunning) {
      el.style.display = ''; el.style.flexDirection = ''; el.style.padding = ''; el.style.overflow = '';
      el.innerHTML = _renderInlineReport(pipelineReport, 'pipeline');
      return;
    }
    if (pipelineRunning) {
      el.innerHTML = pipelineHTML;
      const scroll = document.getElementById('plEpochScroll');
      if (scroll && window._pipelineEpochSync) {
        window._pipelineEpochSync(scroll.querySelectorAll('.epoch-row').length);
      }
      return;
    }
  }

  if (trainerTab === 'gpu') { el.style.display = ''; el.style.padding = ''; el.style.overflow = ''; el.innerHTML = renderGpuTab(); return; }
  if (trainerTab === 'logs') { el.style.display = 'flex'; el.style.flexDirection = 'column'; el.style.padding = '12px'; el.style.overflow = 'hidden'; el.innerHTML = renderLogsTab(); return; }

  el.style.display = ''; el.style.flexDirection = ''; el.style.padding = ''; el.style.overflow = '';

  // Individual step: show report if exists (persisted on server)
  const stepKeys = ['export', 'dedup', 'annotate', 'train', 'onnx'];
  const currentStepKey = stepKeys[trainerStep];
  if (currentStepKey) {
    const report = _serverReports[currentStepKey];
    if (report) {
      el.innerHTML = _renderInlineReport(report, currentStepKey);
      return;
    }
  }

  // No report — render normal step form
  if (trainerStep === 0) { el.innerHTML = renderExportStep(); }
  else if (trainerStep === 1) el.innerHTML = renderDedupStep();
  else if (trainerStep === 2) el.innerHTML = renderAnnotateStep();
  else if (trainerStep === 3) el.innerHTML = renderTrainStep();
  else if (trainerStep === 4) el.innerHTML = renderOnnxStep();

  // Restore saved form values from persistent store
  restoreTrainerFormValues();
}

function restoreTrainerFormValues() {
  for (const [id, val] of Object.entries(trainerFormValues)) {
    const el = document.getElementById(id);
    if (!el) continue;
    if (el.type === 'checkbox') {
      el.checked = val;
    } else {
      el.value = val;
    }
  }
}

let exportSrc = 'db';


function renderExportStep() {
  const dbVis = exportSrc === 'db' ? '' : 'style="display:none"';
  const dirVis = exportSrc === 'dir' ? '' : 'style="display:none"';

  return `
  <div style="display:flex;align-items:center;gap:14px;margin-bottom:20px">
    <span style="font-size:var(--fs-base);font-weight:600;color:var(--t0)" data-tip="Choose where to import images from. Frigate DB reads event snapshots directly. External Folder imports from any directory.">Source</span>
    <button class="btn sm ${exportSrc === 'db' ? 'active' : ''}" onclick="setExportSrc('db')" data-tip="Query Frigate's SQLite database for event snapshots and export them as training images.">Frigate DB</button>
    <button class="btn sm ${exportSrc === 'dir' ? 'active' : ''}" onclick="setExportSrc('dir')" data-tip="Import images from an arbitrary folder on disk.">External Folder</button>
  </div>

  <div id="exportDBSection" ${dbVis}>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:18px">
      <div><div class="sec-label" data-tip="Path to Frigate SQLite database file. Used to query event IDs and camera names.">Frigate DB Path</div><input class="inp" id="exportDB" value="${CONF.FRIGATE_DB || ''}"></div>
      <div><div class="sec-label" data-tip="Directory where Frigate stores clean snapshot WebP files for each event.">Clips Directory</div><input class="inp" id="exportClips" value="${CONF.LIVE_DIR || ''}"></div>
    </div>
  </div>
  <div id="exportDirSection" ${dirVis}>
    <div style="margin-bottom:18px"><div class="sec-label" data-tip="Path to a folder containing images (.jpg, .png, .webp) to import into the dataset.">Source Folder</div><input class="inp" id="exportInputDir" value="" placeholder="/path/to/images/"></div>
  </div>

  <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:24px">
    <div><div class="sec-label" data-tip="Target dataset directory. Images are saved to images/train and images/val subdirectories.">Output Dataset</div><input class="inp" id="exportDataset" value="${CONF.DEFAULT_DATASET || ''}"></div>
    <div><div class="sec-label" data-tip="Maximum number of images to export. Set to 0 to export everything available.">Max Images <span style="font-weight:400;color:var(--t2)">(0 = no limit)</span></div><input type="number" class="num-inp w-full" id="exportMaxImages" value="100" min="0" max="999999"></div>
  </div>

  <div style="display:flex;gap:10px">
    ${_renderStepBtn('export')}
  </div>
  ${_renderProgressDiv('export')}`;
}

function renderDedupStep() {
  return `
  <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:24px">
    <div class="gpu-card" style="padding:var(--pad-lg);position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center">
      <input type="checkbox" id="dedupBoxes" ${CONF.DEDUP_BOXES ? 'checked' : ''} style="accent-color:var(--ac);width:16px;height:16px;position:absolute;top:14px;left:14px;cursor:pointer">
      <span class="badge badge-green" style="position:absolute;top:12px;right:12px">Fast</span>
      <div style="font-size:var(--fs-lg);font-weight:700;color:var(--t0);margin-bottom:20px" data-tip="Compare bounding box annotations between images from the same camera.">Box Dedup</div>
      <div style="position:relative;margin-bottom:6px">
        <input type="number" class="num-inp" id="dedupBoxIou" value="${CONF.DEDUP_BOX_SIM || 10}" min="0" max="100" step="5" style="width:60px;font-size:var(--fs-lg)">
        <span style="font-size:var(--fs-base);color:var(--t2);position:absolute;right:-20px;top:50%;transform:translateY(-50%)">%</span>
      </div>
      <div style="font-size:var(--fs-sm);color:var(--t2)">Similarity</div>
    </div>
    <div class="gpu-card" style="padding:var(--pad-lg);position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center">
      <input type="checkbox" id="dedupPhash" ${CONF.DEDUP_PHASH !== false ? 'checked' : ''} style="accent-color:var(--acp);width:16px;height:16px;position:absolute;top:14px;left:14px;cursor:pointer">
      <span class="badge badge-purple" style="position:absolute;top:12px;right:12px">Smart</span>
      <div style="font-size:var(--fs-lg);font-weight:700;color:var(--t0);margin-bottom:20px" data-tip="Compare images visually using perceptual hashing. Works without annotations.">Visual pHash</div>
      <div style="position:relative;margin-bottom:6px">
        <input type="number" class="num-inp" id="dedupPhashSim" value="${CONF.DEDUP_PHASH_SIM || 85}" min="0" max="100" step="5" style="width:60px;font-size:var(--fs-lg)">
        <span style="font-size:var(--fs-base);color:var(--t2);position:absolute;right:-20px;top:50%;transform:translateY(-50%)">%</span>
      </div>
      <div style="font-size:var(--fs-sm);color:var(--t2)">Similarity</div>
    </div>
    <div class="gpu-card" style="padding:var(--pad-lg);position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center">
      <input type="checkbox" id="dedupNms" ${CONF.DEDUP_NMS === true ? 'checked' : ''} style="accent-color:var(--ac);width:16px;height:16px;position:absolute;top:14px;left:14px;cursor:pointer">
      <span class="badge badge-ac" style="position:absolute;top:12px;right:12px">Clean</span>
      <div style="font-size:var(--fs-lg);font-weight:700;color:var(--t0);margin-bottom:20px" data-tip="Remove overlapping same-class boxes within each image.">NMS Cleanup</div>
      <div style="position:relative;margin-bottom:6px">
        <input type="number" class="num-inp" id="dedupNmsIou" value="${CONF.DEDUP_NMS_SIM || 85}" min="0" max="100" step="5" style="width:60px;font-size:var(--fs-lg)">
        <span style="font-size:var(--fs-base);color:var(--t2);position:absolute;right:-20px;top:50%;transform:translateY(-50%)">%</span>
      </div>
      <div style="font-size:var(--fs-sm);color:var(--t2)">Similarity</div>
    </div>
  </div>

  <div style="display:flex;gap:10px">
    <div style="flex:1">${_renderStepBtn('dedup')}</div>
    <button class="btn" style="flex:1;background:var(--bg2);border:1px solid var(--bd2)" onclick="runDedup(true)" data-tip="Preview what would be removed without actually deleting anything.">Dry Run</button>
  </div>
  <div id="dedupResult" style="margin-top:14px"></div>
  ${_renderProgressDiv('dedup')}`;
}

function renderAnnotateStep() {
  return `
  <div style="display:grid;grid-template-columns:2fr 1fr;gap:16px;margin-bottom:18px">
    <div><div class="sec-label" data-tip="Large, accurate model used to generate ground-truth labels. This model runs inference on every image to create bounding box annotations.">Teacher Model</div>
      <select class="sel w-full" id="annotateTeacher">
        ${(window._modelsList || []).map(m => {
          const name = m.split('/').pop();
          const confTeacher = (CONF.TEACHER_MODEL || '').split('/').pop();
          const sel = name === confTeacher ? ' selected' : '';
          return '<option value="' + m + '"' + sel + '>' + name + '</option>';
        }).join('')}
      </select>
    </div>
    <div><div class="sec-label" data-tip="Minimum detection confidence. Only detections above this score are saved as annotations. Lower = more boxes but more false positives.">Confidence</div>
      <input type="number" class="num-inp w-full" id="annotateConf" value="${CONF.DEFAULT_CONFIDENCE || 0.5}" min="0.05" max="0.99" step="0.05">
    </div>
  </div>

  <label style="display:flex;align-items:center;gap:10px;font-size:var(--fs-base);color:var(--t1);font-family:var(--fontUI);margin-bottom:24px;cursor:pointer" data-tip="When enabled, new detections are added alongside existing boxes (skipping overlaps). When disabled, existing annotations are replaced entirely with new detections.">
    <input type="checkbox" id="annotateMerge" style="accent-color:var(--ac);width:16px;height:16px">
    Merge with existing annotations (keep existing boxes)
  </label>

  <div style="display:flex;gap:10px">
    ${_renderStepBtn('annotate')}
  </div>
  ${_renderProgressDiv('annotate')}`;
}

function _setPipelineBtn(running) {
  const btn = document.getElementById('pipelineBtn');
  if (!btn) return;
  if (running) {
    btn.textContent = '⊘ Stop Pipeline';
    btn.className = 'btn btn-lg danger w-full';
    btn.onclick = function() { stopTrainer(); };
  } else {
    btn.textContent = 'Run Selected Pipeline';
    btn.className = 'btn btn-lg primary-purple w-full';
    btn.onclick = runSelectedPipeline;
  }
}

function stopTrainer(step) {
  // If pipeline running — abort on server too
  if (pipelineRunning) {
    fetch('/api/trainer/pipeline/abort', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: '{}' });
  }
  // Stop specific step or all
  const body = step ? { step: step } : {};
  fetch('/api/trainer/stop', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body) }).then(r => r.json()).then(d => {
    toast('Stopped');
  });
  window._pipelineAborted = true;
  pipelineRunning = false;
  pipelineHTML = '';
  stopTrainerPoll();
  if (gpuTimer) { clearInterval(gpuTimer); gpuTimer = null; }
  if (logsPollTimer) { clearInterval(logsPollTimer); logsPollTimer = null; }
  _resetAllSteps();
  _setPipelineBtn(false);
  setTimeout(() => renderTrainerStep(), 500);
}

function runAnnotate() {
  const teacher = getTrainerFormValue('annotateTeacher', '') || (window._modelsList || [])[0] || '';
  if (!teacher) { showConfigError('No Teacher Model', 'Cannot annotate without a model. Download a YOLO model and set it as Teacher Model.', 'ai'); return; }
  const conf = parseFloat(getTrainerFormValue('annotateConf', CONF.DEFAULT_CONFIDENCE || 0.5));
  const merge = getTrainerFormValue('annotateMerge', false);
  const classes = CONF.DEFAULT_CLASSES || [0,2,15,16];

  _setStepRunning('annotate');
  showImmediateProgress('ANNOTATE');
  startTrainerPoll();
  fetch('/api/trainer/reannotate', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({ teacher: teacher, conf: conf, classes: classes, merge: merge })
  }).catch(e => { stopTrainerPoll(); toast('Annotation error: ' + e, true); _resetStep('annotate'); });
}

function renderTrainStep() {
  return `
  <div style="display:grid;grid-template-columns:2fr auto;gap:14px;align-items:end;margin-bottom:20px">
    <div><div class="sec-label" data-tip="Smaller model to fine-tune on your dataset. This is the model that will be deployed. Starts from pretrained weights and learns your specific objects.">Base Model (Student)</div>
      <select class="sel w-full" id="trainModel">
        ${(window._modelsList || []).map(m => {
          const name = m.split('/').pop();
          const confStudent = (CONF.STUDENT_MODEL || '').split('/').pop();
          const sel = name === confStudent ? ' selected' : '';
          return '<option value="' + m + '"' + sel + '>' + name + '</option>';
        }).join('')}
      </select>
    </div>
  </div>

  <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;margin-bottom:14px">
    <div><div class="sec-label" data-tip="Number of training epochs.">Epochs</div><input type="number" class="num-inp w-full" id="trainEpochs" value="${CONF.EPOCHS || 10}"></div>
    <div><div class="sec-label" data-tip="Images per batch. Lower if OOM.">Batch Size</div><input type="number" class="num-inp w-full" id="trainBatch" value="${CONF.BATCH_SIZE || 8}"></div>
    <div><div class="sec-label" data-tip="Input image resolution.">Image Size</div><input type="number" class="num-inp w-full" id="trainImgsz" value="${CONF.IMAGE_SIZE || 640}" step="32"></div>
    <div><div class="sec-label" data-tip="Initial learning rate.">Learning Rate</div><input type="number" class="num-inp w-full" id="trainLR" value="${CONF.LEARNING_RATE || 0.0001}" step="0.0001"></div>
    <div><div class="sec-label" data-tip="Final LR as fraction of initial.">LR Final</div><input type="number" class="num-inp w-full" id="trainLRF" value="${CONF.LR_FINAL || 0.01}" step="0.01"></div>
    <div><div class="sec-label" data-tip="Frozen backbone layers during fine-tuning.">Freeze Layers</div><input type="number" class="num-inp w-full" id="trainFreeze" value="${CONF.FREEZE_LAYERS || 10}"></div>
  </div>

  <div style="display:flex;gap:20px;margin-bottom:24px">
    <label style="display:flex;align-items:center;gap:6px;font-size:var(--fs-base);color:var(--t1);cursor:pointer" data-tip="Enable data augmentation (fliplr, mosaic, mixup, rotation, HSV). Recommended for small datasets like surveillance footage."><input type="checkbox" id="trainAugment" ${CONF.AUGMENTATION === true ? 'checked' : ''} style="accent-color:var(--ac);width:15px;height:15px">Augmentation</label>
  </div>

  <div style="display:flex;gap:10px;justify-content:center">
    ${_renderStepBtn('train')}
  </div>

  <div id="trainResult"></div>
  ${_renderProgressDiv('train')}`;
}

function renderOnnxStep() {
  return `
  <div style="display:grid;grid-template-columns:2fr 1fr 1fr;gap:14px;margin-bottom:18px">
    <div><div class="sec-label" data-tip="The .pt model to convert. Usually the fine-tuned model from the Train step.">Source Model</div>
      <select class="sel w-full" id="onnxModel">
        ${(window._modelsList || []).map(m => {
          const name = m.split('/').pop();
          return '<option value="' + m + '">' + name + '</option>';
        }).join('')}
      </select>
    </div>
    <div><div class="sec-label" data-tip="Input image resolution baked into the ONNX model. Must match what Frigate expects (usually 640).">Image Size</div><input type="number" class="num-inp w-full" id="onnxImgsz" value="640" step="32"></div>
    <div><div class="sec-label" data-tip="ONNX operator set version. 13 works with most runtimes. Higher may enable newer ops.">Opset</div><input type="number" class="num-inp w-full" id="onnxOpset" value="13"></div>
  </div>

  <div style="display:flex;gap:20px;margin-bottom:24px">
    <label style="display:flex;align-items:center;gap:6px;font-size:var(--fs-base);color:var(--t1);cursor:pointer" data-tip="Run onnx-simplifier to optimize the graph. Reduces model size and improves inference speed."><input type="checkbox" id="onnxSimplify" checked style="accent-color:var(--ac);width:15px;height:15px">Simplify</label>
    <label style="display:flex;align-items:center;gap:6px;font-size:var(--fs-base);color:var(--t1);cursor:pointer" data-tip="Export weights as 16-bit float. Halves model size with minimal accuracy loss. Required for TensorRT FP16."><input type="checkbox" id="onnxHalf" ${DEVICE_INFO.effective === 'nvidia' ? '' : 'disabled'} style="accent-color:var(--ac);width:15px;height:15px">FP16${DEVICE_INFO.effective !== 'nvidia' ? ' <span style="font-size:var(--fs-xs);color:var(--t3)">(GPU only)</span>' : ''}</label>
    <label style="display:flex;align-items:center;gap:6px;font-size:var(--fs-base);color:var(--t1);cursor:pointer" data-tip="Allow dynamic batch size and input dimensions. Disable for fixed-size TensorRT engines."><input type="checkbox" id="onnxDynamic" style="accent-color:var(--ac);width:15px;height:15px">Dynamic</label>
  </div>

  <div style="display:flex;gap:10px">
    ${_renderStepBtn('onnx')}
  </div>

  <div id="onnxResult" style="margin-top:14px"></div>
  ${_renderProgressDiv('onnx')}`;
}

let gpuTimer = null;

function renderGpuTab() {
  // Start polling
  if (gpuTimer) clearInterval(gpuTimer);
  fetchGpuInfo();
  gpuTimer = setInterval(fetchGpuInfo, 3000);

  return `<div class="gpu-terminal" id="gpuOutput">Fetching device info...</div>
  <div class="gpu-cards" id="gpuCards"></div>
  <div class="text-sm text-t2 font-ui" style="margin-top:10px">Auto-refreshes every 3 seconds</div>`;
}

function fetchGpuInfo() {
  fetch('/api/gpu').then(r => r.json()).then(d => {
    const el = document.getElementById('gpuOutput');
    const cards = document.getElementById('gpuCards');
    if (!el) { if (gpuTimer) { clearInterval(gpuTimer); gpuTimer = null; } return; }
    if (d.mode === 'cpu') {
      el.textContent = d.output || 'Running in CPU mode.';
      if (cards) {
        const items = [];
        if (d.load) items.push({ label: 'Load Avg', value: d.load, color: '#3b82f6' });
        if (d.mem_used && d.mem_total) items.push({ label: 'Memory', value: d.mem_used + '/' + d.mem_total + ' MiB', color: '#06b6d4' });
        if (d.cores) items.push({ label: 'CPU Cores', value: d.cores, color: '#e4e4ec' });
        if (d.temp) items.push({ label: 'Temperature', value: d.temp + '°C', color: '#22c55e' });
        if (items.length === 0) items.push({ label: 'Active Device', value: 'CPU', color: '#eab308' });
        cards.innerHTML = items.map(c => `<div class="gpu-card"><div class="gpu-card-val" style="color:${c.color}">${c.value}</div><div class="gpu-card-label">${c.label}</div></div>`).join('');
      }
    } else if (d.ok) {
      el.textContent = d.output;
      if (cards && d.temp !== undefined) {
        cards.innerHTML = [
          { label: 'Temperature', value: d.temp + '°C', color: '#22c55e' },
          { label: 'GPU Util', value: d.util + '%', color: '#3b82f6' },
          { label: 'VRAM', value: d.vram_used + '/' + d.vram_total + ' MiB', color: '#06b6d4' },
          { label: 'Power', value: d.power + 'W', color: '#e4e4ec' },
        ].map(c => `<div class="gpu-card"><div class="gpu-card-val" style="color:${c.color}">${c.value}</div><div class="gpu-card-label">${c.label}</div></div>`).join('');
      }
    } else {
      el.textContent = d.error || 'Device info not available';
      if (cards) cards.innerHTML = '';
    }
  }).catch(() => {
    const el = document.getElementById('gpuOutput');
    if (el) el.textContent = 'Failed to fetch device info';
  });
}

let logsPollTimer = null;
let logsLineCount = 0;

function renderLogsTab() {
  // Start logs polling
  if (logsPollTimer) clearInterval(logsPollTimer);
  logsLineCount = 0;
  pollLogs();
  logsPollTimer = setInterval(pollLogs, 1500);

  return `<div style="display:flex;align-items:center;margin-bottom:10px">
    <div style="flex:1"></div>
    <div style="flex:1;display:flex;justify-content:flex-end;gap:6px">
      <button class="btn sm" onclick="copyLogs()" style="font-size:var(--fs-sm);padding:5px 10px;line-height:1">Copy Log</button>
      <button class="btn sm danger" onclick="resetLogs()" style="font-size:var(--fs-sm);padding:5px 10px;line-height:1">Reset Log</button>
    </div>
  </div>
  <div class="logs-terminal" id="logsOutput" style="flex:1;max-height:none;overflow-y:auto;width:100%;white-space:pre-wrap;word-break:break-all;font-size:var(--fs-xs)">Waiting for training output...</div>`;
}

function pollLogs() {
  fetch('/api/trainer/logs?start=0').then(r => r.json()).then(d => {
    const el = document.getElementById('logsOutput');
    if (!el) { if (logsPollTimer) { clearInterval(logsPollTimer); logsPollTimer = null; } return; }
    if (d.lines && d.lines.length > 0) {
      const wasAtBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 30;
      el.textContent = d.lines.join('\n');
      if (wasAtBottom) el.scrollTop = el.scrollHeight;
    } else {
      el.textContent = 'No logs yet.';
    }
  }).catch(() => {});
}

function resetLogs() {
  fetch('/api/trainer/logs/reset', { method: 'POST' }).then(r => r.json()).then(d => {
    if (d.ok) {
      const el = document.getElementById('logsOutput');
      if (el) el.textContent = 'Logs cleared.';
      toast('Logs reset');
    }
  });
}

function copyLogs() {
  const el = document.getElementById('logsOutput');
  if (!el) return;
  const text = el.textContent;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(() => toast('Logs copied')).catch(() => _copyFallback(text));
  } else {
    _copyFallback(text);
  }
}

function _copyFallback(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.cssText = 'position:fixed;left:-9999px';
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); toast('Logs copied'); }
  catch(e) { toast('Copy failed', true); }
  document.body.removeChild(ta);
}

// Trainer actions (API calls)
// ============================================================
// TRAINER PROGRESS POLLING
// ============================================================
let trainerPollTimer = null;
let trainerStartTime = 0;

// Unified step state — tracks running status and cached progress per step
const _stepState = {
  export:   { running: false, progressHTML: '', startTime: 0, pendingReport: null, btnId: 'exportBtn',   startLabel: 'Export Dataset',   stopLabel: '⊘ Stop Export' },
  dedup:    { running: false, progressHTML: '', startTime: 0, pendingReport: null, btnId: 'dedupBtn',    startLabel: 'Run Dedup',        stopLabel: '⊘ Stop Dedup' },
  annotate: { running: false, progressHTML: '', startTime: 0, pendingReport: null, btnId: 'annotateBtn', startLabel: 'Annotate Dataset', stopLabel: '⊘ Stop Annotate' },
  train:    { running: false, progressHTML: '', startTime: 0, pendingReport: null, btnId: 'trainBtn',    startLabel: 'Start Training',   stopLabel: '⊘ Stop Training' },
  onnx:     { running: false, progressHTML: '', startTime: 0, pendingReport: null, btnId: 'onnxBtn',     startLabel: 'Export ONNX',      stopLabel: '⊘ Stop ONNX' },
};

function _setStepRunning(step) {
  const s = _stepState[step];
  if (!s) return;
  s.running = true;
  s.startTime = Date.now();
  if (step === 'train') _individualEpochCount = 0;
  const btn = document.getElementById(s.btnId);
  if (btn) {
    btn.textContent = s.stopLabel;
    btn.className = 'btn btn-lg danger w-full';
    btn.onclick = function() { stopTrainer(step); _resetStep(step); };
  }
}

function _resetStep(step) {
  const s = _stepState[step];
  if (!s) return;
  s.running = false;
  s.progressHTML = '';
  s.pendingReport = null;
  const btn = document.getElementById(s.btnId);
  if (btn) {
    btn.textContent = s.startLabel;
    btn.className = 'btn btn-lg primary w-full';
    // Restore original onclick
    const handlers = { export: runExport, dedup: function(){runDedup(false)}, annotate: runAnnotate, train: runTrain, onnx: runOnnxExport };
    btn.onclick = handlers[step] || null;
  }
}

function _resetAllSteps() {
  for (const step of Object.keys(_stepState)) _resetStep(step);
}

function _getActiveStep() {
  for (const [k, v] of Object.entries(_stepState)) { if (v.running) return k; }
  return null;
}

function _renderStepBtn(step) {
  const s = _stepState[step];
  if (s.running) {
    return `<button class="btn btn-lg danger w-full" id="${s.btnId}" onclick="stopTrainer('${step}'); _resetStep('${step}');">${s.stopLabel}</button>`;
  }
  const handlers = { export: "runExport()", dedup: "runDedup(false)", annotate: "runAnnotate()", train: "runTrain()", onnx: "runOnnxExport()" };
  return `<button class="btn btn-lg primary w-full" id="${s.btnId}" onclick="${handlers[step]}">${s.startLabel}</button>`;
}

function _renderProgressDiv(step) {
  const s = _stepState[step];
  const show = s.running && s.progressHTML;
  return `<div id="progress_${step}" style="${show ? '' : 'display:none;'}margin-top:14px">${show ? s.progressHTML : ''}</div>`;
}

function startTrainerPoll() {
  stopTrainerPoll();
  trainerStartTime = Date.now();
  trainerPollTimer = setInterval(updateTrainerProgress, 1500);
}

function stopTrainerPoll() {
  if (trainerPollTimer) { clearInterval(trainerPollTimer); trainerPollTimer = null; }
}

let _individualEpochCount = 0;
let _trainShellRendered = false;

function _appendEpochRow(scrollEl, ep) {
  const row = document.createElement('div');
  row.className = 'epoch-row';
  row.style.cssText = 'display:grid;grid-template-columns:35px 1fr 1fr 1fr 1fr 1fr;gap:4px;padding:3px 0;border-bottom:1px solid rgba(42,42,61,0.3)';
  row.innerHTML = `<span style="color:var(--ac)">${ep.epoch||''}</span><span>${ep.box_loss||'-'}</span><span>${ep.cls_loss||'-'}</span><span>${ep.dfl_loss||'-'}</span><span style="color:var(--acg)">${ep.mAP50||'-'}</span><span>${ep.mAP50_95||'-'}</span>`;
  scrollEl.appendChild(row);
}

function _ensureTrainShell(el) {
  if (_trainShellRendered && document.getElementById('indivStepLabel')) return;
  el.innerHTML = `
    <div style="background:var(--bg2);border-radius:var(--radius);padding:var(--pad-md);border:1px solid var(--ac)">
      <div class="flex justify-between items-center" style="margin-bottom:6px">
        <span id="indivStepLabel" style="font-size:var(--fs-xs);font-weight:600;color:var(--t0);font-family:var(--fontUI)">TRAIN</span>
        <span id="indivCounter" style="font-size:var(--fs-xs);color:var(--ac);font-family:var(--font)"></span>
      </div>
      <div class="progress-bar" style="margin-bottom:6px"><div id="indivFill" class="progress-fill" style="width:0%;background:var(--ac)"></div></div>
      <div id="indivMsg" style="font-size:var(--fs-xs);color:var(--t2);font-family:var(--font)"></div>
    </div>
    <div id="indivEpochContainer" style="margin-top:12px;background:var(--bg2);border-radius:8px;padding:var(--pad-lg);border:1px solid var(--bd)">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
        <span style="font-size:var(--fs-sm);font-weight:600;color:var(--t1)">Epoch History</span>
        <span id="indivEpochCounter" style="font-size:var(--fs-sm);font-family:var(--font);color:var(--ac)"></span>
      </div>
      <div id="indivBatchBar" style="display:none;margin-bottom:12px;align-items:center;gap:10px">
        <span id="indivBatchLabel" style="font-size:var(--fs-xs);color:var(--t0);font-family:var(--font);min-width:90px;font-weight:600"></span>
        <div style="flex:1;height:6px;background:var(--bg3);border-radius:3px;overflow:hidden">
          <div id="indivBatchFill" style="height:100%;width:0%;background:var(--ac);border-radius:3px;transition:width 0.3s"></div>
        </div>
        <span id="indivBatchPct" style="font-size:var(--fs-xs);color:var(--t1);font-family:var(--font);min-width:55px;text-align:right"></span>
      </div>
      <div id="indivEpochScroll" style="font-size:var(--fs-xs);font-family:var(--font);color:var(--t1);max-height:180px;overflow-y:auto">
        <div style="display:grid;grid-template-columns:35px 1fr 1fr 1fr 1fr 1fr;gap:4px;padding:var(--pad-xs) 0;border-bottom:1px solid var(--bd);font-weight:600;color:var(--t2);position:sticky;top:0;background:var(--bg2)">
          <span>#</span><span>box</span><span>cls</span><span>dfl</span><span>mAP50</span><span>mAP95</span>
        </div>
      </div>
    </div>`;
  _trainShellRendered = true;
  _individualEpochCount = 0;
}

function updateTrainerProgress() {
  fetch('/api/trainer/status').then(r => r.json()).then(allStatus => {
    // Sync server-persisted reports on every poll
    if (allStatus._reports) _serverReports = allStatus._reports;

    const stepKeys = ['export', 'dedup', 'annotate', 'train', 'onnx'];
    let anyRunning = false;

    for (const step of stepKeys) {
      const d = allStatus[step];
      if (!d) continue;

      if (d.running) {
        anyRunning = true;
        if (!_stepState[step].running) {
          _stepState[step].running = true;
          _stepState[step].startTime = _stepState[step].startTime || Date.now();
        }

        // Cache progress HTML from server data (always, even if div not in DOM)
        let cachedHTML = `<div style="background:var(--bg2);border-radius:var(--radius);padding:var(--pad-md);border:1px solid var(--ac)">
          <div class="flex justify-between items-center" style="margin-bottom:6px">
            <span style="font-size:var(--fs-xs);font-weight:600;color:var(--t0);font-family:var(--fontUI)">${step.toUpperCase()}</span>
            <span style="font-size:var(--fs-xs);color:var(--ac);font-family:var(--font)">${d.current}/${d.total} (${d.progress}%)</span>
          </div>
          <div class="progress-bar" style="margin-bottom:6px"><div class="progress-fill" style="width:${d.progress}%;background:var(--ac)"></div></div>
          <div style="font-size:var(--fs-xs);color:var(--t2);font-family:var(--font)">${d.message}</div>
        </div>`;
        if (step === 'train') {
          const epochs = d.epochs || [];
          const epTotal = d.total || 1;
          const bTotal = d.batch_total || 0;
          const bPct = d.batch_pct || (bTotal > 0 ? Math.round((d.batch || 0) / bTotal * 100) : 0);
          const activeEpoch = d.current || (epochs.length + 1);
          cachedHTML += `<div style="margin-top:12px;background:var(--bg2);border-radius:8px;padding:var(--pad-lg);border:1px solid var(--bd)">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
              <span style="font-size:var(--fs-sm);font-weight:600;color:var(--t1)">Epoch History</span>
              <span style="font-size:var(--fs-sm);font-family:var(--font);color:var(--ac)">${epochs.length}/${epTotal} epochs</span>
            </div>`;
          if (bTotal > 0) {
            cachedHTML += `<div style="display:flex;margin-bottom:12px;align-items:center;gap:10px">
              <span style="font-size:var(--fs-xs);color:var(--t0);font-family:var(--font);min-width:90px;font-weight:600">Epoch ${activeEpoch}/${epTotal}</span>
              <div style="flex:1;height:6px;background:var(--bg3);border-radius:3px;overflow:hidden"><div style="height:100%;width:${bPct}%;background:var(--ac);border-radius:3px"></div></div>
              <span style="font-size:var(--fs-xs);color:var(--t1);font-family:var(--font);min-width:55px;text-align:right">${bPct}%</span>
            </div>`;
          }
          if (epochs.length > 0) {
            cachedHTML += `<div style="font-size:var(--fs-xs);font-family:var(--font);color:var(--t1);max-height:180px;overflow-y:auto">
              <div style="display:grid;grid-template-columns:35px 1fr 1fr 1fr 1fr 1fr;gap:4px;padding:var(--pad-xs) 0;border-bottom:1px solid var(--bd);font-weight:600;color:var(--t2)"><span>#</span><span>box</span><span>cls</span><span>dfl</span><span>mAP50</span><span>mAP95</span></div>`;
            for (const ep of epochs) {
              cachedHTML += `<div style="display:grid;grid-template-columns:35px 1fr 1fr 1fr 1fr 1fr;gap:4px;padding:3px 0;border-bottom:1px solid rgba(42,42,61,0.3)"><span style="color:var(--ac)">${ep.epoch||''}</span><span>${ep.box_loss||'-'}</span><span>${ep.cls_loss||'-'}</span><span>${ep.dfl_loss||'-'}</span><span style="color:var(--acg)">${ep.mAP50||'-'}</span><span>${ep.mAP50_95||'-'}</span></div>`;
            }
            cachedHTML += '</div>';
          }
          cachedHTML += '</div>';
        }
        _stepState[step].progressHTML = cachedHTML;

        // Update live DOM if user is on this module
        const el = document.getElementById('progress_' + step);
        if (el) {
          el.style.display = '';
          if (step === 'train') {
            _ensureTrainShell(el);
            const counter = document.getElementById('indivCounter');
            const fill = document.getElementById('indivFill');
            const msg = document.getElementById('indivMsg');
            if (counter) counter.textContent = `${d.current}/${d.total} (${d.progress}%)`;
            if (fill) fill.style.width = d.progress + '%';
            if (msg) msg.textContent = d.message || '';
            const epochs = d.epochs || [];
            const scroll = document.getElementById('indivEpochScroll');
            const epCounter = document.getElementById('indivEpochCounter');
            if (epCounter) epCounter.textContent = `${epochs.length}/${d.total || 1} epochs`;
            if (scroll && epochs.length > _individualEpochCount) {
              for (let i = _individualEpochCount; i < epochs.length; i++) _appendEpochRow(scroll, epochs[i]);
              _individualEpochCount = epochs.length;
              scroll.scrollTop = scroll.scrollHeight;
            }
            const batchBar = document.getElementById('indivBatchBar');
            if (batchBar && (d.batch_total || 0) > 0) {
              batchBar.style.display = 'flex';
              const bl = document.getElementById('indivBatchLabel');
              const bf = document.getElementById('indivBatchFill');
              const bp = document.getElementById('indivBatchPct');
              const bPct2 = d.batch_pct || Math.round((d.batch||0) / d.batch_total * 100);
              if (bl) bl.textContent = `Epoch ${d.current || (epochs.length+1)}/${d.total||1}`;
              if (bf) bf.style.width = bPct2 + '%';
              if (bp) bp.textContent = bPct2 + '%';
            }
          } else {
            _trainShellRendered = false;
            el.innerHTML = _stepState[step].progressHTML || '';
          }
        }

      } else if (_stepState[step].running) {
        // Was running, now finished — completion
        const msg = d.message || '';
        const isErr = msg.toLowerCase().includes('error') || msg.toLowerCase().includes('fail') || msg.toLowerCase().includes('stop');
        const stepName = _stepState[step].startLabel;
        const elapsed = _stepState[step].startTime ? ((Date.now() - _stepState[step].startTime) / 1000).toFixed(1) + 's' : '';
        const reportData = {
          title: stepName + (isErr ? ' \u2014 Failed' : ' \u2014 Complete'),
          message: msg, isError: isErr, elapsed: elapsed,
          epochs: (step === 'train' && d.epochs && d.epochs.length > 0) ? d.epochs : null,
        };
        _saveReport(step, reportData);
        _stepState[step].running = false;
        _stepState[step].progressHTML = '';
        _stepState[step].pendingReport = null;
        if (step === 'train') _trainShellRendered = false;
        // Re-render to show inline report
        renderTrainerStep();
      }
    }
    if (!anyRunning) {
      stopTrainerPoll();
      loadModelsList();
      if (!pipelineRunning || pipelineHTML === '') { pipelineRunning = false; pipelineHTML = ''; }
    }
  }).catch(() => {});
}

function _findBestEpoch(epochs) {
  if (!epochs || epochs.length === 0) return null;
  let best = epochs[0];
  for (const ep of epochs) {
    if ((ep.mAP50 || 0) > (best.mAP50 || 0)) best = ep;
  }
  return best;
}

function _bestEpochHTML(epochs) {
  const best = _findBestEpoch(epochs);
  if (!best) return '';
  return `<div style="background:var(--bg2);border-radius:8px;padding:var(--pad-lg);border:1px solid var(--acg);margin-bottom:14px">
    <div style="font-size:var(--fs-sm);font-weight:600;color:var(--acg);margin-bottom:8px">Best Epoch: #${best.epoch || '?'}</div>
    <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:8px;font-size:var(--fs-sm);font-family:var(--font)">
      <div><span style="color:var(--t2)">box</span><br><span style="color:var(--t0)">${best.box_loss||'-'}</span></div>
      <div><span style="color:var(--t2)">cls</span><br><span style="color:var(--t0)">${best.cls_loss||'-'}</span></div>
      <div><span style="color:var(--t2)">dfl</span><br><span style="color:var(--t0)">${best.dfl_loss||'-'}</span></div>
      <div><span style="color:var(--t2)">mAP50</span><br><span style="color:var(--acg);font-weight:700">${best.mAP50||'-'}</span></div>
      <div><span style="color:var(--t2)">mAP95</span><br><span style="color:var(--t0)">${best.mAP50_95||'-'}</span></div>
    </div>
  </div>`;
}

function _renderInlineReport(opts, reportStep) {
  // Renders report HTML inline (not modal) — for embedding in trainerContent
  const color = opts.isError ? 'var(--acr)' : 'var(--acg)';
  const icon = opts.isError ? '✗' : '✓';

  let html = `<div style="max-width:600px;margin:40px auto;padding:var(--pad-xl);text-align:center">
    <div style="display:flex;flex-direction:column;align-items:center;gap:12px;margin-bottom:24px">
      <div style="width:48px;height:48px;border-radius:50%;background:${color}20;display:flex;align-items:center;justify-content:center;font-size:var(--fs-3xl);color:${color};font-weight:700;flex-shrink:0">${icon}</div>
      <div>
        <div style="font-size:var(--fs-2xl);font-weight:700;color:var(--t0b)">${opts.title || 'Complete'}</div>
        <div style="font-size:var(--fs-base);color:var(--t1);font-family:var(--font);margin-top:4px">${opts.message || ''}${opts.elapsed ? ' &middot; ' + opts.elapsed : ''}</div>
      </div>
    </div>`;

  // Pipeline step list
  if (opts.steps && opts.steps.length > 0) {
    html += '<div style="background:var(--bg2);border-radius:10px;padding:var(--pad-lg);border:1px solid var(--bd);margin-bottom:20px">';
    html += '<div style="font-size:var(--fs-sm);font-weight:600;color:var(--t1);margin-bottom:12px">Steps</div>';
    for (const s of opts.steps) {
      const sIcon = s.ok ? '✓' : '✗';
      const sColor = s.ok ? 'var(--acg)' : 'var(--acr)';
      html += `<div style="display:flex;align-items:center;gap:10px;padding:var(--pad-md) 0;border-bottom:1px solid var(--bd);font-size:var(--fs-base)">
        <span style="color:${sColor};font-size:var(--fs-lg);font-weight:700;width:20px;text-align:center">${sIcon}</span>
        <span style="color:var(--t0);flex:1">${s.name}</span>
        <span style="font-size:var(--fs-sm);color:var(--t1);font-family:var(--font)">${s.detail || ''}</span>
        <span style="font-size:var(--fs-sm);color:var(--t1);font-family:var(--font);min-width:50px;text-align:right">${s.duration || ''}</span>
      </div>`;
      if (s.extra && s.extra.length > 0) {
        html += _bestEpochHTML(s.extra);
        html += _buildEpochTableHTML(s.extra);
      }
    }
    html += '</div>';
  }

  // Best epoch + epoch table for individual train
  if (opts.epochs && opts.epochs.length > 0 && !opts.steps) {
    html += _bestEpochHTML(opts.epochs);
    html += _buildEpochTableHTML(opts.epochs);
  }

  html += `<button class="btn btn-lg primary w-full" onclick="_dismissInlineReport('${reportStep}')">Dismiss</button>`;
  html += '</div>';
  return html;
}

function _dismissInlineReport(step) {
  _dismissReport(step);
  _stepState[step] && (_stepState[step].pendingReport = null);
  renderTrainerStep();
}

function _buildEpochTableHTML(epochs) {
  let h = `<div style="background:var(--bg2);border-radius:8px;padding:var(--pad-lg);border:1px solid var(--bd);margin:8px 0 16px">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
      <span style="font-size:var(--fs-sm);font-weight:600;color:var(--t1)">Epoch History</span>
      <span style="font-size:var(--fs-sm);font-family:var(--font);color:var(--ac)">${epochs.length} epochs</span>
    </div>
    <div style="font-size:var(--fs-xs);font-family:var(--font);color:var(--t1);max-height:240px;overflow-y:auto">
      <div style="display:grid;grid-template-columns:35px 1fr 1fr 1fr 1fr 1fr;gap:4px;padding:var(--pad-xs) 0;border-bottom:1px solid var(--bd);font-weight:600;color:var(--t2);position:sticky;top:0;background:var(--bg2)">
        <span>#</span><span>box</span><span>cls</span><span>dfl</span><span>mAP50</span><span>mAP95</span>
      </div>`;
  for (const ep of epochs) {
    h += `<div style="display:grid;grid-template-columns:35px 1fr 1fr 1fr 1fr 1fr;gap:4px;padding:3px 0;border-bottom:1px solid rgba(42,42,61,0.3)">
      <span style="color:var(--ac)">${ep.epoch||''}</span><span>${ep.box_loss||'-'}</span><span>${ep.cls_loss||'-'}</span><span>${ep.dfl_loss||'-'}</span><span style="color:var(--acg)">${ep.mAP50||'-'}</span><span>${ep.mAP50_95||'-'}</span></div>`;
  }
  h += '</div></div>';
  return h;
}

function showImmediateProgress(stepName) {
  const activeStep = _getActiveStep();
  const el = activeStep ? document.getElementById('progress_' + activeStep) : null;
  if (!el) return;
  el.style.display = '';
  el.innerHTML = `<div style="background:var(--bg2);border-radius:var(--radius);padding:var(--pad-md);border:1px solid var(--acy)">
    <div class="flex justify-between items-center" style="margin-bottom:6px">
      <span style="font-size:var(--fs-xs);font-weight:600;color:var(--t0);font-family:var(--fontUI)">${stepName}</span>
      <span style="font-size:var(--fs-xs);color:var(--acy);font-family:var(--font)">Starting...</span>
    </div>
    <div class="progress-bar" style="margin-bottom:6px"><div class="progress-fill" style="width:3%;background:var(--acy);transition:width 1s"></div></div>
    <div style="font-size:var(--fs-xs);color:var(--t2);font-family:var(--font)">Initializing...</div>
  </div>`;
}

function runExport() {
  if (exportSrc === 'db') {
    const db = CONF.FRIGATE_DB || '';
    const clips = CONF.LIVE_DIR || '';
    if (!db) { showConfigError('Frigate DB Not Configured', 'Set the path to your Frigate SQLite database to export event snapshots.', 'paths'); return; }
    if (!clips) { showConfigError('Clips Directory Not Configured', 'Set the path to your Frigate clips directory where event snapshots are stored.', 'paths'); return; }
  }
  const maxImages = parseInt(getTrainerFormValue('exportMaxImages', 100));
  _setStepRunning('export');
  showImmediateProgress('EXPORT');
  startTrainerPoll();
  fetch('/api/trainer/export', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({ max_images: maxImages })
  }).catch(e => { stopTrainerPoll(); toast('Export error: ' + e, true); _resetStep('export'); });
}

function runDedup(dryRun) {
  const doBoxes = getTrainerFormValue('dedupBoxes', CONF.DEDUP_BOXES || false);
  const doPhash = getTrainerFormValue('dedupPhash', CONF.DEDUP_PHASH !== undefined ? CONF.DEDUP_PHASH : true);
  const doNms = getTrainerFormValue('dedupNms', CONF.DEDUP_NMS || false);
  const boxIou = parseFloat(getTrainerFormValue('dedupBoxIou', 10));
  const phashSim = parseInt(getTrainerFormValue('dedupPhashSim', 85));
  const nmsIou = parseFloat(getTrainerFormValue('dedupNmsIou', 85));
  const hamming = Math.round((100 - phashSim) / 100 * 64);

  _setStepRunning('dedup');
  showImmediateProgress(dryRun ? 'DEDUP (DRY RUN)' : 'DEDUP');
  startTrainerPoll();

  fetch('/api/trainer/dedup', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({
      boxes: doBoxes, phash: doPhash, nms: doNms,
      box_iou: boxIou, hamming: hamming, nms_iou: nmsIou,
      dry_run: dryRun
    })
  }).catch(e => { stopTrainerPoll(); _resetStep('dedup'); toast('Dedup error: ' + e, true); });
}

function runTrain() {
  const model = getTrainerFormValue('trainModel', '') || (window._modelsList || [])[0] || '';
  if (!model) { showConfigError('No Model Selected', 'Cannot train without a base model. Download a YOLO model first.', 'ai'); return; }
  const epochs = parseInt(getTrainerFormValue('trainEpochs', CONF.EPOCHS || 10));
  const batch = parseInt(getTrainerFormValue('trainBatch', CONF.BATCH_SIZE || 8));
  const lr = parseFloat(getTrainerFormValue('trainLR', CONF.LEARNING_RATE || 0.0001));
  const lrf = parseFloat(getTrainerFormValue('trainLRF', CONF.LR_FINAL || 0.01));
  const imgsz = parseInt(getTrainerFormValue('trainImgsz', CONF.IMAGE_SIZE || 640));
  const freeze = parseInt(getTrainerFormValue('trainFreeze', CONF.FREEZE_LAYERS || 10));
  const augment = getTrainerFormValue('trainAugment', false);

  _setStepRunning('train');
  showImmediateProgress('TRAINING');
  startTrainerPoll();
  fetch('/api/trainer/train', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({ model: model, epochs: epochs, batch: batch, lr: lr, lrf: lrf, imgsz: imgsz, freeze: freeze, augment: augment })
  }).catch(e => { stopTrainerPoll(); toast('Training error: ' + e, true); _resetStep('train'); });
}

function runOnnxExport() {
  const model = getTrainerFormValue('onnxModel', '') || (window._modelsList || [])[0] || '';
  if (!model) { showConfigError('No Model Selected', 'Select a .pt model to export to ONNX format.', 'ai'); return; }
  const imgsz = parseInt(getTrainerFormValue('onnxImgsz', 640));
  const opset = parseInt(getTrainerFormValue('onnxOpset', 13));
  const simplify = getTrainerFormValue('onnxSimplify', true);
  const half = getTrainerFormValue('onnxHalf', false);
  const dynamic = getTrainerFormValue('onnxDynamic', false);

  _setStepRunning('onnx');
  showImmediateProgress('ONNX EXPORT');
  startTrainerPoll();
  fetch('/api/trainer/onnx', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({ model: model, imgsz: imgsz, opset: opset, simplify: simplify, half: half, dynamic: dynamic })
  }).catch(e => { stopTrainerPoll(); toast('ONNX error: ' + e, true); _resetStep('onnx'); });
}

function waitForTrainerDone(updateFn, step) {
  return new Promise((resolve, reject) => {
    let attempts = 0;
    const maxAttempts = 3600;
    let sawRunning = false;
    function poll() {
      if (window._pipelineAborted) { reject(new Error('Aborted')); return; }
      attempts++;
      if (attempts > maxAttempts) { reject(new Error('Timeout waiting for step')); return; }
      fetch('/api/trainer/status').then(r => r.json()).then(d => {
        if (window._pipelineAborted) { reject(new Error('Aborted')); return; }
        const isRunning = step ? (d[step] && d[step].running)
                               : Object.values(d).some(s => s && s.running);
        if (isRunning) {
          sawRunning = true;
          if (updateFn) updateFn(step ? (d[step] || d) : d);
          setTimeout(poll, 1000);
        } else if (!sawRunning && attempts < 10) {
          setTimeout(poll, 500);
        } else {
          const result = (step && d[step] && d[step].result) ? d[step].result : (d.result || d);
          resolve(result);
        }
      }).catch(() => setTimeout(poll, 2000));
    }
    setTimeout(poll, 500);
  });
}

function runSelectedPipeline() {
  const steps = [
    { id: 0, name: 'Export', checked: document.getElementById('pipeStep0')?.checked },
    { id: 1, name: 'Dedup', checked: document.getElementById('pipeStep1')?.checked },
    { id: 2, name: 'Annotate', checked: document.getElementById('pipeStep2')?.checked },
    { id: 3, name: 'Train', checked: document.getElementById('pipeStep3')?.checked },
    { id: 4, name: 'ONNX Export', checked: document.getElementById('pipeStep4')?.checked },
  ];
  const selected = steps.filter(s => s.checked);
  if (selected.length === 0) { toast('No steps selected', true); return; }
  const stepNames = selected.map(s => s.name).join(' → ');
  showPipelineConfirm(stepNames, selected, function() {
  // Collect all params from form
  const params = {
    exportMaxImages: parseInt(getTrainerFormValue('exportMaxImages', 100)),
    dedupBoxes:  getTrainerFormValue('dedupBoxes',  CONF.DEDUP_BOXES || false),
    dedupPhash:  getTrainerFormValue('dedupPhash',  CONF.DEDUP_PHASH !== undefined ? CONF.DEDUP_PHASH : true),
    dedupNms:    getTrainerFormValue('dedupNms',    CONF.DEDUP_NMS || false),
    dedupBoxIou: parseFloat(getTrainerFormValue('dedupBoxIou', 10)),
    dedupPhashSim: parseInt(getTrainerFormValue('dedupPhashSim', 85)),
    dedupNmsIou: parseFloat(getTrainerFormValue('dedupNmsIou', 85)),
    annotateConf:  parseFloat(getTrainerFormValue('annotateConf', CONF.DEFAULT_CONFIDENCE || 0.5)),
    annotateMerge: getTrainerFormValue('annotateMerge', false),
    trainEpochs: parseInt(getTrainerFormValue('trainEpochs', CONF.EPOCHS || 10)),
    trainBatch:  parseInt(getTrainerFormValue('trainBatch', CONF.BATCH_SIZE || 8)),
    trainLR:     parseFloat(getTrainerFormValue('trainLR', CONF.LEARNING_RATE || 0.0001)),
    trainLRF:    parseFloat(getTrainerFormValue('trainLRF', CONF.LR_FINAL || 0.01)),
    trainImgsz:  parseInt(getTrainerFormValue('trainImgsz', CONF.IMAGE_SIZE || 640)),
    trainFreeze: parseInt(getTrainerFormValue('trainFreeze', CONF.FREEZE_LAYERS || 10)),
    trainAugment: getTrainerFormValue('trainAugment', false),
    onnxImgsz:   parseInt(getTrainerFormValue('onnxImgsz', 640)),
    onnxOpset:   parseInt(getTrainerFormValue('onnxOpset', 13)),
    onnxSimplify: getTrainerFormValue('onnxSimplify', true),
    onnxHalf:    getTrainerFormValue('onnxHalf', false),
    onnxDynamic: getTrainerFormValue('onnxDynamic', false),
  };

  const teacher = CONF.TEACHER_MODEL || '';
  const student = CONF.STUDENT_MODEL || '';
  const teacherPath = (window._modelsList || []).find(m => m.split('/').pop() === teacher.split('/').pop()) || teacher;
  const studentPath = (window._modelsList || []).find(m => m.split('/').pop() === student.split('/').pop()) || student;
  params.teacherPath = teacherPath;
  params.studentPath = studentPath;
  params.classes = CONF.DEFAULT_CLASSES || [0,2,15,16];

  // Pre-flight validation
  const problems = [];
  if (steps[0].checked) {
    const db = CONF.FRIGATE_DB || '';
    const clips = CONF.LIVE_DIR || '';
    if (!db && !clips) problems.push('Export: Frigate DB and Clips directory not configured (Settings → Paths)');
  }
  if (steps[2].checked && !teacherPath) problems.push('Annotate: No Teacher Model configured (Settings → AI)');
  if (steps[3].checked && !studentPath) problems.push('Train: No Student Model configured (Settings → AI)');
  if (steps[4].checked && !steps[3].checked && !studentPath) problems.push('ONNX Export: No model available');
  if (problems.length > 0) { showConfigError('Cannot Start Pipeline', problems.join('<br>'), 'ai'); return; }

  const total = selected.length;
  const startTime = Date.now();

  pipelineRunning = true;
  window._pipelineAborted = false;
  window._lastTrainEpochs = null;
  window._pipelineEpochSync = function(count) { _lastRenderedEpochCount = count; };
  trainerTab = 'config';
  _setPipelineBtn(true);

  let _lastRenderedEpochCount = 0;

  // Render shell immediately
  _renderPipelineShell(selected, total);

  // Send single POST to server — server runs everything
  fetch('/api/trainer/pipeline/run', {
    method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({
      steps: selected.map(s => s.name),
      dataset: document.getElementById('trainerDatasetSel')?.value || '',
      params: params
    })
  }).then(r => r.json()).then(d => {
    if (!d.ok) {
      pipelineRunning = false;
      pipelineHTML = '';
      _setPipelineBtn(false);
      toast('Pipeline error: ' + (d.error || 'failed'), true);
      return;
    }
    // Poll until pipeline finishes
    _pollPipeline(selected, total, startTime);
  }).catch(e => {
    pipelineRunning = false;
    pipelineHTML = '';
    _setPipelineBtn(false);
    toast('Pipeline error: ' + e, true);
  });

  }); // end showPipelineConfirm callback
}

function _renderPipelineShell(selected, total) {
  const stepNames = selected.map(s => s.name).join(' → ');
  let h = `<h2>Pipeline Running</h2>
    <p class="desc">${stepNames}</p>
    <div style="background:var(--bg1);border-radius:12px;padding:var(--pad-xl);border:1px solid var(--acp);margin-bottom:20px">
      <div style="display:flex;justify-content:space-between;margin-bottom:8px">
        <span id="plStepName" style="font-size:var(--fs-md);font-weight:600;color:var(--t0b)">${selected[0].name}</span>
        <span id="plStepCounter" style="font-size:var(--fs-base);color:var(--acp);font-family:var(--font)">Step 1/${total}</span>
      </div>
      <div style="height:8px;background:var(--bg3);border-radius:4px;margin-bottom:12px">
        <div id="plProgressBar" style="height:100%;width:0%;border-radius:4px;background:linear-gradient(90deg,var(--acp),var(--ac));transition:width 0.5s"></div>
      </div>
      <div id="plStatusMsg" style="font-size:var(--fs-sm);color:var(--t1)">Starting...</div>
    </div>`;
  h += '<div style="background:var(--bg1);border-radius:12px;padding:var(--pad-xl);border:1px solid var(--bd)">';
  h += '<div class="sec-label">Progress</div>';
  for (const s of selected) {
    h += `<div id="plStep_${s.id}" style="display:flex;align-items:center;gap:10px;padding:var(--pad-md) 0;border-bottom:1px solid var(--bd);font-size:var(--fs-base)">
      <span id="plStepIcon_${s.id}" style="color:var(--t3);font-size:var(--fs-xl);font-weight:700;width:24px;text-align:center">○</span>
      <span id="plStepLabel_${s.id}" style="color:var(--t2);font-weight:400;flex:1">${s.name}</span>
      <span id="plStepDetail_${s.id}" style="font-size:var(--fs-sm);color:var(--t2);font-family:var(--font)"></span>
      <span id="plStepTime_${s.id}" style="font-size:var(--fs-sm);color:var(--t2);font-family:var(--font);min-width:50px;text-align:right"></span>
    </div>`;
    if (s.name === 'Train') {
      h += `<div id="plEpochContainer" style="display:none;margin:4px 0 4px 34px;background:var(--bg2);border-radius:6px;padding:var(--pad-md);border:1px solid var(--bd)">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
          <span style="font-size:var(--fs-sm);font-weight:600;color:var(--t1)">Epoch History</span>
          <span id="plEpochCounter" style="font-size:var(--fs-sm);font-family:var(--font);color:var(--acp)"></span>
        </div>
        <div id="plEpochScroll" style="font-size:var(--fs-xs);font-family:var(--font);color:var(--t1);max-height:180px;overflow-y:auto">
          <div style="display:grid;grid-template-columns:35px 1fr 1fr 1fr 1fr 1fr;gap:4px;padding:var(--pad-xs) 0;border-bottom:1px solid var(--bd);font-weight:600;color:var(--t2);position:sticky;top:0;background:var(--bg2)">
            <span>#</span><span>box</span><span>cls</span><span>dfl</span><span>mAP50</span><span>mAP95</span>
          </div>
        </div>
        <div id="plBatchBar" style="display:none;margin-top:10px;display:flex;align-items:center;gap:10px">
          <span id="plBatchLabel" style="font-size:var(--fs-xs);color:var(--t0);font-family:var(--font);min-width:90px;font-weight:600"></span>
          <div style="flex:1;height:6px;background:var(--bg3);border-radius:3px;overflow:hidden">
            <div id="plBatchFill" style="height:100%;width:0%;background:var(--acp);border-radius:3px;transition:width 0.3s"></div>
          </div>
          <span id="plBatchPct" style="font-size:var(--fs-xs);color:var(--t1);font-family:var(--font);min-width:55px;text-align:right"></span>
        </div>
      </div>`;
    }
  }
  h += '</div>';
  pipelineHTML = h;
  const el = document.getElementById('trainerContent');
  if (el && trainerTab === 'config') el.innerHTML = h;
}

function _pollPipeline(selected, total, startTime) {
  const stepKeyMap = STEP_KEY_MAP;
  const stepResultRendered = {};
  let epochCount = 0;

  function poll() {
    if (!pipelineRunning) return;
    fetch('/api/trainer/status').then(r => r.json()).then(allStatus => {
      if (!pipelineRunning) return;

      const pipelineState = allStatus._pipeline;

      // If server cleared PIPELINE_STATE — pipeline is done
      if (!pipelineState) {
        _finishPipeline(selected, allStatus, startTime);
        return;
      }

      // Find current running step
      let currentStep = null;
      let completedCount = 0;
      const report = [];

      for (const s of selected) {
        const key = stepKeyMap[s.name];
        const d = key ? allStatus[key] : null;
        if (!d) continue;

        if (d.result) {
          completedCount++;
          if (!stepResultRendered[s.name]) {
            stepResultRendered[s.name] = true;
            const ok = d.result.ok !== false;
            let detail = '';
            if (key === 'export')   detail = `${d.result.exported||0} new, ${d.result.existing||0} reused`;
            else if (key === 'dedup') detail = `-${(d.result.steps||[]).reduce((a,x)=>a+(x.removed||0),0)} removed`;
            else if (key === 'annotate') detail = `${d.result.annotated||0} labeled, ${d.result.total_boxes||0} boxes`;
            else if (key === 'train') detail = d.result.output ? d.result.output.split('/').pop() : 'complete';
            else if (key === 'onnx') detail = d.result.output ? d.result.output.split('/').pop() : 'exported';
            _plStepDone(s, ok, detail);
          }
          report.push({ name: s.name, ok: (d.result.ok !== false) });
        } else if (d.running) {
          currentStep = { step: s, data: d, key };
        }
      }

      // Update progress bar
      const pct = total > 0 ? Math.round(completedCount / total * 100) : 0;
      const plBar = document.getElementById('plProgressBar');
      if (plBar) plBar.style.width = pct + '%';

      if (currentStep) {
        const { step: s, data: d, key } = currentStep;
        const plName = document.getElementById('plStepName');
        const plCounter = document.getElementById('plStepCounter');
        const plMsg = document.getElementById('plStatusMsg');
        if (plName) plName.textContent = s.name;
        if (plCounter) plCounter.textContent = `Step ${completedCount + 1}/${total}`;
        if (plMsg) plMsg.textContent = d.message || '';

        // Mark current step as active
        const icon = document.getElementById(`plStepIcon_${s.id}`);
        const label = document.getElementById(`plStepLabel_${s.id}`);
        if (icon && icon.textContent === '○') { icon.textContent = '◌'; icon.style.color = 'var(--acp)'; }
        if (label) { label.style.color = 'var(--t0)'; label.style.fontWeight = '600'; }

        // Train epoch table
        if (key === 'train') {
          const epochs = d.epochs || [];
          const container = document.getElementById('plEpochContainer');
          const scroll = document.getElementById('plEpochScroll');
          const counter = document.getElementById('plEpochCounter');
          if (container && epochs.length > 0) {
            container.style.display = '';
            if (counter) counter.textContent = `${epochs.length}/${d.total||1} epochs`;
            if (scroll && epochs.length > epochCount) {
              for (let i = epochCount; i < epochs.length; i++) _appendEpochRow(scroll, epochs[i]);
              epochCount = epochs.length;
              scroll.scrollTop = scroll.scrollHeight;
            }
          }
          const batchBar = document.getElementById('plBatchBar');
          const batchTotal = d.batch_total || 0;
          if (batchBar && batchTotal > 0) {
            batchBar.style.display = 'flex';
            const bPct = d.batch_pct || Math.round((d.batch||0) / batchTotal * 100);
            const bl = document.getElementById('plBatchLabel');
            const bf = document.getElementById('plBatchFill');
            const bp = document.getElementById('plBatchPct');
            if (bl) bl.textContent = `Epoch ${d.current||1}/${d.total||1}`;
            if (bf) bf.style.width = bPct + '%';
            if (bp) bp.textContent = bPct + '%';
          }
        }
      }

      // Save pipelineHTML only when on config tab
      const el = document.getElementById('trainerContent');
      if (el && trainerTab === 'config') pipelineHTML = el.innerHTML;

      setTimeout(poll, 1000);
    }).catch(() => { if (pipelineRunning) setTimeout(poll, 2000); });
  }

  setTimeout(poll, 0);
}

function _plStepDone(s, ok, detail) {
  const icon  = document.getElementById(`plStepIcon_${s.id}`);
  const label = document.getElementById(`plStepLabel_${s.id}`);
  const det   = document.getElementById(`plStepDetail_${s.id}`);
  if (icon)  { icon.textContent = ok ? '✓' : '✗'; icon.style.color = ok ? 'var(--acg)' : 'var(--acr)'; }
  if (label) { label.style.color = 'var(--t0)'; label.style.fontWeight = '400'; }
  if (det)   det.textContent = detail || '';
}

function _finishPipeline(selected, allStatus, startTime) {
  const stepKeyMap = STEP_KEY_MAP;
  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
  const report = [];

  for (const s of selected) {
    const key = stepKeyMap[s.name];
    const d = key ? allStatus[key] : null;
    const ok = d && d.result && d.result.ok !== false;
    let detail = '';
    if (d && d.result) {
      if (key === 'export')   detail = `${d.result.exported||0} new, ${d.result.existing||0} reused`;
      else if (key === 'dedup') detail = `-${(d.result.steps||[]).reduce((a,x)=>a+(x.removed||0),0)} removed`;
      else if (key === 'annotate') detail = `${d.result.annotated||0} labeled, ${d.result.total_boxes||0} boxes`;
      else if (key === 'train') detail = d.result.output ? d.result.output.split('/').pop() : 'complete';
      else if (key === 'onnx') detail = d.result.output ? d.result.output.split('/').pop() : 'exported';
    }
    const epochs = key === 'train' && d && d.epochs && d.epochs.length > 0 ? d.epochs : null;
    report.push({ name: s.name, ok: !!ok, detail, duration: '', extra: epochs });
  }

  const okCount  = report.filter(r => r.ok).length;
  const hasError = okCount < report.length;

  pipelineRunning = false;
  pipelineHTML = '';
  _setPipelineBtn(false);
  loadModelsList();

  const statusTitle  = hasError ? 'Pipeline Failed' : 'Pipeline Complete';
  const summaryMsg   = `${okCount} succeeded${hasError ? ', ' + (report.length - okCount) + ' failed' : ''}`;

  const pipelineReport = {
    title: statusTitle, message: summaryMsg,
    isError: hasError, elapsed: totalTime + 's',
    steps: report,
  };
  _saveReport('pipeline', pipelineReport);
  renderTrainerStep();
}

function showPipelineConfirm(stepNames, selected, onConfirm) {
  const existing = document.getElementById('pipelineConfirmModal');
  if (existing) existing.remove();

  const stepList = selected.map(s =>
    `<div style="display:flex;align-items:center;gap:8px;padding:var(--pad-sm) 0;border-bottom:1px solid var(--bd)">
      <span style="color:var(--ac);font-size:var(--fs-base)">›</span>
      <span style="font-size:var(--fs-base);color:var(--t0)">${s.name}</span>
    </div>`
  ).join('');

  const modal = document.createElement('div');
  modal.id = 'pipelineConfirmModal';
  modal.className = 'report-modal-backdrop';
  modal.innerHTML = `
    <div class="report-modal-card" style="max-width:420px">
      <div style="font-size:var(--fs-xl);font-weight:700;color:var(--t0);margin-bottom:6px">Run Pipeline?</div>
      <div style="font-size:var(--fs-sm);color:var(--t2);margin-bottom:18px">${selected.length} step${selected.length > 1 ? 's' : ''} selected</div>
      <div style="margin-bottom:24px">${stepList}</div>
      <div style="display:flex;gap:10px">
        <button id="pipelineConfirmCancel" class="btn btn-lg w-full" style="flex:1">Cancel</button>
        <button id="pipelineConfirmOk" class="btn btn-lg primary w-full" style="flex:1">Run</button>
      </div>
    </div>`;

  document.body.appendChild(modal);

  document.getElementById('pipelineConfirmCancel').onclick = function() { modal.remove(); };
  document.getElementById('pipelineConfirmOk').onclick = function() { modal.remove(); onConfirm(); };
  modal.addEventListener('click', function(e) { if (e.target === modal) modal.remove(); });
}

function showPipelineReport(report, startTime, hasError, wasStopped) {
  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
  const ok = report.filter(r => r.ok).length;
  const failed = report.filter(r => !r.ok).length;

  const logStatus = wasStopped ? 'STOPPED' : hasError ? 'FAILED' : 'COMPLETED';
  const logDetail = ok + ' succeeded' + (failed ? ', ' + failed + ' failed' : '') + ' in ' + totalTime + 's';
  fetch('/api/trainer/logs/append', {
    method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({ message: '==================================================\nPIPELINE ' + logStatus + ' — ' + logDetail })
  });

  // Clean up pipeline state
  pipelineRunning = false;
  pipelineHTML = '';
  _setPipelineBtn(false);
  fetch('/api/trainer/pipeline/clear', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: '{}' });

  if (wasStopped) {
    toast('Pipeline stopped');
    renderTrainerStep();
    return;
  }

  const statusTitle = hasError ? 'Pipeline Failed' : 'Pipeline Complete';
  const summaryMsg = `${ok} succeeded${failed ? ', ' + failed + ' failed' : ''}`;

  const pipelineReport = {
    title: statusTitle,
    message: summaryMsg,
    isError: hasError,
    elapsed: totalTime + 's',
    steps: report,
  };
  _saveReport('pipeline', pipelineReport);
  renderTrainerStep();
}

function dismissPipelineReport() {
  pipelineRunning = false;
  pipelineHTML = '';
  _setPipelineBtn(false);
  _dismissInlineReport('pipeline');
}
function setExportSrc(src) {
  exportSrc = src;
  renderTrainerStep();
}
