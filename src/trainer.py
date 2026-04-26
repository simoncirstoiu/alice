# ============================================================
# TRAINER FUNCTIONS
# ============================================================

import glob
import json
import os
import random
import shutil
import sqlite3
from collections import defaultdict
from pathlib import Path

from .header import (
    CLASS_NAMES, CONF, CONF_DEFAULTS, STATE, LogCapture, STEP_STATUS, TRAINER_LOG, conf,
    resolve_device,
)
from .core import box_iou, read_boxes, write_boxes
from .ai_phash_video import compute_phash

def _log(msg):
    """Append a message to the trainer log buffer."""
    TRAINER_LOG.append(msg)


def _glob_images(directory):
    """Return sorted list of all image paths in a directory (jpg/jpeg/png/webp)."""
    paths = []
    for ext in ('*.jpg', '*.jpeg', '*.png', '*.webp'):
        paths.extend(glob.glob(os.path.join(directory, ext)))
    return sorted(set(paths))

def _ss(step):
    """Get the status dict for a specific step."""
    return STEP_STATUS[step]

def _ss_set(step, **kwargs):
    """Update fields on a step's status dict (in-place mutation)."""
    s = STEP_STATUS[step]
    for k, v in kwargs.items():
        s[k] = v

def _ss_reset(step, **kwargs):
    """Reset a step's status to defaults then apply overrides."""
    s = STEP_STATUS[step]
    s.clear()
    s.update({"running": False, "progress": 0, "current": 0, "total": 0, "message": "", "epochs": []})
    s.update(kwargs)

def trainer_export_dataset(max_images=0):
    """Export snapshots from Frigate DB WITHOUT annotation. Dedup first, annotate later."""
    import sqlite3
    import cv2

    frigate_db = conf("FRIGATE_DB")
    clips_dir = conf("LIVE_DIR")

    if not os.path.exists(frigate_db):
        return {"ok": False, "error": f"Frigate DB not found: {frigate_db}"}

    _log(f"{'=' * 50}")
    _log(f"EXPORT: Starting")
    _log(f"  Frigate DB: {frigate_db}")
    _log(f"  Clips dir: {clips_dir}")
    _log(f"  Dataset: {STATE['DATASET_DIR']}")

    _ss_reset("export", running=True, progress=0, current=0, total=0, message="Loading Frigate DB...")

    conn = sqlite3.connect(frigate_db)
    rows = conn.execute(
        "SELECT id, camera FROM event WHERE has_snapshot = 1 ORDER BY start_time DESC"
    ).fetchall()
    conn.close()

    if not rows:
        _ss_reset("export", running=False, progress=0, current=0, total=0, message="No events found")
        return {"ok": False, "error": "No events with snapshots found"}

    # Limit: pick newest images, round-robin across cameras for even distribution
    if max_images > 0 and max_images < len(rows):
        from collections import defaultdict as _dd
        cam_buckets = _dd(list)
        for r in rows:
            cam_buckets[r[1]].append(r)
        selected = []
        cameras = list(cam_buckets.keys())
        idx = 0
        while len(selected) < max_images:
            cam = cameras[idx % len(cameras)]
            if cam_buckets[cam]:
                selected.append(cam_buckets[cam].pop(0))
            else:
                cameras.remove(cam)
                if not cameras:
                    break
            idx += 1
        rows = selected

    total = len(rows)
    _ss("export")["total"] = total
    _ss("export")["message"] = f"Found {total} events. Exporting..."

    # Ensure dataset dirs exist (don't wipe — allow reuse)
    for split in ["train", "val"]:
        os.makedirs(os.path.join(STATE["DATASET_DIR"], "images", split), exist_ok=True)
        os.makedirs(os.path.join(STATE["DATASET_DIR"], "labels", split), exist_ok=True)

    import random
    camera_map = {}
    exported, skipped, existing = 0, 0, 0

    # Pre-compute train/val split — guarantee at least 1 val image
    random.shuffle(rows)
    n_val = max(1, len(rows) // 10)  # 10%, minimum 1
    val_ids = set(r[0] for r in rows[:n_val])

    for idx, (event_id, camera) in enumerate(rows):
        # Check stop
        if not _ss("export").get("running", False):
            _ss("export")["message"] = f"Stopped at {idx}/{total}. Exported {exported} images."
            break

        _ss("export")["current"] = idx + 1
        _ss("export")["progress"] = int((idx + 1) / total * 100)
        _ss("export")["message"] = f"Exporting {idx+1}/{total}: {exported} new, {existing} existing"

        img_path = None
        for ext in ["clean.webp", "clean.png"]:
            candidate = os.path.join(clips_dir, f"{camera}-{event_id}-{ext}")
            if os.path.exists(candidate):
                img_path = candidate
                break
        if img_path is None:
            skipped += 1
            continue

        split = "val" if event_id in val_ids else "train"
        out_img = os.path.join(STATE["DATASET_DIR"], "images", split, f"{event_id}.jpg")

        # Skip if already exists (reuse)
        if os.path.exists(out_img):
            existing += 1
            camera_map[event_id] = camera
            continue

        img_data = cv2.imread(img_path)
        if img_data is None:
            skipped += 1
            continue

        cv2.imwrite(out_img, img_data, [cv2.IMWRITE_JPEG_QUALITY, 95])
        # Create empty label
        out_label = os.path.join(STATE["DATASET_DIR"], "labels", split, f"{event_id}.txt")
        if not os.path.exists(out_label):
            with open(out_label, "w") as f:
                pass
        exported += 1
        camera_map[event_id] = camera

    # Save camera map for dedup
    camera_map_path = os.path.join(STATE["DATASET_DIR"], "camera_map.json")
    with open(camera_map_path, "w") as f:
        json.dump(camera_map, f)

    _write_dataset_yaml()

    _ss_reset("export",
        running=False,
        progress=100,
        current=total,
        total=total,
        message=f"Done: {exported} new, {existing} reused, {skipped} skipped",
        result={"ok": True, "exported": exported, "existing": existing, "skipped": skipped})

    _log(f"EXPORT: COMPLETED — {exported} new, {existing} reused, {skipped} skipped")

    return {"ok": True, "exported": exported, "existing": existing, "skipped": skipped}


def trainer_reannotate(teacher_path, confidence, allowed_classes, merge=False):
    """Re-annotate existing dataset images with teacher model."""
    from ultralytics import YOLO

    if not os.path.exists(teacher_path):
        return {"ok": False, "error": f"Teacher model not found: {teacher_path}"}

    _log(f"{'=' * 50}")
    _log(f"ANNOTATE: Starting")
    _log(f"  Teacher: {os.path.basename(teacher_path)}")
    _log(f"  Confidence: {confidence}")
    _log(f"  Classes: {allowed_classes}")
    _log(f"  Merge: {merge}")

    _ss_reset("annotate", running=True, progress=0, current=0, total=0, message="Loading teacher model...")

    teacher = YOLO(teacher_path)
    annotated, empty, total_boxes, total_added, total_skipped = 0, 0, 0, 0, 0
    total_images = 0

    # Count total images first
    all_images = []
    for split in ["train", "val"]:
        images_dir = os.path.join(STATE["DATASET_DIR"], "images", split)
        if not os.path.exists(images_dir):
            continue
        for img_path in _glob_images(images_dir):
            all_images.append((split, img_path))

    _ss("annotate")["total"] = len(all_images)
    _ss("annotate")["message"] = f"Annotating {len(all_images)} images..."

    for idx, (split, img_path) in enumerate(all_images):
        if not _ss("annotate").get("running", False):
            _ss("annotate")["message"] = f"Stopped at {idx}/{len(all_images)}"
            break

        _ss("annotate")["current"] = idx + 1
        _ss("annotate")["progress"] = int((idx + 1) / len(all_images) * 100)
        _ss("annotate")["message"] = f"Annotating {idx+1}/{len(all_images)}: {annotated} with boxes"

        labels_dir = os.path.join(STATE["DATASET_DIR"], "labels", split)

        results = teacher.predict(img_path, conf=confidence, verbose=False)
        new_boxes = []
        for r in results:
            for b in r.boxes:
                cls_id = int(b.cls[0])
                if cls_id not in allowed_classes:
                    continue
                xc, yc, w, h = b.xywhn[0].tolist()
                new_boxes.append((cls_id, xc, yc, w, h))

        stem = Path(img_path).stem
        label_path = os.path.join(labels_dir, f"{stem}.txt")

        if merge:
            existing = read_boxes(label_path)
            added, skip = 0, 0
            for nb in new_boxes:
                nb_dict = {"cls": nb[0], "xc": nb[1], "yc": nb[2], "w": nb[3], "h": nb[4]}
                overlaps = any(
                    nb[0] == eb["cls"] and box_iou(nb_dict, eb) > 0.5
                    for eb in existing
                )
                if not overlaps:
                    existing.append(nb_dict)
                    added += 1
                else:
                    skip += 1
            write_boxes(label_path, existing)
            total_added += added
            total_skipped += skip
            total_boxes += len(existing)
            if existing:
                annotated += 1
            else:
                empty += 1
        else:
            boxes_dicts = [{"cls": b[0], "xc": b[1], "yc": b[2], "w": b[3], "h": b[4]} for b in new_boxes]
            write_boxes(label_path, boxes_dicts)
            total_boxes += len(new_boxes)
            if new_boxes:
                annotated += 1
            else:
                empty += 1
        total_images += 1

    _ss_reset("annotate",
        running=False,
        progress=100,
        current=len(all_images),
        total=len(all_images),
        message=f"Done: {annotated} annotated, {empty} empty, {total_boxes} boxes",
        result={"ok": True, "images": total_images, "annotated": annotated, "empty": empty, "total_boxes": total_boxes, "added": total_added, "skipped": total_skipped})

    _log(f"ANNOTATE: COMPLETED — {total_images} images, {annotated} annotated, {empty} empty, {total_boxes} total boxes")

    return {
        "ok": True, "images": total_images, "annotated": annotated,
        "empty": empty, "total_boxes": total_boxes,
        "added": total_added, "skipped": total_skipped
    }


def trainer_dedup_run(boxes=False, phash=False, nms=False, box_iou=0.1, hamming=10, nms_iou=0.85, dry_run=False):
    """Run dedup pipeline as async step with stop support and _ss("dedup") progress."""

    steps_todo = []
    if boxes: steps_todo.append(('boxes', box_iou))
    if phash: steps_todo.append(('phash', hamming))
    if nms: steps_todo.append(('nms', nms_iou))

    total = len(steps_todo)
    if total == 0:
        return {"ok": True, "steps": []}

    _ss_reset("dedup", running=True, progress=0, current=0, total=total, message="Starting dedup...")
    _log(f"{'=' * 50}")
    _log(f"DEDUP: {total} sub-steps, dry_run={dry_run}")

    results = []
    for idx, (stype, param) in enumerate(steps_todo):
        if not _ss("dedup").get("running", False):
            _ss("dedup")["message"] = f"Stopped at step {idx}/{total}"
            _log(f"DEDUP: STOPPED at step {idx}/{total}")
            return {"ok": False, "error": "Stopped", "steps": results}

        _ss("dedup")["current"] = idx + 1
        _ss("dedup")["progress"] = int((idx) / total * 100)
        _ss("dedup")["message"] = f"Running {stype} ({idx+1}/{total})..."

        if stype == 'boxes':
            r = trainer_dedup_boxes(param, dry_run=dry_run)
        elif stype == 'phash':
            r = trainer_dedup_phash(int(param), dry_run=dry_run)
        elif stype == 'nms':
            r = trainer_nms_cleanup(param, dry_run=dry_run)
        else:
            continue
        results.append({"type": stype, **r})

    total_removed = sum(s.get("removed", 0) for s in results)
    _ss_reset("dedup",
        running=False,
        progress=100,
        current=total,
        total=total,
        message=f"Done: {total_removed} removed",
        result={"ok": True, "steps": results})
    _log(f"DEDUP: COMPLETED — {total_removed} total removed")
    return {"ok": True, "steps": results}


def trainer_dedup_boxes(iou_threshold, dry_run=False):
    """Deduplicate images per camera based on annotation similarity."""
    _log(f"{'=' * 50}")
    _log(f"DEDUP BOXES: IoU threshold={iou_threshold}, dry_run={dry_run}")
    camera_map = _load_camera_map()
    total_removed, total_kept = 0, 0
    dup_pairs = []

    all_image_count = 0
    for split in ["train", "val"]:
        images_dir = os.path.join(STATE["DATASET_DIR"], "images", split)
        if os.path.exists(images_dir):
            all_image_count += len(_glob_images(images_dir))

    processed = 0
    _ss_set("dedup", message=f"Box dedup: scanning {all_image_count} images...")

    for split in ["train", "val"]:
        images_dir = os.path.join(STATE["DATASET_DIR"], "images", split)
        labels_dir = os.path.join(STATE["DATASET_DIR"], "labels", split)
        if not os.path.exists(images_dir):
            continue

        image_files = _glob_images(images_dir)
        if not image_files:
            continue

        camera_groups = defaultdict(list)
        for img_path in image_files:
            event_id = Path(img_path).stem
            camera = camera_map.get(event_id, "unknown")
            label_path = os.path.join(labels_dir, f"{event_id}.txt")
            boxes = read_boxes(label_path)
            camera_groups[camera].append((img_path, label_path, boxes))

        for camera, items in camera_groups.items():
            kept = []
            for img_path, label_path, boxes in items:
                if not _ss("dedup").get("running", False):
                    return {"ok": False, "error": "Stopped", "removed": total_removed, "kept": total_kept, "pairs": len(dup_pairs)}
                is_dup = False
                for kept_img, _, kept_boxes in kept:
                    if _is_annotation_duplicate(boxes, kept_boxes, iou_threshold):
                        is_dup = True
                        if dry_run:
                            dup_pairs.append((img_path, kept_img, camera, split))
                        break
                if is_dup and not dry_run:
                    os.remove(img_path)
                    if os.path.exists(label_path):
                        os.remove(label_path)
                    total_removed += 1
                elif is_dup:
                    total_removed += 1
                else:
                    kept.append((img_path, label_path, boxes))
                processed += 1
                if processed % 10 == 0 or processed == all_image_count:
                    pct = int(processed / max(all_image_count, 1) * 100)
                    _ss_set("dedup", message=f"Box dedup: {processed}/{all_image_count}, {total_removed} dupes — {camera} ({split})", progress=pct)
            total_kept += len(kept)

    _log(f"DEDUP BOXES: COMPLETED — {total_removed} removed, {total_kept} kept")
    return {"ok": True, "removed": total_removed, "kept": total_kept, "pairs": len(dup_pairs)}


def trainer_dedup_phash(hamming_threshold, dry_run=False):
    """Deduplicate images per camera using perceptual hash (cross-split), then redistribute 90/10."""
    _log(f"{'=' * 50}")
    _log(f"DEDUP pHASH: hamming_threshold={hamming_threshold}, dry_run={dry_run}")
    camera_map = _load_camera_map()
    total_removed, total_kept = 0, 0

    try:
        import numpy as np
    except ImportError:
        return {"ok": False, "error": "numpy required for pHash dedup"}

    # Count total images across splits for progress
    all_image_count = 0
    for split in ["train", "val"]:
        images_dir = os.path.join(STATE["DATASET_DIR"], "images", split)
        if os.path.exists(images_dir):
            all_image_count += len(_glob_images(images_dir))

    processed = 0
    _ss_set("dedup", message=f"pHash: hashing {all_image_count} images...")

    # Collect all images per camera across both splits
    camera_groups = defaultdict(list)
    for split in ["train", "val"]:
        images_dir = os.path.join(STATE["DATASET_DIR"], "images", split)
        labels_dir = os.path.join(STATE["DATASET_DIR"], "labels", split)
        if not os.path.exists(images_dir):
            continue
        for img_path in _glob_images(images_dir):
            event_id = Path(img_path).stem
            camera = camera_map.get(event_id, "unknown")
            label_path = os.path.join(labels_dir, f"{event_id}.txt")
            camera_groups[camera].append((img_path, label_path, split))

    # Phase 1: deduplicate cross-split per camera
    kept_all = []  # list of (img_path, label_path, current_split)

    for camera, items in camera_groups.items():
        hashes = []
        valid_items = []
        for img_path, label_path, split in items:
            if not _ss("dedup").get("running", False):
                return {"ok": False, "error": "Stopped", "removed": total_removed, "kept": total_kept}
            h = compute_phash(img_path)
            if h is not None:
                hashes.append(h)
                valid_items.append((img_path, label_path, split))
            processed += 1
            if processed % 10 == 0 or processed == all_image_count:
                pct = int(processed / max(all_image_count, 1) * 50)
                _ss_set("dedup", message=f"pHash: {processed}/{all_image_count} hashed, {total_removed} dupes — {camera}", progress=pct)

        kept_hashes = []
        removed = 0

        for i, (img_path, label_path, split) in enumerate(valid_items):
            is_dup = False
            for kh in kept_hashes:
                dist = bin(hashes[i] ^ kh).count('1')
                if dist <= hamming_threshold:
                    is_dup = True
                    break
            if is_dup:
                if not dry_run:
                    os.remove(img_path)
                    if os.path.exists(label_path):
                        os.remove(label_path)
                removed += 1
            else:
                kept_hashes.append(hashes[i])
                kept_all.append((img_path, label_path, split))

        total_removed += removed
        total_kept += len(kept_hashes)
        _ss_set("dedup", message=f"pHash: {camera} — {removed} removed, {len(kept_hashes)} kept")

    # Phase 2: redistribute kept images 90/10 train/val
    if not dry_run and kept_all:
        _ss_set("dedup", message=f"pHash: redistributing {len(kept_all)} images 90/10...", progress=80)
        _log(f"DEDUP pHASH: redistributing {len(kept_all)} images 90/10...")

        random.shuffle(kept_all)
        val_count = max(1, round(len(kept_all) * 0.1))
        train_count = len(kept_all) - val_count
        moved = 0

        for idx, (img_path, label_path, current_split) in enumerate(kept_all):
            target_split = "val" if idx < val_count else "train"
            if target_split == current_split:
                continue

            # Move image
            event_id = Path(img_path).stem
            ext = Path(img_path).suffix
            target_img_dir = os.path.join(STATE["DATASET_DIR"], "images", target_split)
            target_lbl_dir = os.path.join(STATE["DATASET_DIR"], "labels", target_split)
            os.makedirs(target_img_dir, exist_ok=True)
            os.makedirs(target_lbl_dir, exist_ok=True)

            target_img = os.path.join(target_img_dir, f"{event_id}{ext}")
            target_lbl = os.path.join(target_lbl_dir, f"{event_id}.txt")

            shutil.move(img_path, target_img)
            if os.path.exists(label_path):
                shutil.move(label_path, target_lbl)
            moved += 1

        _log(f"DEDUP pHASH: redistributed — {moved} moved, {train_count} train / {val_count} val")
        _ss_set("dedup", message=f"pHash: done — {total_removed} removed, {moved} redistributed ({train_count}T/{val_count}V)", progress=100)

    _log(f"DEDUP pHASH: COMPLETED — {total_removed} removed, {total_kept} kept")
    return {"ok": True, "removed": total_removed, "kept": total_kept}


def trainer_nms_cleanup(iou_threshold, dry_run=False):
    """Remove overlapping same-class boxes from all label files."""
    _log(f"{'=' * 50}")
    _log(f"DEDUP NMS: IoU threshold={iou_threshold}, dry_run={dry_run}")
    total_modified, total_removed = 0, 0

    all_labels = []
    for split in ["train", "val"]:
        labels_dir = os.path.join(STATE["DATASET_DIR"], "labels", split)
        if os.path.exists(labels_dir):
            all_labels.extend(sorted(glob.glob(os.path.join(labels_dir, "*.txt"))))

    _ss_set("dedup", message=f"NMS: scanning {len(all_labels)} label files...")

    for idx, label_path in enumerate(all_labels):
        if not _ss("dedup").get("running", False):
            return {"ok": False, "error": "Stopped", "modified": total_modified, "removed": total_removed}
        boxes = read_boxes(label_path)
        if len(boxes) <= 1:
            continue

        sorted_boxes = sorted(boxes, key=lambda b: b['w'] * b['h'], reverse=True)
        kept = []
        removed = 0

        for bx in sorted_boxes:
            suppressed = False
            for kb in kept:
                if bx['cls'] != kb['cls']:
                    continue
                if box_iou(bx, kb) > iou_threshold:
                    suppressed = True
                    removed += 1
                    break
            if not suppressed:
                kept.append(bx)

        if removed > 0:
            if not dry_run:
                write_boxes(label_path, kept)
            total_modified += 1
            total_removed += removed

        if (idx + 1) % 20 == 0 or idx == len(all_labels) - 1:
            pct = int((idx + 1) / max(len(all_labels), 1) * 100)
            _ss_set("dedup", message=f"NMS: {idx+1}/{len(all_labels)}, {total_removed} boxes removed from {total_modified} files", progress=pct)

    _log(f"DEDUP NMS: COMPLETED — {total_removed} boxes removed from {total_modified} files")
    return {"ok": True, "modified": total_modified, "removed": total_removed}


def trainer_train(model_path, epochs, batch_size, lr, lr_final, imgsz, freeze, augment=True):
    """Fine-tune a YOLO model on the current dataset."""
    from ultralytics import YOLO

    if not os.path.exists(model_path):
        return {"ok": False, "error": f"Model not found: {model_path}"}

    _log(f"{'=' * 50}")
    _log(f"TRAIN: Starting")
    _log(f"  Model: {os.path.basename(model_path)}")
    _log(f"  Epochs: {epochs}, Batch: {batch_size}, LR: {lr}, ImgSz: {imgsz}, Augmentation: {'ON' if augment else 'OFF'}")

    _ss_reset("train", running=True, progress=0, current=0, total=epochs, message="Loading model...", epochs=[])

    yaml_path = os.path.join(STATE["DATASET_DIR"], "dataset.yaml")
    _write_dataset_yaml()  # Always rewrite to ensure correct path

    # YOLO requires at least 1 image in val split
    val_img_dir = os.path.join(STATE["DATASET_DIR"], "images", "val")
    if not _glob_images(val_img_dir):
        train_images = _glob_images(os.path.join(STATE["DATASET_DIR"], "images", "train"))
        if not train_images:
            return {"ok": False, "error": "No images in dataset"}
        # Move 10% (min 1) from train to val
        n = max(1, len(train_images) // 10)
        import random as _rnd
        for img in _rnd.sample(train_images, min(n, len(train_images))):
            name = os.path.basename(img)
            stem = os.path.splitext(name)[0]
            shutil.move(img, os.path.join(val_img_dir, name))
            src_lbl = os.path.join(STATE["DATASET_DIR"], "labels", "train", stem + ".txt")
            dst_lbl = os.path.join(STATE["DATASET_DIR"], "labels", "val", stem + ".txt")
            if os.path.exists(src_lbl):
                shutil.move(src_lbl, dst_lbl)
        _log(f"TRAIN: Val was empty — moved {n} images from train to val")

    output_dir = os.path.join(os.path.dirname(STATE["DATASET_DIR"]), "output")
    models_dir = conf("MODELS_DIR")
    os.makedirs(output_dir, exist_ok=True)
    os.makedirs(models_dir, exist_ok=True)

    _ss("train")["message"] = f"Training {Path(model_path).name} for {epochs} epochs..."

    model = YOLO(model_path)

    # YOLO callback — after VALIDATION so mAP is available
    def _on_fit_epoch_end(trainer):
        try:
            epoch = trainer.epoch + 1
            _ss("train")["current"] = epoch
            _ss("train")["progress"] = int(epoch / epochs * 100)

            # Loss from training
            loss = trainer.loss_items if hasattr(trainer, 'loss_items') else None
            epoch_data = {"epoch": epoch}
            if loss is not None:
                try:
                    epoch_data["box_loss"] = round(float(loss[0]), 4)
                    epoch_data["cls_loss"] = round(float(loss[1]), 4)
                    epoch_data["dfl_loss"] = round(float(loss[2]), 4)
                except (IndexError, TypeError):
                    pass

            # mAP from validator (available after validation pass)
            if hasattr(trainer, 'validator') and trainer.validator and hasattr(trainer.validator, 'metrics'):
                vm = trainer.validator.metrics
                if hasattr(vm, 'results_dict'):
                    rd = vm.results_dict
                    epoch_data["mAP50"] = round(float(rd.get("metrics/mAP50(B)", 0)), 4)
                    epoch_data["mAP50_95"] = round(float(rd.get("metrics/mAP50-95(B)", 0)), 4)
                elif hasattr(vm, 'mean_results'):
                    mr = vm.mean_results()
                    if len(mr) >= 4:
                        epoch_data["mAP50"] = round(float(mr[2]), 4)
                        epoch_data["mAP50_95"] = round(float(mr[3]), 4)

            # Fallback: trainer.metrics dict
            if "mAP50" not in epoch_data or not epoch_data.get("mAP50"):
                metrics = trainer.metrics if hasattr(trainer, 'metrics') else {}
                if metrics:
                    epoch_data["mAP50"] = round(float(metrics.get("metrics/mAP50(B)", 0)), 4)
                    epoch_data["mAP50_95"] = round(float(metrics.get("metrics/mAP50-95(B)", 0)), 4)

            if "epochs" not in _ss("train"):
                _ss("train")["epochs"] = []

            # Update existing epoch entry or append new one (avoid duplicates)
            existing = next((e for e in _ss("train")["epochs"] if e.get("epoch") == epoch), None)
            if existing:
                existing.update(epoch_data)
            else:
                _ss("train")["epochs"].append(epoch_data)

            _ss("train")["message"] = f"Epoch {epoch}/{epochs} complete"
            if epoch_data.get("mAP50"):
                _ss("train")["message"] += f" — mAP50: {epoch_data['mAP50']:.3f}"

            # Reset batch counters for next epoch
            _ss("train")["batch"] = 0
            _ss("train")["batch_total"] = 0
            _ss("train")["batch_pct"] = 0

            # Check stop
            if not _ss("train").get("running", False):
                raise KeyboardInterrupt("Training stopped by user")
        except KeyboardInterrupt:
            raise
        except Exception as e:
            print(f"  Callback error: {e}")

    model.add_callback("on_fit_epoch_end", _on_fit_epoch_end)

    # Track batch count per epoch manually since trainer.batch_i may not exist in all YOLO versions
    _batch_state = [0, 0, 0]  # [current_epoch, batch_count, cached_nb]

    def _on_train_batch_end(trainer):
        try:
            epoch = trainer.epoch + 1

            # Reset batch counter when epoch changes
            if _batch_state[0] != epoch:
                _batch_state[0] = epoch
                _batch_state[1] = 0
            _batch_state[1] += 1
            batch_i = _batch_state[1]

            # Get total batches — try multiple approaches, cache once found
            nb = _batch_state[2]
            if nb <= 0:
                # Try train_loader length
                try:
                    if hasattr(trainer, 'train_loader') and trainer.train_loader is not None:
                        nb = len(trainer.train_loader)
                except Exception:
                    pass
                # Try nb attribute (some YOLO versions)
                if nb <= 0 and hasattr(trainer, 'nb'):
                    nb = int(trainer.nb)
                # Fallback: estimate from dataset size / batch_size
                if nb <= 0 and hasattr(trainer, 'trainset') and hasattr(trainer, 'batch_size'):
                    try:
                        ds_len = len(trainer.trainset)
                        nb = (ds_len + trainer.batch_size - 1) // trainer.batch_size
                    except Exception:
                        pass
                # Last resort: parse from log lines (YOLO logs "X/804" format)
                if nb <= 0 and TRAINER_LOG:
                    import re as _re
                    for log_line in reversed(TRAINER_LOG[-20:]):
                        m = _re.search(r'\d+/(\d+)', log_line)
                        if m:
                            candidate = int(m.group(1))
                            if candidate > 10:  # sanity check — must be more than epoch count
                                nb = candidate
                                break
                if nb > 0:
                    _batch_state[2] = nb

            batch_pct = int(batch_i / nb * 100) if nb > 0 else 0

            # Granular progress: completed epochs + fraction of current epoch
            completed_epochs = len(_ss("train").get("epochs", []))
            epoch_fraction = (batch_i / nb) * 0.85 if nb > 0 else 0
            overall_progress = int((completed_epochs + epoch_fraction) / epochs * 100)

            _ss("train")["current"] = epoch
            _ss("train")["progress"] = min(overall_progress, 99)
            _ss("train")["batch"] = batch_i
            _ss("train")["batch_total"] = nb
            _ss("train")["batch_pct"] = batch_pct
            _ss("train")["message"] = f"Epoch {epoch}/{epochs} — {min(overall_progress, 99)}% overall"

            # Check stop
            if not _ss("train").get("running", False):
                raise KeyboardInterrupt("Training stopped by user")
        except KeyboardInterrupt:
            raise
        except Exception:
            pass

    model.add_callback("on_train_batch_end", _on_train_batch_end)

    # Capture all YOLO output to log buffer, not console
    aug_params = {
        "fliplr": 0.5, "flipud": 0.0, "mosaic": 1.0, "mixup": 0.15,
        "degrees": 10.0, "translate": 0.1, "scale": 0.5,
        "hsv_h": 0.015, "hsv_s": 0.7, "hsv_v": 0.4,
    } if augment else {
        "fliplr": 0.0, "flipud": 0.0, "mosaic": 0.0, "mixup": 0.0,
        "degrees": 0.0, "translate": 0.0, "scale": 0.0,
        "hsv_h": 0.0, "hsv_s": 0.0, "hsv_v": 0.0,
    }
    with LogCapture():
        try:
            train_device = 0 if resolve_device() == "nvidia" else "cpu"
            model.train(
                data=yaml_path,
                epochs=epochs,
                imgsz=imgsz,
                batch=batch_size,
                lr0=lr,
                lrf=lr_final,
                warmup_epochs=1,
                freeze=freeze,
                project=output_dir,
                name="finetune",
                exist_ok=True,
                verbose=True,
                device=train_device,
                **aug_params,
            )
        except KeyboardInterrupt:
            _ss_reset("train", running=False, progress=_ss("train").get("progress", 0),
                current=_ss("train").get("current", 0), total=epochs,
                message=f"Stopped at epoch {_ss('train').get('current', 0)}/{epochs}",
                epochs=_ss("train").get("epochs", []))
            _log(f"TRAIN: STOPPED at epoch {_ss('train').get('current', 0)}/{epochs}")
            return {"ok": False, "error": "Training stopped by user"}
        except Exception as e:
            err_msg = str(e)[:200]
            _ss_reset("train", running=False, progress=_ss("train").get("progress", 0),
                current=_ss("train").get("current", 0), total=epochs,
                message=f"Error: {err_msg}",
                epochs=_ss("train").get("epochs", []))
            _log(f"TRAIN: FAILED — {err_msg}")
            return {"ok": False, "error": err_msg}

    best_pt = os.path.join(output_dir, "finetune", "weights", "best.pt")
    if os.path.exists(best_pt):
        base_name = Path(model_path).stem
        final_path = os.path.join(models_dir, f"{base_name}-finetuned.pt")
        shutil.copy2(best_pt, final_path)
        ep = _ss("train").get("epochs", [])
        last_map = ep[-1].get("mAP50", 0) if ep else 0
        _ss_reset("train", running=False, progress=100, current=epochs, total=epochs,
            message=f"Done: {final_path} (mAP50: {last_map:.3f})", epochs=ep,
            result={"ok": True, "output": final_path})
        _log(f"TRAIN: COMPLETED — {final_path} (mAP50: {last_map:.3f})")
        return {"ok": True, "output": final_path}
    else:
        _ss_reset("train", running=False, progress=100, current=epochs, total=epochs,
            message="Error: best.pt not found", epochs=_ss("train").get("epochs", []),
            result={"ok": False, "error": "Training completed but best.pt not found"})
        _log(f"TRAIN: FAILED — best.pt not found")
        return {"ok": False, "error": "Training completed but best.pt not found"}


def trainer_export_onnx(model_path, imgsz=640, opset=13, simplify=True, half=False, dynamic=False):
    """Export a .pt model to ONNX format."""
    from ultralytics import YOLO

    if not os.path.exists(model_path):
        return {"ok": False, "error": f"Model not found: {model_path}"}

    # FP16 only works on GPU — force off on CPU
    effective_device = resolve_device()
    if effective_device != "nvidia":
        half = False

    _log(f"{'=' * 50}")
    _log(f"ONNX EXPORT: {os.path.basename(model_path)}")
    _log(f"  ImgSz: {imgsz}, Opset: {opset}, Half: {half}, Dynamic: {dynamic}, Device: {effective_device}")

    _ss_reset("onnx",
        running=True,
        progress=50,
        current=0,
        total=1,
        message=f"Exporting {Path(model_path).name} to ONNX...")

    try:
        with LogCapture():
            model = YOLO(model_path)
            export_device = 0 if effective_device == "nvidia" else "cpu"
            output = model.export(
                format='onnx', imgsz=imgsz, opset=opset,
                simplify=simplify, half=half, dynamic=dynamic, device=export_device
            )
    except Exception as e:
        err_msg = str(e)[:200]
        _ss_reset("onnx", running=False, progress=100, current=1, total=1, message=f"Error: {err_msg}")
        _log(f"ONNX EXPORT: FAILED — {err_msg}")
        return {"ok": False, "error": err_msg}

    _ss_reset("onnx",
        running=False,
        progress=100,
        current=1,
        total=1,
        message=f"Done: {output}",
        result={"ok": True, "output": str(output)})
    _log(f"ONNX EXPORT: COMPLETED — {output}")
    return {"ok": True, "output": str(output)}


# ============================================================
# TRAINER HELPER FUNCTIONS
# ============================================================

def _write_dataset_yaml():
    """Write dataset.yaml with all 80 COCO classes."""
    yaml_path = os.path.join(STATE["DATASET_DIR"], "dataset.yaml")
    with open(yaml_path, "w") as f:
        f.write(f"path: {STATE['DATASET_DIR']}\n")
        f.write("train: images/train\n")
        f.write("val: images/val\n\n")
        f.write("names:\n")
        for cls_id in sorted(CLASS_NAMES.keys()):
            f.write(f"  {cls_id}: {CLASS_NAMES[cls_id]}\n")


def _load_camera_map():
    """Load camera_map.json from current dataset."""
    camera_map_path = os.path.join(STATE["DATASET_DIR"], "camera_map.json")
    if os.path.exists(camera_map_path):
        with open(camera_map_path) as f:
            return json.load(f)
    return {}


def _is_annotation_duplicate(boxes_a, boxes_b, iou_threshold):
    """Check if two annotation sets are duplicates."""
    if len(boxes_a) != len(boxes_b):
        return False
    if len(boxes_a) == 0:
        return True
    classes_a = sorted([b['cls'] for b in boxes_a])
    classes_b = sorted([b['cls'] for b in boxes_b])
    if classes_a != classes_b:
        return False
    used = set()
    for ba in boxes_a:
        best_iou, best_idx = 0, -1
        for i, bb in enumerate(boxes_b):
            if i in used or ba['cls'] != bb['cls']:
                continue
            iou = box_iou(ba, bb)
            if iou > best_iou:
                best_iou = iou
                best_idx = i
        if best_iou < iou_threshold:
            return False
        used.add(best_idx)
    return True
