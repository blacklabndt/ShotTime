#!/usr/bin/env bash
# Builds the Windows program and packages it as dist/DICONDE-Editor-Windows.zip.
# Needs the .NET SDK (8 or later); works on Windows, Linux or macOS.
set -euo pipefail
cd "$(dirname "$0")/.."
rm -rf windows/bin/Release
dotnet build windows/DicondeEditor.csproj -c Release -nologo -v quiet
out=windows/bin/Release/net48
test -f "$out/DiCondeEditor.exe" && test -f "$out/app/index.html" && test -f "$out/app/vendor/openjpeg/openjpegwasm-binary.js"
test -f "$out/runtimes/win-x64/native/WebView2Loader.dll"
mkdir -p dist
python3 - "$out" dist/DICONDE-Editor-Windows.zip <<'PY'
import os, sys, zipfile
src, dst = sys.argv[1], sys.argv[2]
with zipfile.ZipFile(dst, 'w', zipfile.ZIP_DEFLATED) as z:
    for root, _, files in os.walk(src):
        for f in sorted(files):
            if f.endswith('.pdb'): continue
            p = os.path.join(root, f)
            z.write(p, os.path.join('DICONDE Editor', os.path.relpath(p, src)))
print(f'Wrote {dst} ({os.path.getsize(dst) // 1024} KB)')
PY
