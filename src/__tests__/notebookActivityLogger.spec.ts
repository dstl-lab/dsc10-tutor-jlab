import type { ICellModel } from '@jupyterlab/cells';
import type { INotebookTracker } from '@jupyterlab/notebook';
import type { IObservableList } from '@jupyterlab/observables';
import { Signal } from '@lumino/signaling';
import { logEvent } from '../api/logger';
import { startNotebookActivityLogging } from '../utils/notebookActivityLogger';

jest.mock('../api/logger', () => ({
  logEvent: jest.fn(),
  observationMetadata: { schema_version: 1, client_version: 'test' }
}));

function makeCell(id: string, source: string, task?: Record<string, unknown>) {
  let currentSource = source;
  let currentTask = task;
  const model: any = {
    id,
    type: 'code',
    getMetadata: (key: string) =>
      key === 'ai_tutor' ? currentTask : undefined,
    sharedModel: { getSource: () => currentSource }
  };
  model.contentChanged = new Signal(model);
  model.metadataChanged = new Signal(model);
  return {
    model: model as ICellModel,
    setSource(value: string) {
      currentSource = value;
      model.contentChanged.emit(undefined);
    },
    setTask(value: Record<string, unknown> | undefined) {
      currentTask = value;
      model.metadataChanged.emit({
        key: 'ai_tutor',
        type: 'change',
        oldValue: null,
        newValue: value
      });
    }
  };
}

class FakeCells {
  readonly changed = new Signal<this, IObservableList.IChangedArgs<ICellModel>>(
    this
  );

  constructor(private values: ICellModel[]) {}

  get length() {
    return this.values.length;
  }

  get(index: number) {
    return this.values[index];
  }

  add(index: number, cell: ICellModel) {
    this.values.splice(index, 0, cell);
    this.changed.emit({
      type: 'add',
      oldIndex: -1,
      oldValues: [],
      newIndex: index,
      newValues: [cell]
    });
  }

  move(oldIndex: number, newIndex: number) {
    const [cell] = this.values.splice(oldIndex, 1);
    this.values.splice(newIndex, 0, cell);
    this.changed.emit({
      type: 'move',
      oldIndex,
      oldValues: [cell],
      newIndex,
      newValues: [cell]
    });
  }

  remove(index: number) {
    const [cell] = this.values.splice(index, 1);
    this.changed.emit({
      type: 'remove',
      oldIndex: index,
      oldValues: [cell],
      newIndex: -1,
      newValues: []
    });
  }
}

function setup(initial: ICellModel[]) {
  const cells = new FakeCells(initial);
  const model: any = { cells };
  const panel: any = {
    content: { model, activeCellIndex: 0, activeCell: { model: initial[0] } },
    context: { path: 'lab.ipynb' },
    title: { label: 'lab.ipynb' },
    sessionContext: { session: { id: 'session-1' } },
    isDisposed: false
  };
  panel.disposed = new Signal(panel);
  const tracker: any = {
    currentWidget: panel,
    forEach: (visit: (value: any) => void) => visit(panel)
  };
  tracker.widgetAdded = new Signal(tracker);
  tracker.activeCellChanged = new Signal(tracker);
  const stop = startNotebookActivityLogging(tracker as INotebookTracker);
  return { cells, panel, tracker, stop };
}

const events = () => (logEvent as jest.Mock).mock.calls.map(([event]) => event);

beforeEach(() => jest.useFakeTimers());
afterEach(() => {
  jest.runOnlyPendingTimers();
  jest.useRealTimers();
  jest.clearAllMocks();
});

test('records student-created cell lifecycle and coalesces source edits', () => {
  const anchor = makeCell('question', '# Question 3', {
    task_id: 'lab01-q03',
    task_version: 'v1'
  });
  const { cells, stop } = setup([anchor.model]);
  expect(events()).toEqual([]);

  const student = makeCell('student-cell', 'x = 1');
  cells.add(1, student.model);
  expect(events()[0]).toMatchObject({
    event_type: 'notebook_cell_created',
    payload: {
      cell_id: 'student-cell',
      cell_index: 1,
      source_length: 5,
      task_context: {
        task_id: 'lab01-q03',
        attribution: 'nearest_preceding_cell_metadata'
      }
    }
  });

  student.setSource('x = 2');
  student.setSource('x = 200');
  jest.advanceTimersByTime(750);
  expect(events()[1]).toMatchObject({
    event_type: 'notebook_cell_source_changed',
    payload: {
      cell_id: 'student-cell',
      source_revision: 2,
      source_change_count: 2,
      source_length: 7
    }
  });
  expect(events()[1].payload).not.toHaveProperty('source');

  cells.move(1, 0);
  expect(events()[2]).toMatchObject({
    event_type: 'notebook_cell_moved',
    payload: { cell_id: 'student-cell', old_cell_index: 1, cell_index: 0 }
  });
  cells.remove(0);
  expect(
    events().some(event => event.event_type === 'notebook_cell_deleted')
  ).toBe(true);
  stop();
});

test('records active context as context, not claimed intent', () => {
  const anchor = makeCell('question', '# Question 3', {
    task_id: 'lab01-q03'
  });
  const student = makeCell('student-cell', 'work');
  const { panel, tracker, stop } = setup([anchor.model, student.model]);
  panel.content.activeCellIndex = 1;
  panel.content.activeCell = { model: student.model };
  tracker.activeCellChanged.emit(panel.content.activeCell);
  expect(events()[0]).toMatchObject({
    event_type: 'notebook_active_cell_changed',
    payload: {
      cell_id: 'student-cell',
      task_context: {
        task_id: 'lab01-q03',
        attribution: 'nearest_preceding_cell_metadata'
      }
    }
  });
  expect(events()[0].payload).not.toHaveProperty('asked_task_id');
  stop();
});
