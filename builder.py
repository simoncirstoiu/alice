#!/usr/bin/env python3
"""
builder.py — Assembles Alice from modular source files into a single alice.py monolit.

Usage:
    python3 builder.py                    # Output: alice.py
    python3 builder.py -o /path/to/out.py # Custom output path
    python3 builder.py --check            # Verify all source files exist
    python3 builder.py --list             # Show resolved module order
    python3 builder.py --strict           # Abort on name conflicts

How it works:
    1. Reads import graph from `from .module import ...` statements in each src/*.py
    2. Topologically sorts modules by dependency order (no manual list needed)
    3. Strips all `from .xxx import` lines — redundant in the flat monolit namespace
    4. Injects CSS/JS/HTML assets into placeholder tokens
    5. Writes a single self-contained alice.py

Asset placeholders in src/ files:
    %%CSS%%          ← src/assets/style.css
    %%JS_CORE%%      ← src/assets/core.js
    %%JS_PANELS%%    ← src/assets/panels.js
    %%SIDEBAR_HTML%% ← src/assets/sidebar.html
"""

import os
import sys
import ast
import re
import argparse
from collections import defaultdict, deque

SRC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "src")

# Non-Python modules (assets injected via placeholders) — always appended after Python modules
ASSET_MODULES = ["html_css.py", "html_pages.py", "js_core.py", "js_panels.py"]

ASSETS = {
    "%%CSS%%":          "assets/style.css",
    "%%JS_CORE%%":      "assets/core.js",
    "%%JS_PANELS%%":    "assets/panels.js",
    "%%JS_TRAINER%%":   "assets/trainer.js",
    "%%JS_SETTINGS%%":  "assets/settings.js",
    "%%SIDEBAR_HTML%%": "assets/sidebar.html",
}

# header.py is always first — it defines all globals, imports, VERSION etc.
ENTRY_POINT = "main.py"
FIXED_FIRST = "header.py"


def get_python_modules():
    """Return all .py source modules excluding __init__.py and asset wrappers."""
    excluded = set(ASSET_MODULES) | {"__init__.py"}
    return [
        f for f in sorted(os.listdir(SRC_DIR))
        if f.endswith(".py") and f not in excluded
    ]


def parse_internal_imports(source, filename):
    """
    Extract internal relative imports from a module.
    `from .header import X, Y` → depends on header.py
    Returns list of module filenames this module depends on.
    """
    deps = []
    try:
        tree = ast.parse(source, filename=filename)
    except SyntaxError:
        return deps
    for node in ast.iter_child_nodes(tree):
        if isinstance(node, ast.ImportFrom):
            # Relative import: from .modname import ...
            if node.level == 1 and node.module:
                dep_file = node.module + ".py"
                deps.append(dep_file)
    return deps


def build_dependency_graph(modules):
    """
    Build a dependency graph from internal imports.
    Returns: deps dict {module: [modules it depends on]}
    """
    deps = {}
    for mod in modules:
        path = os.path.join(SRC_DIR, mod)
        if not os.path.exists(path):
            continue
        with open(path) as f:
            source = f.read()
        deps[mod] = parse_internal_imports(source, mod)
    return deps


def topological_sort(modules, deps):
    """
    Kahn's algorithm topological sort.
    header.py always first, main.py always last.
    Returns sorted list or raises on circular dependency.
    """
    # Build in-degree map
    in_degree = {m: 0 for m in modules}
    graph = defaultdict(list)  # m -> [modules that depend on m]

    for mod, mod_deps in deps.items():
        for dep in mod_deps:
            if dep in in_degree:
                in_degree[mod] += 1
                graph[dep].append(mod)

    # Force header.py first
    queue = deque()
    if FIXED_FIRST in in_degree:
        queue.append(FIXED_FIRST)
        in_degree[FIXED_FIRST] = -1  # mark as queued

    # Add all other zero in-degree nodes (except main.py — defer it)
    for mod in modules:
        if mod == FIXED_FIRST:
            continue
        if in_degree[mod] == 0 and mod != ENTRY_POINT:
            queue.append(mod)

    result = []
    while queue:
        mod = queue.popleft()
        result.append(mod)
        for dependent in graph[mod]:
            in_degree[dependent] -= 1
            if in_degree[dependent] == 0 and dependent != ENTRY_POINT:
                queue.append(dependent)

    # main.py always last
    if ENTRY_POINT in modules:
        result.append(ENTRY_POINT)

    if len(result) != len(modules):
        resolved = set(result)
        unresolved = [m for m in modules if m not in resolved]
        raise RuntimeError(f"Circular dependency or unresolved modules: {unresolved}")

    return result


def strip_internal_imports(source):
    """
    Remove all `from .xxx import ...` lines from source.
    These are redundant in the flat monolit — all symbols are in the same namespace.
    Handles multi-line imports with parentheses.
    """
    lines = source.split("\n")
    result = []
    skip_continuation = False

    for line in lines:
        stripped = line.strip()

        if skip_continuation:
            # Inside a multi-line relative import — skip until closing paren
            if ")" in line:
                skip_continuation = False
            continue

        # Single-line relative import: from .xxx import a, b, c
        if re.match(r"^\s*from\s+\.[a-zA-Z_][a-zA-Z0-9_]*\s+import\s+", line):
            # Multi-line: ends with ( but no ) yet
            if "(" in line and ")" not in line:
                skip_continuation = True
            # Skip this line entirely
            continue

        result.append(line)

    return "\n".join(result)


def extract_top_level_names(source, filename):
    """Return all top-level defined names in a module (for conflict detection)."""
    names = {}
    try:
        tree = ast.parse(source, filename=filename)
    except SyntaxError:
        return names
    for node in ast.iter_child_nodes(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            names[node.name] = node.lineno
        elif isinstance(node, ast.Assign):
            for target in node.targets:
                if isinstance(target, ast.Name):
                    names[target.id] = node.lineno
        elif isinstance(node, ast.AnnAssign):
            if isinstance(node.target, ast.Name):
                names[node.target.id] = node.lineno
    return names


def check_conflicts(ordered_modules):
    """Detect top-level name conflicts across modules. Returns list of conflict dicts."""
    seen = {}
    conflicts = []
    for mod in ordered_modules:
        path = os.path.join(SRC_DIR, mod)
        if not os.path.exists(path):
            continue
        with open(path) as f:
            source = f.read()
        names = extract_top_level_names(source, mod)
        for name, lineno in names.items():
            if name in seen:
                prev_mod, prev_line = seen[name]
                conflicts.append({
                    "name": name,
                    "first": prev_mod, "first_line": prev_line,
                    "second": mod, "second_line": lineno,
                })
            else:
                seen[name] = (mod, lineno)
    return conflicts


def load_assets():
    """Load all asset file contents keyed by placeholder token."""
    loaded = {}
    for placeholder, asset_path in ASSETS.items():
        full = os.path.join(SRC_DIR, asset_path)
        if not os.path.exists(full):
            print(f"  ERROR: Missing asset: {full}")
            sys.exit(1)
        with open(full) as f:
            loaded[placeholder] = f.read()
    return loaded


def check_modules(ordered=None):
    """Verify all source modules and assets exist."""
    python_mods = get_python_modules()
    base = ordered or python_mods
    if ENTRY_POINT in base:
        insert_pos = base.index(ENTRY_POINT)
        all_mods = base[:insert_pos] + ASSET_MODULES + base[insert_pos:]
    else:
        all_mods = base + ASSET_MODULES
    ok = True

    print("  Python modules (dependency order):")
    for mod in (ordered or python_mods):
        path = os.path.join(SRC_DIR, mod)
        if os.path.exists(path):
            print(f"    ✓ {mod:<24s} {os.path.getsize(path):>8,} bytes")
        else:
            print(f"    ✗ {mod:<24s} MISSING")
            ok = False

    print("\n  Asset modules:")
    for mod in ASSET_MODULES:
        path = os.path.join(SRC_DIR, mod)
        if os.path.exists(path):
            print(f"    ✓ {mod:<24s} {os.path.getsize(path):>8,} bytes")
        else:
            print(f"    ✗ {mod:<24s} MISSING")
            ok = False

    print("\n  Assets:")
    for placeholder, asset_path in ASSETS.items():
        full = os.path.join(SRC_DIR, asset_path)
        if os.path.exists(full):
            print(f"    ✓ {asset_path:<28s} {os.path.getsize(full):>8,} bytes  → {placeholder}")
        else:
            print(f"    ✗ {asset_path:<28s} MISSING  → {placeholder}")
            ok = False

    return ok


def build(output_path, strict=False):
    """Assemble all modules into a single output file."""
    assets = load_assets()

    # Resolve module order from dependency graph
    python_mods = get_python_modules()
    deps = build_dependency_graph(python_mods)
    try:
        ordered = topological_sort(python_mods, deps)
    except RuntimeError as e:
        print(f"  ERROR: {e}")
        sys.exit(1)

    # Insert ASSET_MODULES before main.py — html_css.py defines INDEX_HTML which
    # must exist before the __main__ block in main.py starts the HTTP server.
    if ENTRY_POINT in ordered:
        insert_pos = ordered.index(ENTRY_POINT)
        all_modules = ordered[:insert_pos] + ASSET_MODULES + ordered[insert_pos:]
    else:
        all_modules = ordered + ASSET_MODULES

    # Conflict detection on raw sources (before strip)
    conflicts = check_conflicts(ordered)
    if conflicts:
        print(f"\n  ⚠  Name conflicts detected ({len(conflicts)}):")
        for c in conflicts:
            print(f"     '{c['name']}' — {c['first']}:{c['first_line']} vs {c['second']}:{c['second_line']}")
        if strict:
            print("\n  Build aborted (--strict). Resolve conflicts before building.")
            sys.exit(1)
        print("  (use --strict to abort on conflicts)\n")
    else:
        print("  Name conflicts: none ✓")

    parts = []
    for i, mod in enumerate(all_modules):
        path = os.path.join(SRC_DIR, mod)
        if not os.path.exists(path):
            print(f"  ERROR: Missing module: {path}")
            sys.exit(1)

        with open(path) as f:
            content = f.read()

        # Strip shebang from all modules except the first
        if i > 0:
            lines = content.split("\n")
            if lines and lines[0].startswith("#!"):
                lines = lines[1:]
            content = "\n".join(lines)

        # Strip internal relative imports — redundant in flat namespace
        content = strip_internal_imports(content)

        # Inject assets into placeholders
        for placeholder, asset_content in assets.items():
            if placeholder in content:
                content = content.replace(placeholder, asset_content)

        # Module banner separator — only for Python modules, not asset modules
        # (asset modules are continuations of string literals; banners would corrupt HTML output)
        if i > 0 and mod not in ASSET_MODULES:
            banner = f"\n# {'=' * 60}\n# MODULE: {mod}\n# {'=' * 60}\n"
            content = banner + content

        parts.append(content)

    assembled = "\n".join(parts)

    with open(output_path, "w") as f:
        f.write(assembled)

    size = os.path.getsize(output_path)

    if os.getuid() == 0:
        os.chmod(output_path, 0o755)
        print(f"\n  Built: {output_path} (chmod +x)")
    else:
        print(f"\n  Built: {output_path}")

    print(f"  Size:  {size:,} bytes")
    print(f"  Modules: {len(all_modules)} ({len(ordered)} Python + {len(ASSET_MODULES)} asset)")


def setup_venv(output_path):
    """Create .venv next to alice.py and install base dependencies."""
    import subprocess
    output_dir = os.path.dirname(os.path.abspath(output_path))
    venv_dir = os.path.join(output_dir, ".venv")
    venv_python = os.path.join(venv_dir, "bin", "python3")

    if os.path.exists(venv_python):
        print(f"\n  venv: {venv_dir} (already exists)")
        return

    print(f"\n  Creating venv: {venv_dir}")
    import venv
    venv.create(venv_dir, with_pip=True)

    print(f"  Installing: Pillow")
    subprocess.run([venv_python, "-m", "pip", "install", "--quiet", "Pillow"], check=True)

    # Patch shebang in alice.py to point to venv python
    with open(output_path) as f:
        content = f.read()
    if content.startswith("#!/usr/bin/env python3"):
        content = f"#!{venv_python}\n" + content.split("\n", 1)[1]
        with open(output_path, "w") as f:
            f.write(content)

    print(f"  venv ready ✓")


def main():
    parser = argparse.ArgumentParser(description="Build Alice from source modules")
    parser.add_argument("-o", "--output", default="alice.py", help="Output file path (default: alice.py)")
    parser.add_argument("--check", action="store_true", help="Check all modules and assets exist without building")
    parser.add_argument("--list", action="store_true", help="Show resolved dependency order")
    parser.add_argument("--no-venv", action="store_true", help="Skip venv creation")
    parser.add_argument("--strict", action="store_true", help="Abort build if name conflicts are detected")
    args = parser.parse_args()

    print(f"\n  Alice Builder")
    print(f"  Source: {SRC_DIR}")
    print()

    python_mods = get_python_modules()
    deps = build_dependency_graph(python_mods)
    try:
        ordered = topological_sort(python_mods, deps)
    except RuntimeError as e:
        print(f"  ERROR: {e}")
        sys.exit(1)

    if args.list:
        if ENTRY_POINT in ordered:
            insert_pos = ordered.index(ENTRY_POINT)
            display_order = ordered[:insert_pos] + ASSET_MODULES + ordered[insert_pos:]
        else:
            display_order = ordered + ASSET_MODULES
        print("  Module assembly order (resolved from import graph):")
        for i, mod in enumerate(display_order):
            dep_list = deps.get(mod, [])
            dep_str = f"  ← {', '.join(dep_list)}" if dep_list else ""
            print(f"    {i+1:2d}. {mod}{dep_str}")
        print("\n  Asset injections:")
        for placeholder, asset_path in ASSETS.items():
            print(f"    {placeholder:<20s} ← {asset_path}")
        return

    if args.check:
        ok = check_modules(ordered)
        print()
        if ok:
            print("  All modules and assets present ✓")
        else:
            print("  Some files missing ✗")
            sys.exit(1)
        return

    if not check_modules(ordered):
        print("\n  Cannot build — missing files")
        sys.exit(1)

    build(args.output, strict=args.strict)

    if not args.no_venv:
        setup_venv(args.output)

    generate_docker_compose(args.output)


def generate_docker_compose(output_path):
    """Generate docker-compose.yml with GPU support if NVIDIA is detected."""
    import subprocess
    output_dir = os.path.dirname(os.path.abspath(output_path))
    compose_path = os.path.join(output_dir, "docker-compose.yml")

    # Detect GPU
    has_gpu = False
    try:
        result = subprocess.run(["nvidia-smi"], capture_output=True, text=True, timeout=8)
        if result.returncode == 0:
            has_gpu = True
    except (FileNotFoundError, subprocess.TimeoutExpired):
        pass

    base = """services:
  alice:
    build: .
    container_name: alice
    ports:
      - "8080:8080"
    volumes:
      # Config — persisted on host
      - ./alice.conf:/app/alice.conf

      # Datasets — read/write (Alice creates images + labels here)
      - /path/to/datasets:/app/datasets

      # Models — read/write (training output saved here)
      - /path/to/models:/app/models

      # Frigate media — read-only (set LIVE_DIR, EXPORTS_DIR, FRIGATE_DB in alice.conf)
      - /path/to/frigate/clips:/app/clips:ro
      - /path/to/frigate/exports:/app/exports:ro
      - /path/to/frigate/frigate.db:/app/frigate.db:ro

      # Persist installed dependencies across container restarts
      - alice_pip_cache:/usr/local/lib/python3.11/site-packages

    restart: unless-stopped
"""

    gpu_block = """
    # NVIDIA GPU — auto-detected by builder
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: 1
              capabilities: [gpu]
"""

    compose = base
    if has_gpu:
        compose += gpu_block

    compose += "\nvolumes:\n  alice_pip_cache:\n"

    with open(compose_path, "w") as f:
        f.write(compose)

    mode = "NVIDIA GPU" if has_gpu else "CPU"
    print(f"\n  docker-compose.yml generated ({mode})")


if __name__ == "__main__":
    main()
