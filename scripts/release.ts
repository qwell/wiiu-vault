import fs from 'node:fs/promises';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { readAppVersion } from '../src/shared/scripts.js';

const RELEASE_NAME = 'wiiu-vault';

const ROOT_DIR = process.cwd();
const RELEASE_ROOT = path.join(ROOT_DIR, 'release');
const OUTPUT_DIR = path.join(RELEASE_ROOT, RELEASE_NAME);

async function copyAppFiles(): Promise<void> {
    const appDir = path.join(OUTPUT_DIR, 'app');

    await fs.mkdir(appDir, { recursive: true });

    await fs.cp(path.join(ROOT_DIR, 'dist'), appDir, {
        recursive: true,
    });

    await fs.writeFile(
        path.join(appDir, 'package.json'),
        `${JSON.stringify({ type: 'module' }, null, 4)}\n`
    );
}

async function copyRootFiles(): Promise<void> {
    await fs.cp(
        path.join(ROOT_DIR, 'README.md'),
        path.join(OUTPUT_DIR, 'README.md')
    );
}

async function writeStartBat(): Promise<void> {
    const startBat = `@echo off
setlocal

set "ROOT=%~dp0"
set "APP=%ROOT%app"
set "RUNTIME=%ROOT%runtime"
set "NODE_DIST_URL=https://nodejs.org/dist/latest-v24.x"
set "RUNTIME_PLATFORM=win-x64"
set "NODE=%RUNTIME%\\%RUNTIME_PLATFORM%\\node.exe"

if exist "%NODE%" goto run_app

echo Installing Node.js runtime for WiiU Vault...
echo This is a one-time setup. Node.js will be downloaded from nodejs.org and verified before use.

if not exist "%RUNTIME%" mkdir "%RUNTIME%"
if not exist "%RUNTIME%\\%RUNTIME_PLATFORM%" mkdir "%RUNTIME%\\%RUNTIME_PLATFORM%"

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    "$ErrorActionPreference = 'Stop';" ^
    "$ProgressPreference = 'SilentlyContinue';" ^
    "$runtime = $env:RUNTIME;" ^
    "$url = $env:NODE_DIST_URL;" ^
    "$shasums = Join-Path $runtime 'SHASUMS256.txt';" ^
    "Write-Host 'Downloading Node.js checksums...';" ^
    "Invoke-WebRequest -Uri ($url + '/SHASUMS256.txt') -OutFile $shasums;" ^
    "$line = Get-Content $shasums | Where-Object { $_ -match 'node-v.*-win-x64\\.zip$' } | Select-Object -First 1;" ^
    "if (-not $line) { throw 'Could not find Node.js win-x64 zip in SHASUMS256.txt' }" ^
    "$parts = $line -split '\\s+';" ^
    "$expected = $parts[0];" ^
    "$archiveName = $parts[1];" ^
    "$archive = Join-Path $runtime $archiveName;" ^
    "if (-not (Test-Path $archive)) { Write-Host ('Downloading Node.js runtime: ' + $archiveName); Invoke-WebRequest -Uri ($url + '/' + $archiveName) -OutFile $archive } else { Write-Host ('Using cached Node.js runtime: ' + $archiveName) }" ^
    "Write-Host 'Verifying Node.js download...';" ^
    "$actual = (Get-FileHash -Algorithm SHA256 $archive).Hash.ToLowerInvariant();" ^
    "if ($actual -ne $expected) { Remove-Item $archive -Force; throw ('Node.js download verification failed. Expected: ' + $expected + ' Actual: ' + $actual) }" ^
    "$extractDir = Join-Path $runtime 'extract-win-x64';" ^
    "if (Test-Path $extractDir) { Remove-Item $extractDir -Recurse -Force }" ^
    "Write-Host 'Extracting Node.js runtime...';" ^
    "Expand-Archive -LiteralPath $archive -DestinationPath $extractDir -Force;" ^
    "$nodeExe = Get-ChildItem -Path $extractDir -Recurse -Filter node.exe | Select-Object -First 1;" ^
    "if (-not $nodeExe) { throw 'node.exe was not found in the archive' }" ^
    "Copy-Item $nodeExe.FullName $env:NODE -Force;" ^
    "Remove-Item $extractDir -Recurse -Force;" ^
    "Write-Host 'Node.js runtime installed successfully.';"

if errorlevel 1 (
    echo Failed to install Node.js runtime.
    pause
    exit /b 1
)

:run_app
cd /d "%APP%"
"%NODE%" server\\index.js %*
pause
`;

    await fs.writeFile(path.join(OUTPUT_DIR, 'start.bat'), startBat);
}

async function writeStartSh(): Promise<void> {
    const startSh = `#!/bin/sh
set -eu

ROOT="$(cd "$(dirname "$0")" && pwd)"
APP="$ROOT/app"
RUNTIME="$ROOT/runtime"
NODE_DIST_URL="https://nodejs.org/dist/latest-v24.x"

OS="$(uname -s)"
ARCH="$(uname -m)"

case "$OS:$ARCH" in
    Darwin:arm64)
        PLATFORM="darwin-arm64"
        RUNTIME_PLATFORM="macos-arm64"
        ARCHIVE_EXT="tar.gz"
        ;;

    Darwin:x86_64)
        PLATFORM="darwin-x64"
        RUNTIME_PLATFORM="macos-x64"
        ARCHIVE_EXT="tar.gz"
        ;;

    Linux:x86_64)
        PLATFORM="linux-x64"
        RUNTIME_PLATFORM="linux-x64"
        ARCHIVE_EXT="tar.gz"
        ;;

    Linux:aarch64)
        PLATFORM="linux-arm64"
        RUNTIME_PLATFORM="linux-arm64"
        ARCHIVE_EXT="tar.gz"
        ;;

    *)
        echo "Unsupported platform: $OS $ARCH"
        exit 1
        ;;
esac

NODE="$RUNTIME/$RUNTIME_PLATFORM/node"

download() {
    URL="$1"
    TARGET="$2"

    if command -v curl >/dev/null 2>&1; then
        curl -L "$URL" -o "$TARGET"
        return
    fi

    if command -v wget >/dev/null 2>&1; then
        wget "$URL" -O "$TARGET"
        return
    fi

    echo "curl or wget is required to download Node.js."
    exit 1
}

sha256_file() {
    FILE="$1"

    if command -v shasum >/dev/null 2>&1; then
        shasum -a 256 "$FILE" | awk '{print $1}'
        return
    fi

    if command -v sha256sum >/dev/null 2>&1; then
        sha256sum "$FILE" | awk '{print $1}'
        return
    fi

    echo "shasum or sha256sum is required to verify Node.js."
    exit 1
}

install_node() {
    mkdir -p "$RUNTIME/$RUNTIME_PLATFORM"

    SHASUMS="$RUNTIME/SHASUMS256.txt"

    echo "Downloading Node.js release checksums..."
    download "$NODE_DIST_URL/SHASUMS256.txt" "$SHASUMS"

    ARCHIVE_NAME="$(grep "node-v.*-$PLATFORM\\\\.$ARCHIVE_EXT$" "$SHASUMS" | awk '{print $2}' | head -n 1)"

    if [ -z "$ARCHIVE_NAME" ]; then
        echo "Could not find Node.js archive for $PLATFORM"
        exit 1
    fi

    EXPECTED_HASH="$(grep "  $ARCHIVE_NAME$" "$SHASUMS" | awk '{print $1}')"
    ARCHIVE="$RUNTIME/$ARCHIVE_NAME"
    EXTRACT_DIR="$RUNTIME/extract-$RUNTIME_PLATFORM"

    if [ ! -f "$ARCHIVE" ]; then
        echo "Downloading $ARCHIVE_NAME..."
        download "$NODE_DIST_URL/$ARCHIVE_NAME" "$ARCHIVE"
    fi

    ACTUAL_HASH="$(sha256_file "$ARCHIVE")"

    if [ "$ACTUAL_HASH" != "$EXPECTED_HASH" ]; then
        echo "Node.js download verification failed."
        echo "Expected: $EXPECTED_HASH"
        echo "Actual:   $ACTUAL_HASH"
        rm -f "$ARCHIVE"
        exit 1
    fi

    rm -rf "$EXTRACT_DIR"
    mkdir -p "$EXTRACT_DIR"

    echo "Extracting Node.js..."
    tar -xzf "$ARCHIVE" -C "$EXTRACT_DIR"

    NODE_VERSION_DIR="$(basename "$ARCHIVE" ".$ARCHIVE_EXT")"
    cp "$EXTRACT_DIR/$NODE_VERSION_DIR/bin/node" "$NODE"
    chmod +x "$NODE"

    rm -rf "$EXTRACT_DIR"

    echo "Node.js installed at $NODE"
}

if [ ! -x "$NODE" ]; then
    install_node
fi

cd "$APP"
exec "$NODE" server/index.js "$@"
`;

    const startShPath = path.join(OUTPUT_DIR, 'start.sh');

    await fs.writeFile(startShPath, startSh);
    await fs.chmod(startShPath, 0o755);
}

async function createReleaseZip(zipPath: string): Promise<void> {
    await fs.rm(zipPath, { force: true });

    const zip = new AdmZip();
    zip.addLocalFolder(OUTPUT_DIR);
    zip.writeZip(zipPath);

    console.log(`[release] wrote ${zipPath}`);
}

async function main(): Promise<void> {
    const version = await readAppVersion(ROOT_DIR);
    const zipPath = path.join(RELEASE_ROOT, `${RELEASE_NAME}-${version}.zip`);

    await fs.rm(OUTPUT_DIR, { recursive: true, force: true });
    await fs.mkdir(OUTPUT_DIR, { recursive: true });
    await fs.mkdir(path.join(OUTPUT_DIR, 'runtime'), { recursive: true });

    await copyAppFiles();
    await copyRootFiles();

    await writeStartBat();
    await writeStartSh();

    console.log(`[release] wrote ${OUTPUT_DIR}`);

    await createReleaseZip(zipPath);
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
