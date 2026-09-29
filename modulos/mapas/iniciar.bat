@echo off
REM Inicia o Mapa de Chuva COA neste computador (abre no navegador).
cd /d "%~dp0"
if not exist node_modules (
  echo Instalando dependencias pela primeira vez...
  call npm install
)
echo Gerando a versao de producao...
call npm run build || goto erro
REM Abre o navegador alguns segundos depois, quando o servidor ja estiver escutando.
start "" /min cmd /c "timeout /t 4 /nobreak >nul & start http://localhost:4173/"
echo.
echo Mapa de Chuva COA rodando em http://localhost:4173/  (feche esta janela para parar)
call npx vite preview --port 4173 --strictPort
goto fim
:erro
echo Falha ao gerar o site. Veja as mensagens acima.
pause
:fim
