import { webcrypto, createHash } from 'crypto';
import { ReadableStream } from 'stream/web';
import { TextDecoder, TextEncoder } from 'util';
import { askTutorStream, IAskTutorParams } from '../api';

jest.mock('@jupyterlab/services', () => ({
  ServerConnection: { makeSettings: () => ({ baseUrl: '/', token: '' }) }
}));
jest.mock('@/utils', () => ({
  getStudentEmailFromUrl: () => 'invented@example.test',
  isProduction: () => false
}));

Object.defineProperty(globalThis, 'crypto', { value: webcrypto });
Object.assign(globalThis, { TextDecoder, TextEncoder });

it('retains two exact request snapshots and joins their replies despite edits while streaming', async () => {
  const records: any[] = [];
  const sent: any[] = [];
  let stream: ReadableStreamDefaultController<any>;
  globalThis.fetch = jest.fn(async (url, init) => {
    const body = JSON.parse(init!.body as string);
    if (String(url).endsWith('/events')) {
      records.push(body);
      return { ok: true } as Response;
    }
    sent.push(body);
    return {
      ok: true,
      body: new ReadableStream({
        start(controller) {
          stream = controller;
        }
      })
    } as unknown as Response;
  });
  const request: IAskTutorParams = {
    student_question: 'why is it still 1? (active cell)',
    notebook_json: '{"cells":[{"id":"cell-a","source":"x = 2"}]}',
    structured_context: '{"activeCell":{"source":"x = 2"}}'
  };
  const original = request.notebook_json;
  const run = () =>
    new Promise<void>((resolve, reject) => {
      askTutorStream(
        request,
        event => {
          if (event.type === 'done') {
            resolve();
          }
        },
        reject,
        {
          question: 'why is it still 1?',
          notebook: 'invented.ipynb',
          mode: 'tutor'
        }
      );
    });
  const first = run();
  while (sent.length < 1) {
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  request.notebook_json = '{"cells":[{"id":"cell-a","source":"x = 3"}]}';
  stream!.enqueue(
    new TextEncoder().encode(
      'data: {"type":"token","text":"Run the cell."}\n\ndata: {"type":"done","conversation_id":"conversation-a"}\n\n'
    )
  );
  stream!.close();
  await first;
  request.conversation_id = 'conversation-a';
  const second = run();
  while (sent.length < 2) {
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  stream!.enqueue(
    new TextEncoder().encode(
      'data: {"type":"done","conversation_id":"conversation-a"}\n\n'
    )
  );
  stream!.close();
  await second;

  // Reopening the serialized records requires neither notebook access nor a model.
  const reopened = JSON.parse(JSON.stringify(records));
  const queries = reopened.filter(
    (row: any) => row.event_type === 'tutor_query'
  );
  const replies = reopened.filter(
    (row: any) => row.event_type === 'tutor_response'
  );
  expect(queries).toHaveLength(2);
  expect(replies).toHaveLength(2);
  expect(queries[0].payload.request.notebook_json).toBe(original);
  expect(queries[0].payload.request).toEqual(sent[0]);
  expect(queries[1].payload.request).toEqual(sent[1]);
  expect(queries[0].payload.notebook_sha256).toBe(
    createHash('sha256').update(original).digest('hex')
  );
  expect(queries[0].payload.question).toBe('why is it still 1?');
  expect(queries[0].payload.request_id).not.toBe(queries[1].payload.request_id);
  for (let index = 0; index < 2; index++) {
    expect(replies[index].payload.request_id).toBe(
      queries[index].payload.request_id
    );
    expect(replies[index].payload.conversation_id).toBe('conversation-a');
    expect(queries[index].payload.request_id).toBe(sent[index].request_id);
  }
  expect(replies[0].payload.response).toBe('Run the cell.');
});

it.each(['eof', 'server-error', 'cancel'])(
  'records one terminal failure for %s',
  async kind => {
    const records: any[] = [];
    globalThis.fetch = jest.fn(async (url, init) => {
      if (String(url).endsWith('/events')) {
        records.push(JSON.parse(init!.body as string));
        return { ok: true } as Response;
      }
      return {
        ok: true,
        body: new ReadableStream({
          start(controller) {
            if (kind === 'server-error') {
              controller.enqueue(
                new TextEncoder().encode(
                  'data: {"type":"error","message":"test failure"}\n\n'
                )
              );
            }
            controller.close();
          }
        })
      } as unknown as Response;
    });
    await new Promise<void>(resolve => {
      const cancel = askTutorStream(
        { student_question: 'help', notebook_json: '{}' },
        () => {},
        () => resolve()
      );
      if (kind === 'cancel') {
        cancel();
      }
    });
    const failures = records.filter(
      row => row.event_type === 'tutor_request_failed'
    );
    expect(failures).toHaveLength(1);
    expect(failures[0].payload.status).toBe(
      kind === 'cancel' ? 'cancelled' : 'error'
    );
    expect(records.some(row => row.event_type === 'tutor_response')).toBe(
      false
    );
  }
);

it.each([
  { type: 'token', text: 3 },
  { type: 'done', conversation_id: 7 }
])(
  'rejects malformed event fields instead of recording completion: %j',
  async event => {
    const records: any[] = [];
    globalThis.fetch = jest.fn(async (url, init) => {
      if (String(url).endsWith('/events')) {
        records.push(JSON.parse(init!.body as string));
        return { ok: true } as Response;
      }
      return {
        ok: true,
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(
              new TextEncoder().encode(
                `data: ${JSON.stringify(event)}\n\ndata: {"type":"done","conversation_id":"valid"}\n\n`
              )
            );
            controller.close();
          }
        })
      } as unknown as Response;
    });
    await new Promise<void>(resolve => {
      askTutorStream(
        { student_question: 'help', notebook_json: '{}' },
        received => {
          if (received.type === 'done') {
            resolve();
          }
        },
        () => resolve()
      );
    });
    expect(
      records.filter(row => row.event_type === 'tutor_request_failed')
    ).toHaveLength(1);
    expect(records.some(row => row.event_type === 'tutor_response')).toBe(
      false
    );
  }
);

it('binds cancellation after a token to the request and its partial response exactly once', async () => {
  const records: any[] = [];
  globalThis.fetch = jest.fn(async (url, init) => {
    if (String(url).endsWith('/events')) {
      records.push(JSON.parse(init!.body as string));
      return { ok: true } as Response;
    }
    return {
      ok: true,
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(
            new TextEncoder().encode(
              'data: {"type":"token","text":"Try running"}\n\n'
            )
          );
        }
      })
    } as unknown as Response;
  });
  let cancel = () => {};
  await new Promise<void>(resolve => {
    cancel = askTutorStream(
      { student_question: 'help', notebook_json: '{}' },
      event => {
        if (event.type === 'token') {
          cancel();
        }
      },
      () => resolve()
    );
  });
  cancel();
  const queries = records.filter(row => row.event_type === 'tutor_query');
  const failures = records.filter(
    row => row.event_type === 'tutor_request_failed'
  );
  expect(queries).toHaveLength(1);
  expect(failures).toHaveLength(1);
  expect(failures[0].payload).toMatchObject({
    request_id: queries[0].payload.request_id,
    status: 'cancelled',
    partial_response: 'Try running'
  });
  expect(records.some(row => row.event_type === 'tutor_response')).toBe(false);
});
