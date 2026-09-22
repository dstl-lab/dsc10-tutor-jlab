import type { INotebookTracker } from '@jupyterlab/notebook';
import { Signal } from '@lumino/signaling';
import { logEvent } from '../api/logger';
import { startExecutionLogging } from '../utils/executionLogger';

jest.mock('../api/logger', () => ({
  logEvent: jest.fn(),
  observationMetadata: { schema_version: 1, client_version: 'test' }
}));

function notebook(path: string) {
  const kernel: any = { id: path, clientId: 'local' };
  kernel.anyMessage = new Signal(kernel);
  kernel.connectionStatusChanged = new Signal(kernel);
  kernel.statusChanged = new Signal(kernel);
  const cell: any = {
    type: 'code',
    sharedModel: { getId: () => 'cell-1', getSource: () => 'edited later' }
  };
  const panel: any = {
    context: { path },
    title: { label: path },
    content: { model: { cells: { length: 1, get: () => cell } } },
    sessionContext: { session: { id: 'session-1', kernel } },
    isDisposed: false
  };
  panel.sessionContext.kernelChanged = new Signal(panel.sessionContext);
  panel.sessionContext.ready = Promise.resolve();
  panel.disposed = new Signal(panel);
  const message = (
    direction: string,
    type: string,
    content: any,
    id = 'run-1',
    metadata = { cellId: 'cell-1' }
  ) => {
    kernel.anyMessage.emit({
      direction,
      msg: {
        channel:
          type === 'execute_request' || type === 'execute_reply'
            ? 'shell'
            : 'iopub',
        header: {
          msg_type: type,
          msg_id: direction === 'send' ? id : `reply-${id}`,
          session: 'local'
        },
        parent_header: direction === 'send' ? {} : { msg_id: id },
        content,
        metadata
      }
    });
  };
  return { panel, kernel, cell, message };
}

const events = () => (logEvent as jest.Mock).mock.calls.map(([event]) => event);
let stop: (() => void) | undefined;
afterEach(() => {
  stop?.();
  jest.clearAllMocks();
});

function track(...panels: any[]) {
  const tracker: any = {
    forEach: (visit: any) => panels.forEach(visit),
    currentWidget: null
  };
  tracker.widgetAdded = new Signal(tracker);
  stop = startExecutionLogging(tracker as INotebookTracker);
  return tracker;
}

test('binds a background notebook result to outbound source and requires reply plus idle', () => {
  const { panel, message } = notebook('background.ipynb');
  track(panel);
  message('send', 'execute_request', {
    code: 'grader.check("q1")',
    silent: false
  });
  expect(events()).toHaveLength(1);
  expect(events()[0]).toMatchObject({
    event_type: 'notebook_execution_requested',
    payload: {
      execution_id: 'run-1',
      source: 'grader.check("q1")',
      cell_id: 'cell-1',
      notebook_path: 'background.ipynb'
    }
  });
  message('recv', 'stream', { text: 'pa', name: 'stdout' });
  message('recv', 'stream', { text: 'ssed', name: 'stdout' });
  message(
    'recv',
    'execute_reply',
    { status: 'ok', execution_count: 3 },
    'unrelated'
  );
  message('recv', 'status', { execution_state: 'idle' });
  expect(events()).toHaveLength(1);
  message('recv', 'execute_reply', { status: 'ok', execution_count: 3 });
  expect(events()[1]).toMatchObject({
    event_type: 'notebook_execution_finished',
    payload: {
      execution_id: 'run-1',
      source: 'grader.check("q1")',
      status: 'ok',
      output: 'passed',
      execution_count: 3
    }
  });
  expect(events()[2]).toMatchObject({
    event_type: 'autograder_info',
    payload: {
      execution_id: 'run-1',
      checked_source: 'grader.check("q1")',
      success: true,
      verdict_method: 'text_heuristic'
    }
  });
  message('recv', 'status', { execution_state: 'idle' });
  expect(events()).toHaveLength(3);
});

test('excludes silent, foreign, console, and unbound executions', () => {
  const { panel, kernel, message } = notebook('a.ipynb');
  track(panel);
  message('send', 'execute_request', { code: 'secret', silent: true });
  message(
    'send',
    'execute_request',
    { code: 'console', silent: false },
    'console',
    { cellId: 'other' }
  );
  message('recv', 'execute_input', { code: 'foreign', execution_count: 1 });
  kernel.clientId = 'another-client';
  message('send', 'execute_request', { code: 'foreign', silent: false });
  expect(events()).toEqual([]);
});

test('tracks newly opened panels and overlapping executions independently', () => {
  const { panel, message } = notebook('new.ipynb');
  const tracker = track();
  tracker.widgetAdded.emit(panel);
  message('send', 'execute_request', { code: 'first', silent: false }, 'one');
  message('send', 'execute_request', { code: 'second', silent: false }, 'two');
  message(
    'recv',
    'execute_reply',
    { status: 'error', execution_count: 8 },
    'two'
  );
  message('recv', 'status', { execution_state: 'idle' }, 'two');
  expect(events()).toHaveLength(3);
  expect(events()[2].payload).toMatchObject({
    execution_id: 'two',
    source: 'second',
    status: 'error'
  });
  message('recv', 'execute_reply', { status: 'ok', execution_count: 7 }, 'one');
  message('recv', 'status', { execution_state: 'idle' }, 'one');
  expect(events()[3].payload).toMatchObject({
    execution_id: 'one',
    source: 'first',
    status: 'ok'
  });
});

test('records connection loss as incomplete and bounds output without claiming grader pass', () => {
  const { panel, kernel, message } = notebook('lost.ipynb');
  track(panel);
  message('send', 'execute_request', {
    code: 'grader.check("q1")',
    silent: false
  });
  message('recv', 'stream', {
    text: 'passed' + 'x'.repeat(100000),
    name: 'stdout'
  });
  kernel.connectionStatusChanged.emit('disconnected');
  expect(events()).toHaveLength(3);
  expect(events()[1].payload).toMatchObject({
    status: 'incomplete',
    incomplete_reason: 'connection_lost',
    output_complete: false
  });
  expect(events()[1].payload.output.length).toBeLessThan(100000);
  expect(events()[2].payload.success).toBeNull();
  message('recv', 'execute_reply', { status: 'ok', execution_count: 1 });
  message('recv', 'status', { execution_state: 'idle' });
  expect(events()).toHaveLength(3);
});

test('does not turn kernel success with unrecognized grader text into a passing grade', () => {
  const { panel, message } = notebook('unknown.ipynb');
  track(panel);
  message('send', 'execute_request', {
    code: 'grader.check_all()',
    silent: false
  });
  message('recv', 'stream', { text: 'checking...', name: 'stdout' });
  message('recv', 'execute_reply', { status: 'ok', execution_count: 1 });
  message('recv', 'status', { execution_state: 'idle' });
  expect(events()).toHaveLength(3);
  expect(events()[2].payload).toMatchObject({
    success: null,
    grader_id: 'check_all',
    execution_status: 'ok'
  });
});

test('does not duplicate output when notebook views share a kernel connection', () => {
  const first = notebook('same.ipynb');
  const second = notebook('same.ipynb');
  second.panel.sessionContext.session.kernel = first.kernel;
  track(first.panel, second.panel);
  first.message('send', 'execute_request', { code: 'print(1)', silent: false });
  first.message('recv', 'stream', { text: '1\n', name: 'stdout' });
  first.message('recv', 'execute_reply', { status: 'ok', execution_count: 1 });
  first.message('recv', 'status', { execution_state: 'idle' });
  expect(events()).toHaveLength(2);
  expect(events()[1].payload.output).toBe('1\n');
});

test('keeps a pending execution when its first shared view closes', () => {
  const first = notebook('original.ipynb');
  const second = notebook('renamed.ipynb');
  second.panel.context = first.panel.context;
  second.panel.content.model = first.panel.content.model;
  second.panel.sessionContext = first.panel.sessionContext;
  track(first.panel, second.panel);
  first.message('send', 'execute_request', { code: 'print(1)', silent: false });
  first.message('recv', 'stream', { text: 'before\n', name: 'stdout' });
  first.panel.content.model = null;
  first.panel.isDisposed = true;
  first.panel.disposed.emit(undefined);
  expect(events()).toHaveLength(1);
  first.message('recv', 'stream', { text: 'after\n', name: 'stdout' });
  first.message('recv', 'execute_reply', { status: 'ok', execution_count: 1 });
  first.message('recv', 'status', { execution_state: 'idle' });
  expect(events()).toHaveLength(2);
  expect(events()[1].payload).toMatchObject({
    notebook_name: 'original.ipynb',
    source: 'print(1)',
    status: 'ok',
    output: 'before\nafter\n',
    output_complete: true
  });
});

test('does not transfer a closing notebook execution to a different notebook using the same kernel', () => {
  const first = notebook('first.ipynb');
  const second = notebook('different.ipynb');
  second.panel.sessionContext.session.kernel = first.kernel;
  track(first.panel, second.panel);
  first.message('send', 'execute_request', { code: 'print(1)', silent: false });
  first.panel.isDisposed = true;
  first.panel.disposed.emit(undefined);
  expect(events()).toHaveLength(2);
  expect(events()[1].payload.status).toBe('incomplete');
});

test('omits rich HTML/image payloads and cannot claim complete grader output from them', () => {
  const { panel, message } = notebook('rich.ipynb');
  track(panel);
  message('send', 'execute_request', {
    code: 'grader.check("q1")',
    silent: false
  });
  message('recv', 'display_data', {
    data: {
      'text/html': '<div>passed<img src="secret"></div>',
      'image/png': 'secret'
    }
  });
  message('recv', 'execute_reply', { status: 'ok', execution_count: 1 });
  message('recv', 'status', { execution_state: 'idle' });
  expect(events()[1].payload.output).toBe('');
  expect(events()[1].payload.output_complete).toBe(false);
  expect(events()[2].payload.success).toBeNull();
});

test.each(['disposed', 'restarted'])(
  'marks %s executions incomplete and disconnects old listeners',
  event => {
    const { panel, kernel, message } = notebook('closed.ipynb');
    track(panel);
    message('send', 'execute_request', { code: 'work()', silent: false });
    if (event === 'disposed') {
      panel.isDisposed = true;
      panel.disposed.emit(undefined);
    } else {
      kernel.statusChanged.emit('restarting');
    }
    expect(events()[1].payload.status).toBe('incomplete');
    message('recv', 'execute_reply', { status: 'ok', execution_count: 1 });
    message('recv', 'status', { execution_state: 'idle' });
    expect(events()).toHaveLength(2);
  }
);
