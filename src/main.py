# ============================================================
# THREADED HTTP SERVER
# ============================================================

import argparse
import os
import sys
import threading
from http.server import HTTPServer

from .header import (
    ALICE_DIR, CONF, CONF_DEFAULTS, STATE,
    IMAGE_LIST, LIVE_CAMERAS, LIVE_LIST,
    MODELS_LIST, VERSION, VIDEO_LIST,
)
from .config import check_dependencies, generate_default_conf, load_conf
from .core import build_image_list, scan_live_images, scan_models, scan_video_exports, sort_image_list, start_watchers
from .handler import Handler

class ThreadedHTTPServer(HTTPServer):
    def process_request(self, request, client_address):
        t = threading.Thread(target=self._handle, args=(request, client_address))
        t.daemon = True
        t.start()

    def _handle(self, request, client_address):
        try:
            self.finish_request(request, client_address)
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            pass
        except Exception:
            self.handle_error(request, client_address)
        finally:
            self.shutdown_request(request)


# ============================================================
# MAIN
# ============================================================

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=f"Alice v{VERSION}")
    parser.add_argument("--port", type=int, default=None, help="HTTP port (overrides alice.conf)")
    parser.add_argument("--conf", default="alice.conf", help="Path to alice.conf (default: ./alice.conf)")
    args = parser.parse_args()

    STATE["CONF_PATH"] = args.conf

    # Ensure venv bin is first in PATH so ultralytics uses venv pip, not system pip
    if sys.prefix != sys.base_prefix:
        venv_bin = os.path.join(sys.prefix, "bin")
        current_path = os.environ.get("PATH", "")
        if not current_path.startswith(venv_bin):
            os.environ["PATH"] = venv_bin + ":" + current_path

    # Load or generate config
    if not os.path.exists(STATE["CONF_PATH"]):
        print(f"  Config not found: {STATE['CONF_PATH']}")
        print(f"  Generating default alice.conf...")
        generate_default_conf(STATE["CONF_PATH"])

    CONF = load_conf(STATE["CONF_PATH"])
    STATE["FIRST_RUN"] = not CONF.get("WELCOME_DISMISSED", False)

    # Resolve empty paths to alice.py directory and ensure they exist
    _path_defaults = {
        "DEFAULT_DATASET": os.path.join(ALICE_DIR, "datasets", "default"),
        "DATASETS_ROOT":   os.path.join(ALICE_DIR, "datasets"),
        "MODELS_DIR":      os.path.join(ALICE_DIR, "models"),
    }
    for key, fallback in _path_defaults.items():
        val = CONF.get(key, "")
        if not val or val == CONF_DEFAULTS.get(key, ""):
            CONF[key] = fallback

    # Ensure dataset and models directories exist
    os.makedirs(CONF["MODELS_DIR"], exist_ok=True)
    os.makedirs(CONF["DATASETS_ROOT"], exist_ok=True)
    dataset_dir = CONF.get("DEFAULT_DATASET", "")
    if dataset_dir:
        for split in ["train", "val"]:
            os.makedirs(os.path.join(dataset_dir, "images", split), exist_ok=True)
            os.makedirs(os.path.join(dataset_dir, "labels", split), exist_ok=True)

    # CLI port override
    if args.port:
        CONF["DEFAULT_PORT"] = args.port

    # Set active dataset
    STATE["DATASET_DIR"] = CONF.get("DEFAULT_DATASET", CONF_DEFAULTS["DEFAULT_DATASET"])
    STATE["TRAINER_DATASET"] = STATE["DATASET_DIR"]

    # Build initial data
    print(f"\n  Alice v{VERSION}")
    if sys.prefix != sys.base_prefix:
        print(f"  Python: {sys.executable} (venv)")
    print(f"  Config: {os.path.abspath(STATE['CONF_PATH'])}")
    print(f"  Dataset: {STATE['DATASET_DIR']}")

    IMAGE_LIST.clear(); IMAGE_LIST.extend(build_image_list())
    sort_image_list()
    MODELS_LIST.clear(); MODELS_LIST.extend(scan_models())
    scan_live_images("all", 24)
    scan_video_exports()

    t = len(IMAGE_LIST)
    e = sum(1 for x in IMAGE_LIST if x["boxes"] == 0)
    print(f"  Images: {t} ({t - e} annotated, {e} empty)")
    print(f"  Models: {len(MODELS_LIST)} - {', '.join(os.path.basename(m) for m in MODELS_LIST)}")
    print(f"  Live: {len(LIVE_LIST)} snapshots, {len(LIVE_CAMERAS)} cameras")
    print(f"  Video: {len(VIDEO_LIST)} clips")

    # Check dependencies
    deps = check_dependencies()
    missing = [d for d in deps if not d["installed"]]
    if missing:
        print(f"  Dependencies: {len(missing)} missing ({', '.join(d['name'] for d in missing)})")
    else:
        print(f"  Dependencies: all OK")

    port = int(CONF.get("DEFAULT_PORT", CONF_DEFAULTS["DEFAULT_PORT"]))

    # Start filesystem watchers
    start_watchers()

    print(f"\n  http://0.0.0.0:{port}\n")

    ThreadedHTTPServer(("0.0.0.0", port), Handler).serve_forever()
