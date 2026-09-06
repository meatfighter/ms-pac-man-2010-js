import { execFileSync } from "node:child_process";

const status = execFileSync("git", ["status", "--porcelain=v1", "--untracked-files=all"], { encoding: "utf8" });
if (status.trim() !== "") {
    console.error("Qualification requires a clean Git working tree:");
    console.error(status.trimEnd());
    process.exit(1);
}
