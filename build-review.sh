#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
: "${SDK_ROOT:?Set SDK_ROOT to your Android SDK path (platform android-35, build-tools 35.0.0)}"
bt="$SDK_ROOT/build-tools/35.0.0"
platform="$SDK_ROOT/platforms/android-35/android.jar"
mkdir -p build/classes build/dex dist
"$bt/aapt" package -f -M AndroidManifest.xml -S res -A assets -I "$platform" -F build/resources.apk
java com.sun.tools.javac.Main -source 8 -target 8 -classpath "$platform" -d build/classes src/ca/kylekeith/shottime/MainActivity.java
mapfile -t class_files < <(find build/classes -name '*.class' -type f)
"$bt/d8" --lib "$platform" --min-api 26 --output build/dex "${class_files[@]}"
cp build/resources.apk build/unsigned.apk
python3 -c 'from zipfile import ZipFile, ZIP_DEFLATED
with ZipFile("build/unsigned.apk","a",ZIP_DEFLATED) as z:z.write("build/dex/classes.dex","classes.dex")'
"$bt/zipalign" -f -p 4 build/unsigned.apk build/aligned.apk
cp build/aligned.apk dist/ShotTime-review-unsigned.apk
"$bt/zipalign" -c -p 4 dist/ShotTime-review-unsigned.apk
"$bt/aapt" dump badging dist/ShotTime-review-unsigned.apk
