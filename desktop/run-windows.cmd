@echo off
setlocal

set "BASE_DIR=%~dp0"
set "JAR_PATH=%BASE_DIR%target\ms-pac-man-2010-desktop.jar"
set "NATIVE_PATH=%BASE_DIR%target\natives\windows"

if not exist "%JAR_PATH%" set "JAR_PATH=%BASE_DIR%ms-pac-man-2010-desktop.jar"
if not exist "%NATIVE_PATH%" set "NATIVE_PATH=%BASE_DIR%natives\windows"

if not exist "%JAR_PATH%" goto missing_jar
if not exist "%NATIVE_PATH%" goto missing_natives
goto launch

:missing_jar
echo Missing desktop jar. Run npm.cmd run build:desktop from the repository root.
exit /b 1

:missing_natives
echo Missing Windows native library directory: "%NATIVE_PATH%"
exit /b 1

:launch
set "JAVA_COMPAT_ARGS="
java --enable-native-access=ALL-UNNAMED -version >nul 2>nul
if not errorlevel 1 set "JAVA_COMPAT_ARGS=%JAVA_COMPAT_ARGS% --enable-native-access=ALL-UNNAMED"
java --sun-misc-unsafe-memory-access=allow -version >nul 2>nul
if not errorlevel 1 set "JAVA_COMPAT_ARGS=%JAVA_COMPAT_ARGS% --sun-misc-unsafe-memory-access=allow"

java %JAVA_COMPAT_ARGS% "-Dorg.lwjgl.librarypath=%NATIVE_PATH%" "-Dnet.java.games.input.librarypath=%NATIVE_PATH%" "-Djava.library.path=%NATIVE_PATH%" "-Djinput.useDefaultPlugin=false" "-Dnet.java.games.input.plugins=net.java.games.input.DirectAndRawInputEnvironmentPlugin" -jar "%JAR_PATH%"
exit /b %ERRORLEVEL%
