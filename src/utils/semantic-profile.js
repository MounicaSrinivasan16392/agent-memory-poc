/** Keyword overlap score for ranking semantic profile against a user query. */
function scoreSemanticProfile(content, query) {
  const words = query.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
  if (words.length === 0) return 1;
  const text = content.toLowerCase();
  const hits = words.filter((w) => text.includes(w)).length;
  return hits / words.length;
}
export {
  scoreSemanticProfile
};
