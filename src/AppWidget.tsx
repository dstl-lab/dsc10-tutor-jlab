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

function App() {
  return (
    <div
      id="dsc10-tutor-jlab-app"
      className="flex h-full w-full flex-col gap-2 p-2"
    >
      <strong>🧑‍🏫 DSC 10 AI Tutor</strong>
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
