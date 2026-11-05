// Development-only visual harness: renders the production app components and styles
// with an in-memory Tauri boundary. It cannot alter real network settings.
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import base from "../../../../apps/desktop/vite.config";
const root = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(root, "../../../..");
export default {
  ...base,
  plugins: [
    {
      name: "preview-source-scan",
      enforce: "pre",
      generateBundle() {
        for (const dir of ["assets", "previews"]) {
          for (const name of fs.readdirSync(path.join(root, dir))) {
            this.emitFile({ type: "asset", fileName: `${dir}/${name}`, source: fs.readFileSync(path.join(root, dir, name)) });
          }
        }
        for (const name of ["palette.json", "contrast.json"]) {
          this.emitFile({ type: "asset", fileName: name, source: fs.readFileSync(path.join(root, name)) });
        }
      },
      transform(code: string, id: string) {
        if (id.endsWith("/apps/desktop/src/App.tsx")) {
          return code.replace('import logoGlyph from "./assets/logo-glyph.png";',
            'const requestedLogo = new URLSearchParams(location.search).get("color") || "A"; const logoGlyph = "/assets/" + (["current","A","B","C","D","E","F"].includes(requestedLogo) ? requestedLogo : "A") + "-mark.svg";');
        }
        if (id.endsWith("/apps/desktop/src/index.css"))
          return code.replace(
            '@import "tailwindcss";',
            '@import "tailwindcss";\n@source "' +
              path.join(repo, "apps/desktop/src") +
              '";',
          );
      },
    },
    ...(base.plugins ?? []),
  ],
  root,
  resolve: {
    ...base.resolve,
    alias: [
      {find:"@tauri-apps/api/webview", replacement:path.join(root,"mock-tauri.ts")},
      {find:"@tauri-apps/api/window", replacement:path.join(root,"mock-tauri.ts")},
      {
        find: "@base-ui/react",
        replacement: path.join(
          repo,
          "apps/desktop/node_modules/@base-ui/react",
        ),
      },
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
  optimizeDeps: {
    include: [
      "react",
      "react-dom/client",
      "react/jsx-runtime",
      "@base-ui/react/select",
    ],
  },
  server: {
    port: 5216,
    strictPort: true,
    host: "127.0.0.1",
    fs: { allow: [repo] },
  },
  build: { ...base.build, outDir: "/tmp/crossbow-logo-palette-dist", rollupOptions: { input: { main: path.join(root,"index.html"), app: path.join(root,"app.html") } } },
};
