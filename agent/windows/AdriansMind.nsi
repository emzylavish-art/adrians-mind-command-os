Unicode true
Name "Adrian's Mind"
OutFile "..\..\public\downloads\AdriansMind-Setup.exe"
InstallDir "$LOCALAPPDATA\AdrianMind"
RequestExecutionLevel user
SetCompress off

Page directory
Page instfiles
UninstPage uninstConfirm
UninstPage instfiles

Section "Companion"
  SetOutPath "$INSTDIR"
  File "DesktopControl.ps1"
  File "Permissions.ps1"
  File "MindAgent.ps1"
  File "Install-MindAgent.ps1"
  File "Uninstall-MindAgent.ps1"
  File "Emergency-Stop.ps1"
  File "KimiAcpClient.mjs"
  File "README.md"
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  CreateDirectory "$SMPROGRAMS\Adrian's Mind"
  CreateShortcut "$SMPROGRAMS\Adrian's Mind\Companion folder.lnk" "$INSTDIR"
  CreateShortcut "$SMPROGRAMS\Adrian's Mind\Uninstall.lnk" "$INSTDIR\Uninstall.exe"
SectionEnd

Section "Uninstall"
  Delete "$INSTDIR\DesktopControl.ps1"
  Delete "$INSTDIR\Permissions.ps1"
  Delete "$INSTDIR\MindAgent.ps1"
  Delete "$INSTDIR\Install-MindAgent.ps1"
  Delete "$INSTDIR\Uninstall-MindAgent.ps1"
  Delete "$INSTDIR\Emergency-Stop.ps1"
  Delete "$INSTDIR\KimiAcpClient.mjs"
  Delete "$INSTDIR\README.md"
  Delete "$INSTDIR\Uninstall.exe"
  RMDir "$INSTDIR"
  Delete "$SMPROGRAMS\Adrian's Mind\Companion folder.lnk"
  Delete "$SMPROGRAMS\Adrian's Mind\Uninstall.lnk"
  RMDir "$SMPROGRAMS\Adrian's Mind"
SectionEnd
