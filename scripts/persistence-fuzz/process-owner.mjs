import { tmpdir } from "node:os";
import { resolve, dirname, basename } from "node:path";
import { readdirSync, readFileSync, lstatSync, rmSync } from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
function groupRunning(group) {
    if (process.platform === "linux") {
        for (const entry of readdirSync("/proc")) {
            if (!/^\d+$/.test(entry)) continue;
            try {
                const stat = readFileSync(`/proc/${entry}/stat`, "utf8");
                const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
                if (Number(fields[2]) === group && !["Z", "X"].includes(fields[0])) return true;
            } catch (error) {
                if (error.code !== "ENOENT" && error.code !== "ESRCH") throw error;
            }
        }
        return false;
    }
    try {
        process.kill(-group, 0);
        return true;
    } catch (error) {
        if (error.code === "ESRCH") return false;
        throw error;
    }
}
export async function ownWorker(child) {
    const groups = new Set([child.pid]);
    let helper, cache;
    if (process.platform === "win32") {
        helper = spawn(
            "powershell.exe",
            ["-NoLogo", "-NoProfile", "-NonInteractive", "-File", fileURLToPath(new URL("./owned-job.ps1", import.meta.url)), "-WorkerPid", String(child.pid)],
            { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] }
        );
        await new Promise((resolve, reject) => {
            let text = "",
                errors = "";
            const timer = setTimeout(() => {
                helper.stdin.end();
                reject(new Error("Windows ownership registration timeout"));
            }, 10000);
            helper.stderr.on("data", (bytes) => {
                errors = (errors + bytes).slice(-4000);
            });
            helper.stdout.on("data", (bytes) => {
                text += bytes;
                if (text.includes("owned")) {
                    clearTimeout(timer);
                    resolve();
                }
            });
            helper.once("error", (error) => {
                clearTimeout(timer);
                reject(error);
            });
            helper.once("exit", (code) => {
                clearTimeout(timer);
                reject(new Error(`Windows owner exited ${code}: ${errors}`));
            });
        });
    }
    return {
        registerCache(path) {
            const target = resolve(path);
            if (cache || dirname(target) !== resolve(tmpdir()) || !basename(target).startsWith("persistence-fuzz-cache-") || lstatSync(target).isSymbolicLink())
                throw new Error("Invalid owned cache registration");
            cache = target;
        },
        cleanupCache() {
            if (cache) rmSync(cache, { recursive: true, force: true });
        },
        register(pid) {
            if (!Number.isSafeInteger(pid) || pid <= 1) throw new Error("Invalid owned browser PID");
            if (process.platform !== "win32") groups.add(pid);
        },
        async close() {
            if (helper) {
                if (helper.exitCode !== null) throw new Error("Windows ownership helper exited before cleanup");
                await new Promise((resolve, reject) => {
                    const timer = setTimeout(() => reject(new Error("Windows job cleanup timeout")), 5000);
                    helper.once("exit", (code) => {
                        clearTimeout(timer);
                        if (code === 0) resolve();
                        else reject(new Error(`Windows job cleanup exit ${code}`));
                    });
                    helper.stdin.end("close\n");
                });
            } else {
                for (const pid of groups) {
                    try {
                        process.kill(-pid, "SIGKILL");
                    } catch (error) {
                        if (error.code !== "ESRCH") throw error;
                    }
                }
                const deadline = performance.now() + 3000;
                while ([...groups].some(groupRunning)) {
                    if (performance.now() >= deadline) throw new Error("Owned process group did not stop");
                    await new Promise((done) => setTimeout(done, 20));
                }
            }
        }
    };
}
