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

import Chat from './components/Chat';
import { NotebookProvider, useNotebook } from './contexts/NotebookContext';

function App() {
  const notebook = useNotebook();
  console.log(notebook);

  return (
    <div>
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
