/** 24-char hex ids for Postgres rows and OpenSearch document ids. */
import { randomBytes } from "node:crypto";
function newId() {
  return randomBytes(12).toString("hex");
}
export {
  newId
};
