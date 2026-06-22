/** Global memory_types catalog and memory_store_types junction seeding. */
import { getPool } from "./client.js";
import { newId } from "../utils/id.js";

const DEFAULT_MEMORY_TYPES = [
  {
    typeKey: "semantic",
    displayName: "Semantic facts",
    scopeMode: "user",
    writeTrigger: "session_end",
    embedOnWrite: false,
    profileMode: true,
    sortOrder: 1
  },
  {
    typeKey: "episodic",
    displayName: "Session events",
    scopeMode: "user",
    writeTrigger: "session_end",
    embedOnWrite: true,
    profileMode: false,
    sortOrder: 2
  },
  {
    typeKey: "experiential",
    displayName: "Shared insights",
    scopeMode: "shared",
    writeTrigger: "session_end",
    embedOnWrite: true,
    profileMode: false,
    sortOrder: 3
  }
];

class MemoryTypesDb {
  /** Seed global memory_types catalog rows (once per platform). */
  async ensureGlobalDefaults() {
    for (const t of DEFAULT_MEMORY_TYPES) {
      await getPool().query(
        `INSERT INTO memory_types (
          id, type_key, display_name, scope_mode,
          write_trigger, embed_on_write, profile_mode, sort_order
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (type_key) DO NOTHING`,
        [
          newId(),
          t.typeKey,
          t.displayName,
          t.scopeMode,
          t.writeTrigger,
          t.embedOnWrite,
          t.profileMode,
          t.sortOrder
        ]
      );
    }
  }

  /** Link all catalog types to a store. Called once when an agent store is created. */
  async linkAllTypesToStore(memoryStoreId) {
    await this.ensureGlobalDefaults();
    await getPool().query(
      `INSERT INTO memory_store_types (memory_store_id, memory_type_id)
       SELECT $1, id FROM memory_types ORDER BY sort_order ASC, type_key ASC
       ON CONFLICT DO NOTHING`,
      [memoryStoreId]
    );
  }
}

export {
  MemoryTypesDb
};
