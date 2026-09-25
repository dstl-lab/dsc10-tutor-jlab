import type { ICellModel } from '@jupyterlab/cells';

export const TASK_METADATA_KEY = 'ai_tutor';

export type TaskAttribution =
  | 'cell_metadata'
  | 'nearest_preceding_cell_metadata'
  | 'unknown';

export interface ITaskContext {
  task_id: string | null;
  task_version: string | null;
  attribution: TaskAttribution;
  anchor_cell_id: string | null;
}

interface ICellCollection {
  length: number;
  get(index: number): ICellModel;
}

export function unknownTaskContext(): ITaskContext {
  return {
    task_id: null,
    task_version: null,
    attribution: 'unknown',
    anchor_cell_id: null
  };
}

function nonempty(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function authoredTask(
  cell: ICellModel
): Omit<ITaskContext, 'attribution'> | null {
  const metadata = cell.getMetadata(TASK_METADATA_KEY);
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return null;
  }
  const record = metadata as Record<string, unknown>;
  const taskId = nonempty(record.task_id);
  if (!taskId) {
    return null;
  }
  return {
    task_id: taskId,
    task_version: nonempty(record.task_version),
    anchor_cell_id: cell.id
  };
}

/**
 * Describe the task context around a cell without claiming student intent.
 *
 * Direct authored metadata is explicit. A preceding task marker is only a
 * spatial inference, which is why the attribution travels with every value.
 */
export function resolveTaskContext(
  cells: ICellCollection,
  cellIndex: number
): ITaskContext {
  if (cellIndex < 0 || cellIndex >= cells.length) {
    return unknownTaskContext();
  }

  const direct = authoredTask(cells.get(cellIndex));
  if (direct) {
    return { ...direct, attribution: 'cell_metadata' };
  }

  for (let index = cellIndex - 1; index >= 0; index--) {
    const preceding = authoredTask(cells.get(index));
    if (preceding) {
      return {
        ...preceding,
        attribution: 'nearest_preceding_cell_metadata'
      };
    }
  }

  return unknownTaskContext();
}
