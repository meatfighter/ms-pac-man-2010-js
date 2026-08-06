$baseDir = $PSScriptRoot;
$jarPath = Join-Path $baseDir "target\ms-pac-man-2010-desktop.jar";
$nativePath = Join-Path $baseDir "target\natives\windows";

if (-not (Test-Path -LiteralPath $jarPath)) {
    $jarPath = Join-Path $baseDir "ms-pac-man-2010-desktop.jar";
}
if (-not (Test-Path -LiteralPath $nativePath)) {
    $nativePath = Join-Path $baseDir "natives\windows";
}

if (-not (Test-Path -LiteralPath $jarPath)) {
    Write-Error "Missing desktop jar. Run npm.cmd run build:desktop from the repository root.";
    exit 1;
}
if (-not (Test-Path -LiteralPath $nativePath)) {
    Write-Error "Missing Windows native library directory: $nativePath";
    exit 1;
}

$javaCompatArgs = @();
function Add-JavaArgIfSupported {
    param([string]$arg);

    & java $arg "-version" *> $null;
    if ($LASTEXITCODE -eq 0) {
        $script:javaCompatArgs += $arg;
    }
}

Add-JavaArgIfSupported "--enable-native-access=ALL-UNNAMED";
Add-JavaArgIfSupported "--sun-misc-unsafe-memory-access=allow";

& java @javaCompatArgs "-Dorg.lwjgl.librarypath=$nativePath" "-Dnet.java.games.input.librarypath=$nativePath" "-Djava.library.path=$nativePath" "-Djinput.useDefaultPlugin=false" "-Dnet.java.games.input.plugins=net.java.games.input.DirectAndRawInputEnvironmentPlugin" -jar $jarPath;
exit $LASTEXITCODE;
