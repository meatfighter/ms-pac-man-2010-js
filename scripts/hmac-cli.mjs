import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import {
    abortRotation,
    checkHmacConfiguration,
    checkRotationKeys,
    getHmacFingerprint,
    getReleaseSecretPaths,
    importActiveKey,
    initActiveKey,
    prepareNextKey,
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
            await runCheck();
            break;
        case "show":
            await runShow();
            break;
        case "rotate:prepare":
            runRotatePrepare();
            break;
        case "rotate:check":
            runRotateCheck();
            break;
        case "rotate:show-next":
            await runRotateShowNext();
            break;
        case "rotate:abort":
            await runRotateAbort();
            break;
        default:
            throw new Error("Usage: node scripts/hmac-cli.mjs <init|import|check|show|rotate:prepare|rotate:check|rotate:show-next|rotate:abort>");
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
    const paths = getReleaseSecretPaths();
    if (existsSync(paths.active)) {
        throw new Error("Active HMAC key already exists. Use rotation to replace an established key.");
    }
    const keyHex = await readHiddenKey("Enter active HMAC key hex: ");
    const fingerprint = importActiveKey(keyHex);
    console.log("Imported active HMAC key.");
    console.log(`Active key fingerprint: ${fingerprint}`);
}

async function runCheck() {
    const configuration = await checkHmacConfiguration();
    console.log("HMAC configuration: OK");
    console.log(`Rotation staged: ${configuration.rotationStaged ? "yes" : "no"}`);
    console.log(`Active key fingerprint: ${configuration.activeFingerprint}`);
    if (configuration.nextFingerprint !== null) {
        console.log(`Next key fingerprint: ${configuration.nextFingerprint}`);
    }
}

async function runShow() {
    await confirmDangerousOperation("This will print the active HMAC key.", "SHOW ACTIVE HMAC KEY");
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

async function runRotateShowNext() {
    await confirmDangerousOperation("This will print the next HMAC key.", "SHOW NEXT HMAC KEY");
    const paths = getReleaseSecretPaths();
    const keyHex = readKeyFile(paths.next, "Next HMAC key");
    console.log(`Next HMAC key: ${keyHex}`);
    console.log(`Next key fingerprint: ${getHmacFingerprint(keyHex)}`);
}

async function runRotateAbort() {
    await confirmDangerousOperation(
        [
            "This will delete the staged next HMAC key and discard the next-key release candidate.",
            "DO NOT use ordinary abort after MSPACMAN_HMAC_KEY_HEX on the production server has been changed to the next key.",
            "After server cutover, use the documented rotation recovery/rollback procedure."
        ].join("\n"),
        "ABORT HMAC ROTATION"
    );
    const result = abortRotation();
    console.log(result.nextRemoved ? "Removed next HMAC key." : "No next HMAC key was present.");
    console.log("Discarded next-key release candidate directory if present.");
}

async function confirmDangerousOperation(warning, confirmationText) {
    if (!process.stdin.isTTY) {
        throw new Error(`Interactive confirmation required. Re-run from a terminal and type: ${confirmationText}`);
    }

    console.error(`WARNING: ${warning}`);
    console.error(`Type ${confirmationText} to continue.`);
    const rl = createInterface({
        input: process.stdin,
        output: process.stderr
    });
    try {
        const answer = await rl.question("> ");
        if (answer !== confirmationText) {
            throw new Error("Confirmation did not match; operation cancelled.");
        }
    } finally {
        rl.close();
    }
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
