#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
: "${SDK_ROOT:?Set SDK_ROOT to your Android SDK directory}"
deps="$PWD/build/whisper-deps"
ndk="$SDK_ROOT/ndk/28.2.13676358"
cmake="$SDK_ROOT/cmake/3.22.1/bin/cmake"
ninja="$SDK_ROOT/cmake/3.22.1/bin/ninja"
mkdir -p "$deps"
[[ -f "$deps/whisper-v1.9.4.zip" ]] || curl -fL https://github.com/ggml-org/whisper.cpp/archive/refs/tags/v1.9.4.zip -o "$deps/whisper-v1.9.4.zip"
[[ -f "$deps/ggml-small.en-q5_1.bin" ]] || curl -fL https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en-q5_1.bin -o "$deps/ggml-small.en-q5_1.bin"
[[ -f "$deps/ggml-silero-v6.2.0.bin" ]] || curl -fL https://huggingface.co/ggml-org/whisper-vad/resolve/main/ggml-silero-v6.2.0.bin -o "$deps/ggml-silero-v6.2.0.bin"
python3 - <<'PY'
from pathlib import Path
import hashlib,zipfile
base=Path('build/whisper-deps')
for name,expected in [('whisper-v1.9.4.zip','873e67727d51213d3a14a6700c7415900a6645b78c4e6edad9328eea90e53572'),('ggml-small.en-q5_1.bin','bfdff4894dcb76bbf647d56263ea2a96645423f1669176f4844a1bf8e478ad30'),('ggml-silero-v6.2.0.bin','2aa269b785eeb53a82983a20501ddf7c1d9c48e33ab63a41391ac6c9f7fb6987')]:
 assert hashlib.file_digest((base/name).open('rb'),'sha256').hexdigest()==expected,'Checksum mismatch: '+name
if not (base/'whisper.cpp-1.9.4').is_dir():
 with zipfile.ZipFile(base/'whisper-v1.9.4.zip') as archive:archive.extractall(base)
PY
for variant in arm64 arm64-fast; do
  arch=armv8-a
  [[ "$variant" != arm64-fast ]] || arch=armv8.2-a+fp16+dotprod
  "$cmake" -S native -B "build/whisper-$variant" -G Ninja "-DCMAKE_MAKE_PROGRAM=$ninja" "-DCMAKE_TOOLCHAIN_FILE=$ndk/build/cmake/android.toolchain.cmake" -DANDROID_ABI=arm64-v8a -DANDROID_PLATFORM=android-26 -DANDROID_STL=c++_static -DCMAKE_BUILD_TYPE=Release "-DWHISPER_SOURCE=$deps/whisper.cpp-1.9.4" "-DGGML_CPU_ARM_ARCH=$arch"
  "$cmake" --build "build/whisper-$variant" -j 4
done
# Start clean so an older model (base.en, 148 MB) is never packaged alongside the current one.
rm -rf build/voice-package
mkdir -p build/voice-package/lib/arm64-v8a build/voice-package/assets/voice
cp build/whisper-arm64/libshottime_whisper.so build/whisper-arm64-fast/libshottime_whisper_fast.so build/voice-package/lib/arm64-v8a/
cp "$deps/ggml-small.en-q5_1.bin" "$deps/ggml-silero-v6.2.0.bin" build/voice-package/assets/voice/
cp "$deps/whisper.cpp-1.9.4/LICENSE" build/voice-package/assets/voice/whisper-LICENSE.txt
