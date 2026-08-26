import { writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { ensureDirectory } from "./build-utils.mjs";

export const titleImageWidth = 900;
export const titleImageHeight = 325;
export const titleImageSizes = "min(900px, calc(100vw - 2rem))";

const titleVariants = [
    { name: "title-900", width: 900 },
    { name: "title-1800", width: 1800 }
];

async function renderTitleVariant(sourcePath, targetPath, width, format) {
    const pipeline = sharp(sourcePath).resize({
        width,
        kernel: sharp.kernel.lanczos3,
        withoutEnlargement: true
    });

    const output =
        format === "png"
            ? await pipeline.png({ adaptiveFiltering: true, compressionLevel: 9 }).toBuffer()
            : await pipeline.webp({ lossless: true, effort: 6 }).toBuffer();

    writeFileSync(targetPath, output);
}

export async function generateAboutImageAssets(sourceAssetsDir, outputAssetsDir, assertTargetPath = (path) => path) {
    const sourceTitlePath = join(sourceAssetsDir, "title.png");
    ensureDirectory(outputAssetsDir);

    for (const variant of titleVariants) {
        for (const format of ["png", "webp"]) {
            const targetPath = assertTargetPath(join(outputAssetsDir, `${variant.name}.${format}`));
            await renderTitleVariant(sourceTitlePath, targetPath, variant.width, format);
        }
    }
}
