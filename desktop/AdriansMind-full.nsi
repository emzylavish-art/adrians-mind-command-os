Unicode true
Name "Adrian's Mind"
OutFile "..\public\downloads\AdriansMind-Setup.exe"
InstallDir "$LOCALAPPDATA\Programs\Adrian's Mind"
RequestExecutionLevel user
SetCompressor /SOLID lzma

Page instfiles

Section "Adrian's Mind"
  SetOutPath "$INSTDIR"
  File /r "win-unpacked\*.*"
  CreateDirectory "$SMPROGRAMS\Adrian's Mind"
  CreateShortcut "$SMPROGRAMS\Adrian's Mind\Adrian's Mind.lnk" "$INSTDIR\Adrian's Mind.exe"
  CreateShortcut "$SMPROGRAMS\Adrian's Mind\Uninstall.lnk" "$INSTDIR\Uninstall.exe"
  WriteUninstaller "$INSTDIR\Uninstall.exe"
SectionEnd

Section "Uninstall"
  RMDir /r "$INSTDIR"
  Delete "$SMPROGRAMS\Adrian's Mind\Adrian's Mind.lnk"
  Delete "$SMPROGRAMS\Adrian's Mind\Uninstall.lnk"
  RMDir "$SMPROGRAMS\Adrian's Mind"
SectionEnd
