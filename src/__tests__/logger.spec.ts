jest.mock('@/utils', () => ({
  getStudentEmailFromUrl: () => 'student@example.edu',
  isProduction: () => false
}));

import { logError, logEvent, TutorError } from '../api/logger';
import { registerNotebookEditFlusher } from '../utils/notebookEditBoundary';

test('a broken edit observer cannot prevent the next event from being logged', () => {
  const unregister = registerNotebookEditFlusher(() => {
    throw new Error('observer failed');
  });
  const error = jest.spyOn(console, 'error').mockImplementation(() => {});
  const fetchMock = jest
    .spyOn(global, 'fetch')
    .mockResolvedValue({ ok: true } as Response);
  try {
    expect(() => logEvent({ event_type: 'tutor_query' })).not.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalled();
  } finally {
    unregister();
    fetchMock.mockRestore();
    error.mockRestore();
  }
});

test('adds joinable client identity and ordering to every event', () => {
  const fetchMock = jest
    .spyOn(global, 'fetch')
    .mockResolvedValue({ ok: true } as Response);

  logEvent({ event_type: 'first', payload: { supplied: true } });
  logEvent({ event_type: 'second' });

  const bodies = fetchMock.mock.calls.map(([, init]) =>
    JSON.parse(String(init?.body))
  );
  expect(bodies[0]).toMatchObject({
    event_type: 'first',
    user_email: 'student@example.edu',
    payload: { supplied: true }
  });
  expect(bodies[0].payload.event_id).not.toBe(bodies[1].payload.event_id);
  expect(bodies[0].payload.analytics_session_id).toBe(
    bodies[1].payload.analytics_session_id
  );
  expect(bodies[1].payload.client_sequence).toBe(
    bodies[0].payload.client_sequence + 1
  );
  expect(bodies[0].payload.client_timestamp).toEqual(expect.any(String));

  fetchMock.mockRestore();
});

test('logs an error with its reason once, even if reported twice', () => {
  const fetchMock = jest
    .spyOn(global, 'fetch')
    .mockResolvedValue({ ok: true } as Response);
  const error = new TutorError('Stream request failed: 502 Bad Gateway', {
    http_status: 502,
    stage: 'http_response'
  });

  logError('tutor_stream', error, { request_id: 'r1' });
  logError('chat_submit', error);

  expect(fetchMock).toHaveBeenCalledTimes(1);
  const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
  expect(body).toMatchObject({
    event_type: 'client_error',
    user_email: 'student@example.edu',
    payload: {
      source: 'tutor_stream',
      error_name: 'TutorError',
      error_message: 'Stream request failed: 502 Bad Gateway',
      http_status: 502,
      stage: 'http_response',
      request_id: 'r1'
    }
  });
  expect(body.payload.stack).toEqual(expect.any(String));

  fetchMock.mockRestore();
});
