param([string]$SdkRoot=$env:ANDROID_HOME, [string]$JavaHome=$env:JAVA_HOME)
$ErrorActionPreference='Stop'
if (-not $SdkRoot) { $SdkRoot=Join-Path $env:LOCALAPPDATA 'Android/Sdk' }
if (-not $JavaHome) { $JavaHome=[Environment]::GetEnvironmentVariable('JAVA_HOME','Machine') }
if (-not $JavaHome) { throw 'Set JAVA_HOME to JDK 21 before building.' }
$env:JAVA_HOME=$JavaHome
$env:PATH=(Join-Path $JavaHome 'bin')+';'+$env:PATH
$buildTools=Join-Path $SdkRoot 'build-tools/36.0.0'
$platform=Join-Path $SdkRoot 'platforms/android-36/android.jar'
function Run-Tool([string]$Tool, [string[]]$Arguments) {
    & $Tool @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Tool failed with exit code $LASTEXITCODE" }
}
Push-Location $PSScriptRoot
try {
    $build=Join-Path $PSScriptRoot ('build/windows-'+[Guid]::NewGuid().ToString('N'))
    $classes=Join-Path $build 'classes'
    $dex=Join-Path $build 'dex'
    $dist=Join-Path $PSScriptRoot 'dist'
    New-Item -ItemType Directory -Force $classes,$dex,$dist | Out-Null
    $unsigned=Join-Path $build 'unsigned.apk'
    Run-Tool (Join-Path $buildTools 'aapt.exe') @('package','-f','-M','AndroidManifest.xml','-S','res','-A','assets','-I',$platform,'-F',$unsigned)
    $sources=@(Get-ChildItem -LiteralPath 'src' -Recurse -Filter '*.java' -File | ForEach-Object FullName)
    Run-Tool (Join-Path $JavaHome 'bin/javac.exe') (@('-source','8','-target','8','-classpath',$platform,'-d',$classes)+$sources)
    $classFiles=@(Get-ChildItem -LiteralPath $classes -Recurse -Filter '*.class' -File | ForEach-Object FullName)
    Run-Tool (Join-Path $buildTools 'd8.bat') (@('--lib',$platform,'--min-api','26','--output',$dex)+$classFiles)
    Run-Tool (Join-Path $JavaHome 'bin/jar.exe') @('uf',$unsigned,'-C',$dex,'classes.dex')
    $voicePackage=Join-Path $PSScriptRoot 'build/voice-package'
    if(!(Test-Path "$voicePackage/lib/arm64-v8a/libshottime_whisper.so") -or !(Test-Path "$voicePackage/assets/voice/ggml-small.en-q5_1.bin") -or !(Test-Path "$voicePackage/assets/voice/ggml-silero-v6.2.0.bin")){throw 'Run build-voice.ps1 before packaging the voice APK.'}
    if(!(Test-Path "$voicePackage/lib/arm64-v8a/libshottime_whisper_fast.so")){throw 'Rebuild voice payload: optimized library missing.'}
    if(Test-Path "$voicePackage/assets/voice/ggml-base.en.bin"){throw 'Old base.en model in build/voice-package; rerun build-voice.ps1.'}
    $payloadArgs=@('uf',$unsigned)
    foreach($payload in Get-ChildItem -LiteralPath $voicePackage -Recurse -File){$payloadArgs+=@('-C',$voicePackage,$payload.FullName.Substring($voicePackage.Length+1))}
    Run-Tool (Join-Path $JavaHome 'bin/jar.exe') $payloadArgs
    $apk=Join-Path $dist 'ShotTime-review-unsigned.apk'
    Run-Tool (Join-Path $buildTools 'zipalign.exe') @('-f','-P','16','4',$unsigned,$apk)
    Run-Tool (Join-Path $buildTools 'zipalign.exe') @('-c','-P','16','4',$apk)
    Run-Tool (Join-Path $buildTools 'aapt.exe') @('dump','badging',$apk)
    Write-Output "Unsigned APK: $apk"
} finally { Pop-Location }
