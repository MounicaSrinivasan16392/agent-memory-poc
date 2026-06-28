/**
 * Mirror generated memory_code to src/prompts/memory_code/{agentId}.md
 * (Postgres memory_stores.memory_code remains the runtime source of truth.)
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MEMORY_CODE_DIR = join(__dirname, "memory_code");

function memoryCodeFilePath(agentId) {
  return join(MEMORY_CODE_DIR, `${agentId}.md`);
}

function saveMemoryCodeFile(agentId, content) {
  const trimmed = content?.trim();
  if (!trimmed) return;
  mkdirSync(MEMORY_CODE_DIR, { recursive: true });
  writeFileSync(memoryCodeFilePath(agentId), `${trimmed}\n`, "utf8");
}

function loadMemoryCodeFile(agentId) {
  const path = memoryCodeFilePath(agentId);
  if (!existsSync(path)) return null;
  const text = readFileSync(path, "utf8").trim();
  return text || null;
}

export {
  loadMemoryCodeFile,
  memoryCodeFilePath,
  saveMemoryCodeFile
};
