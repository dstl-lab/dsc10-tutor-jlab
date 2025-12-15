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
    Omit<INotebookContext, 'getNotebookJson'>
  >({
    notebookName: '',
    notebookPath: '',
    activeCellIndex: -1
  });

  // Build context state snapshot from the tracker
  const getTrackerState = useCallback((): Omit<
    INotebookContext,
    'getNotebookJson'
  > => {
    const panel = notebookTracker.currentWidget;
    const notebookName = panel?.title?.label ?? '';
    const notebookPath = panel?.context?.path ?? '';
    const activeCellIndex = panel?.content?.activeCellIndex ?? -1;

    return { notebookName, notebookPath, activeCellIndex };
  }, [notebookTracker]);

  // Function to serialize current notebook to JSON string
  const getNotebookJson = useCallback(() => {
    const model = notebookTracker.currentWidget?.content?.model;

    if (!model?.toJSON) {
      return '';
    }

    return JSON.stringify(model.toJSON());
  }, [notebookTracker]);

  useEffect(() => {
    // Initialize from current tracker state
    setContextValue(getTrackerState());

    // Update when current notebook changes (open/close/switch)
    const handleCurrentChanged = () => {
      setContextValue(getTrackerState());
    };

    // Update only the active cell index when selection changes
    const handleActiveCellChanged = () => {
      const index =
        notebookTracker.currentWidget?.content?.activeCellIndex ?? -1;
      setContextValue(prev => ({ ...prev, activeCellIndex: index }));
    };

    notebookTracker.currentChanged.connect(handleCurrentChanged);
    notebookTracker.activeCellChanged.connect(handleActiveCellChanged);

    return () => {
      notebookTracker.currentChanged.disconnect(handleCurrentChanged);
      notebookTracker.activeCellChanged.disconnect(handleActiveCellChanged);
    };
  }, [getTrackerState, notebookTracker]);

  // Compose the full context (fields + function)
  const fullContextValue: INotebookContext = {
    ...contextValue,
    getNotebookJson
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
        // Insert a new cell below the active one
        NotebookActions.insertBelow(nb);

        // Try to convert it to a code cell (may throw on some versions)
        try {
          NotebookActions.changeCellType(nb, 'code');
        } catch (e) {
          console.debug(
            'changeCellType not available or failed, cell may not be converted to code type',
            e
          );
        }

        // Set the source of the newly active cell
        const newCell = nb.activeCell;
        if (newCell && newCell.model) {
          const modelAny = newCell.model;
          const shared = modelAny.sharedModel ?? null;

          if (shared) {
            shared.setSource(code);
            console.debug('insertCode: wrote via sharedModel.setSource');
          } else {
            // Log for debugging
            console.warn('insertCode: sharedModel not found', newCell.model);
          }
        }
      } catch (e) {
        console.error('Failed to insert code cell', e);
      }
    },
    [notebookTracker]
  );

  // Attach the new cell to the existing notebook context
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
