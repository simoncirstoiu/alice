# ============================================================
# API HANDLERS — dataset, live, video, AI, settings, deps
# ============================================================

import json
import os
import shutil
import subprocess
import sys
import threading
import time

from .header import (
    CLASS_NAMES, CONF, CONF_DEFAULTS, DEPENDENCIES, DEPS_STATUS,
    IMAGE_LIST, LIVE_ALL, LIVE_CAMERAS, LIVE_LIST, MODELS_LIST,
    PHASH_CACHE, STATE, STEP_STATUS, TRAINER_LOG,
    VERSION, VIDEO_LIST, _state_lock, conf, validate_path,
    detect_device, get_dependencies, get_torch_index_url, resolve_device,
)
from .config import _parse_value, check_dependencies, save_conf
from .core import (
    build_image_list, get_filtered, get_label_path, get_stats,
    read_boxes, rebuild_image_list, refresh_image_mtime, scan_datasets,
    scan_live_images, scan_models, scan_video_exports, sort_image_list,
    write_boxes,
)
from .ai_phash_video import (
    export_video_frame, extract_video_frame, find_similar_images, find_similar_live,
    get_video_info, run_ai_analyse, run_ai_preview, run_video_frame_ai,
)
def _json_ok(data: dict) -> tuple[int, str, bytes]:
    """Return a successful JSON response tuple."""
    return 200, "application/json", json.dumps(data).encode()


def _json_err(msg: str, status: int = 400) -> tuple[int, str, bytes]:
    """Return an error JSON response tuple."""
    return status, "application/json", json.dumps({"ok": False, "error": msg}).encode()


# ============================================================
# GET ROUTE HANDLERS
# ============================================================

def _get_index(params: dict) -> tuple[int, str, bytes]:
    """Serve the main HTML page."""
    html = INDEX_HTML

    # Ensure cameras are populated before building the dropdown
    scan_live_images("all", 24)

    datasets = scan_datasets()
    ds_opts = ""
    for ds in datasets:
        sel = " selected" if ds["path"] == STATE["DATASET_DIR"] else ""
        ds_opts += f'<option value="{ds["path"]}"{sel}>{ds["name"]}</option>'
    if not ds_opts:
        ds_opts = '<option value="" selected disabled>No datasets configured</option>'

    default_classes = conf("DEFAULT_CLASSES")
    cls_filter_opts = ""
    for c in sorted(set(int(x) for x in default_classes)):
        cls_filter_opts += f'<option value="{c}">{c}: {CLASS_NAMES.get(c, str(c))}</option>'

    model_opts = ""
    for m in MODELS_LIST:
        bname = os.path.basename(m)
        model_opts += f'<option value="{m}">{bname}</option>'
    if not model_opts:
        model_opts = '<option value="" disabled selected>No models found</option>'

    live_cam_opts = ""
    for cam in LIVE_CAMERAS:
        live_cam_opts += f'<option value="{cam}">{cam}</option>'

    video_clip_opts = ""
    for v in VIDEO_LIST:
        video_clip_opts += f'<option value="{v["path"]}">{v["name"]}</option>'

    html = html.replace("%%VERSION%%", VERSION)
    html = html.replace("%%DATASET_OPTIONS%%", ds_opts)
    html = html.replace("%%DATASET_OPTIONS_TRAINER%%", ds_opts)
    html = html.replace("%%CLASS_FILTER_OPTIONS%%", cls_filter_opts)
    html = html.replace("%%MODEL_OPTIONS%%", model_opts)
    html = html.replace("%%LIVE_CAMERA_OPTIONS%%", live_cam_opts)
    html = html.replace("%%VIDEO_CLIP_OPTIONS%%", video_clip_opts)
    html = html.replace("%%CLASS_NAMES_JS%%", json.dumps({int(k): v for k, v in CLASS_NAMES.items()}))
    conf_js = {**CONF_DEFAULTS, **{k: v for k, v in CONF.items()}}
    conf_js["VERSION"] = VERSION
    html = html.replace("%%CONF_JS%%", json.dumps(conf_js))
    html = html.replace("%%DEFAULT_CLASSES_JS%%", json.dumps(
        [int(x) for x in conf("DEFAULT_CLASSES")]
    ))
    html = html.replace("%%FIRST_RUN%%", json.dumps(
        STATE["FIRST_RUN"] and not conf("WELCOME_DISMISSED")
    ))
    html = html.replace("%%DEVICE_INFO%%", json.dumps({
        "effective": STATE.get("DEVICE_EFFECTIVE", "cpu"),
        "info": STATE.get("DEVICE_INFO", {}),
        "conf": conf("DEVICE"),
    }))
    html = html.replace("%%UI_STATE_JS%%", json.dumps(STATE["UI_STATE"]))

    return 200, "text/html", html.encode()


def _get_api_info(params: dict) -> tuple[int, str, bytes]:
    filt = params.get("f", ["all"])[0]
    cls = int(params.get("c", ["-1"])[0])
    return _json_ok({"total": len(get_filtered(filt, cls))})


def _get_api_meta(params: dict) -> tuple[int, str, bytes]:
    filt = params.get("f", ["all"])[0]
    cls = int(params.get("c", ["-1"])[0])
    i = int(params.get("i", ["0"])[0])
    filtered = get_filtered(filt, cls)
    if not filtered:
        return _json_err("Image not found")
    # Clamp index to the valid range. The active class filter shrinks whenever
    # the user edits a label that drops an image out of the filter, but the
    # client's cached totalImages is only refreshed by setFilter/setClassFilter.
    # Without clamping, navigation goes off the end and every subsequent fetch
    # 400s, which freezes the canvas until the user changes filters.
    if i >= len(filtered):
        i = len(filtered) - 1
    elif i < 0:
        i = 0
    item = filtered[i]
    bd = read_boxes(get_label_path(item["split"], item["name"]))
    return _json_ok({"split": item["split"], "name": item["name"],
                      "boxes": len(bd), "box_data": bd})


def _get_api_flist(params: dict) -> tuple[int, str, bytes]:
    filt = params.get("f", ["all"])[0]
    cls = int(params.get("c", ["-1"])[0])
    filtered = get_filtered(filt, cls)
    data = [{"split": x["split"], "name": x["name"], "boxes": x["boxes"]} for x in filtered]
    return _json_ok(data)


def _get_api_datasets(params: dict) -> tuple[int, str, bytes]:
    return _json_ok(scan_datasets())


def _get_api_models(params: dict) -> tuple[int, str, bytes]:
    models = scan_models()
    return _json_ok({"models": models, "names": [os.path.basename(m) for m in models]})


def _get_api_reload(params: dict) -> tuple[int, str, bytes]:
    rebuild_image_list()
    with _state_lock:
        MODELS_LIST.clear(); MODELS_LIST.extend(scan_models())
    PHASH_CACHE.clear()
    return _json_ok({"ok": True, "images": len(IMAGE_LIST), "models": len(MODELS_LIST)})


def _get_api_stats(params: dict) -> tuple[int, str, bytes]:
    return _json_ok(get_stats())


def _get_img_raw(params: dict) -> tuple[int, str, bytes]:
    filt = params.get("f", ["all"])[0]
    cls = int(params.get("c", ["-1"])[0])
    i = int(params.get("i", ["0"])[0])
    filtered = get_filtered(filt, cls)
    if not filtered:
        return _json_err("Image not found")
    # See _get_api_meta — clamp out-of-bounds indices so the canvas keeps
    # rendering after a label edit shrinks the filter.
    if i >= len(filtered):
        i = len(filtered) - 1
    elif i < 0:
        i = 0
    item = filtered[i]
    p = os.path.join(STATE["DATASET_DIR"], "images", item["split"], item["name"])
    if not os.path.exists(p):
        return _json_err("Image file missing")
    with open(p, "rb") as f:
        data = f.read()
    return 200, "image/jpeg", data


def _get_img_byname(params: dict) -> tuple[int, str, bytes]:
    split = params.get("split", ["train"])[0]
    name = params.get("name", [""])[0]
    p = os.path.join(STATE["DATASET_DIR"], "images", split, name)
    if not validate_path(p, STATE["DATASET_DIR"]):
        return _json_err("Invalid path")
    if not os.path.exists(p):
        return _json_err("Image not found")
    with open(p, "rb") as f:
        data = f.read()
    ct = "image/jpeg"
    if name.lower().endswith(".png"):
        ct = "image/png"
    elif name.lower().endswith(".webp"):
        ct = "image/webp"
    return 200, ct, data


def _get_api_meta_byname(params: dict) -> tuple[int, str, bytes]:
    split = params.get("split", ["train"])[0]
    name = params.get("name", [""])[0]
    p = os.path.join(STATE["DATASET_DIR"], "images", split, name)
    if not validate_path(p, STATE["DATASET_DIR"]):
        return _json_err("Invalid path")
    lbl = get_label_path(split, name)
    bd = read_boxes(lbl)
    return _json_ok({"split": split, "name": name, "box_data": bd})


_last_live_scan: float = 0.0

def _filter_live(cam, hours):
    """Filter LIVE_ALL by time cutoff and camera. Returns filtered list."""
    cutoff = time.time() - (hours * 3600)
    filtered = [x for x in LIVE_ALL if x["mtime"] >= cutoff]
    if cam and cam != "all":
        filtered = [x for x in filtered if x["camera"] == cam]
    return filtered

def _get_api_live_info(params: dict) -> tuple[int, str, bytes]:
    global _last_live_scan
    cam = params.get("cam", ["all"])[0]
    hours = int(params.get("hours", ["24"])[0])
    now = time.time()
    if now - _last_live_scan > 2.0:
        scan_live_images("all", hours)
        _last_live_scan = now
    return _json_ok({"total": len(_filter_live(cam, hours)), "cameras": LIVE_CAMERAS})


def _get_api_live_meta(params: dict) -> tuple[int, str, bytes]:
    cam = params.get("cam", ["all"])[0]
    hours = int(params.get("hours", ["24"])[0])
    i = int(params.get("i", ["0"])[0])
    filtered = _filter_live(cam, hours)
    if not filtered or i >= len(filtered):
        return _json_err("Live image not found")
    item = filtered[i]
    return _json_ok({"name": item["name"], "camera": item["camera"],
                      "mtime_str": item["mtime_str"], "total": len(filtered)})


def _get_api_live_list(params: dict) -> tuple[int, str, bytes]:
    cam = params.get("cam", ["all"])[0]
    hours = int(params.get("hours", ["24"])[0])
    scan_live_images("all", hours)
    filtered = _filter_live(cam, hours)
    data = [{"name": x["name"], "camera": x["camera"],
             "mtime_str": x["mtime_str"]} for x in filtered]
    return _json_ok(data)


def _get_img_live(params: dict) -> tuple[int, str, bytes]:
    cam = params.get("cam", ["all"])[0]
    hours = int(params.get("hours", ["24"])[0])
    i = int(params.get("i", ["0"])[0])
    filtered = _filter_live(cam, hours)
    if not filtered or i >= len(filtered):
        return _json_err("Live image not found")
    p = filtered[i]["path"]
    if not os.path.exists(p):
        return _json_err("Live image file missing")
    with open(p, "rb") as f:
        data = f.read()
    ct = "image/webp" if p.endswith(".webp") else "image/jpeg"
    return 200, ct, data


def _get_api_video_list(params: dict) -> tuple[int, str, bytes]:
    scan_video_exports()
    data = [{"name": v["name"], "path": v["path"], "size": v["size"],
             "mtime_str": v["mtime_str"]} for v in VIDEO_LIST]
    return _json_ok({"ok": True, "clips": data})


def _get_api_video_info(params: dict) -> tuple[int, str, bytes]:
    vpath = params.get("path", [""])[0]
    exports_dir = conf("EXPORTS_DIR")
    if exports_dir and not validate_path(vpath, exports_dir):
        return _json_err("Invalid video path")
    info = get_video_info(vpath)
    if info:
        info["ok"] = True
        return _json_ok(info)
    return _json_err("Cannot open video")


def _get_api_video_frame(params: dict) -> tuple[int, str, bytes]:
    vpath = params.get("path", [""])[0]
    exports_dir = conf("EXPORTS_DIR")
    if exports_dir and not validate_path(vpath, exports_dir):
        return _json_err("Invalid video path")
    frame_no = int(params.get("frame", ["0"])[0])
    data = extract_video_frame(vpath, frame_no)
    if data:
        return 200, "image/jpeg", data
    return _json_err("Cannot extract frame")


def _get_api_dupes_find(params: dict) -> tuple[int, str, bytes]:
    split = params.get("split", [""])[0]
    name = params.get("name", [""])[0]
    threshold = float(params.get("threshold", ["90"])[0]) / 100.0
    live_idx = params.get("live", [None])[0]
    if live_idx is not None:
        results = find_similar_live(int(live_idx), threshold)
    else:
        results = find_similar_images(split, name, threshold)
    return _json_ok({"ok": True, "results": results})


def _get_api_missing_labels(params: dict) -> tuple[int, str, bytes]:
    missing = []
    for split in ["train", "val"]:
        img_dir = os.path.join(STATE["DATASET_DIR"], "images", split)
        if not os.path.exists(img_dir):
            continue
        for img_file in sorted(os.listdir(img_dir)):
            if not img_file.lower().endswith(('.jpg', '.jpeg', '.png', '.webp')):
                continue
            lbl = get_label_path(split, img_file)
            if not os.path.exists(lbl):
                missing.append({"split": split, "name": img_file})
    return _json_ok({"ok": True, "missing": missing, "count": len(missing)})


def _get_api_settings_defaults(params: dict) -> tuple[int, str, bytes]:
    return _json_ok(CONF_DEFAULTS)


def _get_api_conf(params: dict) -> tuple[int, str, bytes]:
    return _json_ok(CONF)


def _get_api_trainer_status(params: dict) -> tuple[int, str, bytes]:
    return _json_ok({**STEP_STATUS, "_pipeline": STATE["PIPELINE_STATE"], "_reports": STATE["STEP_REPORTS"]})


def _get_api_trainer_logs(params: dict) -> tuple[int, str, bytes]:
    start = int(params.get("start", ["0"])[0])
    lines = TRAINER_LOG[start:]
    return _json_ok({"lines": lines, "total": len(TRAINER_LOG)})


def _get_api_version(params: dict) -> tuple[int, str, bytes]:
    return _json_ok({
        "dataset": STATE["DATASET_VERSION"],
        "live": STATE["LIVE_VERSION"],
        "video": STATE["VIDEO_VERSION"],
        "total": len(IMAGE_LIST),
        "live_total": len(LIVE_ALL),
        "video_total": len(VIDEO_LIST),
    })


def _get_api_gpu(params: dict) -> tuple[int, str, bytes]:
    global _gpu_cache, _gpu_cache_time
    effective = STATE.get("DEVICE_EFFECTIVE", "cpu")
    if effective != "nvidia":
        data = {"ok": True, "mode": "cpu"}
        try:
            # CPU name
            cpu_name = ""
            with open("/proc/cpuinfo") as f:
                for line in f:
                    if line.startswith("model name"):
                        cpu_name = line.split(":", 1)[1].strip()
                        break
            data["gpu_name"] = cpu_name or "CPU"
            data["cores"] = str(os.cpu_count() or "?")
            # Load average
            load1, load5, load15 = os.getloadavg()
            data["load"] = f"{load1:.1f}"
            # Memory from /proc/meminfo
            meminfo = {}
            with open("/proc/meminfo") as f:
                for line in f:
                    parts = line.split()
                    if len(parts) >= 2:
                        meminfo[parts[0].rstrip(":")] = int(parts[1])
            mem_total = meminfo.get("MemTotal", 0) // 1024
            mem_avail = meminfo.get("MemAvailable", 0) // 1024
            mem_used = mem_total - mem_avail
            data["mem_used"] = str(mem_used)
            data["mem_total"] = str(mem_total)
            # Temperature (best effort)
            try:
                with open("/sys/class/thermal/thermal_zone0/temp") as f:
                    data["temp"] = str(int(f.read().strip()) // 1000)
            except Exception:
                pass
            # Build output text
            lines = [f"CPU: {data['gpu_name']}", f"Cores: {data['cores']}", f"Load: {data['load']}"]
            lines.append(f"Memory: {mem_used} / {mem_total} MiB")
            if data.get("temp"):
                lines.append(f"Temp: {data['temp']}°C")
            data["output"] = "\n".join(lines)
        except Exception:
            data["gpu_name"] = "CPU"
            data["output"] = "Running in CPU mode."
        return _json_ok(data)
    now = time.time()
    if _gpu_cache and (now - _gpu_cache_time) < 4:
        return _json_ok(_gpu_cache)
    try:
        result = subprocess.run(["nvidia-smi"], capture_output=True, text=True, timeout=8)
        output = result.stdout.strip()
        data = {"ok": True, "mode": "nvidia", "output": output}
        try:
            qresult = subprocess.run(
                ["nvidia-smi", "--query-gpu=temperature.gpu,utilization.gpu,memory.used,memory.total,power.draw,name",
                 "--format=csv,noheader,nounits"],
                capture_output=True, text=True, timeout=8
            )
            parts = qresult.stdout.strip().split(",")
            if len(parts) >= 5:
                data["temp"] = parts[0].strip()
                data["util"] = parts[1].strip()
                data["vram_used"] = parts[2].strip()
                data["vram_total"] = parts[3].strip()
                data["power"] = parts[4].strip()
            if len(parts) >= 6:
                data["gpu_name"] = parts[5].strip()
        except Exception:
            pass
        _gpu_cache = data
        _gpu_cache_time = now
        return _json_ok(data)
    except FileNotFoundError:
        return _json_ok({"ok": True, "mode": "cpu", "gpu_name": "CPU Mode", "output": "nvidia-smi not found — running in CPU mode."})
    except subprocess.TimeoutExpired:
        if _gpu_cache:
            return _json_ok({**_gpu_cache, "cached": True})
        return _json_err("nvidia-smi timeout")
    except Exception as e:
        return _json_err(str(e))


def _get_api_device_detect(params: dict) -> tuple[int, str, bytes]:
    info = detect_device()
    effective = resolve_device()
    return _json_ok({
        "ok": True,
        "detected": info,
        "effective": effective,
        "conf": conf("DEVICE"),
    })


def _get_api_ai_status(params: dict) -> tuple[int, str, bytes]:
    model_name = os.path.basename(STATE["AI_MODEL_PATH"]) if STATE["AI_MODEL_PATH"] else ""
    return _json_ok({
        "loaded": STATE["AI_MODEL"] is not None,
        "model": model_name,
    })


_deps_cache: list[dict] = []
_gpu_cache: dict = {}
_gpu_cache_time: float = 0.0

def _get_api_deps_check(params: dict) -> tuple[int, str, bytes]:
    global _deps_cache
    # Don't run imports while pip is actively installing — return cached results
    if DEPS_STATUS["running"] and _deps_cache:
        return _json_ok(_deps_cache)
    _deps_cache = check_dependencies()
    return _json_ok(_deps_cache)


def _get_api_deps_status(params: dict) -> tuple[int, str, bytes]:
    return _json_ok(DEPS_STATUS)


def _get_api_deps_python(params: dict) -> tuple[int, str, bytes]:
    import platform
    return _json_ok({
        "version": sys.version.split()[0],
        "executable": sys.executable,
        "platform": platform.platform(),
    })


def _get_api_ui_state(params: dict) -> tuple[int, str, bytes]:
    return _json_ok(STATE["UI_STATE"])


# ============================================================

# ============================================================
# POST ROUTE HANDLERS
# ============================================================

def _post_deps_install_one(body: dict) -> tuple[int, str, bytes]:
    pkg_pip = body.get("pip", "")
    pkg_name = body.get("name", pkg_pip)
    if not pkg_pip:
        return _json_err("No package specified")
    current_deps = get_dependencies()
    allowed_pips = {d["pip"] for d in current_deps}
    if pkg_pip not in allowed_pips:
        return _json_err(f"Package not allowed: {pkg_pip}")
    dep = next((d for d in current_deps if d["pip"] == pkg_pip), {})
    try:
        cmd = [sys.executable, "-m", "pip", "install"]
        if dep.get("index_url"):
            cmd += ["--index-url", dep["index_url"]]
        cmd += pkg_pip.split()
        timeout = 600 if dep.get("index_url") else 300
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        if result.returncode == 0:
            return _json_ok({"ok": True, "name": pkg_name})
        return _json_err(result.stderr[:300])
    except Exception as e:
        return _json_err(str(e))


def _post_deps_install(body: dict) -> tuple[int, str, bytes]:
    if DEPS_STATUS["running"]:
        return _json_ok({"ok": True, "message": "Already installing"})

    effective = STATE.get("DEVICE_EFFECTIVE", resolve_device())
    deps = check_dependencies(effective)
    missing = [d for d in deps if not d["installed"]]
    if not missing:
        return _json_ok({"ok": True, "installed": [], "message": "All dependencies already installed"})

    DEPS_STATUS["running"] = True
    DEPS_STATUS["installed"] = []
    DEPS_STATUS["errors"] = []
    DEPS_STATUS["total"] = len(missing)
    DEPS_STATUS["done"] = 0
    DEPS_STATUS["current"] = ""

    def _install_worker():
        for d in missing:
            if not DEPS_STATUS["running"]:
                break
            DEPS_STATUS["current"] = d["name"]
            try:
                cmd = [sys.executable, "-m", "pip", "install"]
                if d.get("index_url"):
                    cmd += ["--index-url", d["index_url"]]
                cmd += d["pip"].split()
                timeout = 600 if d.get("index_url") else 300
                result = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
                if result.returncode == 0:
                    DEPS_STATUS["installed"].append(d["name"])
                else:
                    DEPS_STATUS["errors"].append(f"{d['name']}: {result.stderr[:200]}")
            except Exception as e:
                DEPS_STATUS["errors"].append(f"{d['name']}: {str(e)}")
            DEPS_STATUS["done"] += 1

        # ultralytics pulls opencv-python (needs libGL) over opencv-python-headless.
        # Fix: force headless variant after all installs complete.
        try:
            subprocess.run([sys.executable, "-m", "pip", "uninstall", "-y", "opencv-python"],
                           capture_output=True, text=True, timeout=60)
            subprocess.run([sys.executable, "-m", "pip", "install", "--force-reinstall", "opencv-python-headless"],
                           capture_output=True, text=True, timeout=120)
        except Exception:
            pass

        DEPS_STATUS["running"] = False
        DEPS_STATUS["current"] = ""

    t = threading.Thread(target=_install_worker, daemon=True)
    t.start()
    return _json_ok({"ok": True, "async": True, "total": len(missing)})


def _post_models_download(body: dict) -> tuple[int, str, bytes]:
    filename = body.get("filename", "")
    if not filename or not filename.endswith(".pt"):
        return _json_err("Invalid filename")
    models_dir = conf("MODELS_DIR")
    os.makedirs(models_dir, exist_ok=True)
    dst = os.path.join(models_dir, filename)
    if os.path.exists(dst):
        return _json_err("Model already exists")
    url = f"https://github.com/ultralytics/assets/releases/download/v8.4.0/{filename}"
    try:
        result = subprocess.run(["wget", "-q", "-O", dst, url], capture_output=True, text=True, timeout=300)
        if result.returncode == 0 and os.path.exists(dst):
            size_mb = f"{os.path.getsize(dst) / 1024 / 1024:.1f} MB"
            with _state_lock:
                MODELS_LIST[:] = scan_models()
            return _json_ok({"ok": True, "size": size_mb})
        if os.path.exists(dst):
            os.remove(dst)
        return _json_err(result.stderr[:200] or "Download failed")
    except Exception as e:
        if os.path.exists(dst):
            os.remove(dst)
        return _json_err(str(e))


def _post_save(body: dict) -> tuple[int, str, bytes]:
    split, name, nb = body["split"], body["name"], body["boxes"]
    write_boxes(get_label_path(split, name), nb)
    cls_in = list(set(b["cls"] for b in nb))
    with _state_lock:
        for i, item in enumerate(IMAGE_LIST):
            if item["split"] == split and item["name"] == name:
                IMAGE_LIST[i]["boxes"] = len(nb)
                IMAGE_LIST[i]["classes"] = cls_in
                break
    refresh_image_mtime(split, name)
    return _json_ok({"ok": True})


def _post_del(body: dict) -> tuple[int, str, bytes]:
    split, name = body["split"], body["name"]
    for p in [os.path.join(STATE["DATASET_DIR"], "images", split, name),
              get_label_path(split, name)]:
        if os.path.exists(p):
            os.remove(p)
    with _state_lock:
        IMAGE_LIST[:] = [x for x in IMAGE_LIST if not (x["split"] == split and x["name"] == name)]
    PHASH_CACHE.pop(os.path.join(STATE["DATASET_DIR"], "images", split, name), None)
    return _json_ok({"ok": True})


def _post_ai(body: dict) -> tuple[int, str, bytes]:
    result = run_ai_analyse(
        body["split"], body["name"],
        body["model"], body["conf"],
        set(body["classes"])
    )
    return _json_ok(result)


def _post_preview_ai(body: dict) -> tuple[int, str, bytes]:
    img_path = os.path.join(STATE["DATASET_DIR"], "images", body["split"], body["name"])
    result = run_ai_preview(img_path, body["model"], body.get("conf", 0.7),
                            set(body.get("classes", conf("DEFAULT_CLASSES"))))
    return _json_ok(result)


def _post_live_ai(body: dict) -> tuple[int, str, bytes]:
    i = body.get("index", 0)
    cam = body.get("cam", "all")
    hours = int(body.get("hours", 24))
    filtered = _filter_live(cam, hours)
    if not filtered or i >= len(filtered):
        return _json_err("Invalid index")
    result = run_ai_preview(
        filtered[i]["path"], body["model"],
        body.get("conf", 0.7),
        set(body.get("classes", conf("DEFAULT_CLASSES")))
    )
    return _json_ok(result)


def _post_video_ai(body: dict) -> tuple[int, str, bytes]:
    vpath = body["path"]
    exports_dir = conf("EXPORTS_DIR")
    if exports_dir and not validate_path(vpath, exports_dir):
        return _json_err("Invalid video path")
    result = run_video_frame_ai(
        vpath, body["frame"],
        body["model"], body["conf"],
        set(body.get("classes", conf("DEFAULT_CLASSES")))
    )
    return _json_ok(result)


def _post_video_export(body: dict) -> tuple[int, str, bytes]:
    vpath = body["path"]
    exports_dir = conf("EXPORTS_DIR")
    if exports_dir and not validate_path(vpath, exports_dir):
        return _json_err("Invalid video path")
    result = export_video_frame(
        vpath, body["frame"],
        body["dst_dataset"], body["dst_split"]
    )
    return _json_ok(result)


def _post_copymove(body: dict) -> tuple[int, str, bytes]:
    src_split = body["src_split"]
    src_name = body["src_name"]
    dst_dataset = body["dst_dataset"]
    dst_split = body["dst_split"]
    action = body["action"]
    is_live = body.get("live", False)

    if is_live:
        live_dir = conf("LIVE_DIR")
        src_img = os.path.join(live_dir, src_name)
        src_lbl = None
        # Convert any live snapshot extension to .jpg for dataset
        dst_name = os.path.splitext(src_name)[0] + ".jpg"
        # Strip Frigate's "-clean" suffix if present
        dst_name = dst_name.replace("-clean.jpg", ".jpg")
    else:
        src_img = os.path.join(STATE["DATASET_DIR"], "images", src_split, src_name)
        src_lbl = get_label_path(src_split, src_name)
        dst_name = src_name

    dst_img_dir = os.path.join(dst_dataset, "images", dst_split)
    dst_lbl_dir = os.path.join(dst_dataset, "labels", dst_split)
    os.makedirs(dst_img_dir, exist_ok=True)
    os.makedirs(dst_lbl_dir, exist_ok=True)
    dst_img = os.path.join(dst_img_dir, dst_name)
    dst_lbl = os.path.join(dst_lbl_dir, dst_name.replace(".jpg", ".txt"))

    if not os.path.exists(src_img):
        return _json_err("Source not found")
    if os.path.exists(dst_img):
        return _json_err("Already exists")

    if is_live:
        from PIL import Image as PILImage
        pil_img = PILImage.open(src_img)
        pil_img.save(dst_img, "JPEG", quality=95)
        pil_img.close()
        with open(dst_lbl, "w") as f:
            pass
        if action == "move":
            os.remove(src_img)
    else:
        if action == "copy":
            shutil.copy2(src_img, dst_img)
            if src_lbl and os.path.exists(src_lbl):
                shutil.copy2(src_lbl, dst_lbl)
        else:
            shutil.move(src_img, dst_img)
            if src_lbl and os.path.exists(src_lbl):
                shutil.move(src_lbl, dst_lbl)
            with _state_lock:
                IMAGE_LIST[:] = [x for x in IMAGE_LIST if not (x["split"] == src_split and x["name"] == src_name)]

    if dst_dataset == STATE["DATASET_DIR"]:
        bxs = read_boxes(dst_lbl) if os.path.exists(dst_lbl) else []
        cls_in = list(set(b["cls"] for b in bxs))
        with _state_lock:
            exists = False
            for i, item in enumerate(IMAGE_LIST):
                if item["split"] == dst_split and item["name"] == dst_name:
                    IMAGE_LIST[i]["boxes"] = len(bxs)
                    IMAGE_LIST[i]["classes"] = cls_in
                    exists = True
                    break
            if not exists:
                img_mt = os.path.getmtime(dst_img) if os.path.exists(dst_img) else time.time()
                IMAGE_LIST.append({"split": dst_split, "name": dst_name, "boxes": len(bxs), "classes": cls_in, "mtime": img_mt})
        sort_image_list()

    return _json_ok({"ok": True, "action": action})


def _post_switch(body: dict) -> tuple[int, str, bytes]:
    new_path = body["path"]
    if os.path.exists(os.path.join(new_path, "images")):
        STATE["DATASET_DIR"] = new_path
        rebuild_image_list()
        PHASH_CACHE.clear()
        return _json_ok({"ok": True, "total": len(IMAGE_LIST), "name": os.path.basename(new_path)})
    return _json_err("Invalid dataset")


def _post_populate_labels(body: dict) -> tuple[int, str, bytes]:
    created = 0
    for split in ["train", "val"]:
        img_dir = os.path.join(STATE["DATASET_DIR"], "images", split)
        lbl_dir = os.path.join(STATE["DATASET_DIR"], "labels", split)
        if not os.path.exists(img_dir):
            continue
        os.makedirs(lbl_dir, exist_ok=True)
        for img_file in sorted(os.listdir(img_dir)):
            if not img_file.lower().endswith(('.jpg', '.jpeg', '.png', '.webp')):
                continue
            lbl = os.path.join(lbl_dir, os.path.splitext(img_file)[0] + '.txt')
            if not os.path.exists(lbl):
                with open(lbl, 'w') as f:
                    pass
                created += 1
    return _json_ok({"ok": True, "created": created})


def _post_settings_save(body: dict) -> tuple[int, str, bytes]:
    old_live = CONF.get("LIVE_DIR", "")
    old_exports = CONF.get("EXPORTS_DIR", "")
    old_models = CONF.get("MODELS_DIR", "")
    for key, val in body.items():
        CONF[key] = _parse_value(str(val)) if isinstance(val, str) else val
    save_conf(STATE["CONF_PATH"], CONF)
    # Rescan only when paths actually changed
    if CONF.get("LIVE_DIR", "") != old_live:
        scan_live_images("all", 24)
    if CONF.get("EXPORTS_DIR", "") != old_exports:
        scan_video_exports()
    if CONF.get("MODELS_DIR", "") != old_models:
        with _state_lock:
            MODELS_LIST.clear(); MODELS_LIST.extend(scan_models())
    return _json_ok({"ok": True, "conf": CONF, "cameras": LIVE_CAMERAS})




def _post_device_set(body: dict) -> tuple[int, str, bytes]:
    """Change device setting and refresh deps list."""
    device = body.get("device", "auto").lower().strip()
    if device not in ("auto", "nvidia", "cpu"):
        return _json_err(f"Invalid device: {device}")
    CONF["DEVICE"] = device
    save_conf(STATE["CONF_PATH"], CONF)
    effective = resolve_device()
    STATE["DEVICE_EFFECTIVE"] = effective
    STATE["DEVICE_INFO"] = detect_device()
    DEPENDENCIES[:] = get_dependencies(effective)
    return _json_ok({"ok": True, "device": device, "effective": effective})


def _post_first_run_dismiss(body: dict) -> tuple[int, str, bytes]:
    STATE["FIRST_RUN"] = False
    CONF["WELCOME_DISMISSED"] = True
    save_conf(STATE["CONF_PATH"], CONF)
    return _json_ok({"ok": True})


_UI_STATE_KEYS = {"page", "mode", "panel_open", "panel_tab", "trainer_step", "trainer_tab", "settings_tab"}

def _post_ui_state(body: dict) -> tuple[int, str, bytes]:
    for key, val in body.items():
        if key in _UI_STATE_KEYS:
            STATE["UI_STATE"][key] = val
    return _json_ok({"ok": True})
