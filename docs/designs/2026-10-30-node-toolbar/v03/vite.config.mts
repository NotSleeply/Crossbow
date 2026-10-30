// Development-only visual harness: renders the production notification components and styles
// with an in-memory Tauri boundary. It cannot alter real network settings.
import path from "node:path";
import { fileURLToPath } from "node:url";
import base from "../../../../apps/desktop/vite.config";
const root = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(root, "../../../..");
export default {
  ...base,
  plugins: [{ name: "preview-source-scan", enforce: "pre", transform(code: string, id: string) {
    if (id.endsWith("/apps/desktop/src/index.css")) return code.replace('@import "tailwindcss";', '@import "tailwindcss";\n@source "' + path.join(repo,"apps/desktop/src") + '";');
  } }, ...(base.plugins ?? [])],
  root,
  resolve: {
    ...base.resolve,
    alias: [
      {
        find: "@tauri-apps/api/core",
        replacement: path.join(root, "mock-tauri.ts"),
      },
      {
        find: "@tauri-apps/api/event",
        replacement: path.join(root, "mock-tauri.ts"),
      },
      {
        find: "@tauri-apps/api/app",
        replacement: path.join(root, "mock-tauri.ts"),
      },
      {
        find: /^react($|\/)/,
        replacement: path.join(repo, "apps/desktop/node_modules/react") + "$1",
      },
      {
        find: /^react-dom($|\/)/,
        replacement:
          path.join(repo, "apps/desktop/node_modules/react-dom") + "$1",
      },
    ],
  },
  optimizeDeps: { include: ["react", "react-dom/client", "react/jsx-runtime"] },
  server: {
    port: 5204,
    strictPort: true,
    host: "127.0.0.1",
    fs: { allow: [repo] },
  },
  build: { ...base.build, outDir: "/tmp/crossbow-node-toolbar-preview-dist" },
};
