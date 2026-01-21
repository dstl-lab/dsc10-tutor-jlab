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

import { INotebookTracker, NotebookActions } from '@jupyterlab/notebook';

export interface INotebookContext {
  notebookName: string;
  notebookPath: string;
  activeCellIndex: number;

  // Returns serialized notebook JSON string
  getNotebookJson: () => string;
  // Get the nearest markdown cell above the active cell
  getNearestMarkdownCell: () => { cellIndex: number; text: string } | null;
  // Insert a code cell containing code below the currently active cell
  insertCodeBelowActiveCell?: (code: string) => void;
}

const NotebookContext = createContext<INotebookContext | null>(null);

interface INotebookProviderProps {
  children: React.ReactNode;
  notebookTracker: INotebookTracker;
}

export function NotebookProvider({
  children,
  notebookTracker
}: INotebookProviderProps) {
  const [contextValue, setContextValue] = useState<
    Omit<INotebookContext, 'getNotebookJson' | 'getNearestMarkdownCell'>
  >({
    notebookName: '',
    notebookPath: '',
    activeCellIndex: -1
  });

  // Helper function to get the currently selected cell index (the one with blue border)
  const getSelectedCellIndex = useCallback((): number => {
    const panel = notebookTracker.currentWidget;
    if (!panel) {
      return -1;
    }

    const notebook = panel.content;
    const activeCell = notebook.activeCell;
    if (!activeCell) {
      return -1;
    }

    // Find the index by iterating through widget children
    // This ensures we get the correct visual index
    const widgetCount = notebook.widgets.length;
    for (let i = 0; i < widgetCount; i++) {
      const widget = notebook.widgets[i];
      if (widget === activeCell) {
        return i;
      }
    }

    // Fallback: try to find by model comparison
    const model = notebook.model;
    if (model) {
      const cells = model.cells;
      for (let i = 0; i < cells.length; i++) {
        const cellModel = cells.get(i);
        if (cellModel && cellModel === activeCell.model) {
          return i;
        }
      }
    }

    return -1;
  }, [notebookTracker]);

  // Build context state snapshot from the tracker
  const getTrackerState = useCallback((): Omit<
    INotebookContext,
    'getNotebookJson' | 'getNearestMarkdownCell'
  > => {
    const panel = notebookTracker.currentWidget;
    const notebookName = panel?.title?.label ?? '';
    const notebookPath = panel?.context?.path ?? '';
    const activeCellIndex = getSelectedCellIndex();

    return { notebookName, notebookPath, activeCellIndex };
  }, [notebookTracker, getSelectedCellIndex]);

  // Function to serialize current notebook to JSON string
  const getNotebookJson = useCallback(() => {
    const model = notebookTracker.currentWidget?.content?.model;

    if (!model?.toJSON) {
      return '';
    }

    return JSON.stringify(model.toJSON());
  }, [notebookTracker]);

  // Function to get the nearest markdown cell above the active cell
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

    // Scan backward from the active cell to find the nearest markdown cell
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
    getNotebookJson,
    getNearestMarkdownCell
  };

  // Add method to insert a code cell below the active cell using NotebookActions
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
