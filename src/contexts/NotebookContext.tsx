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

import { INotebookTracker } from '@jupyterlab/notebook';

export interface INotebookContext {
  notebookName: string;
  notebookPath: string;
  activeCellIndex: number;

  // Returns serialized notebook JSON string
  getNotebookJson: () => string;
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
  // Keep local state just for the simple fields (no function here)
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
  const getNotebookJson = useCallback((): string => {
    try {
      const panel = notebookTracker.currentWidget;
      if (!panel) {
        return '';
      }

      // Try to find the notebook model in common places.
      const docModel =
        (panel.context && (panel.context.model as any)) ||
        (panel.content && (panel.content.model as any));
      if (!docModel) {
        return '';
      }

      // Prefer toJSON() if available
      let notebookObject: any = undefined;
      if (typeof docModel.toJSON === 'function') {
        notebookObject = docModel.toJSON();
      } else if (typeof (panel.content as any).model?.toJSON === 'function') {
        notebookObject = (panel.content as any).model.toJSON();
      } else {
        return '';
      }

      return JSON.stringify(notebookObject);
    } catch (e) {
      console.error('Failed to serialize notebook:', e);
      return '';
    }
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

  // Compose the full context (fields + function) for consumers
  const fullContextValue: INotebookContext = {
    ...contextValue,
    getNotebookJson
  };

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
