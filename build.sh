#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
: "${SDK_ROOT:?Set SDK_ROOT to your Android SDK path (platform android-36, build-tools 36.0.0)}"
bt="$SDK_ROOT/build-tools/36.0.0"
version=$(python3 -c 'import xml.etree.ElementTree as E; print(E.parse("AndroidManifest.xml").getroot().attrib["{http://schemas.android.com/apk/res/android}versionName"])')
output="dist/RT-Handbook-v${version}.apk"
if [ -e "$output" ]; then
  echo "Release artifact already exists: $output. Preserve or rename it before building again." >&2
  exit 1
fi
bash build-review.sh
cp dist/ShotTime-review-unsigned.apk build/aligned.apk
if [ ! -f signing/shottime.jks ] || [ ! -f signing/password.txt ]; then
  echo 'Restore the private ShotTime signing backup into signing/ before building an update.' >&2
  exit 1
fi
"$bt/apksigner" sign --ks signing/shottime.jks --ks-key-alias shottime --ks-pass file:signing/password.txt --out "$output" build/aligned.apk
"$bt/apksigner" verify --verbose "$output"
"$bt/zipalign" -c -P 16 4 "$output"
"$bt/aapt" dump badging "$output"
