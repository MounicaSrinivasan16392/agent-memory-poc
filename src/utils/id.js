/** UUID ids for Postgres rows and Qdrant points (same value in both stores). */
import { randomUUID } from "node:crypto";

function newId() {
  return randomUUID();
}

export {
  newId
};
