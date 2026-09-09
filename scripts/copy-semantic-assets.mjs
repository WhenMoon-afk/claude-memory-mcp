import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const requireDependency = createRequire(import.meta.url);
if (process.platform !== "linux" || process.arch !== "x64") {
  throw new Error(`Mooncite packaging does not support ${process.platform} ${process.arch}.`);
}

const extensionBinary = requireDependency.resolve("sqlite-vec-linux-x64/vec0.so");
const sourceDirectory = dirname(extensionBinary);
const packageManifest = join(sourceDirectory, "package.json");
const license = fileURLToPath(new URL("../vendor/sqlite-vec/LICENSE-MIT", import.meta.url));
const targetDirectory = fileURLToPath(new URL("../dist/vendor/sqlite-vec", import.meta.url));
mkdirSync(targetDirectory, { recursive: true, mode: 0o755 });
copyFileSync(extensionBinary, join(targetDirectory, "vec0.so"));
copyFileSync(packageManifest, join(targetDirectory, "package.json"));
copyFileSync(license, join(targetDirectory, "LICENSE-MIT"));
