/**
 * Entry point for interface. Exports a lumino widget so we can attach it to the
 * JupyterLab sidebar in index.ts.
 *
 * See:
 * https://jupyterlab.readthedocs.io/en/stable/extension/virtualdom.html
 */

import * as React from 'react';
import { StrictMode } from 'react';

import { INotebookTracker } from '@jupyterlab/notebook';
import { ReactWidget } from '@jupyterlab/ui-components';
import { type Widget } from '@lumino/widgets';

import Chat from '@/components/Chat';
import { NotebookProvider } from '@/contexts/NotebookContext';

const styles = {
  boxSizing: 'border-box' as const,
  display: 'flex',
  flexDirection: 'column' as const,
  gap: '1rem',
  width: '100%',
  height: '100%',
  padding: '0.5rem'
};

function App() {
  return (
    <div style={styles} id="dsc10-tutor-jlab-app">
      <strong>Welcome to the AI Tutor app!</strong>
      <Chat />
    </div>
  );
}

export function createAppWidget({
  notebookTracker
}: {
  notebookTracker: INotebookTracker;
}): Widget {
  return ReactWidget.create(
    <StrictMode>
      <NotebookProvider notebookTracker={notebookTracker}>
        <App />
      </NotebookProvider>
    </StrictMode>
  );
}
