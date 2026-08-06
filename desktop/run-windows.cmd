@echo off
setlocal

set "BASE_DIR=%~dp0"
set "JAR_PATH=%BASE_DIR%target\ms-pac-man-2010-desktop.jar"
set "NATIVE_PATH=%BASE_DIR%target\natives\windows"

if not exist "%JAR_PATH%" (
    set "JAR_PATH=%BASE_DIR%ms-pac-man-2010-desktop.jar"
)
if not exist "%NATIVE_PATH%" (
    set "NATIVE_PATH=%BASE_DIR%natives\windows"
)

if not exist "%JAR_PATH%" (
    echo Missing desktop jar. Run npm.cmd run build:desktop from the repository root.
    exit /b 1
)
if not exist "%NATIVE_PATH%" (
    echo Missing Windows native library directory: %NATIVE_PATH%
    exit /b 1
)

java "-Dorg.lwjgl.librarypath=%NATIVE_PATH%" "-Dnet.java.games.input.librarypath=%NATIVE_PATH%" "-Djava.library.path=%NATIVE_PATH%" -jar "%JAR_PATH%"
exit /b %ERRORLEVEL%
