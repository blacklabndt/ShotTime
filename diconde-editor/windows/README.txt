DICONDE Editor for Windows
==========================

Run DiCondeEditor.exe. To open .dcm files by double-clicking, right-click a .dcm file, choose
"Open with" > "Choose another app", browse to DiCondeEditor.exe and tick "Always use this app".

Requirements: Windows 10 or 11 (these include .NET Framework 4.8 and the Microsoft Edge WebView2
Runtime). Keep the "app" folder and the .dll files next to DiCondeEditor.exe.

The original file is never overwritten: every save writes a new file, by default in the same
folder as the original. Settings such as overlay layouts and templates are kept in
%LOCALAPPDATA%\DICONDE Editor.

The program is not code-signed, so Windows SmartScreen may warn the first time you run it
("More info" > "Run anyway").

Third-party software: Microsoft Edge WebView2 SDK (licenses\WebView2-LICENSE.txt); OpenJPEG via
@cornerstonejs/codec-openjpeg (app\vendor\openjpeg\THIRD-PARTY-NOTICES.md).
