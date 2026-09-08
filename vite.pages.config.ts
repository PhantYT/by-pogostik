import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";

const repositoryName = "by-pogostik";
const pagesBase = `/${repositoryName}/`;

/**
 * Vite rewrites asset URLs from HTML and imports, but it intentionally leaves
 * literal public-directory paths in JSX untouched. Keep the production app
 * source shared while making those literals repository-relative for Pages.
 */
function githubPagesPublicPaths(): Plugin {
  return {
    name: "github-pages-public-paths",
    enforce: "pre",
    transform(code, id) {
      const sourcePath = id.split("?", 1)[0].replaceAll("\\", "/");
      if (!sourcePath.endsWith("/app/page.tsx")) return null;

      const transformed = code.replace(
        /(["'`])\/(photos\/|og\.png|favicon\.svg)/g,
        `$1${pagesBase}$2`,
      );

      return transformed === code ? null : { code: transformed, map: null };
    },
  };
}

export default defineConfig({
  root: resolve(import.meta.dirname, "github-pages"),
  base: pagesBase,
  publicDir: resolve(import.meta.dirname, "public"),
  plugins: [githubPagesPublicPaths(), react()],
  resolve: {
    alias: {
      "@": resolve(import.meta.dirname),
    },
  },
  build: {
    outDir: resolve(import.meta.dirname, "dist-pages"),
    emptyOutDir: true,
    sourcemap: false,
  },
});
