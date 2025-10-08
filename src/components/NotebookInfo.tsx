import * as React from 'react';
import { useNotebook } from '@/contexts/NotebookContext';

export default function NotebookInfo() {
  const notebook = useNotebook();
  return (
    <div>
      <p>Notebook: {notebook.notebookName}</p>
      <p>Path: {notebook.notebookPath}</p>
      <p>Active Cell Index: {notebook.activeCellIndex}</p>
    </div>
  );
}
