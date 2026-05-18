/**
 * TypeBox schemas for the data endpoints.
 *
 * These describe what every table / row handler accepts on the wire.
 * Handlers use `readValidatedBody(req, Schema)` to refuse anything that
 * doesn't match before any repository code runs.
 *
 * `fields` (on table create / patch) is intentionally `Type.Unknown()`
 * because `normalizeDataTableFields` is the source of truth for that shape —
 * it tolerates partial / legacy payloads and coerces them into the canonical
 * `DataField[]`. Locking the schema here would force us to keep two
 * definitions in sync.
 */
import { Type, type Static } from '@core/utils/typeboxHelpers'

export const TableCreateBodySchema = Type.Object({
  name: Type.String(),
  slug: Type.Optional(Type.String()),
  kind: Type.Optional(Type.String()),
  routeBase: Type.Optional(Type.String()),
  singularLabel: Type.Optional(Type.String()),
  pluralLabel: Type.Optional(Type.String()),
  primaryFieldId: Type.Optional(Type.String()),
  fields: Type.Optional(Type.Unknown()),
})

export const TablePatchBodySchema = Type.Partial(Type.Object({
  name: Type.String(),
  slug: Type.String(),
  routeBase: Type.String(),
  singularLabel: Type.String(),
  pluralLabel: Type.String(),
  primaryFieldId: Type.String(),
  fields: Type.Unknown(),
}))

export const RowUpsertBodySchema = Type.Object({
  cells: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
})

export const RowStatusBodySchema = Type.Object({
  status: Type.Union([Type.Literal('draft'), Type.Literal('unpublished')]),
})

export const RowAuthorBodySchema = Type.Object({
  authorUserId: Type.String(),
})

export const RowTableBodySchema = Type.Object({
  tableId: Type.String(),
})

export type TablePatchBody = Static<typeof TablePatchBodySchema>
export type RowUpsertBody = Static<typeof RowUpsertBodySchema>
