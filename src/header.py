#!/usr/bin/env python3
"""
Analyse · Learn · Ingest · Curate · Export
All-in-one AI-powered image annotation, training, and dataset management toolkit.

Usage:
    python3 alice.py
    python3 alice.py --port 9090
    python3 alice.py --conf /path/to/alice.conf
"""

import os
import sys
import json
import glob
import re
import time
import math
import shutil
import threading
import argparse
import subprocess
from datetime import datetime
from pathlib import Path
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import unquote, parse_qs
from collections import defaultdict, deque
from typing import Any, Optional

VERSION = "0.5.7"

# ============================================================
# CONFIGURATION DEFAULTS
# All runtime code must reference CONF_DEFAULTS for fallbacks,
# never hardcoded literal values.
# ============================================================

CONF_DEFAULTS = {
    # Paths — empty = auto-resolve to alice.py directory at startup
    "DEFAULT_PORT": 8080,
    "DEFAULT_DATASET": "",
    "DATASETS_ROOT": "",
    "MODELS_DIR": "",
    "LIVE_DIR": "",
    "EXPORTS_DIR": "",
    "FRIGATE_DB": "",
    "VIDEO_EXTENSIONS": [".mp4", ".avi", ".mkv", ".mov"],
    # AI Defaults
    "DEFAULT_MODEL": "",
    "TEACHER_MODEL": "",
    "STUDENT_MODEL": "",
    "DEFAULT_CONFIDENCE": 0.7,
    "DEFAULT_CLASSES": [0, 2, 15, 16],
    # Training Defaults
    "EPOCHS": 10,
    "BATCH_SIZE": 8,
    "LEARNING_RATE": 0.0001,
    "LR_FINAL": 0.01,
    "IMAGE_SIZE": 640,
    "FREEZE_LAYERS": 10,
    "AUGMENTATION": False,
    # Interface
    "HELPERS_ENABLED": True,
    "SORT_ORDER": "modified",
    "WELCOME_DISMISSED": False,
    # Dedup Defaults
    "DEDUP_BOXES": False,
    "DEDUP_BOX_SIM": 10,
    "DEDUP_PHASH": True,
    "DEDUP_PHASH_SIM": 85,
    "DEDUP_NMS": False,
    "DEDUP_NMS_SIM": 85,
}

# ============================================================
# COCO 80 CLASS NAMES
# ============================================================

CLASS_NAMES = {
    0: "person", 1: "bicycle", 2: "car", 3: "motorcycle", 4: "airplane",
    5: "bus", 6: "train", 7: "truck", 8: "boat", 9: "traffic light",
    10: "fire hydrant", 11: "stop sign", 12: "parking meter", 13: "bench",
    14: "bird", 15: "cat", 16: "dog", 17: "horse", 18: "sheep", 19: "cow",
    20: "elephant", 21: "bear", 22: "zebra", 23: "giraffe", 24: "backpack",
    25: "umbrella", 26: "handbag", 27: "tie", 28: "suitcase", 29: "frisbee",
    30: "skis", 31: "snowboard", 32: "sports ball", 33: "kite", 34: "baseball bat",
    35: "baseball glove", 36: "skateboard", 37: "surfboard", 38: "tennis racket",
    39: "bottle", 40: "wine glass", 41: "cup", 42: "fork", 43: "knife",
    44: "spoon", 45: "bowl", 46: "banana", 47: "apple", 48: "sandwich",
    49: "orange", 50: "broccoli", 51: "carrot", 52: "hot dog", 53: "pizza",
    54: "donut", 55: "cake", 56: "chair", 57: "couch", 58: "potted plant",
    59: "bed", 60: "dining table", 61: "toilet", 62: "tv", 63: "laptop",
    64: "mouse", 65: "remote", 66: "keyboard", 67: "cell phone",
    68: "microwave", 69: "oven", 70: "toaster", 71: "sink", 72: "refrigerator",
    73: "book", 74: "clock", 75: "vase", 76: "scissors", 77: "teddy bear",
    78: "hair drier", 79: "toothbrush",
}

REVERSE_CLASS_NAMES = {v: k for k, v in CLASS_NAMES.items()}

# ============================================================
# DEPENDENCY DEFINITIONS
# ============================================================

DEPENDENCIES = [
    {"name": "Pillow", "import": "PIL", "pip": "Pillow", "required": True, "desc": "Image processing (pHash, format conversion)"},
    {"name": "NumPy", "import": "numpy", "pip": "numpy", "required": False, "desc": "Numerical operations for dedup"},
    {"name": "inotify", "import": "inotify", "pip": "inotify", "required": False, "desc": "Filesystem change watching (Linux)"},
    {"name": "OpenCV", "import": "cv2", "pip": "opencv-python-headless", "required": False, "desc": "Video frame extraction & processing"},
    {"name": "ONNX", "import": "onnx", "pip": "onnx", "required": False, "desc": "ONNX model format for export"},
    {"name": "onnxslim", "import": "onnxslim", "pip": "onnxslim", "required": False, "desc": "ONNX model optimization & slimming"},
    {"name": "onnxruntime", "import": "onnxruntime", "pip": "onnxruntime-gpu", "required": False, "desc": "ONNX Runtime with GPU support"},
    {"name": "ultralytics", "import": "ultralytics", "pip": "ultralytics", "required": False, "desc": "YOLO model training & inference"},
]

# ============================================================
# GLOBAL STATE
# ============================================================

ALICE_DIR = os.path.dirname(os.path.abspath(__file__))

# Global lock for compound read+write operations on shared lists/dicts
# Use with _state_lock: around any read-then-modify sequence on IMAGE_LIST,
# LIVE_LIST, VIDEO_LIST, MODELS_LIST to prevent race conditions from
# watcher threads, handler threads, and trainer threads running concurrently.
_state_lock = threading.Lock()

CONF: dict[str, Any] = {}

def conf(key):
    """Read a config value with automatic fallback to CONF_DEFAULTS."""
    return CONF.get(key, CONF_DEFAULTS.get(key))

# ============================================================
# STATE — single mutable dict for all scalar runtime variables.
# All modules import STATE and read/write STATE["KEY"] so that
# reassignments propagate across module boundaries instantly.
# ============================================================
STATE: dict[str, Any] = {
    "CONF_PATH":        "",
    "DATASET_DIR":      "",
    "TRAINER_DATASET":  "",
    "AI_MODEL":         None,
    "AI_MODEL_PATH":    None,
    "DATASET_VERSION":  0,
    "LIVE_VERSION":     0,
    "VIDEO_VERSION":    0,
    "FIRST_RUN":        False,
    "PIPELINE_STATE":   None,
    "STEP_REPORTS": {
        "export": None, "dedup": None, "annotate": None,
        "train": None, "onnx": None, "pipeline": None,
    },
    "UI_STATE": {
        "page":         "viewer",
        "mode":         "dataset",
        "panel_open":   True,
        "panel_tab":    "edit",
        "trainer_step": 0,
        "trainer_tab":  "config",
        "settings_tab": "paths",
    },
}

IMAGE_LIST: list[dict] = []
MODELS_LIST: list[str] = []
LIVE_LIST: list[dict] = []
LIVE_ALL: list[dict] = []   # toate snapshot-urile, nefiltrate — folosit pentru indexare by-idx
LIVE_CAMERAS: list[str] = []
VIDEO_LIST: list[dict] = []

AI_MODEL: Any = None
AI_MODEL_PATH: Optional[str] = None
ai_lock = threading.Lock()

PHASH_CACHE: dict[str, int] = {}

VIDEO_INFO_CACHE: dict[str, dict] = {}
VIDEO_FRAME_CACHE: dict[str, bytes] = {}
VIDEO_FRAME_CACHE_ORDER: deque = deque()
VIDEO_FRAME_CACHE_MAX = 50

def _empty_step_status() -> dict:
    return {"running": False, "progress": 0, "current": 0, "total": 0, "message": "", "epochs": []}

STEP_STATUS: dict[str, dict] = {
    "export": _empty_step_status(),
    "dedup": _empty_step_status(),
    "annotate": _empty_step_status(),
    "train": _empty_step_status(),
    "onnx": _empty_step_status(),
}

TRAINER_LOG: list[str] = []


class LogCapture:
    """Capture stdout/stderr at OS fd level to TRAINER_LOG buffer.

    Uses a dedicated lock to prevent interleaved fd-level redirects
    when multiple threads write to stdout concurrently.
    """
    _fd_lock = threading.Lock()

    def __init__(self) -> None:
        self._old_stdout_fd: Optional[int] = None
        self._old_stderr_fd: Optional[int] = None
        self._old_stdout = None
        self._old_stderr = None
        self._pipe_r: Optional[int] = None
        self._pipe_w: Optional[int] = None
        self._reader_thread: Optional[threading.Thread] = None

    def __enter__(self):
        import io
        LogCapture._fd_lock.acquire()
        self._old_stdout = sys.stdout
        self._old_stderr = sys.stderr
        self._old_stdout_fd = os.dup(1)
        self._old_stderr_fd = os.dup(2)
        self._pipe_r, self._pipe_w = os.pipe()
        os.dup2(self._pipe_w, 1)
        os.dup2(self._pipe_w, 2)
        sys.stdout = io.TextIOWrapper(os.fdopen(self._pipe_w, 'wb', 0), write_through=True)
        sys.stderr = sys.stdout

        def _reader():
            import re as _re
            with os.fdopen(self._pipe_r, 'rb', 0) as f:
                buf = b''
                while True:
                    byte = f.read(1)
                    if not byte:
                        if buf:
                            try:
                                text = buf.decode('utf-8', errors='replace')
                            except Exception:
                                text = ''
                            clean = _re.sub(r'\x1b\[[0-9;]*[a-zA-Z]', '', text).replace('\r', '').strip()
                            if clean:
                                TRAINER_LOG.append(clean)
                        break
                    if byte == b'\n' or byte == b'\r':
                        if not buf:
                            continue
                        try:
                            text = buf.decode('utf-8', errors='replace')
                        except Exception:
                            text = ''
                        clean = _re.sub(r'\x1b\[[0-9;]*[a-zA-Z]', '', text).replace('\r', '').strip()
                        buf = b''
                        if not clean:
                            continue
                        prefix = clean.split()[0] if clean.split() else ''
                        last_prefix = TRAINER_LOG[-1].split()[0] if TRAINER_LOG else ''
                        if prefix and '/' in prefix and prefix == last_prefix:
                            TRAINER_LOG[-1] = clean
                        else:
                            TRAINER_LOG.append(clean)
                    else:
                        buf += byte

        self._reader_thread = threading.Thread(target=_reader, daemon=True)
        self._reader_thread.start()
        return self

    def __exit__(self, *args):
        os.dup2(self._old_stdout_fd, 1)
        os.dup2(self._old_stderr_fd, 2)
        os.close(self._old_stdout_fd)
        os.close(self._old_stderr_fd)
        sys.stdout = self._old_stdout
        sys.stderr = self._old_stderr
        LogCapture._fd_lock.release()


DATASET_VERSION = 0
LIVE_VERSION = 0
VIDEO_VERSION = 0
FIRST_RUN = False

DEPS_STATUS: dict[str, Any] = {
    "running": False,
    "current": "",
    "installed": [],
    "errors": [],
    "total": 0,
    "done": 0,
}


# ============================================================
# PATH VALIDATION UTILITY
# ============================================================

def validate_path(untrusted: str, allowed_root: str) -> Optional[str]:
    """Resolve *untrusted* and return it only if it lives under *allowed_root*.

    Returns the resolved absolute path on success, or ``None`` if the path
    escapes the allowed root (directory traversal).
    """
    if not untrusted or not allowed_root:
        return None
    try:
        resolved = os.path.realpath(untrusted)
        root = os.path.realpath(allowed_root)
        if resolved == root or resolved.startswith(root + os.sep):
            return resolved
    except (ValueError, OSError):
        pass
    return None
