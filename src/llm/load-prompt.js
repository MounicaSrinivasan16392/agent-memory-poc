/** Load markdown prompt templates from src/prompts/. */
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
const __dirname = dirname(fileURLToPath(import.meta.url));
function loadPlatformPrompt(name) {
  return readFileSync(join(__dirname, "../prompts", name), "utf8");
}
export {
  loadPlatformPrompt
};
