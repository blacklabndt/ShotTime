#!/usr/bin/env bash
# Builds WeldScope for Windows (64-bit) and packages dist/WeldScope-Windows.zip.
# Works on Linux (cross-compiles with mingw-w64) and on Windows with the x86_64-pc-windows-gnu toolchain.
# Needs: rustup target add x86_64-pc-windows-gnu; mingw-w64 (x86_64-w64-mingw32-gcc, -windres); python3.
set -euo pipefail
cd "$(dirname "$0")/.."
cargo test --release -p weldscope-core
cargo build --release --locked --target x86_64-pc-windows-gnu -p weldscope
python3 tools/make-notices.py > THIRD-PARTY-NOTICES.txt
rm -rf dist/WeldScope && mkdir -p dist/WeldScope
cp target/x86_64-pc-windows-gnu/release/WeldScope.exe dist/WeldScope/
cp README-Windows.txt dist/WeldScope/README.txt
cp THIRD-PARTY-NOTICES.txt dist/WeldScope/
python3 - <<'PY'
import zipfile, os
with zipfile.ZipFile("dist/WeldScope-Windows.zip", "w", zipfile.ZIP_DEFLATED) as z:
    for f in sorted(os.listdir("dist/WeldScope")):
        z.write(os.path.join("dist/WeldScope", f), "WeldScope/" + f)
PY
ls -l dist/WeldScope-Windows.zip dist/WeldScope/WeldScope.exe
