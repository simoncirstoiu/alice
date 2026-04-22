# ============================================================
# CORE BACKEND FUNCTIONS
# ============================================================

import glob
import os
import re
import threading
import time
from datetime import datetime
from pathlib import Path

from .header import (
    CONF, CONF_DEFAULTS, STATE, IMAGE_LIST, LIVE_LIST, LIVE_ALL, LIVE_CAMERAS,
    VIDEO_LIST, _state_lock, conf,
)

def scan_datasets():
    """Find all dataset directories (contain images/ subfolder)."""
    root = conf("DATASETS_ROOT")
    datasets = []
    if not os.path.exists(root):
        return datasets
    for d in sorted(os.listdir(root)):
        full = os.path.join(root, d)
        if os.path.isdir(full) and os.path.exists(os.path.join(full, "images")):
            datasets.append({"name": d, "path": full})
    return datasets


def scan_models():
    """Find all .pt model files in MODELS_DIR."""
    models_dir = conf("MODELS_DIR")
    if not os.path.exists(models_dir):
        return []
    return sorted(glob.glob(os.path.join(models_dir, "*.pt")))


def scan_live_images(cam_filter="all", hours=24):
    """Scan LIVE_DIR for Frigate event snapshots (*-clean.webp).

    Always rebuilds LIVE_ALL (unfiltered, used for index-based access) and
    LIVE_CAMERAS. LIVE_LIST is set to the filtered subset for version tracking.
    """
    live_dir = conf("LIVE_DIR")
    if not live_dir or not os.path.exists(live_dir):
        with _state_lock:
            LIVE_LIST.clear()
            LIVE_ALL.clear()
            LIVE_CAMERAS.clear()
        return

    cutoff = time.time() - (hours * 3600)
    all_files = []
    cameras = set()

    for f in Path(live_dir).glob("*-clean.webp"):
        mtime = f.stat().st_mtime
        name = f.name
        m = re.match(r'^(.+?)-(\d{10,}\.\d+)-', name)
        if not m:
            m = re.match(r'^(.+?)-(\d{10,})-', name)
        cam = m.group(1) if m else "unknown"
        cameras.add(cam)
        all_files.append({
            "name": name, "path": str(f), "camera": cam,
            "mtime": mtime,
            "mtime_str": datetime.fromtimestamp(mtime).strftime("%Y-%m-%d %H:%M")
        })

    all_files.sort(key=lambda x: x["mtime"], reverse=True)

    filtered = [f for f in all_files if f["mtime"] >= cutoff]
    if cam_filter and cam_filter != "all":
        filtered = [f for f in filtered if f["camera"] == cam_filter]

    with _state_lock:
        LIVE_ALL.clear(); LIVE_ALL.extend(all_files)
        LIVE_CAMERAS.clear(); LIVE_CAMERAS.extend(sorted(cameras))
        LIVE_LIST.clear(); LIVE_LIST.extend(filtered)


def scan_video_exports():
    """Scan EXPORTS_DIR for video files."""
    exports_dir = conf("EXPORTS_DIR")
    if not exports_dir or not os.path.exists(exports_dir):
        with _state_lock:
            VIDEO_LIST.clear()
        return
    video_exts = tuple(conf("VIDEO_EXTENSIONS"))
    new_list = []
    for f in sorted(os.listdir(exports_dir)):
        if not f.lower().endswith(video_exts):
            continue
        full = os.path.join(exports_dir, f)
        st = os.stat(full)
        new_list.append({
            "name": f, "path": full, "size": st.st_size,
            "mtime": st.st_mtime,
            "mtime_str": datetime.fromtimestamp(st.st_mtime).strftime("%Y-%m-%d %H:%M")
        })
    new_list.sort(key=lambda x: x["mtime"], reverse=True)
    with _state_lock:
        VIDEO_LIST.clear(); VIDEO_LIST.extend(new_list)


def build_image_list():
    """Build list of all images in current dataset with box counts and mtime."""
    images = []
    img_exts = ('.jpg', '.jpeg', '.png', '.webp')
    for split in ["train", "val"]:
        img_dir = os.path.join(STATE["DATASET_DIR"], "images", split)
        if not os.path.exists(img_dir):
            continue
        for img in sorted(Path(img_dir).iterdir()):
            if img.suffix.lower() not in img_exts:
                continue
            lbl = os.path.join(STATE["DATASET_DIR"], "labels", split, img.stem + ".txt")
            box_count = 0
            classes_present = set()
            if os.path.exists(lbl):
                with open(lbl) as f:
                    for line in f:
                        parts = line.strip().split()
                        if len(parts) == 5:
                            box_count += 1
                            classes_present.add(int(parts[0]))
            img_mtime = img.stat().st_mtime
            lbl_mtime = os.path.getmtime(lbl) if os.path.exists(lbl) else 0
            mtime = max(img_mtime, lbl_mtime)
            images.append({
                "split": split, "name": img.name,
                "boxes": box_count, "classes": list(classes_present),
                "mtime": mtime
            })
    return images


def get_label_path(split, name):
    """Get label file path for an image (strips any image extension, adds .txt)."""
    stem = os.path.splitext(name)[0]
    return os.path.join(STATE["DATASET_DIR"], "labels", split, stem + ".txt")


def read_boxes(label_path: str) -> list[dict]:
    """Read bounding boxes from a YOLO label file."""
    boxes = []
    if os.path.exists(label_path):
        with open(label_path) as f:
            for line in f:
                parts = line.strip().split()
                if len(parts) == 5:
                    boxes.append({
                        "cls": int(parts[0]),
                        "xc": float(parts[1]), "yc": float(parts[2]),
                        "w": float(parts[3]), "h": float(parts[4])
                    })
    return boxes


def write_boxes(label_path, boxes):
    """Write bounding boxes to a YOLO label file."""
    os.makedirs(os.path.dirname(label_path), exist_ok=True)
    with open(label_path, "w") as f:
        for b in boxes:
            f.write(f"{b['cls']} {b['xc']:.6f} {b['yc']:.6f} {b['w']:.6f} {b['h']:.6f}\n")


def box_iou(a, b):
    """Compute IoU between two box dicts {xc, yc, w, h}."""
    a_l, a_r = a['xc'] - a['w'] / 2, a['xc'] + a['w'] / 2
    a_t, a_b = a['yc'] - a['h'] / 2, a['yc'] + a['h'] / 2
    b_l, b_r = b['xc'] - b['w'] / 2, b['xc'] + b['w'] / 2
    b_t, b_b = b['yc'] - b['h'] / 2, b['yc'] + b['h'] / 2
    ix1, iy1 = max(a_l, b_l), max(a_t, b_t)
    ix2, iy2 = min(a_r, b_r), min(a_b, b_b)
    if ix2 <= ix1 or iy2 <= iy1:
        return 0
    inter = (ix2 - ix1) * (iy2 - iy1)
    union = a['w'] * a['h'] + b['w'] * b['h'] - inter
    return inter / union if union > 0 else 0


def sort_image_list():
    """Re-sort IMAGE_LIST based on current CONF.SORT_ORDER."""
    sort_order = conf("SORT_ORDER")
    if sort_order == "modified":
        IMAGE_LIST.sort(key=lambda x: x.get("mtime", 0))
    else:
        IMAGE_LIST.sort(key=lambda x: (x["split"], x["name"]))


def rebuild_image_list():
    """Rebuild IMAGE_LIST from disk, re-sort, and bump DATASET_VERSION."""
    with _state_lock:
        IMAGE_LIST.clear()
        IMAGE_LIST.extend(build_image_list())
    sort_image_list()
    STATE["DATASET_VERSION"] += 1


def refresh_image_mtime(split, name):
    """Update mtime for a specific image after edit/save.
    No re-sort, no version bump — user stays exactly where they are."""
    for item in IMAGE_LIST:
        if item["split"] == split and item["name"] == name:
            img_path = os.path.join(STATE["DATASET_DIR"], "images", split, name)
            lbl_path = get_label_path(split, name)
            img_mt = os.path.getmtime(img_path) if os.path.exists(img_path) else 0
            lbl_mt = os.path.getmtime(lbl_path) if os.path.exists(lbl_path) else 0
            item["mtime"] = max(img_mt, lbl_mt)
            break


def get_filtered(filt, class_filter=-1):
    """Filter IMAGE_LIST by split and class."""
    if filt == 'train':
        lst = [x for x in IMAGE_LIST if x["split"] == 'train']
    elif filt == 'val':
        lst = [x for x in IMAGE_LIST if x["split"] == 'val']
    elif filt == 'empty':
        lst = [x for x in IMAGE_LIST if x["boxes"] == 0]
    else:
        lst = list(IMAGE_LIST)
    if class_filter >= 0:
        lst = [x for x in lst if class_filter in x["classes"]]
    return lst


def get_stats():
    """Get dataset statistics."""
    total = len(IMAGE_LIST)
    train_count = sum(1 for x in IMAGE_LIST if x["split"] == "train")
    val_count = sum(1 for x in IMAGE_LIST if x["split"] == "val")
    empty = sum(1 for x in IMAGE_LIST if x["boxes"] == 0)
    class_counts = {}
    for item in IMAGE_LIST:
        lbl = get_label_path(item["split"], item["name"])
        if os.path.exists(lbl):
            with open(lbl) as f:
                for line in f:
                    parts = line.strip().split()
                    if len(parts) == 5:
                        cls = int(parts[0])
                        class_counts[cls] = class_counts.get(cls, 0) + 1
    return {
        "total": total, "train": train_count, "val": val_count,
        "empty": empty, "annotated": total - empty,
        "total_boxes": sum(class_counts.values()),
        "class_counts": class_counts
    }


# ============================================================
# FILESYSTEM WATCHERS (inotify)
# ============================================================

def start_watchers():
    """Start inotify watchers on dataset, live, and video directories."""
    try:
        import inotify.adapters
    except ImportError:
        print("  inotify not available, falling back to polling")
        _start_polling_watchers()
        return

    def _watch_dataset():
        import inotify.adapters
        while True:
            try:
                i = inotify.adapters.InotifyTrees(
                    [os.path.join(STATE["DATASET_DIR"], "images"), os.path.join(STATE["DATASET_DIR"], "labels")],
                    mask=inotify.constants.IN_CREATE | inotify.constants.IN_DELETE |
                         inotify.constants.IN_MOVED_TO | inotify.constants.IN_MOVED_FROM
                )
                for event in i.event_gen(yield_nones=False):
                    (_, type_names, path, filename) = event
                    if filename.endswith(('.jpg', '.jpeg', '.png', '.webp', '.txt')):
                        rebuild_image_list()
            except Exception as e:
                print(f"  Dataset watcher error: {e}")
                time.sleep(5)

    def _watch_live():
        import inotify.adapters
        while True:
            live_dir = conf("LIVE_DIR")
            if not live_dir or not os.path.exists(live_dir):
                time.sleep(5)
                continue
            try:
                i = inotify.adapters.Inotify()
                i.add_watch(live_dir,
                    mask=inotify.constants.IN_CREATE | inotify.constants.IN_DELETE |
                         inotify.constants.IN_MOVED_TO)
                for event in i.event_gen(yield_nones=False):
                    (_, type_names, path, filename) = event
                    if filename.endswith(('.webp', '.jpg', '.png')):
                        scan_live_images("all", 24)
                        STATE["LIVE_VERSION"] += 1
            except Exception as e:
                print(f"  Live watcher error: {e}")
                time.sleep(5)

    def _watch_video():
        import inotify.adapters
        while True:
            exports_dir = conf("EXPORTS_DIR")
            if not exports_dir or not os.path.exists(exports_dir):
                time.sleep(5)
                continue
            try:
                i = inotify.adapters.Inotify()
                i.add_watch(exports_dir,
                    mask=inotify.constants.IN_CREATE | inotify.constants.IN_DELETE |
                         inotify.constants.IN_MOVED_TO)
                for event in i.event_gen(yield_nones=False):
                    scan_video_exports()
                    STATE["VIDEO_VERSION"] += 1
            except Exception as e:
                print(f"  Video watcher error: {e}")
                time.sleep(5)

    for fn in [_watch_dataset, _watch_live, _watch_video]:
        t = threading.Thread(target=fn, daemon=True)
        t.start()
    print("  Watchers: inotify active")


def _start_polling_watchers():
    """Fallback polling if inotify not available."""
    def _poll():
        last_dataset_count = len(IMAGE_LIST)
        last_live_count = len(LIVE_ALL)
        last_video_count = len(VIDEO_LIST)
        while True:
            time.sleep(2)
            try:
                new_list = build_image_list()
                if len(new_list) != last_dataset_count:
                    rebuild_image_list()
                    last_dataset_count = len(IMAGE_LIST)
                scan_live_images("all", 24)
                if len(LIVE_ALL) != last_live_count:
                    STATE["LIVE_VERSION"] += 1
                    last_live_count = len(LIVE_ALL)
                scan_video_exports()
                if len(VIDEO_LIST) != last_video_count:
                    STATE["VIDEO_VERSION"] += 1
                    last_video_count = len(VIDEO_LIST)
            except Exception:
                pass

    t = threading.Thread(target=_poll, daemon=True)
    t.start()
    print("  Watchers: polling fallback (2s)")
