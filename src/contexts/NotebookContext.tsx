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
  const [contextValue, setContextValue] = useState<INotebookContext>({
    notebookName: '',
    notebookPath: '',
    activeCellIndex: -1
  });

  // Build context state snapshot from the tracker
  const getTrackerState = useCallback((): INotebookContext => {
    const panel = notebookTracker.currentWidget;
    const notebookName = panel?.title?.label ?? '';
    const notebookPath = panel?.context?.path ?? '';
    const activeCellIndex = panel?.content?.activeCellIndex ?? -1;

    return { notebookName, notebookPath, activeCellIndex };
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

  return (
    <NotebookContext.Provider value={contextValue}>
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
