import { sanitizeNotebook } from '../utils/notebookSanitizer';

it('retains native cell identities without inventing missing identities', () => {
  const notebook = sanitizeNotebook({
    cells: [
      { id: 'stable-a', cell_type: 'code', source: ['x = ', '1'] },
      { cell_type: 'markdown', source: 'Question' }
    ]
  });
  expect(notebook.cells[0]).toMatchObject({ id: 'stable-a', source: 'x = 1' });
  expect(notebook.cells[1]).not.toHaveProperty('id');
});
