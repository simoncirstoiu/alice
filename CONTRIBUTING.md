# Contributing to ALICE

Thanks for your interest in contributing to ALICE! Before submitting a pull
request, issue, patch, or any other contribution, please read the
**Contributor License Agreement** below. By contributing, you agree to its
terms.

## Contributor License Agreement (CLA)

By submitting a contribution to this project (including but not limited to
pull requests, patches, code snippets in issues or discussions, suggestions
applied to the codebase, or any material incorporated into the project), you
agree to the following terms:

1. **Original work.** Your contribution is your own original work, or you
   have the right to submit it under these terms. If your contribution
   includes work owned by your employer, you confirm that you have your
   employer's permission to contribute it, or that your employer has waived
   such rights for your contribution.

2. **License grant.** You grant Simon Cîrstoiu and the ALICE project a
   perpetual, worldwide, non-exclusive, royalty-free, irrevocable copyright
   license to reproduce, prepare derivative works of, publicly display,
   publicly perform, sublicense, and distribute your contribution and such
   derivative works **under any license, including commercial licenses and
   licenses incompatible with the project's current license**.

3. **Patent grant.** You grant Simon Cîrstoiu and the ALICE project a
   perpetual, worldwide, non-exclusive, royalty-free, irrevocable patent
   license to make, have made, use, offer to sell, sell, import, and
   otherwise transfer your contribution, where such license applies only to
   those patent claims licensable by you that are necessarily infringed by
   your contribution alone or by combination of your contribution with the
   project.

4. **Retained rights.** You retain all other rights, title, and interest in
   and to your contribution. You may continue to use your contribution in
   any way you wish, including in other projects, under any license. This
   CLA is a license grant, not an assignment of copyright.

5. **No warranty.** Your contribution is provided "as is", without warranty
   of any kind. You are not obligated to provide support for your
   contribution.

6. **Acceptance.** Submitting a contribution (e.g. opening a pull request or
   committing to this repository) constitutes your acceptance of these terms.
   If you do not agree to these terms, do not submit contributions to this
   project.

If you are unsure whether you have the right to contribute, or if your
employer needs to sign off, please contact alice@it-link.net before
submitting.

---

## Project Structure

```
alice/
├── alice.py                ← assembled single-file (built output, don't edit)
├── builder.py              ← assembles src/ modules + injects assets → alice.py
├── src/
│   ├── header.py           ← imports, VERSION, CONF_DEFAULTS, CLASS_NAMES, global state
│   ├── config.py           ← alice.conf parser/writer, dependency checker
│   ├── core.py             ← dataset scanning, image list, box I/O, watchers
│   ├── ai_phash_video.py   ← AI detection, pHash, video frame extraction
│   ├── trainer.py          ← training pipeline (export, dedup, annotate, train, ONNX)
│   ├── html_css.py         ← HTML skeleton with %%CSS%% and %%SIDEBAR_HTML%% placeholders
│   ├── html_pages.py       ← viewer, trainer, settings, about, help pages HTML
│   ├── js_core.py          ← JS skeleton with %%JS_CORE%% placeholder
│   ├── js_panels.py        ← JS skeleton with %%JS_PANELS%% placeholder
│   ├── handler.py          ← HTTP handler (GET + POST routes)
│   ├── main.py             ← ThreadedHTTPServer + entry point
│   └── assets/
│       ├── style.css       ← all CSS (674 lines) — edit here, not in Python
│       ├── core.js         ← JS: state, init, navigation, canvas, mouse (1151 lines)
│       ├── panels.js       ← JS: panels, AI, live/video, trainer, tooltips (2554 lines)
│       └── sidebar.html    ← sidebar navigation HTML (80 lines)
├── tests/
│   └── test_core.py        ← unit tests for pure functions
├── Dockerfile
├── docker-compose.yml
├── alice.conf             ← generated on first run (not in repo)
├── .venv/                  ← created by builder (not in repo)
└── README.md
```

## How the Build Works

The builder concatenates Python modules in order, then replaces asset placeholders
with the contents of the corresponding files from `src/assets/`:

| Placeholder | Injected from |
|-------------|---------------|
| `%%CSS%%` | `src/assets/style.css` |
| `%%JS_CORE%%` | `src/assets/core.js` |
| `%%JS_PANELS%%` | `src/assets/panels.js` |
| `%%SIDEBAR_HTML%%` | `src/assets/sidebar.html` |

Runtime placeholders like `%%VERSION%%`, `%%DATASET_OPTIONS%%`, etc. are left as-is
and replaced by the HTTP handler at serve time.

## Development Workflow

1. Edit source files in `src/` and `src/assets/`
2. Build:
   ```bash
   python3 builder.py              # first time: creates .venv + alice.py
   python3 builder.py --no-venv    # subsequent: skip venv (already exists)
   ```
3. Test:
   ```bash
   ./alice.py                      # runs from .venv automatically
   ```
4. Run unit tests:
   ```bash
   .venv/bin/python3 -m pytest tests/ -v
   ```

## Key Rules

- **Never edit `alice.py` directly** — it's generated by `builder.py`
- The builder creates `.venv/` next to `alice.py` and patches the shebang
- Re-running builder skips venv creation if `.venv` already exists
- Edit CSS in `src/assets/style.css`, not in Python strings
- Edit JS in `src/assets/core.js` and `src/assets/panels.js`
- Edit sidebar HTML in `src/assets/sidebar.html`
- Python backend modules live in `src/` (one per concern)
- The builder strips shebang lines from all modules except `header.py`

## Running Tests

```bash
# All tests
python3 -m pytest tests/ -v

# Specific test class
python3 -m pytest tests/test_core.py::TestBoxIoU -v
```

Tests cover: box IoU computation, box read/write round-trips, config parsing, pHash similarity.
