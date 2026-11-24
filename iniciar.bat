@echo off
cd /d "%~dp0"
echo Verificando a API local do MediaMTX...
curl.exe --fail --silent http://127.0.0.1:9997/v3/config/paths/list >nul 2>&1
if errorlevel 1 (
  echo Iniciando MediaMTX com mediamtx.local.yml...
  start "CasaView - MediaMTX" /min "%~dp0mediamtx.exe" "%~dp0mediamtx.local.yml"
  call :wait_for_mtx
  if errorlevel 1 (
    echo A API do MediaMTX nao ficou disponivel em 127.0.0.1:9997.
    echo Confira a janela minimizada do MediaMTX para ver o erro de inicializacao.
    pause
    exit /b 1
  )
)
if exist "%~dp0ia\ambiente\Scripts\python.exe" (
  echo Iniciando monitoramento local com RF-DETR Nano...
  start "CasaView - Monitoramento IA" /min "%~dp0ia\ambiente\Scripts\python.exe" "%~dp0ia\monitoramento.py"
) else (
  echo Monitoramento de IA ainda nao instalado.
  echo Execute ia\instalar_dependencias.bat uma vez para habilitar pessoas e animais.
)
if /I "%CASAVIEW_MODO%"=="producao" (
  echo Gerando a versao de producao do CasaView...
  call npm run build
  if errorlevel 1 (
    echo A compilacao falhou. Corrija o erro antes de iniciar o painel.
    pause
    exit /b 1
  )
  echo Iniciando CasaView de producao em localhost:4173.
  npm run start:production
) else (
  echo Iniciando CasaView em modo de desenvolvimento. Mantenha esta janela aberta enquanto usar o painel.
  npm run dev
)
echo.
echo CasaView foi encerrado. Se apareceu algum erro, confira acima.
pause
exit /b

:wait_for_mtx
for /l %%i in (1,1,10) do (
  timeout /t 1 /nobreak >nul
  curl.exe --fail --silent http://127.0.0.1:9997/v3/config/paths/list >nul 2>&1
  if not errorlevel 1 exit /b 0
)
exit /b 1
