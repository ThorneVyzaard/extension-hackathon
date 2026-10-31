@echo off
setlocal
title FakeLens - Backend
cd /d "%~dp0backend"

REM --- Trouver Python (commande "python" ou lanceur "py")
set PY=python
where python >nul 2>nul || set PY=py
where %PY% >nul 2>nul
if errorlevel 1 (
  echo [ERREUR] Python est introuvable. Installez Python 3.10+ depuis python.org en cochant "Add to PATH".
  pause
  exit /b 1
)

if not exist model.pt (
  echo [ERREUR] backend\model.pt est introuvable. Copiez-y votre modele .pt puis relancez.
  pause
  exit /b 1
)

if not exist .venv (
  echo [1/3] Creation de l'environnement virtuel...
  %PY% -m venv .venv
  if errorlevel 1 ( echo [ERREUR] Creation du venv impossible. & pause & exit /b 1 )
)
call .venv\Scripts\activate

if not exist .venv\.deps_ok (
  echo [2/3] Installation des dependances. PyTorch est volumineux : cela peut prendre plusieurs minutes, patientez...
  python -m pip install -r requirements.txt
  if errorlevel 1 ( echo [ERREUR] L'installation a echoue. & pause & exit /b 1 )
  echo ok> .venv\.deps_ok
) else (
  echo [2/3] Dependances deja installees.
)

echo [3/3] Demarrage du backend sur http://127.0.0.1:8000  (Ctrl+C pour arreter)
python -m uvicorn main:app --host 127.0.0.1 --port 8000
echo.
echo Le backend s'est arrete. Lisez le message d'erreur ci-dessus.
pause
