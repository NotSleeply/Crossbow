!include "LogicLib.nsh"
!macro NSIS_HOOK_PREINSTALL
  ; A LocalSystem service must never execute out of a user-writable installation.
  StrLen $0 "$PROGRAMFILES64\"
  StrCpy $1 "$INSTDIR\" $0
  ${If} $1 != "$PROGRAMFILES64\"
    MessageBox MB_ICONSTOP "Crossbow TUN service requires installation under Program Files." /SD IDOK
    SetErrorLevel 101
    Abort
  ${EndIf}
  ; Upgrades must stop the broker AND its managed core before replacing binaries.
  nsExec::ExecToStack 'powershell.exe -NoProfile -NonInteractive -WindowStyle Hidden -Command "try { $$s=Get-Service CrossbowService -ErrorAction SilentlyContinue; if ($$s) { Stop-Service CrossbowService -ErrorAction Stop; $$s.WaitForStatus([System.ServiceProcess.ServiceControllerStatus]::Stopped,[TimeSpan]::FromSeconds(30)) }; exit 0 } catch { Write-Error $$_.Exception.Message; exit 1 }"'
  Pop $0
  Pop $1
  ${If} $0 != 0
    MessageBox MB_ICONSTOP "Cannot stop Crossbow service for upgrade. Please restart Windows and retry." /SD IDOK
    SetErrorLevel 102
    Abort
  ${EndIf}
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ; Backslash-quoted inner quotes are for sc.exe's Windows argv parser, while
  ; outer quotes keep the complete image path (including spaces) in one argument.
  nsExec::ExecToStack '"$SYSDIR\sc.exe" create CrossbowService binPath= "\"$INSTDIR\crossbow-service.exe\"" start= auto obj= LocalSystem DisplayName= "Crossbow Service"'
  Pop $0
  Pop $1
  ${If} $0 != 0
  ${AndIf} $0 != 1073
    MessageBox MB_ICONSTOP "Cannot register Crossbow service ($0). Please rerun the installer as administrator." /SD IDOK
    SetErrorLevel 103
    Abort
  ${EndIf}
  nsExec::ExecToStack '"$SYSDIR\sc.exe" config CrossbowService binPath= "\"$INSTDIR\crossbow-service.exe\"" start= auto obj= LocalSystem'
  Pop $0
  Pop $1
  ${If} $0 != 0
    MessageBox MB_ICONSTOP "Cannot configure Crossbow service ($0)." /SD IDOK
    SetErrorLevel 104
    Abort
  ${EndIf}
  nsExec::ExecToStack '"$SYSDIR\sc.exe" start CrossbowService'
  Pop $0
  Pop $1
  ${If} $0 != 0
    MessageBox MB_ICONSTOP "Cannot start Crossbow service ($0). Please repair the installation." /SD IDOK
    SetErrorLevel 105
    Abort
  ${EndIf}
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  nsExec::ExecToStack 'powershell.exe -NoProfile -NonInteractive -WindowStyle Hidden -Command "try { $$s=Get-Service CrossbowService -ErrorAction SilentlyContinue; if ($$s) { Stop-Service CrossbowService -ErrorAction Stop; $$s.WaitForStatus([System.ServiceProcess.ServiceControllerStatus]::Stopped,[TimeSpan]::FromSeconds(30)) }; exit 0 } catch { Write-Error $$_.Exception.Message; exit 1 }"'
  Pop $0
  Pop $1
  ${If} $0 != 0
    MessageBox MB_ICONSTOP "Cannot stop Crossbow service. Please restart Windows before uninstalling." /SD IDOK
    SetErrorLevel 106
    Abort
  ${EndIf}
  nsExec::Exec '"$SYSDIR\sc.exe" delete CrossbowService'
  ; 卸载器只处理主程序：内核子进程必须在此先杀，否则残留内核占着
  ; 混合端口，重装后首次启动报 os error 10048（#233）。按镜像名清理，
  ; 覆盖 sidecar 三元组命名与 data 目录下载命名。
  nsExec::ExecToLog 'taskkill /F /IM "mihomo.exe" /T'
  Pop $0
  nsExec::ExecToLog 'taskkill /F /IM "mihomo-x86_64-pc-windows-msvc.exe" /T'
  Pop $0
  nsExec::ExecToLog 'taskkill /F /IM "sing-box.exe" /T'
  Pop $0
  nsExec::ExecToLog 'taskkill /F /IM "sing-box-x86_64-pc-windows-msvc.exe" /T'
  Pop $0
  ; Service-owned config/cache must not survive an uninstall with user secrets.
  RMDir /r "$INSTDIR\service-runtime"
!macroend
