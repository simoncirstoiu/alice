# ============================================================
# AI ANALYSIS FUNCTIONS
# ============================================================

import math
import os
from typing import Optional

from .header import (
    STATE, ai_lock,
    IMAGE_LIST, LIVE_ALL, LIVE_LIST,
    PHASH_CACHE, VIDEO_FRAME_CACHE, VIDEO_FRAME_CACHE_MAX, VIDEO_FRAME_CACHE_ORDER,
    VIDEO_INFO_CACHE,
)
from .core import box_iou, get_filtered, get_label_path, read_boxes, write_boxes

def run_ai_analyse(split, name, model_path, conf, classes):
    """Run AI detection on a dataset image, merge new boxes with existing."""
    from ultralytics import YOLO

    img_path = os.path.join(STATE["DATASET_DIR"], "images", split, name)
    if not os.path.exists(img_path):
        return {"ok": False, "error": "Image not found"}
    if not os.path.exists(model_path):
        return {"ok": False, "error": f"Model not found: {model_path}"}

    with ai_lock:
        if STATE["AI_MODEL"] is None or STATE["AI_MODEL_PATH"] != model_path:
            print(f"  Loading AI model: {model_path}")
            STATE["AI_MODEL"] = YOLO(model_path)
            STATE["AI_MODEL_PATH"] = model_path
        results = STATE["AI_MODEL"].predict(img_path, conf=conf, verbose=False)

    new_boxes = []
    for r in results:
        for b in r.boxes:
            cls_id = int(b.cls[0])
            if cls_id not in classes:
                continue
            xc, yc, w, h = b.xywhn[0].tolist()
            cf = float(b.conf[0])
            new_boxes.append({"cls": cls_id, "xc": xc, "yc": yc, "w": w, "h": h, "conf": cf})

    label_path = get_label_path(split, name)
    existing_boxes = read_boxes(label_path)

    added, skipped, skipped_boxes = 0, 0, []
    for nb in new_boxes:
        overlaps = False
        matched_idx = -1
        for ei, eb in enumerate(existing_boxes):
            if nb['cls'] != eb['cls']:
                continue
            if box_iou(nb, eb) > 0.5:
                overlaps = True
                matched_idx = ei
                break
        if not overlaps:
            existing_boxes.append(nb)
            added += 1
        else:
            skipped += 1
            skipped_boxes.append({"cls": nb["cls"], "xc": nb["xc"], "yc": nb["yc"],
                                  "w": nb["w"], "h": nb["h"], "conf": nb.get("conf", 0),
                                  "matched_idx": matched_idx})

    write_boxes(label_path, existing_boxes)

    for i, item in enumerate(IMAGE_LIST):
        if item["split"] == split and item["name"] == name:
            IMAGE_LIST[i]["boxes"] = len(existing_boxes)
            IMAGE_LIST[i]["classes"] = list(set(b["cls"] for b in existing_boxes))
            break

    return {"ok": True, "boxes": existing_boxes, "added": added, "skipped": skipped,
            "skipped_boxes": skipped_boxes, "total": len(existing_boxes)}


def run_ai_preview(img_path, model_path, conf, classes):
    """Run AI detection and return boxes without saving. Works for any image path."""
    from ultralytics import YOLO

    if not os.path.exists(img_path):
        return {"ok": False, "error": "Image not found"}
    if not os.path.exists(model_path):
        return {"ok": False, "error": "Model not found"}

    with ai_lock:
        if STATE["AI_MODEL"] is None or STATE["AI_MODEL_PATH"] != model_path:
            STATE["AI_MODEL"] = YOLO(model_path)
            STATE["AI_MODEL_PATH"] = model_path
        results = STATE["AI_MODEL"].predict(img_path, conf=conf, verbose=False)

    det_boxes = []
    for r in results:
        for b in r.boxes:
            cls_id = int(b.cls[0])
            if cls_id not in classes:
                continue
            xc, yc, w, h = b.xywhn[0].tolist()
            cf = float(b.conf[0])
            det_boxes.append({"cls": cls_id, "xc": xc, "yc": yc, "w": w, "h": h, "conf": cf})
    return {"ok": True, "boxes": det_boxes}


def run_batch_analyse(filter_type, model_path, conf, classes, class_filter):
    """Run AI on all filtered images."""
    filtered = get_filtered(filter_type, class_filter)
    results = {"processed": 0, "total_added": 0, "total_skipped": 0, "errors": 0}
    for item in filtered:
        r = run_ai_analyse(item["split"], item["name"], model_path, conf, classes)
        if r["ok"]:
            results["processed"] += 1
            results["total_added"] += r["added"]
            results["total_skipped"] += r["skipped"]
        else:
            results["errors"] += 1
    results["ok"] = True
    return results


# ============================================================
# pHASH - PERCEPTUAL HASHING FOR DUPLICATE DETECTION
# ============================================================

def _compute_phash_from_pixels(pixels: list, size: int = 32) -> int:
    """Compute 64-bit perceptual hash from a flat list of grayscale pixel values.

    Shared implementation used by both the main-thread ``compute_phash``
    and the multiprocessing ``_phash_worker``.
    """
    def dct1d(v):
        N = len(v)
        out = []
        for k in range(N):
            s = 0.0
            for n in range(N):
                s += v[n] * math.cos(math.pi * k * (2 * n + 1) / (2 * N))
            out.append(s)
        return out

    rows = [pixels[i * size:(i + 1) * size] for i in range(size)]
    dr = [dct1d(r) for r in rows]
    dc = [[0.0] * size for _ in range(size)]
    for j in range(size):
        col = [dr[i][j] for i in range(size)]
        cdct = dct1d(col)
        for i in range(size):
            dc[i][j] = cdct[i]
    low = []
    for i in range(8):
        for j in range(8):
            low.append(dc[i][j])
    med = sorted(low[1:])[len(low[1:]) // 2]
    h = 0
    for i, v in enumerate(low):
        if v > med:
            h |= (1 << (63 - i))
    return h


def compute_phash(path: str) -> Optional[int]:
    """Compute 64-bit perceptual hash using PIL + DCT."""
    if path in PHASH_CACHE:
        return PHASH_CACHE[path]
    try:
        from PIL import Image as PILImage
        im = PILImage.open(path).convert('L').resize((32, 32), PILImage.LANCZOS)
        pixels = list(im.get_flattened_data())
        im.close()
    except Exception:
        return None
    h = _compute_phash_from_pixels(pixels)
    PHASH_CACHE[path] = h
    return h


def phash_similarity(h1, h2):
    """Return similarity 0.0 - 1.0 (1.0 = identical)."""
    return 1.0 - (bin(h1 ^ h2).count('1') / 64.0)


def precompute_all_hashes():
    """Pre-compute pHash for all images in current dataset."""
    global PHASH_CACHE
    PHASH_CACHE = {}
    count = 0
    for split in ["train", "val"]:
        img_dir = os.path.join(STATE["DATASET_DIR"], "images", split)
        if not os.path.exists(img_dir):
            continue
        for img_file in sorted(os.listdir(img_dir)):
            if not img_file.lower().endswith(('.jpg', '.jpeg', '.png', '.webp')):
                continue
            compute_phash(os.path.join(img_dir, img_file))
            count += 1
    return count


def ensure_hashes_computed():
    """Compute hashes using multiprocessing for any images not yet cached."""
    # Evict deleted files from cache
    stale = [p for p in PHASH_CACHE if not os.path.exists(p)]
    for p in stale:
        del PHASH_CACHE[p]
    paths = []
    for split in ["train", "val"]:
        img_dir = os.path.join(STATE["DATASET_DIR"], "images", split)
        if not os.path.exists(img_dir):
            continue
        for img_file in sorted(os.listdir(img_dir)):
            if img_file.lower().endswith(('.jpg', '.jpeg', '.png', '.webp')):
                full = os.path.join(img_dir, img_file)
                if full not in PHASH_CACHE:
                    paths.append(full)
    if not paths:
        return
    try:
        from multiprocessing import Pool, cpu_count
        workers = min(cpu_count(), 8)
        with Pool(workers) as pool:
            results = pool.map(_phash_worker, paths)
        for path, h in zip(paths, results):
            if h is not None:
                PHASH_CACHE[path] = h
    except Exception:
        for p in paths:
            compute_phash(p)


def _phash_worker(path: str) -> Optional[int]:
    """Multiprocessing worker for pHash computation."""
    try:
        from PIL import Image as PILImage
        im = PILImage.open(path).convert('L').resize((32, 32), PILImage.LANCZOS)
        pixels = list(im.get_flattened_data())
        im.close()
    except Exception:
        return None
    return _compute_phash_from_pixels(pixels)


def find_similar_images(src_split, src_name, threshold=0.9):
    """Find images similar to source across entire dataset. Uses parallel hash computation."""
    ensure_hashes_computed()
    src_path = os.path.join(STATE["DATASET_DIR"], "images", src_split, src_name)
    src_hash = PHASH_CACHE.get(src_path)
    if src_hash is None:
        src_hash = compute_phash(src_path)
    if src_hash is None:
        return []
    # Compare from cache — all hashes are precomputed, this is instant
    results = []
    for cached_path, h in PHASH_CACHE.items():
        if cached_path == src_path:
            continue
        sim = phash_similarity(src_hash, h)
        if sim >= threshold:
            # Extract split and name from path
            parts = cached_path.replace(STATE["DATASET_DIR"] + "/images/", "").split("/", 1)
            if len(parts) == 2:
                results.append({"split": parts[0], "name": parts[1], "similarity": round(sim * 100, 1)})
    results.sort(key=lambda x: x["similarity"], reverse=True)
    return results


def find_similar_live(live_index, threshold=0.9):
    """Find images similar to a LIVE snapshot across the dataset."""
    ensure_hashes_computed()
    if live_index >= len(LIVE_ALL):
        return []
    src_path = LIVE_ALL[live_index]["path"]
    src_hash = compute_phash(src_path)
    if src_hash is None:
        return []
    results = []
    for cached_path, h in PHASH_CACHE.items():
        sim = phash_similarity(src_hash, h)
        if sim >= threshold:
            parts = cached_path.replace(STATE["DATASET_DIR"] + "/images/", "").split("/", 1)
            if len(parts) == 2:
                results.append({"split": parts[0], "name": parts[1], "similarity": round(sim * 100, 1)})
    results.sort(key=lambda x: x["similarity"], reverse=True)
    return results


# ============================================================
# VIDEO FUNCTIONS
# ============================================================

def get_video_info(video_path):
    """Get video metadata (fps, frames, resolution, duration)."""
    if video_path in VIDEO_INFO_CACHE:
        return VIDEO_INFO_CACHE[video_path]
    import cv2
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        return None
    info = {
        "fps": round(cap.get(cv2.CAP_PROP_FPS) or 25, 2),
        "total_frames": int(cap.get(cv2.CAP_PROP_FRAME_COUNT)),
        "width": int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)),
        "height": int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT)),
    }
    info["duration"] = round(info["total_frames"] / info["fps"], 2) if info["fps"] > 0 else 0
    cap.release()
    VIDEO_INFO_CACHE[video_path] = info
    return info


def extract_video_frame(video_path, frame_no):
    """Extract a single frame from video as JPEG bytes."""
    cache_key = f"{video_path}:{frame_no}"
    if cache_key in VIDEO_FRAME_CACHE:
        return VIDEO_FRAME_CACHE[cache_key]
    import cv2
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        return None
    cap.set(cv2.CAP_PROP_POS_FRAMES, frame_no)
    ret, frame = cap.read()
    cap.release()
    if not ret:
        return None
    _, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 100])
    data = buf.tobytes()
    VIDEO_FRAME_CACHE[cache_key] = data
    VIDEO_FRAME_CACHE_ORDER.append(cache_key)
    while len(VIDEO_FRAME_CACHE_ORDER) > VIDEO_FRAME_CACHE_MAX:
        oldest = VIDEO_FRAME_CACHE_ORDER.popleft()
        VIDEO_FRAME_CACHE.pop(oldest, None)
    return data


def export_video_frame(video_path, frame_no, dst_dataset, dst_split):
    """Export a video frame as JPG + empty label into a dataset."""
    import cv2
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        return {"ok": False, "error": "Cannot open video"}
    cap.set(cv2.CAP_PROP_POS_FRAMES, frame_no)
    ret, frame = cap.read()
    cap.release()
    if not ret:
        return {"ok": False, "error": "Cannot read frame"}
    video_name = os.path.splitext(os.path.basename(video_path))[0]
    dst_name = f"{video_name}_f{frame_no:06d}.jpg"
    dst_img_dir = os.path.join(dst_dataset, "images", dst_split)
    dst_lbl_dir = os.path.join(dst_dataset, "labels", dst_split)
    os.makedirs(dst_img_dir, exist_ok=True)
    os.makedirs(dst_lbl_dir, exist_ok=True)
    dst_img = os.path.join(dst_img_dir, dst_name)
    dst_lbl = os.path.join(dst_lbl_dir, os.path.splitext(dst_name)[0] + ".txt")
    if os.path.exists(dst_img):
        return {"ok": False, "error": "Frame already exported"}
    cv2.imwrite(dst_img, frame, [cv2.IMWRITE_JPEG_QUALITY, 100])
    with open(dst_lbl, "w") as f:
        pass
    return {"ok": True, "name": dst_name}


def run_video_frame_ai(video_path, frame_no, model_path, conf, classes):
    """Run AI detection on a video frame."""
    import cv2
    from ultralytics import YOLO

    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        return {"ok": False, "error": "Cannot open video"}
    cap.set(cv2.CAP_PROP_POS_FRAMES, frame_no)
    ret, frame = cap.read()
    cap.release()
    if not ret:
        return {"ok": False, "error": "Cannot read frame"}
    if not os.path.exists(model_path):
        return {"ok": False, "error": "Model not found"}

    with ai_lock:
        if STATE["AI_MODEL"] is None or STATE["AI_MODEL_PATH"] != model_path:
            STATE["AI_MODEL"] = YOLO(model_path)
            STATE["AI_MODEL_PATH"] = model_path
        results = STATE["AI_MODEL"].predict(frame, conf=conf, verbose=False)

    det_boxes = []
    for r in results:
        for b in r.boxes:
            cls_id = int(b.cls[0])
            if cls_id not in classes:
                continue
            xc, yc, w, h = b.xywhn[0].tolist()
            cf = float(b.conf[0])
            det_boxes.append({"cls": cls_id, "xc": xc, "yc": yc, "w": w, "h": h, "conf": cf})
    return {"ok": True, "boxes": det_boxes}
