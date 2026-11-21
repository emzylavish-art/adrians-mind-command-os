Unicode true
Name "Adrian's Mind"
OutFile "..\..\public\downloads\AdriansMind-Setup.exe"
InstallDir "$LOCALAPPDATA\AdrianMind"
RequestExecutionLevel user
SetCompress off

!include nsDialogs.nsh
!include LogicLib.nsh

Var Dialog
Var UrlCtl
Var CodeCtl
Var DashboardUrl
Var PairingCode
Var PairResult

Page custom PairPage PairLeave
Page instfiles
UninstPage uninstConfirm
UninstPage instfiles

Function .onInit
  StrCpy $DashboardUrl "https://adrians-mind.vercel.app"
  StrCpy $PairingCode ""
FunctionEnd

Function PairPage
  nsDialogs::Create 1018
  Pop $Dialog
  ${If} $Dialog == error
    Abort
  ${EndIf}

  ${NSD_CreateLabel} 0 0 100% 36u "Installs Adrian's Mind for this Windows user. On the signed-in site, open Build and press Mint pairing code. Paste that code here. It expires in five minutes. Leave it blank to install the files and pair later from the Start menu."
  Pop $0

  ${NSD_CreateLabel} 0 40u 100% 8u "Dashboard"
  Pop $0
  ${NSD_CreateText} 0 50u 100% 12u "https://adrians-mind.vercel.app"
  Pop $UrlCtl

  ${NSD_CreateLabel} 0 68u 100% 8u "Pairing code"
  Pop $0
  ${NSD_CreateText} 0 78u 100% 12u ""
  Pop $CodeCtl

  nsDialogs::Show
FunctionEnd

Function PairLeave
  ${NSD_GetText} $UrlCtl $DashboardUrl
  ${NSD_GetText} $CodeCtl $PairingCode
FunctionEnd

Section "Companion"
  SetOutPath "$INSTDIR"
  File "DesktopControl.ps1"
  File "Permissions.ps1"
  File "MindAgent.ps1"
  File "Install-MindAgent.ps1"
  File "Uninstall-MindAgent.ps1"
  File "Emergency-Stop.ps1"
  File "KimiAcpClient.mjs"
  File "Pair-Now.ps1"
  File "README.md"
  WriteUninstaller "$INSTDIR\Uninstall.exe"

  CreateDirectory "$SMPROGRAMS\Adrian's Mind"
  CreateShortcut "$SMPROGRAMS\Adrian's Mind\Pair this PC.lnk" "$WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe" "-NoProfile -ExecutionPolicy Bypass -File $\"$INSTDIR\Pair-Now.ps1$\""
  CreateShortcut "$SMPROGRAMS\Adrian's Mind\Emergency stop.lnk" "$WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe" "-NoProfile -ExecutionPolicy Bypass -File $\"$INSTDIR\Emergency-Stop.ps1$\""
  CreateShortcut "$SMPROGRAMS\Adrian's Mind\Companion folder.lnk" "$INSTDIR"
  CreateShortcut "$SMPROGRAMS\Adrian's Mind\Uninstall.lnk" "$INSTDIR\Uninstall.exe"

  ${If} $PairingCode != ""
    ClearErrors
    FileOpen $0 "$INSTDIR\pair-request.txt" w
    FileWrite $0 "$DashboardUrl$\r$\n"
    FileWrite $0 "$PairingCode$\r$\n"
    FileClose $0
    DetailPrint "Running the companion install with the pasted pairing code."
    nsExec::ExecToLog '"$WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\Pair-Now.ps1"'
    Pop $PairResult
    DetailPrint "Pairing script exit code: $PairResult"
    ${If} $PairResult != 0
      MessageBox MB_OK|MB_ICONEXCLAMATION "The files are installed, but pairing did not finish. Mint a new code and run Start menu, Adrian's Mind, Pair this PC."
    ${EndIf}
  ${Else}
    DetailPrint "Files installed. Pairing was left for Start menu, Adrian's Mind, Pair this PC."
  ${EndIf}
SectionEnd

Section "Uninstall"
  Delete "$INSTDIR\DesktopControl.ps1"
  Delete "$INSTDIR\Permissions.ps1"
  Delete "$INSTDIR\MindAgent.ps1"
  Delete "$INSTDIR\Install-MindAgent.ps1"
  Delete "$INSTDIR\Uninstall-MindAgent.ps1"
  Delete "$INSTDIR\Emergency-Stop.ps1"
  Delete "$INSTDIR\KimiAcpClient.mjs"
  Delete "$INSTDIR\Pair-Now.ps1"
  Delete "$INSTDIR\pair-request.txt"
  Delete "$INSTDIR\README.md"
  Delete "$INSTDIR\Uninstall.exe"
  RMDir "$INSTDIR"
  Delete "$SMPROGRAMS\Adrian's Mind\Pair this PC.lnk"
  Delete "$SMPROGRAMS\Adrian's Mind\Emergency stop.lnk"
  Delete "$SMPROGRAMS\Adrian's Mind\Companion folder.lnk"
  Delete "$SMPROGRAMS\Adrian's Mind\Uninstall.lnk"
  RMDir "$SMPROGRAMS\Adrian's Mind"
SectionEnd
