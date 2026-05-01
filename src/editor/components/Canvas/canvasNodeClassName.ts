import type { ClassPreviewAssignment } from '../../../core/editor-store/slices/classSlice'
import { classNamesForClassIds, type ClassRegistry } from '../../../core/page-tree/classNames'

export function getCanvasNodeClassIds(
  classIds: readonly string[] | undefined,
  previewClassAssignment: ClassPreviewAssignment | null,
  nodeId: string,
): string[] | undefined {
  const ids = classIds ? [...classIds] : []

  if (
    previewClassAssignment?.nodeId === nodeId &&
    !ids.includes(previewClassAssignment.classId)
  ) {
    ids.push(previewClassAssignment.classId)
  }

  return ids.length > 0 ? ids : undefined
}

export function getCanvasNodeClassName(
  classIds: readonly string[] | undefined,
  previewClassAssignment: ClassPreviewAssignment | null,
  nodeId: string,
  classes: ClassRegistry,
): string | undefined {
  const names = classNamesForClassIds(
    classes,
    getCanvasNodeClassIds(classIds, previewClassAssignment, nodeId),
  )
  return names.length > 0 ? names.join(' ') : undefined
}
