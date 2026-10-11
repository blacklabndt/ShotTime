$ErrorActionPreference = 'Stop'
$project = Split-Path $PSScriptRoot -Parent
$classes = Join-Path $project 'build/voice-journal-tests'
New-Item -ItemType Directory -Force $classes | Out-Null
$stubs = Get-ChildItem (Join-Path $PSScriptRoot 'journal-stubs') -Recurse -Filter '*.java' | Select-Object -ExpandProperty FullName
& javac -d $classes @stubs (Join-Path $project 'src/ca/kylekeith/shottime/VoiceJournal.java') (Join-Path $PSScriptRoot 'VoiceJournalTest.java')
if ($LASTEXITCODE -ne 0) { throw 'Voice journal test compilation failed' }
& java -cp $classes ca.kylekeith.shottime.VoiceJournalTest
if ($LASTEXITCODE -ne 0) { throw 'Voice journal regression failed' }
