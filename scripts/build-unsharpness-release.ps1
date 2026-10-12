$ErrorActionPreference='Stop'
$releaseRoot=Split-Path $PSScriptRoot -Parent
Push-Location $releaseRoot
try {
    $env:JAVA_HOME=[Environment]::GetEnvironmentVariable('JAVA_HOME','Machine')
    $env:PATH=(Join-Path $env:JAVA_HOME 'bin')+';'+$env:PATH
    & ./build-review.ps1
    $releaseTools=Join-Path $env:LOCALAPPDATA 'Android/Sdk/build-tools/36.0.0'
    & (Join-Path $releaseTools 'apksigner.bat') sign --ks ../../claude-test8/ShotTime/signing/shottime.jks --ks-key-alias shottime --ks-pass file:../../claude-test8/ShotTime/signing/password.txt --out dist/RT-Handbook-v1.89.apk dist/ShotTime-review-unsigned.apk
    if($LASTEXITCODE -ne 0){throw 'Signing failed'}
    & (Join-Path $releaseTools 'apksigner.bat') verify --verbose --print-certs dist/RT-Handbook-v1.89.apk
    if($LASTEXITCODE -ne 0){throw 'Signature verification failed'}
    & (Join-Path $releaseTools 'zipalign.exe') -c -P 16 4 dist/RT-Handbook-v1.89.apk
    if($LASTEXITCODE -ne 0){throw 'Alignment verification failed'}
    Get-FileHash -LiteralPath 'dist/RT-Handbook-v1.89.apk' -Algorithm SHA256
} finally { Pop-Location }
