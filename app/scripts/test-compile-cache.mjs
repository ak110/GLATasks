import { enableCompileCache } from "node:module";
import { fileURLToPath } from "node:url";

const cacheDir =
    process.env.NODE_COMPILE_CACHE ??
    fileURLToPath(
        new URL("../node_modules/.cache/test-compile", import.meta.url),
    );
if (enableCompileCache(cacheDir).directory) {
    process.env.NODE_COMPILE_CACHE = cacheDir;
}
