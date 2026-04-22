# ============================================================
# CONFIGURATION - alice.conf parser/writer
# ============================================================

import os

from .header import CONF_DEFAULTS, get_dependencies

def _parse_value(raw):
    """Auto-detect type from string value."""
    v = raw.strip()
    if v.lower() in ("true", "yes", "on"):
        return True
    if v.lower() in ("false", "no", "off"):
        return False
    if "," in v:
        items = [_parse_value(x) for x in v.split(",")]
        return items
    try:
        if "." not in v and "e" not in v.lower():
            return int(v)
    except ValueError:
        pass
    try:
        return float(v)
    except ValueError:
        pass
    if (v.startswith('"') and v.endswith('"')) or (v.startswith("'") and v.endswith("'")):
        return v[1:-1]
    return v


def _format_value(val):
    """Convert Python value to conf string."""
    if isinstance(val, bool):
        return "true" if val else "false"
    if isinstance(val, list):
        return ", ".join(str(x) for x in val)
    return str(val)


def load_conf(path):
    """Load alice.conf, return dict with defaults for missing keys."""
    conf = dict(CONF_DEFAULTS)
    if not os.path.exists(path):
        return conf
    with open(path, "r") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if "=" not in line:
                continue
            key, _, val = line.partition("=")
            key = key.strip()
            val = val.strip()
            conf[key] = _parse_value(val)
    return conf


def save_conf(path, conf):
    """Write alice.conf preserving comments and order."""
    lines = []
    written_keys = set()

    if os.path.exists(path):
        with open(path, "r") as f:
            for line in f:
                stripped = line.strip()
                if not stripped or stripped.startswith("#"):
                    lines.append(line.rstrip("\n"))
                    continue
                if "=" in stripped:
                    key = stripped.partition("=")[0].strip()
                    if key in conf:
                        lines.append(f"{key} = {_format_value(conf[key])}")
                        written_keys.add(key)
                    else:
                        lines.append(line.rstrip("\n"))
                else:
                    lines.append(line.rstrip("\n"))
    else:
        lines.append("# Alice Configuration")
        lines.append("# Edit here or from Settings in the web UI")
        lines.append("")

    new_keys = [k for k in conf if k not in written_keys]
    if new_keys:
        if lines and lines[-1] != "":
            lines.append("")
        for key in new_keys:
            lines.append(f"{key} = {_format_value(conf[key])}")

    with open(path, "w") as f:
        f.write("\n".join(lines) + "\n")


def generate_default_conf(path):
    """Generate a fresh alice.conf with all defaults and comments."""
    sections = [
        ("# Alice Configuration", None),
        ("# Edit here or from Settings in the web UI", None),
        ("", None),
        ("# Empty paths auto-resolve to alice.py directory:", None),
        ("#   MODELS_DIR      → <alice_dir>/models/", None),
        ("#   DATASETS_ROOT   → <alice_dir>/datasets/", None),
        ("#   DEFAULT_DATASET → <alice_dir>/datasets/default/", None),
        ("", None),
        ("# === Paths ===", None),
        ("DEFAULT_PORT", None), ("DEFAULT_DATASET", None), ("DATASETS_ROOT", None),
        ("MODELS_DIR", None), ("LIVE_DIR", None), ("EXPORTS_DIR", None),
        ("FRIGATE_DB", None), ("VIDEO_EXTENSIONS", None),
        ("", None),
        ("# === AI Defaults ===", None),
        ("DEFAULT_MODEL", None), ("TEACHER_MODEL", None), ("STUDENT_MODEL", None),
        ("DEFAULT_CONFIDENCE", None), ("DEFAULT_CLASSES", None),
        ("", None),
        ("# === Training Defaults ===", None),
        ("EPOCHS", None), ("BATCH_SIZE", None), ("LEARNING_RATE", None),
        ("LR_FINAL", None), ("IMAGE_SIZE", None), ("FREEZE_LAYERS", None),
        ("", None),
        ("# === Device ===", None),
        ("# auto = detect at startup, nvidia = force GPU, cpu = force CPU", None),
        ("DEVICE", None),
        ("", None),
        ("# === Interface ===", None),
        ("HELPERS_ENABLED", None), ("SORT_ORDER", None), ("WELCOME_DISMISSED", None),
        ("", None),
        ("# === Dedup Defaults ===", None),
        ("DEDUP_BOXES", None), ("DEDUP_BOX_SIM", None),
        ("DEDUP_PHASH", None), ("DEDUP_PHASH_SIM", None),
        ("DEDUP_NMS", None), ("DEDUP_NMS_SIM", None),
    ]
    lines = []
    for item, _ in sections:
        if item == "" or item.startswith("#"):
            lines.append(item)
        elif item in CONF_DEFAULTS:
            lines.append(f"{item} = {_format_value(CONF_DEFAULTS[item])}")
    with open(path, "w") as f:
        f.write("\n".join(lines) + "\n")


def check_dependencies(device_type=None):
    """Check which dependencies are installed. Returns list of dicts."""
    import importlib
    deps = get_dependencies(device_type)
    results = []
    for dep in deps:
        try:
            importlib.invalidate_caches()
            importlib.import_module(dep["import"])
            results.append({**dep, "installed": True, "version": _get_pkg_version(dep["import"])})
        except ImportError:
            results.append({**dep, "installed": False, "version": None})
    return results


def _get_pkg_version(import_name):
    """Try to get version string for a package."""
    try:
        mod = __import__(import_name)
        for attr in ("__version__", "VERSION", "version"):
            if hasattr(mod, attr):
                v = getattr(mod, attr)
                return str(v) if not callable(v) else str(v())
    except Exception:
        pass
    return "?"
