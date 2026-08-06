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

& java "-Dorg.lwjgl.librarypath=$nativePath" -jar $jarPath;
exit $LASTEXITCODE;
