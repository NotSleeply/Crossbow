import { fileURLToPath } from "node:url";
import preview from "../v02/vite.config.mts";

export default {
  ...preview,
  root: fileURLToPath(new URL(".", import.meta.url)),
  server: { ...preview.server, port: 5221 },
  build: { ...preview.build, outDir: "/tmp/crossbow-overview-height-v03-dist" },
};
