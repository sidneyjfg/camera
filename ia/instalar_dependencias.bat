@echo off
cd /d "%~dp0"
echo Criando ambiente isolado do monitoramento de IA...
py -3 -m venv ambiente
if errorlevel 1 (
  echo Nao foi possivel criar o ambiente. Instale Python 3.10 ou superior.
  pause
  exit /b 1
)
echo Instalando RF-DETR, Supervision, rastreamento e captura RTSP...
ambiente\Scripts\python.exe -m pip install --upgrade pip
if errorlevel 1 goto falha
ambiente\Scripts\python.exe -m pip install -r dependencias.txt
if errorlevel 1 goto falha
echo.
echo Instalacao concluida. O modelo RF-DETR sera baixado na primeira inicializacao.
pause
exit /b 0

:falha
echo A instalacao falhou. Confira a mensagem acima e tente novamente.
pause
exit /b 1
