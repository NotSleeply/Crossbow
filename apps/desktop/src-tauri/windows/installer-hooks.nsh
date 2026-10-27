!macro NSIS_HOOK_PREINSTALL
  ; A LocalSystem service must never execute out of a user-writable installation.
  StrLen $0 "$PROGRAMFILES64\"
  StrCpy $1 "$INSTDIR\" $0
  StrCmp $1 "$PROGRAMFILES64\" +3
    MessageBox MB_ICONSTOP "Crossbow TUN service requires installation under Program Files."
    Abort
  ; Upgrades must stop the broker AND its managed core before replacing binaries.
  nsExec::ExecToStack 'powershell.exe -NoProfile -NonInteractive -WindowStyle Hidden -Command "$$s=Get-Service CrossbowService -ErrorAction SilentlyContinue; if ($$s) { Stop-Service CrossbowService -ErrorAction Stop; $$s.WaitForStatus([System.ServiceProcess.ServiceControllerStatus]::Stopped,[TimeSpan]::FromSeconds(30)) }"'
  Pop $0
  Pop $1
  StrCmp $0 0 +3
    MessageBox MB_ICONSTOP "Cannot stop Crossbow service for upgrade. Please restart Windows and retry."
    Abort
!macroend

!macro NSIS_HOOK_POSTINSTALL
  nsExec::ExecToStack '"$SYSDIR\sc.exe" create CrossbowService binPath= "$\"$INSTDIR\crossbow-service.exe$\"" start= auto obj= LocalSystem DisplayName= "Crossbow Service"'
  Pop $0
  Pop $1
  StrCmp $0 0 configure_service
  StrCmp $0 1073 configure_service
    MessageBox MB_ICONSTOP "Cannot register Crossbow service ($0). Please rerun the installer as administrator."
    Abort
  configure_service:
  nsExec::ExecToStack '"$SYSDIR\sc.exe" config CrossbowService binPath= "$\"$INSTDIR\crossbow-service.exe$\"" start= auto obj= LocalSystem'
  Pop $0
  Pop $1
  StrCmp $0 0 +3
    MessageBox MB_ICONSTOP "Cannot configure Crossbow service ($0)."
    Abort
  nsExec::ExecToStack '"$SYSDIR\sc.exe" start CrossbowService'
  Pop $0
  Pop $1
  StrCmp $0 0 +3
    MessageBox MB_ICONSTOP "Cannot start Crossbow service ($0). Please repair the installation."
    Abort
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  nsExec::ExecToStack 'powershell.exe -NoProfile -NonInteractive -WindowStyle Hidden -Command "$$s=Get-Service CrossbowService -ErrorAction SilentlyContinue; if ($$s) { Stop-Service CrossbowService -ErrorAction Stop; $$s.WaitForStatus([System.ServiceProcess.ServiceControllerStatus]::Stopped,[TimeSpan]::FromSeconds(30)) }"'
  Pop $0
  Pop $1
  StrCmp $0 0 +3
    MessageBox MB_ICONSTOP "Cannot stop Crossbow service. Please restart Windows before uninstalling."
    Abort
  nsExec::Exec '"$SYSDIR\sc.exe" delete CrossbowService'
  ; Service-owned config/cache must not survive an uninstall with user secrets.
  RMDir /r "$INSTDIR\service-runtime"
!macroend
