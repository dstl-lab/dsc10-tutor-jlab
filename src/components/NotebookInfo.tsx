import * as React from 'react';
import { useNotebook } from '@/contexts/NotebookContext';

export default function NotebookInfo() {
  const notebook = useNotebook();
  const nearestMarkdown = notebook.getNearestMarkdownCell();

  return (
    <div>
      <small>Notebook: {notebook.notebookName}</small>
      <br />
      <small>Path: {notebook.notebookPath}</small>
      <br />
      <small>Active Cell Index: {notebook.activeCellIndex}</small>
      <br />
      {nearestMarkdown && (
        <>
          <small>
            Nearest Markdown Cell Index: {nearestMarkdown.cellIndex}
          </small>
          <br />
          <small>
            Markdown Preview: {nearestMarkdown.text.substring(0, 50)}...
          </small>
        </>
      )}
    </div>
  );
}
