Unicode true
Name "Adrian's Mind"
OutFile "AdriansMind-Setup-Full.exe"
InstallDir "$LOCALAPPDATA\Programs\Adrian's Mind"
RequestExecutionLevel user
SetCompressor /SOLID lzma

Page directory "" "" CheckInstallDirectory
Page instfiles

Function CheckInstallDirectory
  ; A custom location must be empty or an installation made by this installer.
  ; User data is outside $INSTDIR and is never deleted by this package.
  IfFileExists "$INSTDIR\*.*" 0 safe
  IfFileExists "$INSTDIR\adrian-install.marker" safe 0
  MessageBox MB_OK|MB_ICONEXCLAMATION "Choose an empty folder or a previously marked Adrian installation. Existing unrelated files will not be overwritten. Your user data remains in its separate profile directory."
  Abort
  safe:
FunctionEnd

Section "Adrian's Mind"
  SetOutPath "$INSTDIR"
  File /r "win-unpacked\*.*"
  FileOpen $0 "$INSTDIR\adrian-install.marker" w
  FileWrite $0 "Adrian's Mind managed installation"
  FileClose $0
  CreateDirectory "$SMPROGRAMS\Adrian's Mind"
  CreateShortcut "$DESKTOP\Adrian's Mind.lnk" "$INSTDIR\Adrian's Mind.exe"
  CreateShortcut "$SMPROGRAMS\Adrian's Mind\Adrian's Mind.lnk" "$INSTDIR\Adrian's Mind.exe"
  CreateShortcut "$SMPROGRAMS\Adrian's Mind\Pair this PC.lnk" "$WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe" "-NoProfile -ExecutionPolicy Bypass -File $\"$INSTDIR\resources\companion\Pair-Now.ps1$\""
  CreateShortcut "$SMPROGRAMS\Adrian's Mind\Emergency stop.lnk" "$WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe" "-NoProfile -ExecutionPolicy Bypass -File $\"$INSTDIR\resources\companion\Emergency-Stop.ps1$\""
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  CreateShortcut "$SMPROGRAMS\Adrian's Mind\Uninstall.lnk" "$INSTDIR\Uninstall.exe"
  Exec "$\"$INSTDIR\Adrian's Mind.exe$\""
SectionEnd

Section "Uninstall"
  RMDir /r "$INSTDIR"
  Delete "$DESKTOP\Adrian's Mind.lnk"
  Delete "$SMPROGRAMS\Adrian's Mind\Adrian's Mind.lnk"
  Delete "$SMPROGRAMS\Adrian's Mind\Pair this PC.lnk"
  Delete "$SMPROGRAMS\Adrian's Mind\Emergency stop.lnk"
  Delete "$SMPROGRAMS\Adrian's Mind\Uninstall.lnk"
  RMDir "$SMPROGRAMS\Adrian's Mind"
  DeleteRegValue HKCU "Software\Microsoft\Windows NT\CurrentVersion\AppCompatFlags\Layers" "$INSTDIR\Adrian's Mind.exe"
SectionEnd
