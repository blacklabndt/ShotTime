#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
: "${SDK_ROOT:?Set SDK_ROOT to your Android SDK path (platform android-36, build-tools 36.0.0)}"
bt="$SDK_ROOT/build-tools/36.0.0"
platform="$SDK_ROOT/platforms/android-36/android.jar"
mkdir -p build/classes build/dex dist
"$bt/aapt" package -f -M AndroidManifest.xml -S res -A assets -I "$platform" -F build/resources.apk
java com.sun.tools.javac.Main -source 8 -target 8 -classpath "$platform" -d build/classes src/ca/kylekeith/shottime/*.java
mapfile -t class_files < <(find build/classes -name '*.class' -type f)
"$bt/d8" --lib "$platform" --min-api 26 --output build/dex "${class_files[@]}"
cp build/resources.apk build/unsigned.apk
python3 -c 'from zipfile import ZipFile, ZIP_DEFLATED
from pathlib import Path
payload=Path("build/voice-package")
assert (payload/"lib/arm64-v8a/libshottime_whisper.so").is_file(), "Run build-voice.sh first"
assert (payload/"lib/arm64-v8a/libshottime_whisper_fast.so").is_file(), "Optimized library missing; run build-voice.sh first"
assert (payload/"assets/voice/ggml-small.en-q5_1.bin").is_file() and (payload/"assets/voice/ggml-silero-v6.2.0.bin").is_file(), "Missing Whisper or speech detector model; run build-voice.sh"
assert not (payload/"assets/voice/ggml-base.en.bin").exists(), "Old base.en model in build/voice-package; rerun build-voice.sh"
with ZipFile("build/unsigned.apk","a",ZIP_DEFLATED) as z:
 z.write("build/dex/classes.dex","classes.dex")
 for p in payload.rglob("*"):
  if p.is_file():z.write(p,p.relative_to(payload).as_posix())'
"$bt/zipalign" -f -P 16 4 build/unsigned.apk build/aligned.apk
cp build/aligned.apk dist/ShotTime-review-unsigned.apk
"$bt/zipalign" -c -P 16 4 dist/ShotTime-review-unsigned.apk
"$bt/aapt" dump badging dist/ShotTime-review-unsigned.apk
