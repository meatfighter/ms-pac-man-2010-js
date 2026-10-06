import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { supervisedTrial } from "./persistence-fuzz/supervisor.mjs";

for (const mode of [
    "success",
    "result-hang",
    "result-nonzero",
    "evidence-crash",
    "child-crash",
    "exit-before-result",
    "cancel-boot",
    "cancel-restore",
    "cancel-drain",
    "cancel-cleanup",
    "cleanup-reject",
    "result-tail",
    "persistence-reject"
]) {
    test(`owned worker lifetime (${process.platform}): ${mode}`, { timeout: 20000 }, async () => {
        const dir = mkdtempSync(join(tmpdir(), "fuzz-supervisor-"));
        const file = join(dir, "worker.mjs"),
            pidFile = join(dir, "child.pid");
        const source = `import { spawn } from 'node:child_process'; import { writeFileSync } from 'node:fs';
process.on('message', message => {
 if (message.type === 'stop') { process.send({type:'result',result:{interrupted:true,issues:[]}},()=>process.exit(130)); return; }
 if (message.type === 'evidence-ack') { if (message.sequence === 1) process.exit(7); return; }
 const mode = message.mode;
 if (mode === 'child-crash') { const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore',windowsHide:true}); writeFileSync(message.pidFile,String(child.pid)); process.exit(7); }
 if (mode === 'exit-before-result') process.exit(0);
 if (mode === 'evidence-crash' || mode === 'persistence-reject') { process.send({type:'evidence',sequence:1,packet:{issues:[{domain:'persistence',category:'SAVE_REJECTED',evidenceId:'A'}]}}); setInterval(()=>{},1000); return; }
 if (mode.startsWith('cancel-')) { process.send({type:'progress',phase:mode.slice(7)}); setInterval(()=>{},1000); return; }
 process.send({type:'result',result:{issues:[],metrics:{},coverage:[],evidenceComplete:true,cleanup:{complete:mode!=='cleanup-reject'}}},()=>{if(mode==='result-tail')process.stderr.write('final owned worker tail\\n');if(mode==='result-hang')setInterval(()=>{},1000);else process.exit(mode==='result-nonzero'?9:0);});
});`;
        writeFileSync(file, source);
        const stop = new AbortController(),
            retained = [];
        try {
            const result = await supervisedTrial(
                { repo: resolve("."), mode, pidFile },
                {
                    workerUrl: pathToFileURL(file),
                    timeoutMs: 10000,
                    exitGraceMs: 300,
                    signal: stop.signal,
                    progress: () => {
                        if (mode.startsWith("cancel-")) stop.abort();
                    },
                    onEvidence: async (packet) => {
                        await new Promise((done) => setTimeout(done, 30));
                        if (mode === "persistence-reject") throw new Error("disk failure");
                        retained.push(...packet.issues);
                    }
                }
            );
            if (["success", "result-tail"].includes(mode)) assert.equal(result.infrastructureFailure, undefined);
            else assert.equal(result.incomplete, true);
            if (mode === "result-tail") assert.match(result.workerTail, /final owned worker tail/);
            if (mode === "cleanup-reject") assert.match(result.infrastructureFailure.message, /incomplete evidence or cleanup/);
            if (mode === "result-hang") assert.match(result.infrastructureFailure.message, /did not exit/);
            if (mode === "result-nonzero") assert.match(result.infrastructureFailure.message, /exit 9/);
            if (mode === "evidence-crash") {
                assert.equal(retained.length, 1);
                assert.ok(result.issues.some((issue) => issue.evidenceId === "A"));
            }
            if (mode === "child-crash") {
                const pid = Number(readFileSync(pidFile, "utf8"));
                if (process.platform === "linux") {
                    try {
                        assert.match(readFileSync(`/proc/${pid}/stat`, "utf8"), /\) [ZX] /, "an adopted zombie is terminated; no live descendant may remain");
                    } catch (error) {
                        if (error.code !== "ENOENT") throw error;
                    }
                } else assert.throws(() => process.kill(pid, 0), /ESRCH/);
            }
            assert.notEqual(result.workerExit?.code, undefined);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
}
