Unicode true
!include "MUI2.nsh"
!include "FileFunc.nsh"

Name "DomeOS AI"
OutFile "C:\Users\wslaoliu7a\Desktop\DomeOS AI Alpha\work\out-installer\DomeOSAI-Setup.exe"
InstallDir "$PROGRAMFILES64\DomeOS AI"
InstallDirRegKey HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\43650b54-3833-52e2-96fa-498f468cb58d" "InstallLocation"
RequestExecutionLevel admin
SetCompressor /SOLID lzma
ShowInstDetails show
ShowUninstDetails show

!define APP_GUID "43650b54-3833-52e2-96fa-498f468cb58d"
!define APP_AUMID "com.domeos.ai"
!define APP_NAME "DomeOS AI"
!define APP_DESC "DomeOS AI Voice Services"
!define SRC "C:\Users\wslaoliu7a\Desktop\DomeOS AI Alpha\work\app"

!define MUI_ICON "C:\Users\wslaoliu7a\Desktop\DomeOS AI Alpha\work\installer\uninstallerIcon.ico"
!define MUI_UNICON "C:\Users\wslaoliu7a\Desktop\DomeOS AI Alpha\work\installer\uninstallerIcon.ico"
!define MUI_WELCOMEFINISHPAGE_BITMAP "C:\Users\wslaoliu7a\AppData\Local\Temp\opencode\modern-wizard.bmp"
!define MUI_ABORTWARNING
!define MUI_FINISHPAGE_NOAUTOCLOSE

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "SimpChinese"
!insertmacro MUI_LANGUAGE "English"

Section "DomeOSAI" SecMain
  SectionIn RO
  SetShellVarContext all
  SetOutPath "$INSTDIR"

  ; stop a running copy so its files can be replaced
  nsExec::ExecToLog 'taskkill /IM "DomeOS AI.exe" /F'

  File /r "${SRC}\*.*"

  WriteUninstaller "$INSTDIR\Uninstall ${APP_NAME}.exe"

  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_GUID}" "DisplayName" "${APP_NAME}"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_GUID}" "Publisher" "DomeOS Team"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_GUID}" "DisplayIcon" "$INSTDIR\uninstallerIcon.ico"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_GUID}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_GUID}" "UninstallString" '"$INSTDIR\Uninstall ${APP_NAME}.exe" /allusers'
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_GUID}" "QuietUninstallString" '"$INSTDIR\Uninstall ${APP_NAME}.exe" /allusers /S'
  WriteRegDWORD HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_GUID}" "NoModify" 1
  WriteRegDWORD HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_GUID}" "NoRepair" 1
  ; the version is deliberately not written, so the column stays empty
  DeleteRegValue HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_GUID}" "DisplayVersion"
  DeleteRegValue HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_GUID}" "EstimatedSize"

  ${GetSize} "$INSTDIR" "/S=0K" $0 $1 $2
  IntFmt $0 "0x%08X" $0
  WriteRegDWORD HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_GUID}" "EstimatedSize" "$0"

  ; All Users start menu entry
  CreateShortCut "$SMPROGRAMS\${APP_NAME}.lnk" "$INSTDIR\DomeOS AI.exe" "" "$INSTDIR\DomeOS AI.exe" 0 SW_SHOWNORMAL "" "${APP_DESC}"

  ; the process calls app.setAppUserModelId('com.domeos.ai'); give that id a friendly name so
  ; Task Manager / the taskbar show "DomeOS AI" instead of the executable description
  WriteRegStr HKLM "Software\Classes\AppUserModelId\${APP_AUMID}" "DisplayName" "${APP_NAME}"
  WriteRegStr HKLM "Software\Classes\AppUserModelId\${APP_AUMID}" "IconUri" "$INSTDIR\DomeOS AI.exe"
  WriteRegStr HKCU "Software\Classes\AppUserModelId\${APP_AUMID}" "DisplayName" "${APP_NAME}"
  WriteRegStr HKCU "Software\Classes\AppUserModelId\${APP_AUMID}" "IconUri" "$INSTDIR\DomeOS AI.exe"

  ; tie the shortcut to the same AppUserModelID
  WinShell::SetLnkAUMI "$SMPROGRAMS\${APP_NAME}.lnk" "${APP_AUMID}"
  Pop $0

  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, i 0, i 0)'
SectionEnd

Section "Uninstall"
  SetShellVarContext all
  nsExec::ExecToLog 'taskkill /IM "DomeOS AI.exe" /F'
  Delete "$SMPROGRAMS\${APP_NAME}.lnk"
  RMDir /r "$INSTDIR"
  DeleteRegKey HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_GUID}"
  DeleteRegKey HKLM "Software\Classes\AppUserModelId\${APP_AUMID}"
  DeleteRegKey HKCU "Software\Classes\AppUserModelId\${APP_AUMID}"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, i 0, i 0)'
SectionEnd
