/**
 * Provides a React context to track the notebook state (e.g. currently opened
 * notebook file, select cell, etc.).
 *
 * See the INotebookTracker interface in @jupyterlab/notebook for reference.
 *
 * In components, use the useNotebook hook to get the notebook state.
 */

import * as React from 'react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState
} from 'react';

import { CommandRegistry } from '@lumino/commands';
import {
  buildStructuredContext,
  sanitizeNotebook,
  type IActiveCellInfo,
  type ISanitizedNotebook,
  type IStructuredContext
} from '@/utils/notebookSanitizer';
import {
  type ITaskContext,
  resolveTaskContext,
  unknownTaskContext
} from '@/utils/taskContext';
import { INotebookTracker, NotebookActions } from '@jupyterlab/notebook';

export interface INotebookContext {
  notebookName: string;
  notebookPath: string;
  activeCellIndex: number;

  getNotebookIdentity: () => {
    notebook_path: string | null;
    notebook_session_id: string | null;
    kernel_id: string | null;
    kernel_client_id: string | null;
  };
  getActiveObservationContext: () => {
    active_cell_id: string | null;
    active_cell_index: number | null;
    active_cell_type: string | null;
    active_task_context: ITaskContext;
  };
  getNotebookJson: () => string;
  getSanitizedNotebook: () => ISanitizedNotebook;
  getStructuredContext: (
    snapshot?: ISanitizedNotebook
  ) => IStructuredContext | null;
  getActiveCellInfo: () => IActiveCellInfo | null;
  getNearestMarkdownCell: () => { cellIndex: number; text: string } | null;
  insertCodeBelowActiveCell?: (code: string) => void;
  commands?: CommandRegistry;
}

const NotebookContext = createContext<INotebookContext | null>(null);

interface INotebookProviderProps {
  children: React.ReactNode;
  notebookTracker: INotebookTracker;
  commands?: CommandRegistry;
}

export function NotebookProvider({
  children,
  notebookTracker,
  commands
}: INotebookProviderProps) {
  const [contextValue, setContextValue] = useState<
    Omit<
      INotebookContext,
      | 'getNotebookJson'
      | 'getNotebookIdentity'
      | 'getActiveObservationContext'
      | 'getSanitizedNotebook'
      | 'getStructuredContext'
      | 'getActiveCellInfo'
      | 'getNearestMarkdownCell'
    >
  >({
    notebookName: '',
    notebookPath: '',
    activeCellIndex: -1
  });

  const getNotebookIdentity = useCallback(() => {
    const panel = notebookTracker.currentWidget;
    const session = panel?.sessionContext.session;
    return {
      notebook_path: panel?.context.path ?? null,
      notebook_session_id: session?.id ?? null,
      kernel_id: session?.kernel?.id ?? null,
      kernel_client_id: session?.kernel?.clientId ?? null
    };
  }, [notebookTracker]);

  const getActiveObservationContext = useCallback(() => {
    const panel = notebookTracker.currentWidget;
    const cells = panel?.content.model?.cells;
    const index = panel?.content.activeCellIndex ?? -1;
    if (!cells || index < 0 || index >= cells.length) {
      return {
        active_cell_id: null,
        active_cell_index: null,
        active_cell_type: null,
        active_task_context: unknownTaskContext()
      };
    }
    const cell = cells.get(index);
    return {
      active_cell_id: cell.id,
      active_cell_index: index,
      active_cell_type: cell.type,
      active_task_context: resolveTaskContext(cells, index)
    };
  }, [notebookTracker]);

  const getSelectedCellIndex = useCallback((): number => {
    const panel = notebookTracker.currentWidget;
    if (!panel) {
      return -1;
    }

    const notebook = panel.content;
    return notebook?.activeCellIndex ?? -1;
  }, [notebookTracker]);

  const getTrackerState = useCallback((): {
    notebookName: string;
    notebookPath: string;
    activeCellIndex: number;
  } => {
    const panel = notebookTracker.currentWidget;
    const notebookName = panel?.title?.label ?? '';
    const notebookPath = panel?.context?.path ?? '';
    const activeCellIndex = getSelectedCellIndex();

    return { notebookName, notebookPath, activeCellIndex };
  }, [notebookTracker, getSelectedCellIndex]);

  const getFullNotebook = useCallback(() => {
    const model = notebookTracker.currentWidget?.content?.model;
    if (!model?.toJSON) {
      return null;
    }

    return {
      notebookName: notebookTracker.currentWidget?.title?.label ?? '',
      ...(model.toJSON() as Record<string, any>)
    };
  }, [notebookTracker]);

  const getNotebookJson = useCallback(() => {
    const notebookSnapshot = getFullNotebook();
    return notebookSnapshot ? JSON.stringify(notebookSnapshot) : '';
  }, [getFullNotebook]);

  // Get sanitized notebook (removes images, plots, large outputs)
  const getSanitizedNotebook = useCallback((): ISanitizedNotebook => {
    const fullNotebook = getFullNotebook();
    if (!fullNotebook) {
      return {
        notebookName: 'Untitled',
        cells: [],
        imagesRemoved: 0,
        plotsRemoved: 0,
        largeOutputsRemoved: 0
      };
    }

    return sanitizeNotebook(fullNotebook);
  }, [getFullNotebook]);

  // Get active cell information
  const getActiveCellInfo = useCallback((): IActiveCellInfo | null => {
    const sanitized = getSanitizedNotebook();
    const activeCellIndex = getSelectedCellIndex();

    if (activeCellIndex < 0 || activeCellIndex >= sanitized.cells.length) {
      return null;
    }

    const cell = sanitized.cells[activeCellIndex];
    return {
      id: cell.id,
      index: activeCellIndex,
      type: cell.cell_type,
      source: cell.source,
      execution_count: cell.execution_count,
      outputs: cell.outputs
    };
  }, [getSanitizedNotebook, getSelectedCellIndex]);

  const getNearestMarkdownCell = useCallback(() => {
    const panel = notebookTracker.currentWidget;
    if (!panel) {
      return null;
    }

    const notebook = panel.content;
    const model = notebook.model;
    const activeIndex = getSelectedCellIndex();

    if (!model || activeIndex < 0) {
      return null;
    }

    const cells = model.cells;

    for (let i = activeIndex; i >= 0; i--) {
      const cellModel = cells.get(i);
      if (!cellModel) {
        continue;
      }

      if (cellModel.type !== 'markdown') {
        continue;
      }

      const sharedModel = (cellModel as any).sharedModel;
      const source: string | string[] = sharedModel?.source || '';

      const markdownText = Array.isArray(source)
        ? source.join('').trim()
        : (source || '').trim();

      if (markdownText.length > 0) {
        return {
          cellIndex: i,
          text: markdownText
        };
      }
    }

    return null;
  }, [notebookTracker, getSelectedCellIndex]);

  // Get structured context for a request
  const getStructuredContext = useCallback(
    (snapshot?: ISanitizedNotebook): IStructuredContext | null => {
      const sanitized = snapshot ?? getSanitizedNotebook();
      const activeCellIndex = getSelectedCellIndex();
      const nearestMarkdown = getNearestMarkdownCell();

      return buildStructuredContext(
        sanitized,
        activeCellIndex,
        nearestMarkdown
      );
    },
    [getSanitizedNotebook, getSelectedCellIndex, getNearestMarkdownCell]
  );

  useEffect(() => {
    setContextValue(getTrackerState());

    const handleCurrentChanged = () => {
      setContextValue(getTrackerState());
    };

    const handleActiveCellChanged = () => {
      const index = getSelectedCellIndex();
      setContextValue(prev => ({ ...prev, activeCellIndex: index }));
    };

    notebookTracker.currentChanged.connect(handleCurrentChanged);
    notebookTracker.activeCellChanged.connect(handleActiveCellChanged);

    return () => {
      notebookTracker.currentChanged.disconnect(handleCurrentChanged);
      notebookTracker.activeCellChanged.disconnect(handleActiveCellChanged);
    };
  }, [getTrackerState, getSelectedCellIndex, notebookTracker]);

  const fullContextValue: INotebookContext = {
    ...contextValue,
    getNotebookIdentity,
    getActiveObservationContext,
    getNotebookJson,
    getSanitizedNotebook,
    getStructuredContext,
    getActiveCellInfo,
    getNearestMarkdownCell,
    commands
  };

  const insertCodeBelowActiveCell = useCallback(
    (code: string) => {
      const panel = notebookTracker.currentWidget;
      if (!panel) {
        return;
      }

      const nb = panel.content;

      try {
        NotebookActions.insertBelow(nb);

        try {
          NotebookActions.changeCellType(nb, 'code');
        } catch (e) {
          console.debug(
            'changeCellType not available or failed, cell may not be converted to code type',
            e
          );
        }

        const newCell = nb.activeCell;
        if (newCell && newCell.model) {
          const modelAny = newCell.model;
          const shared = modelAny.sharedModel ?? null;

          if (shared) {
            shared.setSource(code);
            console.debug('insertCode: wrote via sharedModel.setSource');
          } else {
            console.warn('insertCode: sharedModel not found', newCell.model);
          }
        }
      } catch (e) {
        console.error('Failed to insert code cell', e);
      }
    },
    [notebookTracker]
  );

  fullContextValue.insertCodeBelowActiveCell = insertCodeBelowActiveCell;

  return (
    <NotebookContext.Provider value={fullContextValue}>
      {children}
    </NotebookContext.Provider>
  );
}

export function useNotebook() {
  const context = useContext(NotebookContext);
  if (!context) {
    throw new Error('useNotebook must be used within an NotebookProvider');
  }
  return context;
}
