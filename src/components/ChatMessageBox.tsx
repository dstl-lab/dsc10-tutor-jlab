import * as React from 'react';
import { useNotebook } from '../contexts/NotebookContext';

export default function ChatMessageBox() {
  const notebook = useNotebook();
  return (
    <div>
      <h1>Chat MessageBox</h1>
      <p>Notebook: {notebook.notebookName}</p>
      <p>Path: {notebook.notebookPath}</p>
      <p>Active Cell Index: {notebook.activeCellIndex}</p>
    </div>
  );
}
