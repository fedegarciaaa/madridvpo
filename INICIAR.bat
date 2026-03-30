@echo off
title MadridVPO — Vivienda Protegida Madrid
color 0D

:: ─────────────────────────────────────────
:: MadridVPO v1.0.0
:: Plataforma VPO/VPPL Madrid
:: ─────────────────────────────────────────

echo.
echo  ==========================================
echo    MadridVPO - Vivienda Protegida Madrid
echo  ==========================================
echo.

:: Verificar Node.js
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js no esta instalado.
    echo         Descargalo en https://nodejs.org
    pause
    exit /b 1
)

:: Verificar .env
if not exist ".env" (
    echo [AVISO] Fichero .env no encontrado.
    echo         Copiando .env.example como punto de partida...
    copy ".env.example" ".env" >nul
    echo         Edita el fichero .env con tus credenciales antes de continuar.
    pause
    exit /b 1
)

:: Instalar dependencias si no existen
if not exist "node_modules" (
    echo [INFO] Instalando dependencias npm...
    npm install
    if %errorlevel% neq 0 (
        echo [ERROR] Fallo al instalar dependencias.
        pause
        exit /b 1
    )
)

:: Crear carpeta uploads si no existe
if not exist "uploads" mkdir uploads

:: Verificar si ya hay servidor corriendo en puerto 3004
netstat -ano | findstr ":3004" | findstr "LISTENING" >nul 2>&1
if %errorlevel% equ 0 (
    echo [INFO] Servidor ya corriendo en puerto 3004
    echo        Abriendo navegador...
    start "" "http://localhost:3004"
    exit /b 0
)

echo [INFO] Iniciando servidor MadridVPO en puerto 3004...
echo.

:: Arrancar en ventana minimizada + abrir navegador
start "MadridVPO Server" /min cmd /c "node server\index.js & pause"
timeout /t 2 /nobreak >nul
start "" "http://localhost:3004"

echo [OK] Servidor iniciado. Abriendo http://localhost:3004
echo.
