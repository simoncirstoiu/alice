# ============================================================
# HTTP HANDLER — routing + request dispatch
# ============================================================

import json
from http.server import BaseHTTPRequestHandler
from urllib.parse import parse_qs, unquote

from .handler_api import (
    _json_err, _json_ok,
    _get_index,
    _get_api_info, _get_api_meta, _get_api_flist,
    _get_api_datasets, _get_api_models, _get_api_reload, _get_api_stats,
    _get_img_raw, _get_img_byname, _get_api_meta_byname,
    _get_api_live_info, _get_api_live_meta, _get_api_live_list, _get_img_live,
    _get_api_video_list, _get_api_video_info, _get_api_video_frame,
    _get_api_dupes_find, _get_api_missing_labels,
    _get_api_settings_defaults, _get_api_conf,
    _get_api_trainer_status, _get_api_trainer_logs,
    _get_api_version, _get_api_gpu, _get_api_ai_status,
    _get_api_deps_check, _get_api_deps_status, _get_api_deps_python,
    _get_api_ui_state, _get_api_device_detect,
    _post_save, _post_del, _post_ai, _post_preview_ai,
    _post_live_ai, _post_video_ai, _post_video_export,
    _post_copymove, _post_switch, _post_dataset_create, _post_populate_labels,
    _post_settings_save,
    _post_deps_install_one, _post_deps_install,
    _post_models_download,
    _post_first_run_dismiss, _post_ui_state, _post_device_set,
)
from .handler_trainer import (
    _post_trainer_stop,
    _post_trainer_pipeline_start, _post_trainer_pipeline_clear,
    _post_trainer_logs_reset, _post_trainer_logs_append,
    _post_trainer_report_dismiss, _post_trainer_report_save,
    _post_trainer_set_dataset,
    _post_trainer_export, _post_trainer_reannotate,
    _post_trainer_dedup, _post_trainer_train, _post_trainer_onnx,
    _post_trainer_pipeline_run,
)


# ============================================================
# GET ROUTING TABLE
# ============================================================

GET_ROUTES: dict[str, callable] = {
    "/":                     _get_index,
    "/index.html":           _get_index,
    "/api/info":             _get_api_info,
    "/api/meta":             _get_api_meta,
    "/api/flist":            _get_api_flist,
    "/api/datasets":         _get_api_datasets,
    "/api/models":           _get_api_models,
    "/api/reload":           _get_api_reload,
    "/api/stats":            _get_api_stats,
    "/img/raw":              _get_img_raw,
    "/img/thumb":            _get_img_raw,
    "/img/byname":           _get_img_byname,
    "/api/meta/byname":      _get_api_meta_byname,
    "/api/live/info":        _get_api_live_info,
    "/api/live/meta":        _get_api_live_meta,
    "/api/live/list":        _get_api_live_list,
    "/img/live":             _get_img_live,
    "/api/video/list":       _get_api_video_list,
    "/api/video/info":       _get_api_video_info,
    "/api/video/frame":      _get_api_video_frame,
    "/api/dupes/find":       _get_api_dupes_find,
    "/api/missing-labels":   _get_api_missing_labels,
    "/api/settings/defaults": _get_api_settings_defaults,
    "/api/conf":             _get_api_conf,
    "/api/trainer/status":   _get_api_trainer_status,
    "/api/trainer/logs":     _get_api_trainer_logs,
    "/api/version":          _get_api_version,
    "/api/gpu":              _get_api_gpu,
    "/api/ai/status":        _get_api_ai_status,
    "/api/deps/check":       _get_api_deps_check,
    "/api/deps/status":      _get_api_deps_status,
    "/api/deps/python":      _get_api_deps_python,
    "/api/device/detect":    _get_api_device_detect,
    "/api/ui/state":         _get_api_ui_state,
}


# ============================================================
# POST ROUTING TABLE — exact match, checked in order
# ============================================================

POST_ROUTES: list[tuple[str, callable]] = [
    ("/api/trainer/stop",           _post_trainer_stop),
    ("/api/trainer/pipeline/run",   _post_trainer_pipeline_run),
    ("/api/trainer/pipeline/abort", _post_trainer_pipeline_clear),
    ("/api/trainer/pipeline/start", _post_trainer_pipeline_start),
    ("/api/trainer/pipeline/clear", _post_trainer_pipeline_clear),
    ("/api/trainer/logs/reset",     _post_trainer_logs_reset),
    ("/api/trainer/logs/append",    _post_trainer_logs_append),
    ("/api/trainer/report/dismiss", _post_trainer_report_dismiss),
    ("/api/trainer/report/save",    _post_trainer_report_save),
    ("/api/deps/install-one",       _post_deps_install_one),
    ("/api/deps/install",           _post_deps_install),
    ("/api/models/download",        _post_models_download),
    ("/api/save",                   _post_save),
    ("/api/del",                    _post_del),
    ("/api/ai",                     _post_ai),
    ("/api/preview/ai",             _post_preview_ai),
    ("/api/live/ai",                _post_live_ai),
    ("/api/video/ai",               _post_video_ai),
    ("/api/video/export",           _post_video_export),
    ("/api/copymove",               _post_copymove),
    ("/api/switch",                 _post_switch),
    ("/api/dataset/create",         _post_dataset_create),
    ("/api/populate-labels",        _post_populate_labels),
    ("/api/settings/save",          _post_settings_save),
    ("/api/trainer/set-dataset",    _post_trainer_set_dataset),
    ("/api/trainer/export",         _post_trainer_export),
    ("/api/trainer/reannotate",     _post_trainer_reannotate),
    ("/api/trainer/dedup",          _post_trainer_dedup),
    ("/api/trainer/train",          _post_trainer_train),
    ("/api/trainer/onnx",           _post_trainer_onnx),
    ("/api/first-run/dismiss",      _post_first_run_dismiss),
    ("/api/device/set",             _post_device_set),
    ("/api/ui/state",               _post_ui_state),
]


# ============================================================
# HANDLER CLASS
# ============================================================

class Handler(BaseHTTPRequestHandler):

    def do_GET(self):
        path = unquote(self.path).split("?")
        endpoint = path[0]
        params = parse_qs(path[1]) if len(path) > 1 else {}

        try:
            handler_fn = GET_ROUTES.get(endpoint)
            if handler_fn:
                code, ctype, data = handler_fn(params)
                self._respond(code, ctype, data)
            else:
                self.send_error(404)
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            pass
        except Exception as e:
            try:
                code, ctype, data = _json_err(str(e))
                self._respond(code, ctype, data)
            except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
                pass

    def do_POST(self):
        try:
            raw = self.rfile.read(int(self.headers.get("Content-Length", 0)))
            body = json.loads(raw) if raw else {}

            for prefix, handler_fn in POST_ROUTES:
                if self.path == prefix:
                    code, ctype, data = handler_fn(body)
                    self._respond(code, ctype, data)
                    return

            self.send_error(404)

        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            pass
        except Exception as e:
            try:
                code, ctype, data = _json_err(str(e))
                self._respond(code, ctype, data)
            except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
                pass

    def _respond(self, code: int, ctype: str, data: bytes):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0, post-check=0, pre-check=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        self.send_header("ETag", f'"{hash(data) & 0xFFFFFFFF:08x}"')
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, *a):
        pass
