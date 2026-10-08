import { NotebookModel } from '@jupyterlab/notebook/lib/model';
import { Signal } from '@lumino/signaling';
import { logEvent } from '../api/logger';
import { startNotebookActivityLogging } from '../utils/notebookActivityLogger';

jest.mock('@/utils', () => ({
  getStudentEmailFromUrl: () => 'invented@example.test',
  isProduction: () => false
}));

let records: any[];
let cleanup: Array<() => void>;
let errors: Error[];
let previousExceptionHandler: Signal.ExceptionHandler;

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-10-06T12:00:00.000Z'));
  records = [];
  cleanup = [];
  errors = [];
  previousExceptionHandler = Signal.setExceptionHandler(error =>
    errors.push(error)
  );
  jest.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
    records.push(JSON.parse(String(init?.body)));
    return { ok: true } as Response;
  });
  // Real Yjs cells warn during creation, before attachment to their document.
  const warn = console.warn;
  jest.spyOn(console, 'warn').mockImplementation((...args) => {
    if (
      [
        'Invalid access: Add Yjs type to a document before reading data.',
        '[yjs#509] Not same Y.Doc'
      ].includes(args.join(' '))
    ) {
      return;
    }
    warn(...args);
  });
});

afterEach(() => {
  for (const close of cleanup.reverse()) {
    close();
  }
  Signal.setExceptionHandler(previousExceptionHandler);
  jest.clearAllTimers();
  jest.useRealTimers();
  jest.restoreAllMocks();
  // Lumino catches slot errors, so assertions on emitted rows alone miss them.
  expect(errors).toEqual([]);
});

function openNotebook(
  count = 3,
  beforeAttach?: (model: NotebookModel) => void
) {
  const model = new NotebookModel();
  model.sharedModel.insertCells(
    0,
    Array.from({ length: count }, (_, index) => ({
      id: `cell-${index}`,
      cell_type: 'code' as const,
      source: `x = ${index}`,
      metadata: {},
      outputs: [],
      execution_count: null
    }))
  );
  beforeAttach?.(model);
  model.sharedModel.clearUndoHistory();
  const panel: any = {
    content: {
      model,
      activeCellIndex: 0,
      activeCell: { model: model.cells.get(0) }
    },
    context: { path: 'invented.ipynb' },
    title: { label: 'invented.ipynb' },
    sessionContext: { session: { id: 'test-session' } },
    isDisposed: false
  };
  panel.disposed = new Signal(panel);
  const tracker: any = {
    currentWidget: panel,
    forEach: (visit: (value: any) => void) => visit(panel)
  };
  tracker.widgetAdded = new Signal(tracker);
  tracker.activeCellChanged = new Signal(tracker);
  const stop = startNotebookActivityLogging(tracker);
  cleanup.push(() => {
    stop();
    model.dispose();
  });
  return { model, panel, tracker, stop };
}

const events = (type: string) => records.filter(row => row.event_type === type);
const edits = () => events('notebook_cell_source_changed');
const types = () => records.map(row => row.event_type);

test('real deletion retains the disposed cell identity and flushes its last edit once', () => {
  const { model } = openNotebook();
  model.cells.get(1).sharedModel.setSource('x = 123');
  jest.advanceTimersByTime(100);
  model.sharedModel.deleteCell(1);
  expect(types()).toEqual([
    'notebook_cell_source_changed',
    'notebook_cell_deleted'
  ]);
  expect(records[1].payload).toMatchObject({
    cell_id: 'cell-1',
    cell_index: 1,
    source_length: 7
  });
  expect(edits()[0].payload.timestamp).toBe('2026-10-06T12:00:00.000Z');
  jest.advanceTimersByTime(1000);
  expect(records).toHaveLength(2);
  expect(model.cells.length).toBe(2);
});

test.each([
  [1, 0],
  [0, 2]
])('real move %i → %i is one move, preserving edit revisions', (from, to) => {
  const { model } = openNotebook();
  const oldModel = model.cells.get(from);
  oldModel.sharedModel.setSource('x = 123');
  model.sharedModel.moveCell(from, to);
  expect(model.cells.get(to)).not.toBe(oldModel);
  expect(types()).toEqual([
    'notebook_cell_source_changed',
    'notebook_cell_moved'
  ]);
  expect(records[1].payload).toMatchObject({
    cell_id: `cell-${from}`,
    old_cell_index: from,
    cell_index: to
  });
  model.cells.get(to).sharedModel.setSource('x = 456');
  jest.advanceTimersByTime(750);
  expect(edits()).toHaveLength(2);
  expect(edits()[1].payload).toMatchObject({
    cell_id: `cell-${from}`,
    cell_index: to,
    source_revision: 2,
    source_change_count: 1
  });
});

test('multi-cell moves and undo/redo retain IDs without phantom creates or deletes', () => {
  const { model } = openNotebook(5);
  model.sharedModel.moveCells(1, 4, 2);
  expect(
    events('notebook_cell_moved')
      .map(row => row.payload.cell_id)
      .sort()
  ).toEqual(['cell-1', 'cell-2']);
  expect(records).toHaveLength(2);
  records = [];
  model.sharedModel.undo();
  expect(
    events('notebook_cell_moved')
      .map(row => row.payload.cell_id)
      .sort()
  ).toEqual(['cell-1', 'cell-2']);
  expect(records).toHaveLength(2);
  expect(model.cells.get(1).id).toBe('cell-1');
  records = [];
  model.sharedModel.redo();
  expect(events('notebook_cell_moved')).toHaveLength(2);
  expect(records).toHaveLength(2);
});

test('deletion undo recreates a cell; shifted neighbors are not moved cells', () => {
  const { model } = openNotebook();
  model.sharedModel.deleteCell(0);
  model.sharedModel.undo();
  expect(types()).toEqual(['notebook_cell_deleted', 'notebook_cell_created']);
  expect(records.every(row => row.payload.cell_id === 'cell-0')).toBe(true);
  model.cells.get(0).sharedModel.setSource('restored = True');
  jest.advanceTimersByTime(750);
  expect(edits()).toHaveLength(1);
});

test('deleting a task anchor flushes old attribution then makes subsequent edits unknown', () => {
  const { model } = openNotebook(3, value => {
    value.cells.get(0).setMetadata('ai_tutor', { task_id: 'q1' });
  });
  model.cells.get(1).sharedModel.setSource('before = 1');
  model.sharedModel.deleteCell(0);
  expect(edits()[0].payload.task_context.task_id).toBe('q1');
  expect(events('notebook_cell_task_context_changed')).toHaveLength(2);
  model.cells.get(0).sharedModel.setSource('after = 2');
  jest.advanceTimersByTime(750);
  expect(edits()[1].payload).toMatchObject({
    cell_id: 'cell-1',
    cell_index: 0,
    task_context: { task_id: null, attribution: 'unknown' }
  });
});

test('moving across task anchors splits pending work and updates inferred context', () => {
  const { model } = openNotebook(4, value => {
    value.cells.get(0).setMetadata('ai_tutor', { task_id: 'q1' });
    value.cells.get(2).setMetadata('ai_tutor', { task_id: 'q2' });
  });
  model.cells.get(1).sharedModel.setSource('before = 1');
  model.sharedModel.moveCell(1, 3);
  expect(edits()[0].payload.task_context.task_id).toBe('q1');
  expect(events('notebook_cell_moved')[0].payload.task_context.task_id).toBe(
    'q2'
  );
  model.cells.get(3).sharedModel.setSource('after = 2');
  jest.advanceTimersByTime(750);
  expect(edits()[1].payload.task_context.task_id).toBe('q2');
});

test('task metadata changes split pending edit bursts before reattribution', () => {
  const { model } = openNotebook(2, value => {
    value.cells.get(0).setMetadata('ai_tutor', { task_id: 'q1' });
  });
  model.cells.get(1).sharedModel.setSource('before = 1');
  model.cells.get(0).setMetadata('ai_tutor', { task_id: 'q2' });
  expect(records[0].event_type).toBe('notebook_cell_source_changed');
  expect(edits()[0].payload.task_context.task_id).toBe('q1');
  model.cells.get(1).sharedModel.setSource('after = 2');
  jest.advanceTimersByTime(750);
  expect(edits()[1].payload.task_context.task_id).toBe('q2');
});

test.each([
  'tutor_query',
  'tutor_response',
  'notebook_execution_requested',
  'notebook_execution_finished',
  'notebook_active_cell_changed',
  'autograder_info'
])(
  'pending edits precede %s in both timestamps and client sequence',
  eventType => {
    const { model } = openNotebook();
    model.cells.get(0).sharedModel.setSource('before = 1');
    jest.advanceTimersByTime(100);
    logEvent({
      event_type: eventType,
      payload: { timestamp: new Date().toISOString() }
    });
    expect(types()).toEqual(['notebook_cell_source_changed', eventType]);
    expect(records[0].payload.timestamp < records[1].payload.timestamp).toBe(
      true
    );
    expect(
      records[0].payload.client_sequence < records[1].payload.client_sequence
    ).toBe(true);
    model.cells.get(0).sharedModel.setSource('after = 2');
    jest.advanceTimersByTime(750);
    expect(edits()).toHaveLength(2);
    expect(edits()[1].payload.source_change_count).toBe(1);
    expect(edits()[1].payload.edit_started_at).toBe('2026-10-06T12:00:00.100Z');
  }
);

test('idle summaries preserve the edit interval, not the later upload time', () => {
  const { model } = openNotebook();
  model.cells.get(0).sharedModel.setSource('first = 1');
  jest.advanceTimersByTime(100);
  model.cells.get(0).sharedModel.setSource('second = 2');
  jest.advanceTimersByTime(750);
  expect(edits()[0].payload).toMatchObject({
    source_change_count: 2,
    edit_started_at: '2026-10-06T12:00:00.000Z',
    edit_ended_at: '2026-10-06T12:00:00.100Z',
    timestamp: '2026-10-06T12:00:00.100Z',
    client_timestamp: '2026-10-06T12:00:00.850Z'
  });
  expect(edits()[0].payload).not.toHaveProperty('source');
});

test('boundary flush orders multiple pending cells by their last edit even in the same millisecond', () => {
  const { model } = openNotebook();
  model.cells.get(2).sharedModel.setSource('first = 1');
  model.cells.get(0).sharedModel.setSource('second = 2');
  model.cells.get(2).sharedModel.setSource('third = 3');
  logEvent({ event_type: 'tutor_query' });
  expect(edits().map(row => row.payload.cell_id)).toEqual(['cell-0', 'cell-2']);
  expect(edits()[1].payload.source_change_count).toBe(2);
});

test('initialization and task refresh are linear; unrelated metadata does no task reads', () => {
  let reads = 0;
  const { model } = openNotebook(1000, value => {
    for (const cell of value.cells) {
      const original = cell.getMetadata.bind(cell);
      jest.spyOn(cell, 'getMetadata').mockImplementation(key => {
        if (key === 'ai_tutor') {
          reads++;
        }
        return original(key);
      });
    }
  });
  expect(reads).toBe(1000);
  reads = 0;
  model.cells.get(0).setMetadata('execution', { busy: 'now' });
  expect(reads).toBe(0);
  model.cells.get(0).setMetadata('ai_tutor', { task_id: 'q1' });
  expect(reads).toBe(1000);
  expect(events('notebook_cell_task_context_changed')).toHaveLength(1000);
});

test('closing one shared view keeps exactly one observer; closing the last flushes and detaches', () => {
  const { model, panel, tracker } = openNotebook();
  const other = { ...panel };
  other.disposed = new Signal(other);
  tracker.widgetAdded.emit(other);
  panel.isDisposed = true;
  panel.disposed.emit(undefined);
  model.cells.get(0).sharedModel.setSource('first = 1');
  logEvent({ event_type: 'tutor_query' });
  expect(edits()).toHaveLength(1);
  model.cells.get(0).sharedModel.setSource('second = 2');
  other.isDisposed = true;
  other.disposed.emit(undefined);
  expect(edits()).toHaveLength(2);
  records = [];
  model.cells.get(0).sharedModel.setSource('unobserved = 3');
  logEvent({ event_type: 'tutor_query' });
  jest.advanceTimersByTime(1000);
  expect(types()).toEqual(['tutor_query']);
});
