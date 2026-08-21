import { spawnSync } from "node:child_process";
import {
    abortRotation,
    checkRotationKeys,
    getHmacFingerprint,
    getReleaseSecretPaths,
    importActiveKey,
    initActiveKey,
    prepareNextKey,
    promoteNextKey,
    readKeyFile
} from "./hmac-config.mjs";

const command = process.argv[2];

try {
    switch (command) {
        case "init":
            runInit();
            break;
        case "import":
            await runImport();
            break;
        case "check":
            runCheck();
            break;
        case "show":
            runShow();
            break;
        case "rotate:prepare":
            runRotatePrepare();
            break;
        case "rotate:check":
            runRotateCheck();
            break;
        case "rotate:show-next":
            runRotateShowNext();
            break;
        case "rotate:promote":
            runRotatePromote();
            break;
        case "rotate:abort":
            runRotateAbort();
            break;
        default:
            throw new Error(
                "Usage: node scripts/hmac-cli.mjs <init|import|check|show|rotate:prepare|rotate:check|rotate:show-next|rotate:promote|rotate:abort>"
            );
    }
} catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
}

function runInit() {
    const result = initActiveKey();
    console.log(`${result.created ? "Created" : "Found"} active HMAC key.`);
    console.log(`Active key fingerprint: ${result.fingerprint}`);
}

async function runImport() {
    const keyHex = await readHiddenKey("Enter active HMAC key hex: ");
    const fingerprint = importActiveKey(keyHex);
    console.log("Imported active HMAC key.");
    console.log(`Active key fingerprint: ${fingerprint}`);
}

function runCheck() {
    const paths = getReleaseSecretPaths();
    const keyHex = readKeyFile(paths.active, "Active HMAC key");
    console.log("Active HMAC key is valid.");
    console.log(`Active key fingerprint: ${getHmacFingerprint(keyHex)}`);
}

function runShow() {
    const paths = getReleaseSecretPaths();
    const keyHex = readKeyFile(paths.active, "Active HMAC key");
    console.log(`Active HMAC key: ${keyHex}`);
    console.log(`Active key fingerprint: ${getHmacFingerprint(keyHex)}`);
}

function runRotatePrepare() {
    const fingerprint = prepareNextKey();
    console.log("Created next HMAC key.");
    console.log(`Next key fingerprint: ${fingerprint}`);
}

function runRotateCheck() {
    const fingerprints = checkRotationKeys();
    console.log("Active and next HMAC keys are valid.");
    console.log(`Active key fingerprint: ${fingerprints.activeFingerprint}`);
    console.log(`Next key fingerprint: ${fingerprints.nextFingerprint}`);
}

function runRotateShowNext() {
    const paths = getReleaseSecretPaths();
    const keyHex = readKeyFile(paths.next, "Next HMAC key");
    console.log(`Next HMAC key: ${keyHex}`);
    console.log(`Next key fingerprint: ${getHmacFingerprint(keyHex)}`);
}

function runRotatePromote() {
    const fingerprints = promoteNextKey();
    console.log("Promoted next HMAC key.");
    console.log(`Previous key fingerprint: ${fingerprints.previousFingerprint}`);
    console.log(`Active key fingerprint: ${fingerprints.activeFingerprint}`);
}

function runRotateAbort() {
    const removed = abortRotation();
    console.log(removed ? "Removed next HMAC key." : "No next HMAC key was present.");
}

async function readHiddenKey(promptText) {
    if (process.platform === "win32" && process.stdin.isTTY) {
        const result = spawnSync(
            "powershell.exe",
            [
                "-NoProfile",
                "-Command",
                [
                    `$secure = Read-Host ${JSON.stringify(promptText)} -AsSecureString`,
                    "$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)",
                    "try { [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }"
                ].join("; ")
            ],
            {
                encoding: "utf8",
                stdio: ["inherit", "pipe", "inherit"],
                windowsHide: true
            }
        );
        if (result.status !== 0 || result.error) {
            throw result.error ?? new Error("Unable to read hidden HMAC key.");
        }
        return result.stdout.trim();
    }

    if (!process.stdin.isTTY) {
        return await readStdin();
    }

    const result = spawnSync(
        "sh",
        [
            "-c",
            [
                "printf '%s' \"$PROMPT_TEXT\" >&2",
                "old_stty=$(stty -g)",
                "stty -echo",
                "IFS= read -r key",
                "status=$?",
                'stty "$old_stty"',
                "printf '\\n' >&2",
                "printf '%s' \"$key\"",
                "exit $status"
            ].join("; ")
        ],
        {
            encoding: "utf8",
            env: {
                ...process.env,
                PROMPT_TEXT: promptText
            },
            stdio: ["inherit", "pipe", "inherit"]
        }
    );
    if (result.status !== 0 || result.error) {
        throw result.error ?? new Error("Unable to read hidden HMAC key.");
    }
    return result.stdout.trim();
}

async function readStdin() {
    let text = "";
    for await (const chunk of process.stdin) {
        text += chunk;
    }
    return text.trim();
}
