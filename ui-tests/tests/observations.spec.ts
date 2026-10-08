import { createHash } from 'crypto';
import { writeFile } from 'fs/promises';
import { expect, test } from '@jupyterlab/galata';

test.use({ autoGoto: false, serviceWorkers: 'block' });

test('records real kernel execution and two request snapshots while work changes', async ({
  page,
  tmpPath
}, testInfo) => {
  const records: any[] = [];
  const requests: any[] = [];
  let releaseTutor: (() => void) | undefined;
  const firstReply = new Promise<void>(resolve => {
    releaseTutor = resolve;
  });
  const localHost = new URL(page.baseURL).hostname;
  // Only local Jupyter traffic reaches the network. Tutor/log endpoints are fixtures.
  // Context routes survive Galata's page-route cleanup while kernels shut down.
  const context = page.context();
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    return url.hostname === localHost ? route.fallback() : route.abort();
  });
  await context.route(
    'https://dsc10-tutor-logging-api*.nrp-nautilus.io/events',
    async route => {
      if (route.request().method() === 'POST') {
        records.push(route.request().postDataJSON());
      }
      await route.fulfill({
        status: 201,
        headers: {
          'access-control-allow-origin': '*',
          'access-control-allow-headers': 'content-type'
        },
        body: '{}'
      });
    }
  );
  await context.route('**/dsc10-tutor-jlab-backend/ask-stream', async route => {
    requests.push(route.request().postDataJSON());
    if (requests.length === 1) {
      await firstReply;
    }
    await route.fulfill({
      contentType: 'text/event-stream',
      body:
        'data: {"type":"token","text":"Try running the edited cell."}\n\n' +
        'data: {"type":"done","conversation_id":"invented-conversation"}\n\n'
    });
  });
  const events = (type: string) =>
    records.filter(row => row.event_type === type);
  const gate = 'release-observation';
  const submitted =
    'import time\nfrom pathlib import Path\nx = 1\nwhile not Path("release-observation").exists():\n    time.sleep(0.05)\nprint(x)';
  try {
    // Navigate directly: newer Galata file-browser helpers assume 4.6 markup,
    // while the course and CI target JupyterLab 4.4. The UI still creates the file.
    await page.goto(`tree/${tmpPath}`);
    await page.notebook.createNew(undefined, { kernel: 'python3' });
    await page.notebook.setCell(
      0,
      'markdown',
      'Invented example: inspect a variable.'
    );
    await page.notebook.addCell('code', '');
    // Insert the authored program at once so editor auto-indent cannot change it.
    const codeCell = await page.notebook.getCellLocator(1);
    await codeCell!.getByRole('textbox').fill(submitted);
    await page.notebook.runCell(1, { inplace: true, wait: false });
    await expect
      .poll(() => events('notebook_execution_requested').length)
      .toBe(1);
    const execution = events('notebook_execution_requested')[0].payload;
    expect(execution.execution_id).toEqual(expect.stringMatching(/\S/));
    expect(execution.kernel_id).toEqual(expect.stringMatching(/\S/));
    expect(execution.cell_id).toEqual(expect.stringMatching(/\S/));
    const submittedEdits = events('notebook_cell_source_changed').filter(
      row =>
        row.payload.cell_id === execution.cell_id &&
        row.payload.client_sequence < execution.client_sequence
    );
    expect(submittedEdits.length).toBeGreaterThan(0);
    expect(submittedEdits[submittedEdits.length - 1].payload).toMatchObject({
      source_length: submitted.length,
      edit_ended_at: expect.any(String)
    });
    // The file gate keeps the real kernel running until the editor has changed.
    await codeCell!.getByRole('textbox').fill('x = 2\nprint(x)');
    expect(events('notebook_execution_finished')).toHaveLength(0);
    await page.contents.uploadContent('', 'text', `${tmpPath}/${gate}`);
    await expect
      .poll(() => events('notebook_execution_finished').length)
      .toBe(1);
    expect(events('notebook_execution_finished')[0].payload).toMatchObject({
      execution_id: events('notebook_execution_requested')[0].payload
        .execution_id,
      source: submitted,
      status: 'ok',
      output: '1\n',
      output_complete: true
    });

    const input = page.locator('#chatbot-widget textarea');
    await input.fill('why is it still 1?');
    await input.press('Enter');
    await expect.poll(() => requests.length).toBe(1);
    await codeCell!.getByRole('textbox').fill('x = 3\nprint(x)');
    releaseTutor!();
    await expect.poll(() => events('tutor_response').length).toBe(1);
    await expect(input).toBeEnabled();
    await input.fill('what about now?');
    await input.press('Enter');
    await expect.poll(() => events('tutor_response').length).toBe(2);
    await expect.poll(() => events('tutor_query').length).toBe(2);
    const queries = events('tutor_query');
    expect(queries).toHaveLength(2);
    expect(queries[0].payload.request_id).not.toBe(
      queries[1].payload.request_id
    );
    for (let index = 0; index < 2; index++) {
      const query = queries[index].payload;
      expect(query.request).toEqual(requests[index]);
      expect(query.request_id).toBe(requests[index].request_id);
      expect(JSON.parse(query.request.notebook_json).cells[1].source).toBe(
        `x = ${index + 2}\nprint(x)`
      );
      expect(JSON.parse(query.request.notebook_json).cells[1].outputs).toEqual([
        { output_type: 'stream', text: '1\n', name: 'stdout' }
      ]);
      expect(query.notebook_sha256).toBe(
        createHash('sha256').update(query.request.notebook_json).digest('hex')
      );
      expect(events('tutor_response')[index].payload.request_id).toBe(
        query.request_id
      );
      expect(query.kernel_id).toBe(
        events('notebook_execution_requested')[0].payload.kernel_id
      );
      expect(JSON.parse(query.request.notebook_json).cells[1].id).toBe(
        events('notebook_execution_requested')[0].payload.cell_id
      );
      const beforeRequest = events('notebook_cell_source_changed').filter(
        row =>
          row.payload.cell_id === execution.cell_id &&
          row.payload.client_sequence < query.client_sequence
      );
      expect(beforeRequest.length).toBeGreaterThan(0);
      expect(
        beforeRequest[beforeRequest.length - 1].payload.edit_ended_at
      ).toBeTruthy();
    }
    await expect.poll(() => events('tutor_notebook_info').length).toBe(2);
    expect(
      JSON.parse(events('tutor_notebook_info')[0].payload.initial_notebook_json)
        .cells[1].source
    ).toBe('x = 2\nprint(x)');
  } finally {
    releaseTutor!();
    await page.contents.uploadContent('', 'text', `${tmpPath}/${gate}`);
    const artifact = testInfo.outputPath('observations.json');
    await writeFile(
      artifact,
      JSON.stringify(
        {
          invented: true,
          collector: 'browser interception',
          requests,
          records
        },
        null,
        2
      )
    );
    await testInfo.attach('observations', {
      path: artifact,
      contentType: 'application/json'
    });
  }
});

test('real UI moves, edits, deletion and undo preserve cell identity', async ({
  page,
  tmpPath
}, testInfo) => {
  const records: any[] = [];
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (
      message.type() === 'error' &&
      /TypeError|Cannot read properties/.test(message.text())
    ) {
      errors.push(message.text());
    }
  });
  const localHost = new URL(page.baseURL).hostname;
  const context = page.context();
  await context.route('**/*', route =>
    new URL(route.request().url()).hostname === localHost
      ? route.fallback()
      : route.abort()
  );
  await context.route(
    'https://dsc10-tutor-logging-api*.nrp-nautilus.io/events',
    async route => {
      if (route.request().method() === 'POST') {
        records.push(route.request().postDataJSON());
      }
      await route.fulfill({
        status: 201,
        headers: {
          'access-control-allow-origin': '*',
          'access-control-allow-headers': 'content-type'
        },
        body: '{}'
      });
    }
  );
  const events = (type: string) =>
    records.filter(row => row.event_type === type);
  try {
    await page.goto(`tree/${tmpPath}`);
    await page.notebook.createNew(undefined, { kernel: 'python3' });
    await page.notebook.addCell('code', 'x = 1');
    const cell = await page.notebook.getCellLocator(1);
    await cell!.getByRole('textbox').fill('x = 123');
    await cell!.getByRole('textbox').press('Escape');
    const creates = events('notebook_cell_created').length;
    const deletes = events('notebook_cell_deleted').length;
    // These are Jupyter's actual command-mode keyboard shortcuts, not synthetic
    // cell-list signals or calls to the shared-model API.
    await page.keyboard.press('Control+Shift+ArrowUp');
    await expect.poll(() => events('notebook_cell_moved').length).toBe(1);
    const moved = events('notebook_cell_moved')[0].payload;
    expect(moved).toMatchObject({ old_cell_index: 1, cell_index: 0 });
    expect(events('notebook_cell_created')).toHaveLength(creates);
    expect(events('notebook_cell_deleted')).toHaveLength(deletes);
    const priorEdits = events('notebook_cell_source_changed').filter(
      row => row.payload.cell_id === moved.cell_id
    );
    expect(priorEdits.length).toBeGreaterThan(0);
    const priorRevision =
      priorEdits[priorEdits.length - 1].payload.source_revision;
    const movedCell = await page.notebook.getCellLocator(0);
    await movedCell!.getByRole('textbox').fill('x = 456');
    await movedCell!.getByRole('textbox').press('Escape');
    await page.keyboard.press('d');
    await page.keyboard.press('d');
    await expect
      .poll(() => events('notebook_cell_deleted').length)
      .toBe(deletes + 1);
    await expect.poll(() => page.notebook.getCellCount()).toBe(1);
    const deleted = events('notebook_cell_deleted')[deletes].payload;
    expect(deleted.cell_id).toBe(moved.cell_id);
    const edits = events('notebook_cell_source_changed').filter(
      row => row.payload.cell_id === moved.cell_id
    );
    const lastEdit = edits[edits.length - 1].payload;
    expect(lastEdit.source_revision).toBeGreaterThan(priorRevision);
    expect(lastEdit.client_sequence).toBeLessThan(deleted.client_sequence);
    await page.keyboard.press('z');
    await expect.poll(() => page.notebook.getCellCount()).toBe(2);
    await expect
      .poll(() => events('notebook_cell_created').length)
      .toBe(creates + 1);
    expect(events('notebook_cell_created')[creates].payload.cell_id).toBe(
      moved.cell_id
    );
    expect(errors).toEqual([]);
  } finally {
    const artifact = testInfo.outputPath('cell-activity.json');
    await writeFile(
      artifact,
      JSON.stringify(
        { invented: true, collector: 'browser interception', records, errors },
        null,
        2
      )
    );
    await testInfo.attach('cell-activity', {
      path: artifact,
      contentType: 'application/json'
    });
  }
});
