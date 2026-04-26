# Changelog

All notable changes to ALICE will be documented in this file.
Entries are ordered newest first.

## [0.6.3] - 25-04-2026

- Added bulk video frames export under Video section.
- Fixed image name clipping.
- Fixed builder venv setup.

## [0.6.2] - 25-04-2026

- Fixed canvas getting stuck and showing 400 errors when editing the current image dropped it out of an active class filter. Thanks @ngk0 for the bug report in #2.
- Fixed bounding box class names showing as empty black bands instead of the label text for many classes.
- Fixed class filter dropdown not refreshing after saving Settings, you no longer need to refresh the page.
- Fixed empty-state message showing "No images in dataset" when there are images but the active filter has no matches.
- Fixed black canvas on first page load when the browser had not finished layout before the image was loaded.
- Fixed zoom out positioning the image off-center when reaching the minimum zoom level.
- Right-click context menu on a box is now scrollable when it contains more than 10 classes, instead of overflowing the screen.
- Right-click context menus now reposition automatically when they would be clipped by the screen edge.
- Other small bugs and fixes I do not remember now.

## [0.6.1] - 23-04-2026

- Fixed fp16/32, now by default FP16 will be unchecked, you can still check it if your system supports fp16.
- Added Discord Community link under Help.

## [0.6.0] - 22-04-2026

- License changed to PolyForm Noncommercial 1.0.0

## [0.5.8] - 22-04-2026

- Implemented CPU support as a fallback if no supported GPU is found.
- Implemented a new docker-compose mechanism, that will automatically generate the proper docker-compose file depending on detected hardware.
- Fixed various bugs.
- Other improvements.

## [0.5.7] - 20-04-2026

- Fixed welcome/onboarding page to proper support future development.

## [0.5.6] - 19-04-2026

- Small fixes.


## [0.5.5] - 19-04-2026

### Fixed
- Added empty alice.conf for docker compatibility.


## [0.5.4] - 19-04-2026

### Fixed
- F-string nested quotes compatibility for Python < 3.12 (Docker fix)


## [0.5.3] - 17-04-2026

### Fixed
- Connection errors (BrokenPipe, ConnectionReset) no longer print tracebacks to console

### Changed
- Settings tabs moved to toolbar — Paths, AI, Training, Dedup, Interface, System now in horizontal bar
- Trainer toolbar shows current context — step name (Export Dataset, Deduplication, etc.), GPU Status, or Training Logs
- Settings page content area no longer has separate tab bar taking vertical space

## [0.5.2] - 17-04-2026

### Fixed
- Tooltip viewport clamping — tooltips no longer get cut off at screen edges
- Scrollbar visibility — brighter thumb color and wider track
- Context menu overlap — right-click closes any existing menu before opening new one
- Selection badge shows per-class count instead of global array index
- Empty filter no longer removes current image when adding boxes
- Dynamic resize cursors on bounding box handles

### Changed
- Full responsive UI — all sizing adapts to browser window width
- Settings, Trainer, Support, Welcome pages use responsive layouts
- Buttons unified — consistent style across all pages
- Navigation buttons enlarged for better visibility
- Panel tabs match toolbar button dimensions
- GPU terminal and cards centered in trainer view
- Pipeline completion reports centered
- License changed to CC BY-NC 4.0

### Added
- Support page with donation link
- Responsive CSS token system

## [0.5.1] - 12-04-2026

### Changed
- All font sizes and padding replaced with responsive CSS clamp() tokens
- Info pages use dynamic max-width based on viewport
- Licensing text centered in About toolbar

## [0.5.0] - 07-04-2026

### Changed
- Completion reports render inline instead of modal overlays
- Reports persist to server and survive page refresh
- Dedup shows granular per-image progress with camera and split context

## [0.4.9] - 03-04-2026

### Added
- Docker support with Dockerfile and docker-compose.yml

## [0.4.8] - 31-03-2026

### Added
- Welcome wizard on first run with guided setup
- Model download directly from welcome overlay
- Dependency status check during first-run flow

## [0.4.7] - 27-03-2026

### Added
- GPU monitoring in sidebar — temperature, VRAM, power, utilization
- nvidia-smi polling with structured data parsing
- GPU status tab in Trainer with terminal output and metric cards

## [0.4.6] - 24-03-2026

### Added
- inotify filesystem watchers on dataset, live, and video directories
- Automatic list refresh on file changes
- Polling fallback when inotify not available

## [0.4.5] - 20-03-2026

### Changed
- Refactored from single file to modular source package
- builder.py assembles modules via topological sort of import graph
- Asset injection system for CSS, JS, HTML via placeholder tokens

## [0.4.4] - 17-03-2026

### Added
- Right-click context menus on boxes and images
- Tooltip system with hover popups on all interactive elements

## [0.4.3] - 13-03-2026

### Added
- Gallery grid view toggled with G key
- Keyboard shortcuts for all common actions

## [0.4.2] - 10-03-2026

### Added
- Dependency management page in Settings
- One-click install of missing Python packages

## [0.4.1] - 06-03-2026

### Added
- Settings page with tabbed UI
- alice.conf parser and writer with comment preservation

## [0.4.0] - 03-03-2026

### Added
- Server-side pipeline orchestration
- Pipeline state persistence across browser refresh
- Pipeline confirmation dialog

## [0.3.9] - 28-02-2026

### Added
- ONNX Export step with FP16 and dynamic batch support

## [0.3.8] - 26-02-2026

### Added
- Train step — YOLO fine-tune with epoch callbacks and mAP tracking
- Batch-level progress updates
- Augmentation toggle
- LogCapture for YOLO output redirection

## [0.3.7] - 23-02-2026

### Added
- Annotate merge mode — add detections without overwriting existing boxes

## [0.3.6] - 20-02-2026

### Added
- Annotate step — batch auto-annotation using teacher model
- Per-image progress with stop support

## [0.3.5] - 17-02-2026

### Added
- NMS cleanup — remove overlapping same-class boxes within label files

## [0.3.4] - 14-02-2026

### Added
- Box annotation dedup per camera group

## [0.3.3] - 12-02-2026

### Added
- pHash dedup step with hamming distance threshold
- Stop support mid-operation

## [0.3.2] - 09-02-2026

### Added
- Perceptual hash computation using PIL + DCT
- Hash caching with multiprocessing

## [0.3.1] - 06-02-2026

### Added
- Export step — query Frigate DB for event snapshots
- 90/10 train/val split, skip existing on re-run

## [0.3.0] - 03-02-2026

### Added
- Trainer page with step sidebar
- Pipeline checkbox selection
- Trainer log viewer

## [0.2.9] - 31-01-2026

### Added
- Sidebar navigation with collapsible layout
- Page and source mode switching
- UI state persistence to server

## [0.2.8] - 28-01-2026

### Added
- Batch export of scanned video frames

## [0.2.7] - 25-01-2026

### Added
- Video Scanner — auto-scan every Nth frame with AI detection

## [0.2.6] - 22-01-2026

### Added
- AI detection on video frames

## [0.2.5] - 19-01-2026

### Added
- Video frame export to dataset as JPG

## [0.2.4] - 16-01-2026

### Added
- Video seekbar, step buttons, play/pause with configurable FPS

## [0.2.3] - 13-01-2026

### Added
- Video mode — frame extraction from Frigate exports
- Frame cache with LRU eviction

## [0.2.2] - 09-01-2026

### Added
- Transfer tab — copy/move live snapshots to dataset
- Automatic WebP to JPG conversion

## [0.2.1] - 06-01-2026

### Added
- Camera filter and time window for live snapshots

## [0.2.0] - 03-01-2026

### Added
- Live mode — browse Frigate event snapshots

## [0.1.9] - 27-12-2025

### Added
- AI tab in panel with model selector and live detection toggle

## [0.1.8] - 23-12-2025

### Added
- Right panel with Edit tab, box list, quick actions

## [0.1.7] - 20-12-2025

### Added
- Person box flash animation on navigation

## [0.1.6] - 18-12-2025

### Added
- Confidence threshold and class filter for AI detection

## [0.1.5] - 16-12-2025

### Added
- Copy/Move dialog between datasets and splits

## [0.1.4] - 13-12-2025

### Added
- Multi-dataset support and dataset switching

## [0.1.3] - 10-12-2025

### Added
- Class filter dropdown with COCO 80 class names

## [0.1.2] - 08-12-2025

### Added
- AI Preview — dashed overlay boxes without saving

## [0.1.1] - 05-12-2025

### Added
- AI Analyse — merge detected boxes into annotations with IoU check

## [0.1.0] - 02-12-2025

### Added
- YOLO model loading with thread-safe caching

## [0.0.9] - 28-11-2025

### Added
- Filter by split (All, Train, Val, Empty)

## [0.0.8] - 25-11-2025

### Added
- Train/val split directory structure

## [0.0.7] - 21-11-2025

### Added
- Undo system (max 50 steps)

## [0.0.6] - 18-11-2025

### Added
- YOLO label file reading and writing

## [0.0.5] - 14-11-2025

### Added
- Box resize with 8 handles

## [0.0.4] - 11-11-2025

### Added
- Box select, move, and delete

## [0.0.3] - 08-11-2025

### Added
- Bounding box drawing on canvas

## [0.0.2] - 05-11-2025

### Added
- Image navigation, zoom, and pan

## [0.0.1] - 03-11-2025

### Added
- Initial release — threaded HTTP server with canvas-based image viewer
