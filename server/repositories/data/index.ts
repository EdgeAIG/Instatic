/**
 * Public surface of the data repository.
 *
 * Split into four modules by responsibility:
 *
 *   shared.ts  — shared mapper helpers (userRefAt, toIso, toIsoOrNull, types)
 *   tables.ts  — data_tables CRUD
 *   rows.ts    — data_rows CRUD (drafts, status, author, move, delete)
 *   publish.ts — data_row_versions + redirects + public-route lookups
 *
 * Domain types (`DataRow`, `DataTable`, `PublishedDataRow`, `DataRowRedirect`,
 * `DataRowVersion`, `DataUserReference`) are TypeBox schemas in
 * `@core/data/schemas` — import them from there.
 * Row shapes and mappers stay co-located with the queries that produce them.
 */

export { userRefAt, toIso, toIsoOrNull } from './shared'
export type { UserJoinPrefix, UserJoinColumns } from './shared'

export {
  listDataTables,
  getDataTable,
  createDataTable,
  updateDataTable,
  softDeleteDataTable,
} from './tables'

export {
  listDataRows,
  searchDataRows,
  getDataRow,
  listDataAuthorOptions,
  createDataRow,
  saveDataRowDraft,
  softDeleteDataRow,
  updateDataRowTable,
  updateDataRowStatus,
  updateDataRowAuthor,
} from './rows'
export type { UpdateDataRowTableResult, DataRowSearchResult } from './rows'

export {
  publishDataRow,
  getPublishedDataRowByRoute,
  getDataRowRedirectByRoute,
} from './publish'
