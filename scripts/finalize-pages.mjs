import { copyFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const outputDirectory = resolve(import.meta.dirname, "..", "dist-pages");

// GitHub Pages serves 404.html for unknown paths. Using the same shell keeps
// this client-side app usable after a direct navigation or hard refresh.
await copyFile(
  resolve(outputDirectory, "index.html"),
  resolve(outputDirectory, "404.html"),
);
await writeFile(resolve(outputDirectory, ".nojekyll"), "", "utf8");
