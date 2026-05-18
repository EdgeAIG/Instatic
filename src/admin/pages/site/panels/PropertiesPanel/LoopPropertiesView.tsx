/**
 * LoopPropertiesView — module-settings rows for a selected `base.loop` node.
 *
 * Slotted into the standard PropertiesPanel flow as the Module section's
 * content (alongside the ClassPicker + style sections), so the loop has
 * the same panel surface as every other module. No nested accordions —
 * just a flat list of rows like Container, Text, etc.
 *
 * Renders dynamic controls instead of a static schema because the
 * available filters and order options come from whichever
 * LoopEntitySource the author picks.
 *
 * Achromatic palette (Constraint #376). CSS Modules only (Constraint #402).
 */

import { useEffect, useMemo, useState } from 'react'
import { useEditorStore } from '@site/store/store'
import { loopSourceRegistry } from '@core/loops/registry'
import type { LoopEntitySource } from '@core/loops/types'
import type { PropertyControl, PropertySchema } from '@core/module-engine/types'
import { listCmsDataTables } from '@core/persistence/cmsData'
import { PropertyControlRenderer } from '@site/property-controls/PropertyControlRenderer'

interface LoopPropertiesViewProps {
  nodeId: string
  props: Record<string, unknown>
}

export function LoopPropertiesView({ nodeId, props }: LoopPropertiesViewProps) {
  const updateNodeProps = useEditorStore((s) => s.updateNodeProps)

  const sources = useMemo(() => loopSourceRegistry.list(), [])
  const sourceId = typeof props.sourceId === 'string' ? props.sourceId : ''
  const source: LoopEntitySource | undefined = sources.find((s) => s.id === sourceId)

  const filters =
    props.filters && typeof props.filters === 'object' && !Array.isArray(props.filters)
      ? (props.filters as Record<string, unknown>)
      : {}

  // Data table list — fetched lazily for the data.rows source's tableId picker.
  // Other sources don't need this.
  const [tables, setTables] = useState<Array<{ id: string; name: string }> | null>(null)
  useEffect(() => {
    if (sourceId !== 'data.rows' || tables !== null) return
    let cancelled = false
    listCmsDataTables()
      .then((list) => {
        if (!cancelled) setTables(list)
      })
      .catch(() => {
        if (!cancelled) setTables([])
      })
    return () => {
      cancelled = true
    }
  }, [sourceId, tables])

  // Build the per-source filter schema with dynamic options patched in.
  const filterSchema: PropertySchema = useMemo(() => {
    if (!source) return {}
    if (source.id === 'data.rows' && tables) {
      const tableField = source.filterSchema.tableId
      if (tableField && tableField.type === 'select') {
        return {
          ...source.filterSchema,
          tableId: {
            ...tableField,
            options: [
              { label: '— Choose a table —', value: '' },
              ...tables.map((t) => ({ label: t.name, value: t.id })),
            ],
          },
        }
      }
    }
    return source.filterSchema
  }, [source, tables])

  // Order options reactive to source change.
  const orderOptions: PropertyControl = useMemo(() => {
    return {
      type: 'select',
      label: 'Order by',
      options:
        source?.orderByOptions.map((o) => ({ label: o.label, value: o.id })) ?? [
          { label: 'Default', value: '' },
        ],
    }
  }, [source])

  function handleSourceChange(_key: string, value: unknown) {
    const nextId = typeof value === 'string' ? value : ''
    const next = loopSourceRegistry.get(nextId)
    // Reset filters and orderBy when changing source — keys don't transfer.
    updateNodeProps(nodeId, {
      sourceId: nextId,
      filters: {},
      orderBy: next?.orderByOptions[0]?.id ?? '',
    })
  }

  function handleFilterChange(key: string, value: unknown) {
    const nextFilters = { ...filters, [key]: value }
    updateNodeProps(nodeId, { filters: nextFilters })
  }

  function handleScalarChange(key: string, value: unknown) {
    updateNodeProps(nodeId, { [key]: value })
  }

  return (
    <>
      <PropertyControlRenderer
        propKey="sourceId"
        control={{
          type: 'select',
          label: 'Source',
          options: [
            { label: '— Pick a source —', value: '' },
            ...sources.map((s) => ({ label: s.label, value: s.id })),
          ],
        }}
        value={sourceId}
        onChange={handleSourceChange}
      />

      {source
        ? Object.entries(filterSchema).map(([key, control]) => (
            <PropertyControlRenderer
              key={key}
              propKey={key}
              control={control}
              value={filters[key]}
              onChange={handleFilterChange}
            />
          ))
        : null}

      {source ? (
        <>
          <PropertyControlRenderer
            propKey="orderBy"
            control={orderOptions}
            value={typeof props.orderBy === 'string' ? props.orderBy : ''}
            onChange={handleScalarChange}
          />
          <PropertyControlRenderer
            propKey="direction"
            control={{
              type: 'select',
              label: 'Direction',
              options: [
                { label: 'Descending (newest first)', value: 'desc' },
                { label: 'Ascending (oldest first)', value: 'asc' },
              ],
            }}
            value={typeof props.direction === 'string' ? props.direction : 'desc'}
            onChange={handleScalarChange}
          />
          <PropertyControlRenderer
            propKey="limit"
            control={{ type: 'number', label: 'Limit', min: 1, max: 200, step: 1 }}
            value={typeof props.limit === 'number' ? props.limit : 10}
            onChange={handleScalarChange}
          />
          <PropertyControlRenderer
            propKey="offset"
            control={{ type: 'number', label: 'Offset', min: 0, max: 10000, step: 1 }}
            value={typeof props.offset === 'number' ? props.offset : 0}
            onChange={handleScalarChange}
          />
          <PropertyControlRenderer
            propKey="pagination"
            control={{
              type: 'select',
              label: 'Pagination',
              options: [
                { label: 'None', value: 'none' },
                { label: 'Infinite scroll', value: 'infinite' },
              ],
            }}
            value={typeof props.pagination === 'string' ? props.pagination : 'none'}
            onChange={handleScalarChange}
          />
          {props.pagination === 'infinite' ? (
            <PropertyControlRenderer
              propKey="pageSize"
              control={{ type: 'number', label: 'Page size', min: 1, max: 100, step: 1 }}
              value={typeof props.pageSize === 'number' ? props.pageSize : 10}
              onChange={handleScalarChange}
            />
          ) : null}
        </>
      ) : null}
    </>
  )
}
