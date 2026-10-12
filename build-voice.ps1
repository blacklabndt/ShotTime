param([string]$SdkRoot=$env:ANDROID_HOME)
$ErrorActionPreference='Stop'
if(-not $SdkRoot){$SdkRoot=Join-Path $env:LOCALAPPDATA 'Android/Sdk'}
$deps=Join-Path $PSScriptRoot 'build/whisper-deps'
$cmake=Join-Path $SdkRoot 'cmake/3.22.1/bin/cmake.exe'
$ninja=Join-Path $SdkRoot 'cmake/3.22.1/bin/ninja.exe'
$ndk=Join-Path $SdkRoot 'ndk/28.2.13676358'
$source=Join-Path $deps 'whisper.cpp-1.9.4'
$model=Join-Path $deps 'ggml-small.en-q5_1.bin'
$vad=Join-Path $deps 'ggml-silero-v6.2.0.bin'
if(!(Test-Path $cmake) -or !(Test-Path $ndk)){throw 'Install SDK packages ndk;28.2.13676358 and cmake;3.22.1.'}
New-Item -ItemType Directory -Force $deps | Out-Null
$zip=Join-Path $deps 'whisper-v1.9.4.zip'
if(!(Test-Path $zip)){Invoke-WebRequest 'https://github.com/ggml-org/whisper.cpp/archive/refs/tags/v1.9.4.zip' -OutFile $zip}
if((Get-FileHash $zip).Hash -ne '873E67727D51213D3A14A6700C7415900A6645B78C4E6EDAD9328EEA90E53572'){throw 'Whisper source checksum mismatch.'}
if(!(Test-Path $source)){Expand-Archive $zip $deps}
if(!(Test-Path $model)){Invoke-WebRequest 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en-q5_1.bin' -OutFile $model}
if((Get-FileHash $model).Hash -ne 'BFDFF4894DCB76BBF647D56263EA2A96645423F1669176F4844A1BF8E478AD30'){throw 'Whisper model checksum mismatch.'}
if(!(Test-Path $vad)){Invoke-WebRequest 'https://huggingface.co/ggml-org/whisper-vad/resolve/main/ggml-silero-v6.2.0.bin' -OutFile $vad}
if((Get-FileHash $vad).Hash -ne '2AA269B785EEB53A82983A20501DDF7C1D9C48E33AB63A41391AC6C9F7FB6987'){throw 'Speech detector model checksum mismatch.'}
foreach($variant in @(@{Name='arm64';Arch='armv8-a'},@{Name='arm64-fast';Arch='armv8.2-a+fp16+dotprod'})){
$build=Join-Path $PSScriptRoot ('build/whisper-'+$variant.Name)
& $cmake -S (Join-Path $PSScriptRoot 'native') -B $build -G Ninja "-DCMAKE_MAKE_PROGRAM=$ninja" "-DCMAKE_TOOLCHAIN_FILE=$ndk/build/cmake/android.toolchain.cmake" '-DANDROID_ABI=arm64-v8a' '-DANDROID_PLATFORM=android-26' '-DANDROID_STL=c++_static' '-DCMAKE_BUILD_TYPE=Release' "-DWHISPER_SOURCE=$source" "-DGGML_CPU_ARM_ARCH=$($variant.Arch)"
if($LASTEXITCODE -ne 0){throw 'Whisper configuration failed.'}
& $cmake --build $build --config Release -j 4
if($LASTEXITCODE -ne 0){throw 'Whisper compilation failed.'}
}
$package=Join-Path $PSScriptRoot 'build/voice-package'
# Start clean so an older model (base.en, 148 MB) is never packaged alongside the current one.
$voiceAssets=[IO.Path]::GetFullPath((Join-Path $package 'assets/voice'))
$expectedAssets=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot 'build/voice-package/assets/voice'))
if($voiceAssets -ne $expectedAssets){throw 'Unexpected voice asset cleanup path'}
if(Test-Path -LiteralPath $voiceAssets){Remove-Item -LiteralPath $voiceAssets -Recurse -Force}
New-Item -ItemType Directory -Force "$package/lib/arm64-v8a","$package/assets/voice" | Out-Null
Copy-Item "$PSScriptRoot/build/whisper-arm64/libshottime_whisper.so" "$package/lib/arm64-v8a/libshottime_whisper.so" -Force
Copy-Item "$PSScriptRoot/build/whisper-arm64-fast/libshottime_whisper_fast.so" "$package/lib/arm64-v8a/libshottime_whisper_fast.so" -Force
Copy-Item $model "$package/assets/voice/ggml-small.en-q5_1.bin" -Force
Copy-Item $vad "$package/assets/voice/ggml-silero-v6.2.0.bin" -Force
Copy-Item "$source/LICENSE" "$package/assets/voice/whisper-LICENSE.txt" -Force
Write-Output "Voice payload: $package"
