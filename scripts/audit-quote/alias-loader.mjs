import { register } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const hooksPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "alias-hooks.mjs"
);

register(pathToFileURL(hooksPath).href);