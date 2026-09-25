import type { ICellModel } from '@jupyterlab/cells';
import type { INotebookTracker, NotebookPanel } from '@jupyterlab/notebook';
import type { IObservableList } from '@jupyterlab/observables';
import { logEvent, observationMetadata } from '../api/logger';
import { ITaskContext, resolveTaskContext } from './taskContext';

const EDIT_IDLE_MS = 750;
type INotebookCells = NonNullable<NotebookPanel['content']['model']>['cells'];

interface ICellState {
  source: string;
  sourceRevision: number;
  pendingChanges: number;
  timer: ReturnType<typeof setTimeout> | null;
  taskContext: ITaskContext;
  onContentChanged: () => void;
  onMetadataChanged: () => void;
}

interface INotebookObservation {
  panel: NotebookPanel;
  panels: Set<NotebookPanel>;
  cells: INotebookCells;
  states: Map<ICellModel, ICellState>;
  onCellsChanged: (
    sender: unknown,
    args: IObservableList.IChangedArgs<ICellModel>
  ) => void;
}

function sourceOf(cell: ICellModel): string {
  return cell.sharedModel.getSource();
}

function sameTask(left: ITaskContext, right: ITaskContext): boolean {
  return (
    left.task_id === right.task_id &&
    left.task_version === right.task_version &&
    left.attribution === right.attribution &&
    left.anchor_cell_id === right.anchor_cell_id
  );
}

function cellIndex(cells: INotebookCells, cell: ICellModel): number {
  for (let index = 0; index < cells.length; index++) {
    if (cells.get(index) === cell) {
      return index;
    }
  }
  return -1;
}

function notebookIdentity(panel: NotebookPanel) {
  return {
    notebook_path: panel.context.path,
    notebook_name: panel.title.label,
    notebook_session_id: panel.sessionContext.session?.id ?? null
  };
}

/** Observe cell lifecycle and editing bursts without uploading source text. */
export function startNotebookActivityLogging(
  tracker: INotebookTracker
): () => void {
  const observations = new Map<object, INotebookObservation>();
  const panelModels = new Map<NotebookPanel, object>();
  const waitingPanels = new Set<NotebookPanel>();
  let stopped = false;

  const emit = (
    eventType: string,
    panel: NotebookPanel,
    payload: Record<string, unknown>
  ) =>
    logEvent({
      event_type: eventType,
      payload: {
        ...observationMetadata,
        ...notebookIdentity(panel),
        ...payload,
        timestamp: new Date().toISOString()
      }
    });

  const refreshTaskContexts = (observation: INotebookObservation) => {
    const cells = observation.cells;
    for (let index = 0; index < cells.length; index++) {
      const cell = cells.get(index);
      const state = observation.states.get(cell);
      if (!state) {
        continue;
      }
      const next = resolveTaskContext(cells, index);
      if (sameTask(state.taskContext, next)) {
        continue;
      }
      const previous = state.taskContext;
      state.taskContext = next;
      emit('notebook_cell_task_context_changed', observation.panel, {
        cell_id: cell.id,
        cell_index: index,
        cell_type: cell.type,
        previous_task_context: previous,
        task_context: next
      });
    }
  };

  const flushEdit = (
    observation: INotebookObservation,
    cell: ICellModel,
    indexOverride?: number
  ) => {
    const state = observation.states.get(cell);
    if (!state || state.pendingChanges === 0) {
      return;
    }
    if (state.timer) {
      clearTimeout(state.timer);
      state.timer = null;
    }
    const index = indexOverride ?? cellIndex(observation.cells, cell);
    emit('notebook_cell_source_changed', observation.panel, {
      cell_id: cell.id,
      cell_index: index >= 0 ? index : null,
      cell_type: cell.type,
      source_revision: state.sourceRevision,
      source_change_count: state.pendingChanges,
      source_length: state.source.length,
      task_context: state.taskContext
    });
    state.pendingChanges = 0;
  };

  const observeCell = (
    observation: INotebookObservation,
    cell: ICellModel,
    index: number
  ) => {
    const cells = observation.cells;
    const state: ICellState = {
      source: sourceOf(cell),
      sourceRevision: 0,
      pendingChanges: 0,
      timer: null,
      taskContext: resolveTaskContext(cells, index),
      onContentChanged: () => undefined,
      onMetadataChanged: () => undefined
    };
    state.onContentChanged = () => {
      const source = sourceOf(cell);
      if (source === state.source) {
        return;
      }
      state.source = source;
      state.sourceRevision += 1;
      state.pendingChanges += 1;
      if (state.timer) {
        clearTimeout(state.timer);
      }
      state.timer = setTimeout(() => {
        state.timer = null;
        flushEdit(observation, cell);
      }, EDIT_IDLE_MS);
    };
    state.onMetadataChanged = () => refreshTaskContexts(observation);
    observation.states.set(cell, state);
    cell.contentChanged.connect(state.onContentChanged);
    cell.metadataChanged.connect(state.onMetadataChanged);
  };

  const forgetCell = (
    observation: INotebookObservation,
    cell: ICellModel,
    oldIndex: number
  ) => {
    const state = observation.states.get(cell);
    if (!state) {
      return;
    }
    flushEdit(observation, cell, oldIndex);
    cell.contentChanged.disconnect(state.onContentChanged);
    cell.metadataChanged.disconnect(state.onMetadataChanged);
    observation.states.delete(cell);
  };

  const disposeObservation = (model: object) => {
    const observation = observations.get(model);
    if (!observation) {
      observations.delete(model);
      return;
    }
    observation.cells.changed.disconnect(observation.onCellsChanged);
    for (const [cell] of observation.states) {
      forgetCell(observation, cell, cellIndex(observation.cells, cell));
    }
    observations.delete(model);
  };

  const attach = (panel: NotebookPanel) => {
    const model = panel.content.model;
    if (stopped || panelModels.has(panel)) {
      return;
    }
    if (!model) {
      if (!waitingPanels.has(panel)) {
        waitingPanels.add(panel);
        void panel.context.ready
          .then(() => {
            waitingPanels.delete(panel);
            if (!panel.isDisposed) {
              attach(panel);
            }
          })
          .catch(() => waitingPanels.delete(panel));
      }
      return;
    }
    panelModels.set(panel, model);
    const existing = observations.get(model);
    if (existing) {
      existing.panels.add(panel);
    } else {
      const observation: INotebookObservation = {
        panel,
        panels: new Set([panel]),
        cells: model.cells,
        states: new Map(),
        onCellsChanged: () => undefined
      };
      observation.onCellsChanged = (_sender, args) => {
        const currentCells = observation.cells;
        if (
          args.type === 'remove' ||
          args.type === 'set' ||
          args.type === 'clear'
        ) {
          args.oldValues.forEach((cell, offset) => {
            const state = observation.states.get(cell);
            forgetCell(observation, cell, args.oldIndex + offset);
            emit('notebook_cell_deleted', observation.panel, {
              cell_id: cell.id,
              cell_index: args.oldIndex + offset,
              cell_type: cell.type,
              source_length: state?.source.length ?? sourceOf(cell).length,
              task_context: state?.taskContext ?? {
                task_id: null,
                task_version: null,
                attribution: 'unknown',
                anchor_cell_id: null
              }
            });
          });
        }
        if (args.type === 'add' || args.type === 'set') {
          args.newValues.forEach((cell, offset) => {
            const index = args.newIndex + offset;
            observeCell(observation, cell, index);
            const state = observation.states.get(cell)!;
            emit('notebook_cell_created', observation.panel, {
              cell_id: cell.id,
              cell_index: index,
              cell_type: cell.type,
              source_length: state.source.length,
              task_context: state.taskContext
            });
          });
        } else if (args.type === 'move') {
          const moved = args.newValues[0] ?? currentCells.get(args.newIndex);
          emit('notebook_cell_moved', observation.panel, {
            cell_id: moved.id,
            cell_type: moved.type,
            old_cell_index: args.oldIndex,
            cell_index: args.newIndex,
            task_context: resolveTaskContext(currentCells, args.newIndex)
          });
        }
        refreshTaskContexts(observation);
      };
      observations.set(model, observation);
      for (let index = 0; index < model.cells.length; index++) {
        observeCell(observation, model.cells.get(index), index);
      }
      model.cells.changed.connect(observation.onCellsChanged);
    }

    const onDisposed = () => {
      panel.disposed.disconnect(onDisposed);
      panelModels.delete(panel);
      const observation = observations.get(model);
      if (!observation) {
        return;
      }
      observation.panels.delete(panel);
      if (observation.panels.size === 0) {
        disposeObservation(model);
      } else if (observation.panel === panel) {
        observation.panel = observation.panels.values().next().value!;
      }
    };
    panel.disposed.connect(onDisposed);
  };

  const onAdded = (_: INotebookTracker, panel: NotebookPanel) => attach(panel);
  const onActiveCell: Parameters<
    INotebookTracker['activeCellChanged']['connect']
  >[0] = () => {
    const panel = tracker.currentWidget;
    const cell = panel?.content.activeCell?.model;
    const cells = panel?.content.model?.cells;
    const index = panel?.content.activeCellIndex ?? -1;
    if (!panel || !cell || !cells || index < 0) {
      return;
    }
    emit('notebook_active_cell_changed', panel, {
      cell_id: cell.id,
      cell_index: index,
      cell_type: cell.type,
      task_context: resolveTaskContext(cells, index)
    });
  };

  tracker.widgetAdded.connect(onAdded);
  tracker.activeCellChanged.connect(onActiveCell);
  tracker.forEach(attach);
  return () => {
    stopped = true;
    tracker.widgetAdded.disconnect(onAdded);
    tracker.activeCellChanged.disconnect(onActiveCell);
    for (const model of [...observations.keys()]) {
      disposeObservation(model);
    }
    panelModels.clear();
    waitingPanels.clear();
  };
}
