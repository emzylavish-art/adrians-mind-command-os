Unicode true
Name "Adrian's Mind"
OutFile "AdriansMind-Setup-full.exe"
InstallDir "$LOCALAPPDATA\Programs\Adrian's Mind"
RequestExecutionLevel admin
SetCompressor /SOLID lzma

Page instfiles

Section "Adrian's Mind"
  SetOutPath "$INSTDIR"
  File /r "win-unpacked\*.*"
  CreateDirectory "$SMPROGRAMS\Adrian's Mind"
  CreateShortcut "$DESKTOP\Adrian's Mind.lnk" "$INSTDIR\Adrian's Mind.exe"
  CreateShortcut "$SMPROGRAMS\Adrian's Mind\Adrian's Mind.lnk" "$INSTDIR\Adrian's Mind.exe"
  CreateShortcut "$SMPROGRAMS\Adrian's Mind\Pair this PC.lnk" "$WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe" "-NoProfile -ExecutionPolicy Bypass -File $\"$INSTDIR\resources\companion\Pair-Now.ps1$\""
  CreateShortcut "$SMPROGRAMS\Adrian's Mind\Emergency stop.lnk" "$WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe" "-NoProfile -ExecutionPolicy Bypass -File $\"$INSTDIR\resources\companion\Emergency-Stop.ps1$\""
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  CreateShortcut "$SMPROGRAMS\Adrian's Mind\Uninstall.lnk" "$INSTDIR\Uninstall.exe"
  WriteRegStr HKCU "Software\Microsoft\Windows NT\CurrentVersion\AppCompatFlags\Layers" "$INSTDIR\Adrian's Mind.exe" "~ RUNASADMIN"
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
