import { main } from "./persistence-fuzz/cli.mjs";

try {
    process.exitCode = await main();
} catch (error) {
    console.error(error.stack ?? error);
    process.exitCode = 2;
}
