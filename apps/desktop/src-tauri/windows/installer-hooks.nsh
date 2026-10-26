!macro NSIS_HOOK_POSTINSTALL
  ; 特权内核服务（#81）：LocalSystem 运行、开机自启——安装一次 = TUN 授权一次。
  ; create 在升级安装已存在时报错，忽略后用 config 兜底刷新 binPath。
  nsExec::Exec 'sc.exe create CrossbowService binPath= "\"$INSTDIR\crossbow-service.exe\"" start= auto obj= LocalSystem DisplayName= "Crossbow Service"'
  nsExec::Exec 'sc.exe config CrossbowService binPath= "\"$INSTDIR\crossbow-service.exe\"" start= auto obj= LocalSystem'
  nsExec::Exec 'sc.exe description CrossbowService "Crossbow privileged core service (TUN)"'
  nsExec::Exec 'sc.exe start CrossbowService'
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  nsExec::Exec 'sc.exe stop CrossbowService'
  nsExec::Exec 'sc.exe delete CrossbowService'
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
!macroend
