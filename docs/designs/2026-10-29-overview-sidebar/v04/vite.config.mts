import path from "node:path";
import { fileURLToPath } from "node:url";
import base from "../v03/vite.config.mts";
export default {
  ...base,
  root: path.dirname(fileURLToPath(import.meta.url)),
  server: { ...base.server, port: 5200 },
};
