<!-- ============================================================
     MAIN CONTENT
     ============================================================ -->
<div class="main">

<!-- ============================================================
     VIEWER PAGE
     ============================================================ -->
<div class="page active" id="page-viewer">

  <!-- Toolbar: Dataset mode -->
  <div class="toolbar" id="toolbar-dataset">
    <select class="sel" id="datasetSel" onchange="switchDataset(this.value)" data-tip="Switch between YOLO datasets found in Datasets Root directory.">%%DATASET_OPTIONS%%</select>
    <div class="toolbar-sep"></div>
    <button class="btn filter active" data-filter="all" onclick="setFilter('all')" data-tip="Show all images in the dataset.">All</button>
    <button class="btn filter" data-filter="train" onclick="setFilter('train')" data-tip="Show only training split images.">Train</button>
    <button class="btn filter" data-filter="val" onclick="setFilter('val')" data-tip="Show only validation split images.">Val</button>
    <button class="btn filter" data-filter="empty" onclick="setFilter('empty')" data-tip="Show images with no bounding boxes.">Empty</button>
    <div class="toolbar-sep"></div>
    <select class="sel" id="classFilterSel" onchange="setClassFilter(parseInt(this.value))" data-tip="Filter images by detected class.">
      <option value="-1">All classes</option>
      %%CLASS_FILTER_OPTIONS%%
    </select>
    <div class="toolbar-spacer"></div>
    <span class="toolbar-fileinfo" id="toolbarFileInfo" data-tip="Current image filename and split"></span>
    <div class="toolbar-sep"></div>
    <button class="btn filter nav-btn" onclick="navigate(-1)" data-tip="Previous image (←)">‹</button>
    <span class="img-counter" onclick="jumpTo()" style="cursor:pointer" data-tip="Click to jump to a specific image number"><b id="imgIdx">0</b> / <span id="imgTotal">0</span></span>
    <button class="btn filter nav-btn" onclick="navigate(1)" data-tip="Next image (→)">›</button>
    <div class="toolbar-sep"></div>
    <button class="btn filter gallery-btn" id="galleryBtn" onclick="toggleGallery()" data-tip="Switch to grid gallery view (G)">⊞</button>
  </div>

  <!-- Toolbar: Live mode -->
  <div class="toolbar" id="toolbar-live" style="display:none">
    <span class="badge badge-green">● LIVE</span>
    <div class="toolbar-sep"></div>
    <select class="sel" id="liveCamSel" onchange="loadLive()" data-tip="Filter snapshots by camera name.">
      <option value="all">All cameras</option>
      %%LIVE_CAMERA_OPTIONS%%
    </select>
    <div class="toolbar-sep"></div>
    <span class="text-base text-t1 font-ui" style="flex-shrink:0">Last</span>
    <input type="number" class="num-inp" id="liveHours" value="24" min="1" max="720" style="width:50px" onchange="loadLive()" data-tip="Time window in hours.">
    <span class="text-base text-t2 font-ui" style="flex-shrink:0">hours</span>
    <div class="toolbar-spacer"></div>
    <span class="toolbar-fileinfo" id="liveFileInfo"></span>
    <div class="toolbar-sep"></div>
    <button class="btn filter nav-btn" onclick="navigateLive(-1)">‹</button>
    <span class="img-counter" onclick="jumpToLive()" style="cursor:pointer" data-tip="Click to jump to snapshot number"><b id="liveIdx">0</b> / <span id="liveTotal">0</span></span>
    <button class="btn filter nav-btn" onclick="navigateLive(1)">›</button>
    <div class="toolbar-sep"></div>
    <button class="btn filter gallery-btn" onclick="toggleGallery()" data-tip="Gallery grid view (G)">⊞</button>
  </div>

  <!-- Toolbar: Video mode (row 1) -->
  <div class="toolbar" id="toolbar-video" style="display:none">
    <span class="badge badge-purple">▶ VIDEO</span>
    <div class="toolbar-sep"></div>
    <select class="sel" id="videoClipSel" onchange="loadVideoClip(this.value)" style="max-width:280px" data-tip="Select a video clip from Frigate exports.">%%VIDEO_CLIP_OPTIONS%%</select>
    <div class="toolbar-spacer"></div>
    <span class="img-counter"><b id="videoFrame">0</b> / <span id="videoTotalFrames">0</span> frames</span>
    <div class="toolbar-sep"></div>
    <button class="btn filter gallery-btn" onclick="toggleGallery()" data-tip="Gallery grid view (G)">⊞</button>
  </div>

  <!-- Toolbar: Video mode (row 2 — seekbar) -->
  <div class="toolbar-video" id="toolbar-video2" style="display:none">
    <button class="btn filter" onclick="videoTogglePlay()" id="videoPlayBtn" data-tip="Play/pause (Space)">▶</button>
    <button class="btn filter" onclick="videoStep(-videoStepSize)" data-tip="Step backward (←)">‹F</button>
    <button class="btn filter" onclick="videoStep(videoStepSize)" data-tip="Step forward (→)">F›</button>
    <span class="text-base font-mono text-t1" id="videoTime" style="min-width:85px;flex-shrink:0">0:00 / 0:00</span>
    <input type="range" id="videoSeekbar" min="0" max="100" value="0" oninput="videoSeek(this.value)">
    <div class="toolbar-sep"></div>
    <span class="text-base text-t2 font-ui" style="flex-shrink:0">Step</span>
    <input type="number" class="num-inp" id="videoStepInput" value="5" min="1" max="100" style="width:42px" onchange="videoStepSize=parseInt(this.value)||5;if(document.getElementById('galleryOverlay').style.display!=='none')renderGallery()" data-tip="Frames per step.">
    <span class="text-base text-t2 font-ui" style="flex-shrink:0">FPS</span>
    <input type="number" class="num-inp" id="videoFpsInput" value="10" min="1" max="60" style="width:42px" onchange="videoPlayFps=parseInt(this.value)||10" data-tip="Playback FPS.">
    <div class="toolbar-sep"></div>
    <button class="btn filter" onclick="videoExportFrame()" style="color:var(--acg);border-color:rgba(34,197,94,0.3)" data-tip="Export current frame as JPG to dataset (M)">⤓ Export</button>
  </div>

  <!-- Content: Canvas + Panel -->
  <div class="content" id="viewerContent">
    <div class="canvas-area" id="canvasArea">
      <canvas id="mainCanvas"></canvas>
      <div class="selection-badge" id="selectionBadge" style="display:none"></div>
      <div id="emptyState" style="display:none;position:absolute;inset:0;display:none;flex-direction:column;align-items:center;justify-content:center;gap:16px;z-index:4;pointer-events:none">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--t3)" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>
        <span id="emptyStateText" style="font-size:var(--fs-md);color:var(--t2);font-family:var(--fontUI);text-align:center;max-width:300px;line-height:1.6">No images in dataset.<br><span style="font-size:var(--fs-sm);color:var(--t3)">Use Live mode to import snapshots, or run the Export step in Trainer.</span></span>
      </div>
      <div id="galleryOverlay" style="display:none;position:absolute;inset:0;background:var(--bg0);overflow-y:auto;z-index:5;padding:var(--pad-lg)"></div>
    </div>

    <div class="panel" id="panel">
      <div class="panel-collapsed-label" onclick="togglePanel()">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        <span>Panel</span>
      </div>
      <div class="panel-tabs" id="panelTabs"></div>
      <div class="panel-body" id="panelBody"></div>
      <button class="panel-collapse-btn" id="panelToggle" onclick="togglePanel()">
        <span class="arrow">›</span>
        <span class="label">Collapse</span>
      </button>
    </div>
  </div>

</div><!-- /page-viewer -->


<!-- ============================================================
     TRAINER PAGE
     ============================================================ -->
<div class="page" id="page-trainer">
  <div class="toolbar">
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--acp)" stroke-width="2"><rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><line x1="9" y1="1" x2="9" y2="4"/><line x1="15" y1="1" x2="15" y2="4"/><line x1="9" y1="20" x2="9" y2="23"/><line x1="15" y1="20" x2="15" y2="23"/></svg>
    <span style="font-size:var(--fs-lg);font-weight:700">Training Pipeline</span>
    <div class="toolbar-spacer"></div>
    <span id="trainerToolbarTitle" style="font-size:var(--fs-lg);font-weight:700;color:var(--t0b);font-family:var(--fontUI)"></span>
    <div class="toolbar-spacer"></div>
    <button class="btn filter active" data-ttab="config" onclick="setTrainerTab('config')">Config</button>
    <button class="btn filter" data-ttab="gpu" onclick="setTrainerTab('gpu')">Device</button>
    <button class="btn filter" data-ttab="logs" onclick="setTrainerTab('logs')">Logs</button>
  </div>

  <div style="display:flex;flex:1;overflow:hidden;width:100%">
    <div style="flex:1;display:flex;flex-direction:column;overflow:hidden">
      <div class="trainer-content" id="trainerContent" style="flex:1"></div>
    </div>

    <div class="trainer-steps" id="trainerSteps">
      <div class="trainer-steps-content">
        <div class="sec-label">Dataset</div>
        <select class="sel w-full" id="trainerDatasetSel" onchange="setTrainerDataset(this.value)" style="margin-bottom:14px" data-tip="Dataset used for training pipeline. Independent from Viewer dataset.">%%DATASET_OPTIONS_TRAINER%%</select>
        <div class="sec-label">Pipeline Steps</div>
        <div class="step-item active" data-step="0" onclick="setTrainerStep(0)" data-tip="Extract snapshots from Frigate DB.">
          <input type="checkbox" class="pipeline-cb" id="pipeStep0" checked onclick="event.stopPropagation()" style="accent-color:var(--acp);width:15px;height:15px;flex-shrink:0;cursor:pointer">
          <div class="step-num">1</div>
          <div><span class="step-label">Export</span><div class="step-desc">Export snapshots from Frigate DB</div></div>
        </div>
        <div class="step-item" data-step="1" onclick="setTrainerStep(1)" data-tip="Remove duplicates before annotation.">
          <input type="checkbox" class="pipeline-cb" id="pipeStep1" checked onclick="event.stopPropagation()" style="accent-color:var(--acp);width:15px;height:15px;flex-shrink:0;cursor:pointer">
          <div class="step-num">2</div>
          <div><span class="step-label">Dedup</span><div class="step-desc">Remove duplicates via pHash / IoU</div></div>
        </div>
        <div class="step-item" data-step="2" onclick="setTrainerStep(2)" data-tip="Auto-annotate with teacher model.">
          <input type="checkbox" class="pipeline-cb" id="pipeStep2" checked onclick="event.stopPropagation()" style="accent-color:var(--acp);width:15px;height:15px;flex-shrink:0;cursor:pointer">
          <div class="step-num">3</div>
          <div><span class="step-label">Annotate</span><div class="step-desc">Auto-label with teacher model</div></div>
        </div>
        <div class="step-item" data-step="3" onclick="setTrainerStep(3)" data-tip="Fine-tune student model on dataset.">
          <input type="checkbox" class="pipeline-cb" id="pipeStep3" checked onclick="event.stopPropagation()" style="accent-color:var(--acp);width:15px;height:15px;flex-shrink:0;cursor:pointer">
          <div class="step-num">4</div>
          <div><span class="step-label">Train</span><div class="step-desc">Fine-tune student model</div></div>
        </div>
        <div class="step-item" data-step="4" onclick="setTrainerStep(4)" data-tip="Export trained model to ONNX.">
          <input type="checkbox" class="pipeline-cb" id="pipeStep4" checked onclick="event.stopPropagation()" style="accent-color:var(--acp);width:15px;height:15px;flex-shrink:0;cursor:pointer">
          <div class="step-num">5</div>
          <div><span class="step-label">Export ONNX</span><div class="step-desc">Export to ONNX format</div></div>
        </div>
        <div class="divider"></div>
        <div class="sec-label">Quick Actions</div>
        <button class="btn btn-lg primary-purple w-full" id="pipelineBtn" onclick="runSelectedPipeline()" data-tip="Run only the checked steps above, in order.">Run Selected Pipeline</button>
      </div>
      <div class="trainer-steps-collapsed-label" onclick="toggleTrainerSteps()">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--t2)" stroke-width="2"><rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/></svg>
        <span style="font-size:var(--fs-xs);color:var(--t2);writing-mode:vertical-rl;margin-top:8px;font-family:var(--fontUI)">Steps</span>
      </div>
      <button class="trainer-collapse-btn" id="trainerToggle" onclick="toggleTrainerSteps()">
        <span class="arrow">›</span>
        <span class="label">Collapse</span>
      </button>
    </div>
  </div>

</div><!-- /page-trainer -->


<!-- ============================================================
     SETTINGS PAGE — Tabbed
     ============================================================ -->
<div class="page" id="page-settings">
  <div class="toolbar">
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--t1)" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09"/></svg>
    <span style="font-size:var(--fs-lg);font-weight:700">Settings</span>
    <button class="btn" onclick="resetSettings()" data-tip="Reset all settings to defaults." style="margin-left:var(--pad-md)">↺ Reset</button>
    <div class="toolbar-spacer"></div>
    <button class="btn filter active" data-stab="paths" onclick="setSettingsTab('paths')">Paths</button>
    <button class="btn filter" data-stab="ai" onclick="setSettingsTab('ai')">AI</button>
    <button class="btn filter" data-stab="training" onclick="setSettingsTab('training')">Training</button>
    <button class="btn filter" data-stab="dedup" onclick="setSettingsTab('dedup')">Dedup</button>
    <button class="btn filter" data-stab="interface" onclick="setSettingsTab('interface')">Interface</button>
    <button class="btn filter" data-stab="system" onclick="setSettingsTab('system')">System</button>
    <div class="toolbar-spacer"></div>
    <button class="btn primary" onclick="saveSettings()" data-tip="Save all settings to alice.conf.">✓ Save</button>
    <span class="badge badge-green" style="margin-left:var(--pad-sm)">alice.conf</span>
  </div>

  <div class="settings-page" id="settingsContent">

    <!-- TAB: Paths -->
    <div class="settings-panel active" id="stab-paths">
      <div class="settings-card">
        <h3>Paths</h3>
        <div class="flex-col gap-14">
          <div><div class="sec-label" data-tip="Default dataset loaded at startup.">Default Dataset</div><input class="inp" id="s_DEFAULT_DATASET" value=""></div>
          <div><div class="sec-label" data-tip="Parent directory containing all datasets.">Datasets Root</div><input class="inp" id="s_DATASETS_ROOT" value=""></div>
          <div><div class="sec-label" data-tip="Directory containing .pt model files.">Models Directory</div><input class="inp" id="s_MODELS_DIR" value=""></div>
          <div><div class="sec-label" data-tip="Frigate clips directory for Live mode.">Frigate Clips (Live)</div><input class="inp" id="s_LIVE_DIR" value=""></div>
          <div><div class="sec-label" data-tip="Frigate exports directory for Video mode.">Frigate Exports (Video)</div><input class="inp" id="s_EXPORTS_DIR" value=""></div>
          <div><div class="sec-label" data-tip="Path to Frigate SQLite database.">Frigate DB</div><input class="inp" id="s_FRIGATE_DB" value=""></div>
        </div>
      </div>
      <div class="settings-card">
        <h3>Server</h3>
        <div><div class="sec-label" data-tip="HTTP port (restart required).">Port</div><input type="number" class="num-inp" id="s_DEFAULT_PORT" value="8080" min="1024" max="65535" style="width:100%"></div>
      </div>
    </div>

    <!-- TAB: AI -->
    <div class="settings-panel" id="stab-ai" style="max-width:900px">
      <div style="display:grid;grid-template-columns:1fr 280px;gap:24px;width:100%;margin-bottom:24px">
      <div class="settings-card" style="margin-bottom:0">
        <h3>AI Defaults</h3>
        <div class="flex-col gap-14">
          <div>
            <div class="sec-label" data-tip="Best model for analysis across all modes.">Default Model</div>
            <select class="sel w-full" id="s_DEFAULT_MODEL">%%MODEL_OPTIONS%%</select>
          </div>
          <div>
            <div class="sec-label" data-tip="Large model for auto-annotation in Trainer.">Teacher Model</div>
            <select class="sel w-full" id="s_TEACHER_MODEL">%%MODEL_OPTIONS%%</select>
          </div>
          <div>
            <div class="sec-label" data-tip="Model to fine-tune during training.">Student Model</div>
            <select class="sel w-full" id="s_STUDENT_MODEL">%%MODEL_OPTIONS%%</select>
          </div>
          <div class="divider"></div>
          <div>
            <div class="sec-label" data-tip="Minimum confidence threshold for AI detection.">Default Confidence</div>
            <input type="number" class="num-inp" id="s_DEFAULT_CONFIDENCE" value="0.7" min="0.05" max="0.99" step="0.05" style="width:100%">
          </div>
          <div>
            <div class="sec-label" data-tip="COCO classes to detect across all modes.">Default Classes</div>
            <div id="classPickerContainer"></div>
          </div>
        </div>
      </div>

      <!-- Download Models -->
      <div class="settings-card" style="margin-bottom:0">
        <h3>Download Models</h3>
        <div style="font-size:var(--fs-sm);color:var(--t2);margin-bottom:14px;line-height:1.5">
          Download YOLO models from Ultralytics.
        </div>
        <div style="display:flex;flex-direction:column;gap:6px;margin-bottom:14px" id="modelDownloadGrid">
          <button class="btn sm" onclick="downloadModel('yolo11n.pt')">YOLO11n <span style="color:var(--t2);font-size:var(--fs-xs)">(nano)</span></button>
          <button class="btn sm" onclick="downloadModel('yolo11s.pt')">YOLO11s <span style="color:var(--t2);font-size:var(--fs-xs)">(small)</span></button>
          <button class="btn sm" onclick="downloadModel('yolo11m.pt')">YOLO11m <span style="color:var(--t2);font-size:var(--fs-xs)">(medium)</span></button>
          <button class="btn sm" onclick="downloadModel('yolo11l.pt')">YOLO11l <span style="color:var(--t2);font-size:var(--fs-xs)">(large)</span></button>
          <button class="btn sm" onclick="downloadModel('yolo11x.pt')">YOLO11x <span style="color:var(--t2);font-size:var(--fs-xs)">(xlarge)</span></button>
          <button class="btn sm" onclick="downloadModel('yolov8n.pt')">YOLOv8n <span style="color:var(--t2);font-size:var(--fs-xs)">(nano)</span></button>
          <button class="btn sm" onclick="downloadModel('yolov8s.pt')">YOLOv8s <span style="color:var(--t2);font-size:var(--fs-xs)">(small)</span></button>
          <button class="btn sm" onclick="downloadModel('yolov8x.pt')">YOLOv8x <span style="color:var(--t2);font-size:var(--fs-xs)">(xlarge)</span></button>
        </div>
        <div id="modelDownloadStatus" style="display:none;font-size:var(--fs-sm);color:var(--t1);font-family:var(--font);text-align:center"></div>
      </div>
      </div>
    </div>

    <!-- TAB: Training -->
    <div class="settings-panel" id="stab-training">
      <div class="settings-card">
        <h3>Training Defaults</h3>
        <div class="flex-col gap-14">
          <div><div class="sec-label" data-tip="Number of training epochs.">Epochs</div><input type="number" class="num-inp w-full" id="s_EPOCHS" value="10" min="1" max="300"></div>
          <div><div class="sec-label" data-tip="Images per batch. Reduce if OOM.">Batch Size</div><input type="number" class="num-inp w-full" id="s_BATCH_SIZE" value="8" min="1" max="64"></div>
          <div><div class="sec-label" data-tip="Initial learning rate.">Learning Rate</div><input type="number" class="num-inp w-full" id="s_LEARNING_RATE" value="0.0001" min="0.00001" max="0.1" step="0.0001"></div>
          <div><div class="sec-label" data-tip="Final LR as fraction of initial.">LR Final</div><input type="number" class="num-inp w-full" id="s_LR_FINAL" value="0.01" min="0.001" max="1" step="0.01"></div>
          <div><div class="sec-label" data-tip="Input resolution for training.">Image Size</div><input type="number" class="num-inp w-full" id="s_IMAGE_SIZE" value="640" min="320" max="1280" step="32"></div>
          <div><div class="sec-label" data-tip="Frozen backbone layers during fine-tuning.">Freeze Layers</div><input type="number" class="num-inp w-full" id="s_FREEZE_LAYERS" value="10" min="0" max="50"></div>
          <div class="flex items-center justify-between">
            <div style="font-size:var(--fs-md);font-weight:600;color:var(--t0)" data-tip="Enable data augmentation during training (fliplr, mosaic, mixup, rotation, HSV). Recommended for small datasets.">Augmentation</div>
            <div class="toggle-switch on" id="s_AUGMENTATION_toggle" onclick="this.classList.toggle('on')"><div class="toggle-knob"></div></div>
          </div>
        </div>
      </div>
    </div>

    <!-- TAB: Dedup -->
    <div class="settings-panel" id="stab-dedup">
      <div class="settings-card">
        <h3>Dedup Defaults</h3>
        <div class="flex-col gap-14">
          <div class="flex items-center justify-between">
            <div style="font-size:var(--fs-md);font-weight:600;color:var(--t0)" data-tip="Compare bounding box annotations to find duplicates.">Box Dedup</div>
            <div class="toggle-switch" id="s_DEDUP_BOXES_toggle" onclick="this.classList.toggle('on')"><div class="toggle-knob"></div></div>
          </div>
          <div><div class="sec-label" data-tip="Minimum overlap between annotation sets to consider as duplicates.">Box Similarity (%)</div><input type="number" class="num-inp w-full" id="s_DEDUP_BOX_SIM" value="10" min="0" max="100" step="5"></div>
          <div class="divider"></div>
          <div class="flex items-center justify-between">
            <div style="font-size:var(--fs-md);font-weight:600;color:var(--t0)" data-tip="Compare images visually using perceptual hashing.">Visual pHash</div>
            <div class="toggle-switch on" id="s_DEDUP_PHASH_toggle" onclick="this.classList.toggle('on')"><div class="toggle-knob"></div></div>
          </div>
          <div><div class="sec-label" data-tip="How similar two images must be to count as duplicates.">pHash Similarity (%)</div><input type="number" class="num-inp w-full" id="s_DEDUP_PHASH_SIM" value="85" min="0" max="100" step="5"></div>
          <div class="divider"></div>
          <div class="flex items-center justify-between">
            <div style="font-size:var(--fs-md);font-weight:600;color:var(--t0)" data-tip="Remove overlapping same-class boxes within each image.">NMS Cleanup</div>
            <div class="toggle-switch on" id="s_DEDUP_NMS_toggle" onclick="this.classList.toggle('on')"><div class="toggle-knob"></div></div>
          </div>
          <div><div class="sec-label" data-tip="Overlap threshold above which smaller box is removed.">NMS Similarity (%)</div><input type="number" class="num-inp w-full" id="s_DEDUP_NMS_SIM" value="85" min="0" max="100" step="5"></div>
        </div>
      </div>
    </div>

    <!-- TAB: Interface -->
    <div class="settings-panel" id="stab-interface">
      <div class="settings-card">
        <h3>Interface</h3>
        <div class="flex items-center justify-between" style="margin-bottom:16px">
          <div>
            <div style="font-size:var(--fs-md);font-weight:600;color:var(--t0)" data-tip="Toggle tooltips on all interactive elements.">Live Helper Guide</div>
            <div style="font-size:var(--fs-sm);color:var(--t2);margin-top:3px">Show tooltips when hovering</div>
          </div>
          <div class="toggle-switch" id="helpersToggle" onclick="toggleHelpers()">
            <div class="toggle-knob"></div>
          </div>
        </div>
        <div>
          <div class="sec-label" data-tip="How images are ordered.">Sort Order</div>
          <select class="sel" id="s_SORT_ORDER" style="width:100%">
            <option value="modified">Last Modified</option>
            <option value="filename">Filename (A-Z)</option>
          </select>
        </div>
      </div>
    </div>

    <!-- TAB: System (Dependencies) -->
    <div class="settings-panel" id="stab-system">
      <div class="settings-card">
        <h3>Device</h3>
        <div style="font-size:var(--fs-base);color:var(--t2);margin-bottom:16px;line-height:1.6">
          Compute device for training and inference. Changing this affects which dependencies are installed.
        </div>
        <div id="deviceSettingsContainer"><div style="color:var(--t2);font-size:var(--fs-sm)">Loading...</div></div>
      </div>
      <div class="settings-card">
        <h3>Dependencies</h3>
        <div style="font-size:var(--fs-base);color:var(--t2);margin-bottom:16px;line-height:1.6">
          Python packages required for full functionality. Optional packages enable specific features.
        </div>
        <div id="depsContainer"><div style="color:var(--t2);font-size:var(--fs-sm)">Loading...</div></div>
        <div style="margin-top:16px">
          <button class="btn btn-lg primary w-full" onclick="installMissingDeps()" id="installDepsBtn" style="display:none">
            ⬇ Install Missing Dependencies
          </button>
          <div id="depsInstallStatus" style="display:none;margin-top:12px;font-size:var(--fs-sm);color:var(--t1);font-family:var(--font);text-align:center"></div>
        </div>
      </div>
      <div class="settings-card">
        <h3>Python Environment</h3>
        <div id="pythonInfo" style="font-family:var(--font);font-size:var(--fs-sm);color:var(--t1);line-height:1.8">Loading...</div>
      </div>
    </div>
  </div>

</div><!-- /page-settings -->


<!-- ============================================================
     ABOUT PAGE
     ============================================================ -->
<div class="page" id="page-about">
  <div class="toolbar">
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--ac)" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>
    <span style="font-size:var(--fs-lg);font-weight:700">About</span>
    <div class="toolbar-spacer"></div>
    <span style="font-size:var(--fs-sm);color:var(--t2);font-family:var(--font)">Free for personal use · For commercial licensing please contact me at: <a href="mailto:alice@it-link.net" style="color:var(--ac);text-decoration:none">alice@it-link.net</a></span>
    <div class="toolbar-spacer"></div>
  </div>
  <div class="info-page" style="padding-top:40px">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:32px">
      <div>
        <h1 style="margin-bottom:4px">ALICE</h1>
        <p style="font-size:var(--fs-md);color:var(--ac);margin:0 0 8px;letter-spacing:0.5px;font-weight:600">
          <b>A</b>nalyse · <b>L</b>earn · <b>I</b>ngest · <b>C</b>urate · <b>E</b>xport
        </p>
        <p style="font-size:var(--fs-xl);color:var(--t0);margin:0">
          All-in-one AI-powered image annotation, training, and dataset management toolkit.
        </p>
      </div>
      <div style="text-align:right;font-family:var(--font);flex-shrink:0">
        <div style="font-size:var(--fs-sm);color:var(--t0b);font-weight:600">Developer: Simon Cirstoiu</div>
        <div style="font-size:var(--fs-xs);color:var(--t2);margin-top:4px">Licensed under <a href="https://creativecommons.org/licenses/by-nc/4.0/" target="_blank" rel="noopener" style="color:var(--ac);text-decoration:none">CC BY-NC 4.0</a></div>
      </div>
    </div>

    <h2>What is this?</h2>
    <p>
      Alice is a self-contained web application for managing YOLO object detection datasets.<br>
      It combines a visual image browser, bounding box editor, AI-assisted auto-annotation,
      duplicate detection and cleanup, and a full training pipeline — all in a single Python file served via
      a built-in HTTP server.<br>
      No external frameworks or databases required.<br>
    </p>

    <h2>Why?</h2>
    <p>
      I needed a tool to train a YOLO model for my cameras, using my own images,
      with the specific angles and scenarios around my house.<br>
      I couldn't find anything on the internet (or if it existed, I was probably too drunk to find it),
      so I built my own utility to fit my needs.<br>
      If you find it useful — enjoy. If not, well... cry me a river! :)
    </p>

    <h2>Key Capabilities</h2>

    <div class="card" style="margin-bottom:12px">
      <strong style="color:var(--acg);font-size:var(--fs-md)">Viewer</strong>
      <p style="margin:8px 0 0;font-size:var(--fs-md)">Browse, annotate, and edit YOLO bounding boxes with drag, resize, draw, and class assignment. Gallery view, keyboard shortcuts, and per-class filtering.</p>
    </div>

    <div class="card" style="margin-bottom:12px">
      <strong style="color:var(--ac);font-size:var(--fs-md)">Live Mode</strong>
      <p style="margin:8px 0 0;font-size:var(--fs-md)">Browse Frigate NVR event snapshots in real-time. Copy or move snapshots directly into your training dataset.</p>
    </div>

    <div class="card" style="margin-bottom:12px">
      <strong style="color:var(--acp);font-size:var(--fs-md)">Video Mode</strong>
      <p style="margin:8px 0 0;font-size:var(--fs-md)">Frame-by-frame analysis of video exports. Automated frame scanning with AI detection and batch export.</p>
    </div>

    <div class="card" style="margin-bottom:12px">
      <strong style="color:var(--aco);font-size:var(--fs-md)">Trainer</strong>
      <p style="margin:8px 0 0;font-size:var(--fs-md)">Full pipeline: export from Frigate DB, deduplicate (pHash + box IoU + NMS), auto-annotate with teacher model, fine-tune student model, export to ONNX.</p>
    </div>

    <div class="card" style="margin-bottom:12px">
      <strong style="color:var(--acy);font-size:var(--fs-md)">Duplicate Detection</strong>
      <p style="margin:8px 0 0;font-size:var(--fs-md)">Perceptual hashing (pHash) for finding visually similar images across the dataset. Side-by-side comparison view.</p>
    </div>

    <div class="card" style="margin-bottom:12px">
      <strong style="color:var(--acc);font-size:var(--fs-md)">Settings</strong>
      <p style="margin:8px 0 0;font-size:var(--fs-md)">All configuration stored in <code>alice.conf</code>. Editable from the web UI or directly in the file.</p>
    </div>

  </div>
</div><!-- /page-about -->


<!-- ============================================================
     SUPPORT PAGE
     ============================================================ -->
<div class="page" id="page-support">
  <div class="toolbar">
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--acr)" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
    <span style="font-size:var(--fs-lg);font-weight:700">Support Alice</span>
  </div>
  <div class="info-page" style="padding-top:60px;text-align:center">

    <div style="margin-bottom:40px">
      <div style="width:64px;height:64px;border-radius:16px;background:linear-gradient(135deg,var(--ac),var(--acp));display:flex;align-items:center;justify-content:center;margin:0 auto 20px;box-shadow:0 8px 24px rgba(59,130,246,0.3)">
        <span style="font-size:var(--fs-3xl);font-weight:800;color:#fff;font-family:var(--font)">A</span>
      </div>
      <h1 style="margin-bottom:12px">Thank You</h1>
      <p style="font-size:var(--fs-lg);color:var(--t1);line-height:1.8;max-width:clamp(400px,45vw,700px);margin:0 auto">
        Thank you for using Alice. This project started as a personal tool for my home cameras and grew into something I'm genuinely proud of.
      </p>
    </div>

    <div style="background:var(--bg2);border-radius:16px;border:1px solid var(--bd);padding:var(--pad-xl);margin-bottom:32px;text-align:center">
      <p style="font-size:var(--fs-lg);color:var(--t1);line-height:1.8;margin:0 0 24px">
        Alice exists because good tools shouldn't cost a fortune. One app, zero dependencies, completely self-hosted. If you find it useful, your support helps keep it that way.
      </p>
      <a href="https://www.paypal.com/donate/?hosted_button_id=988G9YXYX78RG" target="_blank" rel="noopener" style="display:inline-block;padding:var(--pad-lg) 40px;border-radius:10px;background:#0070ba;color:#fff;text-decoration:none;font-weight:600;font-family:var(--fontUI);font-size:var(--fs-lg);box-shadow:0 4px 16px rgba(0,112,186,0.4);transition:opacity 0.15s" onmouseenter="this.style.opacity='0.85'" onmouseleave="this.style.opacity='1'">♥ Donate via PayPal</a>
    </div>

    <p style="font-size:var(--fs-lg);color:var(--t2);line-height:1.6">
      Built with late nights, many coffees, and the belief that I can make something useful. — Simon
    </p>

  </div>
</div><!-- /page-support -->


<!-- ============================================================
     HELP PAGE
     ============================================================ -->
<div class="page" id="page-help">
  <div class="toolbar">
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--acc)" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
    <span style="font-size:var(--fs-lg);font-weight:700">Help & Documentation</span>
  </div>
  <div class="info-page" style="padding-top:40px">
    <h1>Documentation</h1>
    <p style="margin-bottom:32px">Complete reference for every feature in Alice.</p>

    <h2>Viewer — Dataset Mode</h2>

    <p>
      The main interface for browsing and annotating your YOLO dataset.<br>
      Images are displayed on a canvas with full zoom, pan, and bounding box interaction support.
    </p>

    <h3 style="color:var(--ac)">Navigation</h3>
    <p>
      Use <code>←</code> / <code>→</code> arrow keys or toolbar buttons to move between images.<br>
      Scroll wheel (without Ctrl) also navigates.<br>
      Click the image counter to jump to a specific index.<br>
      Filter by split (All / Train / Val / Empty) or by class using the toolbar dropdowns.
    </p>

    <h3 style="color:var(--ac)">Bounding Box Editing</h3>
    <p>
      <strong>Draw</strong> — Click and drag on the canvas to create a new box.<br>
      <strong>Select</strong> — Click inside a box to select it (green highlight + handles).<br>
      <strong>Move</strong> — Click and hold inside a selected box, then drag to reposition it.<br>
      <strong>Resize</strong> — Drag any of the 8 handles (corners + midpoints).<br>
      <strong>Delete</strong> — Press <code>D</code> or use the × button in the panel.<br>
      <strong>Undo</strong> — <code>Ctrl+Z</code> restores previous state (up to 50 steps).<br>
      <strong>Right-click</strong> — Context menu for quick class change, copy/move, delete.
    </p>

    <h3 style="color:var(--ac)">AI Analysis</h3>
    <p>
      The AI tab runs YOLO inference on the current image.<br>
      <strong>Analyse</strong> merges detected boxes into saved annotations (skipping duplicates by IoU &gt; 0.5).<br>
      <strong>Preview</strong> shows dashed boxes without saving.<br>
      <strong>Live Detection</strong> auto-runs AI every time you navigate to a new image.
    </p>

    <h3 style="color:var(--ac)">Gallery View</h3>
    <p>
      Press <code>G</code> to toggle a grid thumbnail view.<br>
      Click any thumbnail to navigate to that image.<br>
      The gallery respects current filters.
    </p>

    <h2>Viewer — Live Mode</h2>

    <p>
      Browses Frigate NVR event snapshots from the configured clips directory.<br>
      Filter by camera and time window.<br>
      Use the Transfer tab to copy or move snapshots into your training dataset with automatic format conversion (WebP → JPG).
    </p>

    <h2>Viewer — Video Mode</h2>

    <p>
      Frame-by-frame analysis of video exports from Frigate.<br>
      Use the seekbar, step buttons, or keyboard arrows to navigate.<br>
      The <strong>Scanner</strong> tab automatically scans every Nth frame with AI detection, collecting frames with detections for batch export.
    </p>

    <h2>Trainer</h2>

    <p>The training pipeline consists of 5 steps that can be run individually or as a sequence.</p>

    <h3 style="color:var(--acp)">1. Export</h3>
    <p>
      Extracts event snapshots from the Frigate SQLite database and saves them as JPGs.<br>
      Existing images are skipped (safe to re-run).<br>
      A 90/10 train/val split is applied randomly.
    </p>

    <h3 style="color:var(--acp)">2. Dedup</h3>
    <p>
      Three strategies:<br>
      <strong>Box Dedup</strong> compares annotation similarity per camera.<br>
      <strong>pHash</strong> compares visual similarity using perceptual hashing.<br>
      <strong>NMS Cleanup</strong> removes overlapping same-class boxes within images.
    </p>

    <h3 style="color:var(--acp)">3. Annotate</h3>
    <p>
      Auto-labels all images using the Teacher model.<br>
      Can either overwrite or merge with existing annotations.<br>
      Only configured default classes are annotated.
    </p>

    <h3 style="color:var(--acp)">4. Train</h3>
    <p>
      Fine-tunes the Student model on the dataset.<br>
      Displays real-time progress with epoch metrics (box/cls/dfl loss, mAP50, mAP50-95).<br>
      The best checkpoint is saved to the Models directory.
    </p>

    <h3 style="color:var(--acp)">5. Export ONNX</h3>
    <p>
      Converts the trained model to ONNX format for deployment (e.g., in Frigate with TensorRT).<br>
      Supports FP16 half-precision and dynamic batch sizes.
    </p>

    <h2>Settings</h2>

    <p>
      All settings are stored in <code>alice.conf</code> and organized into tabs:<br><br>
      <strong>Paths</strong> — Directories and server port<br>
      <strong>AI</strong> — Models, confidence, classes, model download<br>
      <strong>Training</strong> — Epochs, batch size, learning rate, freeze layers<br>
      <strong>Dedup</strong> — Strategies and similarity thresholds<br>
      <strong>Interface</strong> — Tooltips, sort order<br>
      <strong>System</strong> — Dependency check and Python environment info
    </p>

    <h2>Keyboard Shortcuts</h2>

    <p>
      <code>← →</code> Navigate images · <code>D</code> Delete selected box · <code>P</code> Set to Person class · <code>A</code> AI Analyse (save) · <code>M</code> Copy/Move dialog · <code>E</code> Toggle panel · <code>G</code> Gallery view · <code>J</code> Jump to image # · <code>Ctrl+Z</code> Undo · <code>Ctrl+Scroll</code> Zoom · <code>Scroll</code> Navigate images · <code>Space</code> Play/pause (video) · <code>Right-click</code> Context menu
    </p>
  </div>
</div><!-- /page-help -->

</div><!-- /main -->

<!-- Tooltip element -->
<div class="tip-popup" id="tipPopup" style="display:none"></div>
