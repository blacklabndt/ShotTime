#!/usr/bin/env python3
"""Writes THIRD-PARTY-NOTICES.txt for the Windows build: every crate compiled into WeldScope.exe (from cargo
metadata for x86_64-pc-windows-gnu) with its licence files, grouped where the text is identical, plus the bundled
fonts and OpenJPEG. Run from weldscope/: python3 tools/make-notices.py > THIRD-PARTY-NOTICES.txt"""
import json, os, subprocess, sys, glob, collections

meta = json.loads(subprocess.check_output(["cargo", "metadata", "--format-version", "1", "--filter-platform", "x86_64-pc-windows-gnu", "--locked"], text=True))
pk = {p["id"]: p for p in meta["packages"]}
nodes = {n["id"]: n for n in meta["resolve"]["nodes"]}
# crates reachable from the app through normal (non-dev, non-build) dependencies
root = next(p["id"] for p in meta["packages"] if p["name"] == "weldscope")
seen, todo = set(), [root]
while todo:
    i = todo.pop()
    if i in seen: continue
    seen.add(i)
    for d in nodes[i]["deps"]:
        if any(k["kind"] in (None, "normal") for k in d["dep_kinds"]): todo.append(d["pkg"])
crates = sorted((pk[i] for i in seen if pk[i]["name"] not in ("weldscope", "weldscope-core")), key=lambda p: (p["name"], p["version"]))

texts = collections.OrderedDict()
for p in crates:
    d = os.path.dirname(p["manifest_path"])
    files = sorted(f for f in glob.glob(d + "/*") if os.path.basename(f).upper().startswith(("LICENSE", "LICENCE", "COPYING", "COPYRIGHT", "UNLICENSE", "NOTICE")) and os.path.isfile(f))
    label = f'{p["name"]} {p["version"]} ({p.get("license") or "see licence"})'
    if not files: texts.setdefault(("(no licence file in the crate; licence: " + (p.get("license") or "unknown") + ")",), []).append(label); continue
    body = tuple(open(f, encoding="utf-8", errors="replace").read().strip() for f in files)
    texts.setdefault(body, []).append(label)

out = sys.stdout
out.write("WeldScope - third-party notices\n===============================\n\n")
out.write("WeldScope.exe contains the software listed below. Each is used under its own licence, reproduced here.\n\n")
fonts = os.path.join(os.path.dirname(next(p["manifest_path"] for p in crates if p["name"] == "epaint_default_fonts")), "fonts")
ojp = os.path.join(os.path.dirname(next(p["manifest_path"] for p in crates if p["name"] == "openjpeg-sys")), "vendor", "LICENSE")
sections = [("OpenJPEG 2.5 (JPEG 2000 codec, compiled into the program; BSD 2-clause)", ojp),
            ("Ubuntu Light font (Ubuntu Font Licence 1.0)", fonts + "/UFL.txt"), ("Noto Emoji font (SIL Open Font Licence 1.1)", fonts + "/OFL.txt"),
            ("Hack font", fonts + "/Hack-Regular.txt"), ("Emoji icon font (MIT)", fonts + "/emoji-icon-font-mit-license.txt")]
for title, f in sections:
    out.write("-" * 78 + "\n" + title + "\n" + "-" * 78 + "\n" + open(f, encoding="utf-8", errors="replace").read().strip() + "\n\n")
out.write("=" * 78 + "\nRust crates\n" + "=" * 78 + "\n\n")
for body, labels in texts.items():
    out.write("-" * 78 + "\n" + "\n".join(labels) + "\n" + "-" * 78 + "\n" + "\n\n".join(body) + "\n\n")

# Standard texts for crates that name a licence but ship no licence file.
std_files = {}
for p in crates:
    d = os.path.dirname(p["manifest_path"])
    for f in glob.glob(d + "/*"):
        b = os.path.basename(f).upper()
        if "APACHE" in b: std_files.setdefault("Apache-2.0", f)
        if "BSL" in b or b == "LICENSE_1_0.TXT": std_files.setdefault("BSL-1.0", f)
MIT = """Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated
documentation files (the "Software"), to deal in the Software without restriction, including without limitation the
rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit
persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the
Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE
WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE."""
out.write("=" * 78 + "\nStandard licence texts (for crates above that name a licence without a licence file)\n" + "=" * 78 + "\n\n")
out.write("-" * 78 + "\nMIT\n" + "-" * 78 + "\n" + MIT + "\n\n")
for name, f in std_files.items():
    out.write("-" * 78 + "\n" + name + "\n" + "-" * 78 + "\n" + open(f, encoding="utf-8", errors="replace").read().strip() + "\n\n")
if "BSL-1.0" not in std_files:
    out.write("-" * 78 + "\nBSL-1.0 (Boost Software License 1.0)\n" + "-" * 78 + "\n" + """Permission is hereby granted, free of charge, to any person or organization obtaining a copy of the software and
accompanying documentation covered by this license (the "Software") to use, reproduce, display, distribute, execute,
and transmit the Software, and to prepare derivative works of the Software, and to permit third-parties to whom the
Software is furnished to do so, all subject to the following:

The copyright notices in the Software and this entire statement, including the above license grant, this restriction
and the following disclaimer, must be included in all copies of the Software, in whole or in part, and all derivative
works of the Software, unless such copies or derivative works are solely in the form of machine-executable object code
generated by a source language processor.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE
WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, TITLE AND NON-INFRINGEMENT. IN NO EVENT SHALL THE
COPYRIGHT HOLDERS OR ANYONE DISTRIBUTING THE SOFTWARE BE LIABLE FOR ANY DAMAGES OR OTHER LIABILITY, WHETHER IN CONTRACT,
TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.""" + "\n\n")
out.write("-" * 78 + "\nCC0-1.0\n" + "-" * 78 + "\nCreative Commons Zero v1.0 Universal (public domain dedication): https://creativecommons.org/publicdomain/zero/1.0/legalcode\n")
