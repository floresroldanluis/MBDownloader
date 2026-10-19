!macro customHeader
  BrandingText "MB Downloader · Rápido · Flexible · Personal"
!macroend

!macro customInstall
  ${If} ${FileExists} "$newDesktopLink"
    Delete "$newDesktopLink"
    CreateShortCut "$newDesktopLink" "$appExe" "" "$INSTDIR\resources\mb-downloader-0.4.44.ico" 0 "" "" "MB Downloader"
    WinShell::SetLnkAUMI "$newDesktopLink" "${APP_ID}"
  ${EndIf}
  ${If} ${FileExists} "$newStartMenuLink"
    Delete "$newStartMenuLink"
    CreateShortCut "$newStartMenuLink" "$appExe" "" "$INSTDIR\resources\mb-downloader-0.4.44.ico" 0 "" "" "MB Downloader"
    WinShell::SetLnkAUMI "$newStartMenuLink" "${APP_ID}"
  ${EndIf}
  System::Call 'Shell32::SHChangeNotify(i 0x08000000, i 0, i 0, i 0)'
!macroend

!macro customWelcomePage
  !define MUI_WELCOMEPAGE_TITLE "Bienvenido a MB Downloader"
  !define MUI_WELCOMEPAGE_TITLE_3LINES
  !define MUI_WELCOMEPAGE_TEXT "Tu contenido, donde lo necesitas.$\r$\n$\r$\nEste asistente instalará MB Downloader y sus motores multimedia. Podrás elegir quién usará la aplicación y dónde guardarla.$\r$\n$\r$\nPulsa Siguiente para comenzar."
  !insertmacro MUI_PAGE_WELCOME
!macroend

!macro customFinishPage
  Function StartMbDownloader
    ${If} ${isUpdated}
      StrCpy $1 "--updated"
    ${Else}
      StrCpy $1 ""
    ${EndIf}
    ${StdUtils.ExecShellAsUser} $0 "$launchLink" "open" "$1"
  FunctionEnd

  !define MUI_FINISHPAGE_TITLE "MB Downloader está listo"
  !define MUI_FINISHPAGE_TITLE_3LINES
  !define MUI_FINISHPAGE_TEXT "La instalación terminó correctamente.$\r$\n$\r$\nYa puedes pegar un enlace y comenzar tu primera descarga."
  !define MUI_FINISHPAGE_RUN
  !define MUI_FINISHPAGE_RUN_TEXT "Abrir MB Downloader ahora"
  !define MUI_FINISHPAGE_RUN_FUNCTION "StartMbDownloader"
  !define MUI_FINISHPAGE_LINK "Ver MB Downloader en GitHub"
  !define MUI_FINISHPAGE_LINK_LOCATION "https://github.com/floresroldanluis/MBDownloader"
  !insertmacro MUI_PAGE_FINISH
!macroend
