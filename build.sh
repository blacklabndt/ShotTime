#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
: "${SDK_ROOT:?Set SDK_ROOT to your Android SDK path (platform android-36, build-tools 36.0.0)}"
bt="$SDK_ROOT/build-tools/36.0.0"
platform="$SDK_ROOT/platforms/android-36/android.jar"
mkdir -p build/classes build/dex dist
"$bt/aapt" package -f -M AndroidManifest.xml -S res -A assets -I "$platform" -F build/resources.apk
java com.sun.tools.javac.Main -source 8 -target 8 -classpath "$platform" -d build/classes src/ca/kylekeith/shottime/MainActivity.java
mapfile -t class_files < <(find build/classes -name '*.class' -type f)
"$bt/d8" --lib "$platform" --min-api 26 --output build/dex "${class_files[@]}"
cp build/resources.apk build/unsigned.apk
python3 -c 'from zipfile import ZipFile, ZIP_DEFLATED
with ZipFile("build/unsigned.apk","a",ZIP_DEFLATED) as z:z.write("build/dex/classes.dex","classes.dex")'
"$bt/zipalign" -f -p 4 build/unsigned.apk build/aligned.apk
if [ ! -f signing/shottime.jks ] || [ ! -f signing/password.txt ]; then
  echo 'Restore the private ShotTime signing backup into signing/ before building an update.' >&2
  exit 1
fi
"$bt/apksigner" sign --ks signing/shottime.jks --ks-key-alias shottime --ks-pass file:signing/password.txt --out dist/ShotTime-v1.21.0.apk build/aligned.apk
"$bt/apksigner" verify --verbose dist/ShotTime-v1.21.0.apk
"$bt/zipalign" -c -p 4 dist/ShotTime-v1.21.0.apk
"$bt/aapt" dump badging dist/ShotTime-v1.21.0.apk
