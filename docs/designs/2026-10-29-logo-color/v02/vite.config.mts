import path from "node:path";
import { fileURLToPath } from "node:url";
import base from "../../../../apps/desktop/vite.config";
const root = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(root, "../../../..");
export default {
  ...base,
  root,
  plugins: base.plugins
    .flat(Infinity)
    .filter((plugin) => plugin && !plugin.name?.startsWith("vite:react")),
  optimizeDeps: { include: [], noDiscovery: true },
  server: {
    host: "127.0.0.1",
    port: 5203,
    strictPort: true,
    fs: { allow: [repo] },
  },
  build: { ...base.build, outDir: "/tmp/crossbow-brand-b-preview" },
};
