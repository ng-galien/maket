/** Millisecond timestamp used by document summaries and render cache keys. */
export const DOCUMENT_NOW_SQL = "strftime('%Y-%m-%d %H:%M:%f', 'now')";

/**
 * Advance a document timestamp even when two mutations land in the same
 * SQLite clock millisecond. The value remains chronologically sortable and
 * parseable while also acting as a deterministic render revision token.
 */
export const NEXT_DOCUMENT_UPDATED_AT_SQL = `CASE
  WHEN documents.updated_at >= ${DOCUMENT_NOW_SQL}
    THEN strftime('%Y-%m-%d %H:%M:%f', documents.updated_at, '+0.001 seconds')
  ELSE ${DOCUMENT_NOW_SQL}
END`;
