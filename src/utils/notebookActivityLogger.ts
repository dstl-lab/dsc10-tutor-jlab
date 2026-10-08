import type { ICellModel } from '@jupyterlab/cells';
import type { INotebookTracker, NotebookPanel } from '@jupyterlab/notebook';
import type { IObservableList } from '@jupyterlab/observables';
import { logEvent, observationMetadata } from '../api/logger';
import { registerNotebookEditFlusher } from './notebookEditBoundary';
import {
  ITaskContext,
  resolveTaskContext,
  resolveTaskContexts,
  TASK_METADATA_KEY
} from './taskContext';

const EDIT_IDLE_MS = 750;
type INotebookCells = NonNullable<NotebookPanel['content']['model']>['cells'];

interface ICellState {
  cell: ICellModel;
  id: string;
  type: ICellModel['type'];
  index: number;
  source: string;
  sourceRevision: number;
  pendingChanges: number;
  editStartedAt: string;
  editEndedAt: string;
  editOrder: number;
  timer: ReturnType<typeof setTimeout> | null;
  taskContext: ITaskContext;
  onContentChanged: () => void;
  onMetadataChanged: Parameters<ICellModel['metadataChanged']['connect']>[0];
}

interface INotebookObservation {
  panel: NotebookPanel;
  panels: Set<NotebookPanel>;
  cells: INotebookCells;
  // IDs and cached values survive disposal and Jupyter's clone-based moves.
  states: Map<string, ICellState>;
  pendingEdits: Set<ICellState>;
  onCellsChanged: (
    sender: unknown,
    args: IObservableList.IChangedArgs<ICellModel>
  ) => void;
}

function sameTask(left: ITaskContext, right: ITaskContext): boolean {
  return (
    left.task_id === right.task_id &&
    left.task_version === right.task_version &&
    left.attribution === right.attribution &&
    left.anchor_cell_id === right.anchor_cell_id
  );
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
  let editOrder = 0;

  const emit = (
    eventType: string,
    panel: NotebookPanel,
    payload: Record<string, unknown>,
    timestamp = new Date().toISOString()
  ) =>
    logEvent({
      event_type: eventType,
      payload: {
        ...observationMetadata,
        ...notebookIdentity(panel),
        ...payload,
        timestamp
      }
    });

  const flushEdit = (observation: INotebookObservation, state: ICellState) => {
    if (!state.pendingChanges) {
      return;
    }
    if (state.timer !== null) {
      clearTimeout(state.timer);
      state.timer = null;
    }
    const changes = state.pendingChanges;
    state.pendingChanges = 0;
    observation.pendingEdits.delete(state);
    emit(
      'notebook_cell_source_changed',
      observation.panel,
      {
        cell_id: state.id,
        cell_index: state.index,
        cell_type: state.type,
        source_revision: state.sourceRevision,
        source_change_count: changes,
        source_length: state.source.length,
        task_context: state.taskContext,
        edit_started_at: state.editStartedAt,
        edit_ended_at: state.editEndedAt
      },
      state.editEndedAt
    );
  };

  const flushEdits = (observation: INotebookObservation) => {
    const pending = [...observation.pendingEdits].sort(
      (left, right) => left.editOrder - right.editOrder
    );
    for (const state of pending) {
      flushEdit(observation, state);
    }
  };
  const unregisterFlusher = registerNotebookEditFlusher(() => {
    for (const observation of observations.values()) {
      flushEdits(observation);
    }
  });

  const refreshTaskContexts = (observation: INotebookObservation) => {
    // A metadata boundary must not reattribute an already-recorded edit burst.
    flushEdits(observation);
    const contexts = resolveTaskContexts(observation.cells);
    for (let index = 0; index < observation.cells.length; index++) {
      const state = observation.states.get(observation.cells.get(index).id);
      const next = contexts[index];
      if (!state || sameTask(state.taskContext, next)) {
        continue;
      }
      const previous = state.taskContext;
      state.taskContext = next;
      emit('notebook_cell_task_context_changed', observation.panel, {
        cell_id: state.id,
        cell_index: index,
        cell_type: state.type,
        previous_task_context: previous,
        task_context: next
      });
    }
  };

  const observeCell = (
    observation: INotebookObservation,
    cell: ICellModel,
    index: number,
    taskContext: ITaskContext
  ): ICellState => {
    const state: ICellState = {
      cell,
      id: cell.id,
      type: cell.type,
      index,
      source: cell.sharedModel.getSource(),
      sourceRevision: 0,
      pendingChanges: 0,
      editStartedAt: '',
      editEndedAt: '',
      editOrder: 0,
      timer: null,
      taskContext,
      onContentChanged: () => undefined,
      onMetadataChanged: () => undefined
    };
    state.onContentChanged = () => {
      const source = state.cell.sharedModel.getSource();
      if (source === state.source) {
        return;
      }
      const now = new Date().toISOString();
      if (!state.pendingChanges) {
        state.editStartedAt = now;
      }
      state.editEndedAt = now;
      state.editOrder = ++editOrder;
      state.source = source;
      state.sourceRevision += 1;
      state.pendingChanges += 1;
      observation.pendingEdits.add(state);
      if (state.timer !== null) {
        clearTimeout(state.timer);
      }
      state.timer = setTimeout(
        () => flushEdit(observation, state),
        EDIT_IDLE_MS
      );
    };
    state.onMetadataChanged = (_sender, change) => {
      if (change.key === TASK_METADATA_KEY) {
        refreshTaskContexts(observation);
      }
    };
    observation.states.set(state.id, state);
    cell.contentChanged.connect(state.onContentChanged);
    cell.metadataChanged.connect(state.onMetadataChanged);
    return state;
  };

  const disconnectCell = (state: ICellState) => {
    state.cell.contentChanged.disconnect(state.onContentChanged);
    state.cell.metadataChanged.disconnect(state.onMetadataChanged);
  };

  const reconcileCells = (
    observation: INotebookObservation,
    args: IObservableList.IChangedArgs<ICellModel>
  ) => {
    // CellList emits multiple deltas for a transaction, but all current models
    // are already available. Reconcile the complete state once; later deltas
    // are no-ops. Never dereference disposed cells from args.oldValues.
    const cells = Array.from({ length: observation.cells.length }, (_, index) =>
      observation.cells.get(index)
    );
    if (
      cells.length === observation.states.size &&
      cells.every((cell, index) => {
        const state = observation.states.get(cell.id);
        return state?.cell === cell && state.index === index;
      })
    ) {
      return;
    }
    flushEdits(observation);
    const current = new Map(cells.map(cell => [cell.id, cell]));
    for (const state of observation.states.values()) {
      const cell = current.get(state.id);
      if (cell && cell.type === state.type) {
        continue;
      }
      disconnectCell(state);
      observation.states.delete(state.id);
      emit('notebook_cell_deleted', observation.panel, {
        cell_id: state.id,
        cell_index: state.index,
        cell_type: state.type,
        source_length: state.source.length,
        task_context: state.taskContext
      });
    }
    const contexts = resolveTaskContexts(observation.cells);
    const explicitMoves = new Set(
      args.type === 'move' ? args.newValues.map(cell => cell.id) : []
    );
    const rebound: ICellState[] = [];
    cells.forEach((cell, index) => {
      let state = observation.states.get(cell.id);
      if (!state) {
        state = observeCell(observation, cell, index, contexts[index]);
        emit('notebook_cell_created', observation.panel, {
          cell_id: state.id,
          cell_index: index,
          cell_type: state.type,
          source_length: state.source.length,
          task_context: state.taskContext
        });
        return;
      }
      const previousIndex = state.index;
      const replacedModel = state.cell !== cell;
      state.index = index;
      if (replacedModel) {
        disconnectCell(state);
        state.cell = cell;
        cell.contentChanged.connect(state.onContentChanged);
        cell.metadataChanged.connect(state.onMetadataChanged);
        rebound.push(state);
      }
      // Jupyter's shared-model move clones the moved cells, preserving their
      // IDs. Neighbors shifted by an insertion/deletion are not themselves moves.
      if (
        previousIndex !== index &&
        (replacedModel || explicitMoves.has(state.id))
      ) {
        emit('notebook_cell_moved', observation.panel, {
          cell_id: state.id,
          cell_type: state.type,
          old_cell_index: previousIndex,
          cell_index: index,
          task_context: contexts[index]
        });
      }
      if (!sameTask(state.taskContext, contexts[index])) {
        const previous = state.taskContext;
        state.taskContext = contexts[index];
        emit('notebook_cell_task_context_changed', observation.panel, {
          cell_id: state.id,
          cell_index: index,
          cell_type: state.type,
          previous_task_context: previous,
          task_context: state.taskContext
        });
      }
    });
    for (const state of rebound) {
      state.onContentChanged();
    }
  };

  const disposeObservation = (model: object) => {
    const observation = observations.get(model);
    if (!observation) {
      return;
    }
    flushEdits(observation);
    observation.cells.changed.disconnect(observation.onCellsChanged);
    for (const state of observation.states.values()) {
      disconnectCell(state);
    }
    observations.delete(model);
  };

  const attach = (panel: NotebookPanel) => {
    const model = panel.content.model;
    if (stopped || panel.isDisposed || panelModels.has(panel)) {
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
        pendingEdits: new Set(),
        onCellsChanged: (_sender, args) => reconcileCells(observation, args)
      };
      observations.set(model, observation);
      const contexts = resolveTaskContexts(model.cells);
      for (let index = 0; index < model.cells.length; index++) {
        observeCell(
          observation,
          model.cells.get(index),
          index,
          contexts[index]
        );
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
    unregisterFlusher();
    tracker.widgetAdded.disconnect(onAdded);
    tracker.activeCellChanged.disconnect(onActiveCell);
    for (const model of [...observations.keys()]) {
      disposeObservation(model);
    }
    panelModels.clear();
    waitingPanels.clear();
  };
}
