#!/usr/bin/env sh
set -eu

BASE_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
JAR_PATH="$BASE_DIR/target/ms-pac-man-2010-desktop.jar"
NATIVE_PATH="$BASE_DIR/target/natives/macosx"

if [ ! -f "$JAR_PATH" ]; then
    JAR_PATH="$BASE_DIR/ms-pac-man-2010-desktop.jar"
fi
if [ ! -d "$NATIVE_PATH" ]; then
    NATIVE_PATH="$BASE_DIR/natives/macosx"
fi

if [ ! -f "$JAR_PATH" ]; then
    echo "Missing desktop jar. Run npm run build:desktop from the repository root." >&2
    exit 1
fi
if [ ! -d "$NATIVE_PATH" ]; then
    echo "Missing macOS native library directory: $NATIVE_PATH" >&2
    exit 1
fi

JAVA_COMPAT_ARGS=""
if java --enable-native-access=ALL-UNNAMED -version >/dev/null 2>&1; then
    JAVA_COMPAT_ARGS="$JAVA_COMPAT_ARGS --enable-native-access=ALL-UNNAMED"
fi
if java --sun-misc-unsafe-memory-access=allow -version >/dev/null 2>&1; then
    JAVA_COMPAT_ARGS="$JAVA_COMPAT_ARGS --sun-misc-unsafe-memory-access=allow"
fi

exec java $JAVA_COMPAT_ARGS "-Dorg.lwjgl.librarypath=$NATIVE_PATH" "-Dnet.java.games.input.librarypath=$NATIVE_PATH" "-Djava.library.path=$NATIVE_PATH" "-Djinput.useDefaultPlugin=false" "-Dnet.java.games.input.plugins=net.java.games.input.OSXEnvironmentPlugin" -jar "$JAR_PATH"
