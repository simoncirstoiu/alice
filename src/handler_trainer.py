# ============================================================
# TRAINER HANDLERS — individual steps + pipeline
# ============================================================

import json
import os
import threading
import time
from contextlib import contextmanager

from .header import (
    CONF, CONF_DEFAULTS, IMAGE_LIST, MODELS_LIST, STATE,
    STEP_STATUS, TRAINER_LOG, _state_lock, conf,
)
from .handler_api import _json_ok, _json_err
from .core import (
    build_image_list, rebuild_image_list, scan_models, sort_image_list,
)
from .trainer import (
    trainer_dedup_run, trainer_export_dataset, trainer_export_onnx,
    trainer_reannotate, trainer_train,
)
def _post_trainer_stop(body: dict) -> tuple[int, str, bytes]:
    step = body.get("step", "")
    if step and step in STEP_STATUS:
        STEP_STATUS[step]["running"] = False
    else:
        # Stop all running steps
        for s in STEP_STATUS.values():
            s["running"] = False
    return _json_ok({"ok": True})


def _post_trainer_pipeline_start(body: dict) -> tuple[int, str, bytes]:
    import time as _time
    STATE["PIPELINE_STATE"] = {
        "steps": body.get("steps", []),
        "started_at": _time.time(),
    }
    return _json_ok({"ok": True})


def _post_trainer_pipeline_clear(body: dict) -> tuple[int, str, bytes]:
    STATE["PIPELINE_STATE"] = None
    return _json_ok({"ok": True})


def _post_trainer_logs_reset(body: dict) -> tuple[int, str, bytes]:
    TRAINER_LOG.clear()
    return _json_ok({"ok": True})


def _post_trainer_logs_append(body: dict) -> tuple[int, str, bytes]:
    msg = body.get("message", "")
    if msg:
        for line in msg.split("\n"):
            TRAINER_LOG.append(line)
    return _json_ok({"ok": True})


_REPORT_KEYS = {"export", "dedup", "annotate", "train", "onnx", "pipeline"}

def _post_trainer_report_dismiss(body: dict) -> tuple[int, str, bytes]:
    step = body.get("step", "")
    if step in _REPORT_KEYS:
        STATE["STEP_REPORTS"][step] = None
    return _json_ok({"ok": True})


def _post_trainer_report_save(body: dict) -> tuple[int, str, bytes]:
    step = body.get("step", "")
    report = body.get("report", None)
    if step in _REPORT_KEYS and report:
        STATE["STEP_REPORTS"][step] = report
    return _json_ok({"ok": True})



def _post_trainer_set_dataset(body: dict) -> tuple[int, str, bytes]:
    new_path = body.get("path", "")
    if os.path.exists(os.path.join(new_path, "images")):
        STATE["TRAINER_DATASET"] = new_path
        return _json_ok({"ok": True, "dataset": new_path})
    return _json_err("Invalid dataset path")


STEP_KEY_MAP = {"Export": "export", "Dedup": "dedup", "Annotate": "annotate", "Train": "train", "ONNX Export": "onnx"}

def _safe_trainer_thread(fn, step_name):
    """Wrap a trainer function to catch unhandled exceptions and reset STEP_STATUS."""
    def wrapper():
        try:
            fn()
        except Exception as e:
            import traceback
            err_msg = str(e)[:200]
            tb = traceback.format_exc()[:500]
            STEP_STATUS[step_name]["running"] = False
            STEP_STATUS[step_name]["message"] = f"Error: {err_msg}"
            STEP_STATUS[step_name]["result"] = {"ok": False, "error": err_msg}
            TRAINER_LOG.append(f"{step_name.upper()}: FAILED — {err_msg}")
            TRAINER_LOG.append(tb)
    return wrapper


from contextlib import contextmanager

@contextmanager
def _trainer_dataset(tds):
    """Temporarily set DATASET_DIR to trainer dataset, restore on exit."""
    saved = STATE["DATASET_DIR"]
    STATE["DATASET_DIR"] = tds
    try:
        yield
    finally:
        STATE["DATASET_DIR"] = saved


def _post_trainer_export(body: dict) -> tuple[int, str, bytes]:
    max_images = int(body.get("max_images", 0))
    _tds = STATE["TRAINER_DATASET"] or STATE["DATASET_DIR"]

    def _run_export():
        with _trainer_dataset(_tds):
            trainer_export_dataset(max_images=max_images)
            STATE["TRAINER_DATASET"] = _tds
            rebuild_image_list()

    t = threading.Thread(target=_safe_trainer_thread(_run_export, "export"), daemon=True)
    t.start()
    return _json_ok({"ok": True, "async": True})


def _post_trainer_reannotate(body: dict) -> tuple[int, str, bytes]:
    teacher = body.get("teacher", conf("TEACHER_MODEL"))
    if not teacher:
        return _json_err("No teacher model configured. Set it in Settings \u2192 AI.")
    teacher_path = os.path.join(conf("MODELS_DIR"), teacher) if "/" not in teacher else teacher
    ann_conf = float(body.get("conf", 0.5))
    classes = set(int(c) for c in body.get("classes", conf("DEFAULT_CLASSES")))
    merge = body.get("merge", False)
    _tds = STATE["TRAINER_DATASET"] or STATE["DATASET_DIR"]

    def _run_annotate():
        with _trainer_dataset(_tds):
            trainer_reannotate(teacher_path, ann_conf, classes, merge=merge)
            rebuild_image_list()

    t = threading.Thread(target=_safe_trainer_thread(_run_annotate, "annotate"), daemon=True)
    t.start()
    return _json_ok({"ok": True, "async": True})


def _post_trainer_dedup(body: dict) -> tuple[int, str, bytes]:
    _tds = STATE["TRAINER_DATASET"] or STATE["DATASET_DIR"]
    _dry_run = body.get("dry_run", False)

    def _run_dedup():
        with _trainer_dataset(_tds):
            trainer_dedup_run(
                boxes=body.get("boxes", False),
                phash=body.get("phash", False),
                nms=body.get("nms", False),
                box_iou=float(body.get("box_iou", 10)) / 100.0,
                hamming=int(body.get("hamming", 10)),
                nms_iou=float(body.get("nms_iou", 85)) / 100.0,
                dry_run=_dry_run
            )
            if not _dry_run:
                rebuild_image_list()

    t = threading.Thread(target=_safe_trainer_thread(_run_dedup, "dedup"), daemon=True)
    t.start()
    return _json_ok({"ok": True, "async": True})


def _post_trainer_train(body: dict) -> tuple[int, str, bytes]:
    model = body.get("model", "")
    if not model:
        return _json_err("No student model configured. Set it in Settings \u2192 AI.")
    model_path = os.path.join(conf("MODELS_DIR"), model) if "/" not in model else model
    _epochs = int(body.get("epochs", conf("EPOCHS")))
    _batch = int(body.get("batch", conf("BATCH_SIZE")))
    _lr = float(body.get("lr", conf("LEARNING_RATE")))
    _lrf = float(body.get("lrf", conf("LR_FINAL")))
    _imgsz = int(body.get("imgsz", conf("IMAGE_SIZE")))
    _freeze = int(body.get("freeze", conf("FREEZE_LAYERS")))
    _augment = bool(body.get("augment", conf("AUGMENTATION")))
    _tds = STATE["TRAINER_DATASET"] or STATE["DATASET_DIR"]

    def _run_train():
        with _trainer_dataset(_tds):
            trainer_train(model_path, _epochs, _batch, _lr, _lrf, _imgsz, _freeze, _augment)
        with _state_lock:
            MODELS_LIST.clear(); MODELS_LIST.extend(scan_models())

    t = threading.Thread(target=_safe_trainer_thread(_run_train, "train"), daemon=True)
    t.start()
    return _json_ok({"ok": True, "async": True})


def _post_trainer_onnx(body: dict) -> tuple[int, str, bytes]:
    model = body.get("model", "")
    if not model:
        return _json_err("No model specified for ONNX export.")
    model_path = os.path.join(conf("MODELS_DIR"), model) if "/" not in model else model
    _imgsz = int(body.get("imgsz", 640))
    _opset = int(body.get("opset", 13))
    _simplify = body.get("simplify", True)
    _half = body.get("half", False)
    _dynamic = body.get("dynamic", False)

    def _run_onnx():
        trainer_export_onnx(model_path, _imgsz, _opset, _simplify, _half, _dynamic)

    t = threading.Thread(target=_safe_trainer_thread(_run_onnx, "onnx"), daemon=True)
    t.start()
    return _json_ok({"ok": True, "async": True})


def _post_trainer_pipeline_run(body: dict) -> tuple[int, str, bytes]:
    """Run full pipeline server-side in a single thread. Browser only polls status."""
    import time as _time

    steps     = body.get("steps", [])
    dataset   = body.get("dataset", "")
    params    = body.get("params", {})

    if not steps:
        return _json_err("No steps provided")

    # Pre-flight: reject if any step already running
    for s in STEP_STATUS.values():
        if s.get("running"):
            return _json_err("A trainer step is already running")

    # Store pipeline state for recovery after refresh
    STATE["PIPELINE_STATE"] = {"steps": steps, "started_at": _time.time(), "params": params}

    _tds = dataset or STATE["TRAINER_DATASET"] or STATE["DATASET_DIR"]

    def _run_pipeline():
        import time as _t

        TRAINER_LOG.append("=" * 50)
        TRAINER_LOG.append(f"PIPELINE STARTED — {len(steps)} steps: {', '.join(steps)}")

        def _wait_step(step_key):
            """Wait for a step to finish (running→done)."""
            while STEP_STATUS[step_key].get("running", False):
                _t.sleep(0.5)

        try:
            with _trainer_dataset(_tds):
                for step_name in steps:
                    if not STATE["PIPELINE_STATE"]:
                        TRAINER_LOG.append("PIPELINE: Aborted")
                        break

                    if step_name == "Export":
                        max_images = int(params.get("exportMaxImages", 100))
                        _ss_reset = lambda **kw: STEP_STATUS["export"].update({"running": False, "progress": 0, "current": 0, "total": 0, "message": "", "epochs": [], **kw})
                        trainer_export_dataset(max_images=max_images)
                        STATE["TRAINER_DATASET"] = _tds
                        rebuild_image_list()

                    elif step_name == "Dedup":
                        phash_sim = int(params.get("dedupPhashSim", 85))
                        hamming   = round((100 - phash_sim) / 100 * 64)
                        trainer_dedup_run(
                            boxes   = bool(params.get("dedupBoxes", False)),
                            phash   = bool(params.get("dedupPhash", True)),
                            nms     = bool(params.get("dedupNms", False)),
                            box_iou = float(params.get("dedupBoxIou", 10)) / 100.0,
                            hamming = hamming,
                            nms_iou = float(params.get("dedupNmsIou", 85)) / 100.0,
                            dry_run = False,
                        )
                        rebuild_image_list()

                    elif step_name == "Annotate":
                        teacher = params.get("teacherPath", conf("TEACHER_MODEL"))
                        if not teacher:
                            TRAINER_LOG.append("PIPELINE: Annotate skipped — no teacher model")
                            continue
                        if "/" not in teacher:
                            teacher = os.path.join(conf("MODELS_DIR"), teacher)
                        conf_val = float(params.get("annotateConf", 0.5))
                        classes  = set(int(c) for c in params.get("classes", conf("DEFAULT_CLASSES")))
                        merge    = bool(params.get("annotateMerge", False))
                        trainer_reannotate(teacher, conf_val, classes, merge=merge)
                        rebuild_image_list()

                    elif step_name == "Train":
                        student = params.get("studentPath", conf("STUDENT_MODEL"))
                        if not student:
                            TRAINER_LOG.append("PIPELINE: Train skipped — no student model")
                            continue
                        if "/" not in student:
                            student = os.path.join(conf("MODELS_DIR"), student)
                        trainer_train(
                            model_path = student,
                            epochs     = int(params.get("trainEpochs", conf("EPOCHS"))),
                            batch_size = int(params.get("trainBatch", conf("BATCH_SIZE"))),
                            lr         = float(params.get("trainLR", conf("LEARNING_RATE"))),
                            lr_final   = float(params.get("trainLRF", conf("LR_FINAL"))),
                            imgsz      = int(params.get("trainImgsz", conf("IMAGE_SIZE"))),
                            freeze     = int(params.get("trainFreeze", conf("FREEZE_LAYERS"))),
                            augment    = bool(params.get("trainAugment", False)),
                        )
                        with _state_lock:
                            MODELS_LIST.clear(); MODELS_LIST.extend(scan_models())

                    elif step_name == "ONNX Export":
                        # Use output from Train if available, else studentPath
                        train_result = STEP_STATUS["train"].get("result", {})
                        model_path   = train_result.get("output", "") or params.get("studentPath", "")
                        if not model_path:
                            TRAINER_LOG.append("PIPELINE: ONNX Export skipped — no model")
                            continue
                        if "/" not in model_path:
                            model_path = os.path.join(conf("MODELS_DIR"), model_path)
                        trainer_export_onnx(
                            model_path = model_path,
                            imgsz      = int(params.get("onnxImgsz", params.get("trainImgsz", 640))),
                            opset      = int(params.get("onnxOpset", 13)),
                            simplify   = params.get("onnxSimplify", True),
                            half       = params.get("onnxHalf", False),
                            dynamic    = params.get("onnxDynamic", False),
                        )

                    # Check for step error
                    step_key_map = STEP_KEY_MAP
                    key = step_key_map.get(step_name)
                    if key:
                        result = STEP_STATUS[key].get("result", {})
                        if result and result.get("ok") == False:
                            TRAINER_LOG.append(f"PIPELINE: Aborted at {step_name} — {result.get('error', 'failed')}")
                            break

        except Exception as e:
            import traceback
            TRAINER_LOG.append(f"PIPELINE: EXCEPTION — {str(e)[:200]}")
            TRAINER_LOG.append(traceback.format_exc()[:500])
        finally:
            STATE["PIPELINE_STATE"] = None
            ok_count = sum(1 for s in steps if STEP_STATUS.get(
                STEP_KEY_MAP.get(s, ""), {}
            ).get("result", {}).get("ok", False))
            TRAINER_LOG.append("=" * 50)
            TRAINER_LOG.append(f"PIPELINE COMPLETED — {ok_count}/{len(steps)} succeeded")

    t = threading.Thread(target=_run_pipeline, daemon=True)
    t.start()
    return _json_ok({"ok": True, "async": True})


