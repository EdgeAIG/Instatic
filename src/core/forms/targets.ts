import type { DataTable } from '@core/data/schemas'

type FormSubmissionTargetTable = Pick<DataTable, 'kind' | 'system'>

export function isFormSubmissionTargetTable(table: FormSubmissionTargetTable): boolean {
  return table.kind === 'data' && table.system === false
}
