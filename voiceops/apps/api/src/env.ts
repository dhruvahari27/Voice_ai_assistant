import fs from "node:fs";
import path from "node:path";
import { API_ROOT } from "./config.js";

/** Load the repo-root .env if there is one. Everything has a default, so it's optional. */
export function loadDotEnv() {
  const file = path.resolve(API_ROOT, "../../.env");
  if (fs.existsSync(file)) process.loadEnvFile(file);
}
