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

// set the min-width to be same as the other default jupyterlab right sidebar
// widgets (the property inspector and debugger, as of this writing)
const APP_MIN_WIDTH = '300px';

function App() {
  return (
    <div
      id="dsc10-tutor-jlab-app"
      className="flex h-full w-full flex-col gap-2 p-2"
    >
      <strong className="text-center">🧑‍🏫 DSC 10 AI Tutor</strong>
      <Chat />
    </div>
  );
}

export function createAppWidget({
  notebookTracker
}: {
  notebookTracker: INotebookTracker;
}): Widget {
  const widget = ReactWidget.create(
    <StrictMode>
      <NotebookProvider notebookTracker={notebookTracker}>
        <App />
      </NotebookProvider>
    </StrictMode>
  );

  // sam: it took me forever to figure out how to set the min-width of the
  // widget properly. it turns out that you can't set the min-width of the
  // MainAreaWidget in index.ts because
  // @lumino/widgets/boxlayout.ts:BoxLayout._fit() reads the min-width from the
  // CHILDREN of the widget inside MainAreaWidget, then overrides the min-width
  // of the MainAreaWidget itself. so even when i was setting the min-width
  // of the MainAreaWidget, it would get overridden by the min-width of the
  // children.
  //
  // we also can't set the min-width in the App component since that gets
  // created dynamically after the widget attaches, so when i was trying to set
  // the min-width of App, the min-width on initial load would still be 0px.
  //
  // basically, this is our ONLY chance to set the min-width of the widget and
  // have lumino respect it!
  widget.node.style.minWidth = APP_MIN_WIDTH;

  return widget;
}
