<p align="center">
  <h1 align="center">ALICE</h1>
  <p align="center"><b>A</b>nalyse · <b>L</b>earn · <b>I</b>ngest · <b>C</b>urate · <b>E</b>xport</p>
  <p align="center">All-in-one AI-powered image annotation, training, and dataset management toolkit.</p>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/python-3.8+-blue?logo=python&logoColor=white" alt="Python">
  <img src="https://img.shields.io/badge/YOLO-v8%20%7C%2011-orange" alt="YOLO">
  <img src="https://img.shields.io/badge/Frigate-NVR-green" alt="Frigate">
  <img src="https://img.shields.io/badge/license-PolyForm%20Noncommercial%201.0.0-lightgrey" alt="License">
</p>

---

> **Works on both NVIDIA GPU and CPU.** 

ALICE automatically detects your hardware — if no compatible GPU is found, it falls back to CPU mode. No manual configuration needed.

![Viewer — AI Detection](screenshots/viewer.png)

## Why?

I needed a tool to train a YOLO model for my cameras, using my own images, with the specific angles and scenarios around my house.
I couldn't find anything on the internet (or if it existed, I was probably too drunk to find it), so I built my own utility to fit my needs.
If you find it useful — enjoy. If not, well... cry me a river! :)

## Quick Start

```bash
# Build and set up virtual environment
python3 builder.py

# Run
./alice.py
```

The builder assembles `alice.py` from source modules, creates a `.venv` with base dependencies, and patches the shebang so `./alice.py` uses the venv automatically. On Debian/Ubuntu, the builder will auto-install `python3-venv` if missing.

On first run, a welcome page guides you through initial setup — hardware detection, model download, and dependency installation. Open **http://localhost:8080** and follow the steps.

```bash
# Options
./alice.py --port 9090                  # custom port
./alice.py --conf /path/to/alice.conf   # custom config path
```

### Docker

```bash
python3 builder.py --no-venv
```

The builder generates `docker-compose.yml` automatically, depending on your configured hardware (GPU or CPU). 
Edit the volume paths to match your Frigate setup, then:

```bash
docker compose up --build -d
```

See [Docker Setup](#docker-setup) below for details.

## Features

### Viewer — Dataset Mode
Browse and annotate YOLO bounding boxes with a full canvas editor — draw, resize, move, delete, undo. Filter by split (train / val / empty) or by class. Gallery grid view, keyboard shortcuts, right-click context menus.

![Viewer — Edit Panel](screenshots/viewer-edit.png)

### Gallery & Dataset Stats
Gallery grid view with thumbnail previews, split badges, and box counts. Dataset statistics panel shows total images, train/val distribution, annotation coverage, and class distribution.

![Gallery — Stats](screenshots/gallery-stats.png)

### Duplicate Detection
Perceptual hashing (pHash) with DCT-based 64-bit hashes. Multiprocessing-accelerated computation. Side-by-side comparison. Box-similarity dedup per camera. NMS cleanup for overlapping same-class boxes.

![Viewer — Duplicate Detection](screenshots/viewer-dupes.png)

### Viewer — Live Mode
Browse Frigate NVR event snapshots in real-time. Filter by camera and time window. Transfer snapshots directly into your training dataset with automatic WebP → JPG conversion.

### Viewer — Video Mode
Frame-by-frame analysis of Frigate video exports. Seekbar, step controls, adjustable playback FPS. Automated frame scanner with AI detection for batch export.

### AI Analysis
Run YOLO inference on any image across all three modes. Merge detected boxes into annotations (dedup by IoU > 0.5). Preview mode shows detections without saving. Live detection auto-runs as you navigate.

### Training Pipeline

Five-step pipeline — each step toggleable, runnable individually or as a sequence:

| Step | What it does |
|------|-------------|
| **1. Export** | Extract newest snapshots from Frigate DB with round-robin camera distribution → 90/10 train/val split |
| **2. Dedup** | Remove duplicates via pHash, box similarity, and NMS cleanup |
| **3. Annotate** | Auto-label all images using a teacher model |
| **4. Train** | Fine-tune student model with real-time metrics (loss, mAP50, mAP50-95) |
| **5. Export ONNX** | Convert to ONNX for deployment (FP16 or FP32 on GPU, FP32 only on CPU) |

All steps log to the Logs tab with COMPLETED / FAILED / STOPPED status.

![Training Pipeline](screenshots/trainer.png)

### Device Detection

ALICE automatically detects your hardware at startup and adapts accordingly:

| | NVIDIA GPU | CPU |
|---|---|---|
| Training | GPU accelerated | CPU (slower) |
| Inference | GPU | CPU |
| ONNX Export | FP16 + FP32 | FP32 only |
| PyTorch | CUDA build | CPU build |
| onnxruntime | `onnxruntime-gpu` | `onnxruntime` |

Configure from **Settings → System → Device** (Auto / NVIDIA GPU / CPU). The sidebar and Device tab show live hardware stats.

### Settings

All configuration in `alice.conf` — editable from the web UI or directly in the file. Built-in dependency checker with one-click install. Model downloader for YOLO11 and YOLOv8 variants.

<table>
<tr>
<td width="50%"><b>Paths</b><br><img src="screenshots/settings-paths.png" alt="Settings — Paths"></td>
<td width="50%"><b>AI Models</b><br><img src="screenshots/settings-ai.png" alt="Settings — AI"></td>
</tr>
<tr>
<td width="50%"><b>Training</b><br><img src="screenshots/settings-training.png" alt="Settings — Training"></td>
<td width="50%"><b>System & Dependencies</b><br><img src="screenshots/settings-system.png" alt="Settings — System"></td>
</tr>
</table>

## Requirements

Python 3.8+ required. The builder creates a `.venv` and installs the base dependency (Pillow) automatically. All other dependencies are managed by ALICE and can be installed from the welcome page or Settings → System with one click:

| Package | Purpose |
|---------|---------|
| **Pillow** | Image processing, pHash, format conversion (auto-installed by builder) |
| **NumPy** | Numerical operations for dedup |
| **inotify** | Filesystem watching on Linux (falls back to polling) |
| **opencv-python-headless** | Video frame extraction |
| **ONNX** | ONNX model format for export |
| **onnxslim** | ONNX model optimization |
| **onnxruntime** | ONNX Runtime — GPU or CPU variant auto-selected |
| **PyTorch** | Deep learning framework — CUDA or CPU variant auto-selected |
| **ultralytics** | YOLO model training & inference |

ALICE installs the correct PyTorch variant (CUDA or CPU) based on detected hardware. No manual torch installation needed.

> **Note:** ALICE does **not** install NVIDIA drivers or CUDA. If you want GPU-accelerated training, install the [NVIDIA drivers](https://www.nvidia.com/Download/index.aspx) and [CUDA toolkit](https://developer.nvidia.com/cuda-toolkit) on your system before running ALICE.

## Docker Setup

The builder generates `docker-compose.yml` with GPU support auto-detected from your host:

```bash
python3 builder.py --no-venv
```

This creates `docker-compose.yml` with the NVIDIA GPU block included if a GPU is detected, or CPU-only otherwise.

Edit the volume paths to match your setup:

```yaml
volumes:
  - ./alice.conf:/app/alice.conf
  - /path/to/datasets:/app/datasets
  - /path/to/models:/app/models
  - /path/to/frigate/clips:/app/clips:ro
  - /path/to/frigate/exports:/app/exports:ro
  - /path/to/frigate/frigate.db:/app/frigate.db:ro
```

> **Important:** The `frigate.db` volume must point to the actual **file**, not a directory. If the file doesn't exist on the host at the time of container creation, Docker will create a directory instead and ALICE won't be able to open the database.

Then start:

```bash
docker compose up --build -d
```

On first run, open ALICE in your browser and install dependencies from the welcome page or Settings → System. Dependencies are persisted in a Docker volume across container restarts.

> **Note:** GPU support in Docker requires [NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html) on the host. If running the builder on a machine without GPU, the generated compose file will be CPU-only.

## Dataset Structure

Alice expects standard YOLO format:

```
dataset/
├── images/
│   ├── train/*.jpg
│   └── val/*.jpg
├── labels/
│   ├── train/*.txt
│   └── val/*.txt
└── dataset.yaml          ← auto-generated by trainer
```

## Building from Source

Alice is developed as modular source files assembled into a single `alice.py`:

```bash
python3 builder.py                     # → alice.py + .venv/ + docker-compose.yml
python3 builder.py -o /path/to/out.py  # custom output path
python3 builder.py --no-venv           # skip venv creation (for Docker)
python3 builder.py --check             # verify all modules and assets exist
python3 builder.py --list              # show resolved dependency order
python3 builder.py --strict            # abort on name conflicts
```

The builder:
1. Reads the import graph from `from .module import` statements in each `src/*.py`
2. Topologically sorts modules by dependency order
3. Strips all relative imports (redundant in the flat monolith namespace)
4. Injects CSS, JS, and HTML assets from `src/assets/` into placeholder tokens
5. Writes a single self-contained `alice.py`
6. Creates a `.venv` with Pillow and patches the shebang (auto-installs `python3-venv` if missing)
7. Generates `docker-compose.yml` with GPU support auto-detected

Re-running `builder.py` rebuilds `alice.py` and regenerates `docker-compose.yml`, but skips venv creation if `.venv` already exists.

Source modules live in `src/` — see [CONTRIBUTING.md](CONTRIBUTING.md) for development workflow.

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `← →` | Navigate images |
| `D` | Delete selected box |
| `P` | Set to Person class |
| `A` | AI Analyse (save) |
| `M` | Copy/Move dialog |
| `E` | Toggle panel |
| `G` | Gallery view |
| `J` | Jump to image # |
| `Ctrl+Z` | Undo |
| `Ctrl+Scroll` | Zoom |
| `Space` | Play/pause (video) |

## Support

If you find ALICE useful, you can buy me a coffee:

[![Donate](https://img.shields.io/badge/Donate-PayPal-blue?logo=paypal)](https://www.paypal.com/donate/?hosted_button_id=988G9YXYX78RG)

Need help or want to chat? Join Alice Discord:

[![Discord](https://img.shields.io/badge/Discord-Join-5865F2?logo=discord&logoColor=white)](https://discord.gg/SnsDbNuhmW)

## License

[PolyForm Noncommercial 1.0.0](https://polyformproject.org/licenses/noncommercial/1.0.0/) — free for personal, non-commercial use. For commercial licensing, contact alice@it-link.net.


## Author

Simon Cirstoiu
