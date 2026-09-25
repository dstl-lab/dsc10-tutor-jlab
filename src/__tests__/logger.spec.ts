jest.mock('@/utils', () => ({
  getStudentEmailFromUrl: () => 'student@example.edu',
  isProduction: () => false
}));

import { logEvent } from '../api/logger';

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
