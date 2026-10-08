import type { ICellModel } from '@jupyterlab/cells';
import {
  resolveTaskContext,
  resolveTaskContexts,
  TASK_METADATA_KEY
} from '../utils/taskContext';

function cell(id: string, task?: Record<string, unknown>): ICellModel {
  return {
    id,
    getMetadata: (key: string) => (key === TASK_METADATA_KEY ? task : undefined)
  } as ICellModel;
}

function cells(...values: ICellModel[]) {
  return {
    length: values.length,
    get: (index: number) => values[index]
  };
}

test('the forward pass agrees with individual lookups across multiple anchors', () => {
  const collection = cells(
    cell('unknown'),
    cell('q1', { task_id: ' q1 ', task_version: 'v1' }),
    cell('student-a'),
    cell('bad', { task_id: ' ' }),
    cell('q2', { task_id: 'q2' }),
    cell('student-b')
  );
  expect(resolveTaskContexts(collection)).toEqual(
    Array.from({ length: collection.length }, (_, index) =>
      resolveTaskContext(collection, index)
    )
  );
  expect(resolveTaskContexts(cells())).toEqual([]);
});

test('uses authored task metadata on the cell', () => {
  const context = resolveTaskContext(
    cells(cell('question', { task_id: 'lab01-q03', task_version: 'v2' })),
    0
  );
  expect(context).toEqual({
    task_id: 'lab01-q03',
    task_version: 'v2',
    attribution: 'cell_metadata',
    anchor_cell_id: 'question'
  });
});

test('labels context inherited by a student cell as an inference', () => {
  const context = resolveTaskContext(
    cells(cell('question', { task_id: 'lab01-q03' }), cell('student-created')),
    1
  );
  expect(context).toEqual({
    task_id: 'lab01-q03',
    task_version: null,
    attribution: 'nearest_preceding_cell_metadata',
    anchor_cell_id: 'question'
  });
});

test('keeps missing and malformed task context unknown', () => {
  const collection = cells(
    cell('bad', { task_id: ' ' }),
    cell('student-created')
  );
  expect(resolveTaskContext(collection, 1)).toEqual({
    task_id: null,
    task_version: null,
    attribution: 'unknown',
    anchor_cell_id: null
  });
  expect(resolveTaskContext(collection, 99).attribution).toBe('unknown');
});
