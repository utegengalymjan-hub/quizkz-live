import type { Session, SSEEnvelope, StudentSessionView } from '../types.ts';
import { api, getTeacherToken } from './api.ts';

export type ConnectionState = 'connected' | 'reconnecting' | 'polling';

export function subscribeTeacherSession(params: {
  sessionId: string;
  onSession: (session: Session) => void;
  onViolation?: (info: { displayName: string; type: string; totalViolations: number }) => void;
  onConnectionChange?: (state: ConnectionState) => void;
}): () => void {
  let closed = false;
  let lastSeq = 0;
  let es: EventSource | null = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  const fetchSnapshot = async () => {
    try {
      const { session } = await api.getSession(params.sessionId);
      if (!closed) params.onSession(session);
    } catch {}
  };

  const startPollingFallback = () => {
    if (pollTimer || closed) return;
    params.onConnectionChange?.('polling');
    pollTimer = setInterval(() => {
      void fetchSnapshot();
    }, 2000);
  };

  const stopPollingFallback = () => {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  };

  const connect = () => {
    if (closed) return;
    const token = getTeacherToken();
    if (!token) {
      startPollingFallback();
      return;
    }

    const url = `/api/stream/teacher/${encodeURIComponent(params.sessionId)}?token=${encodeURIComponent(token)}&lastSeq=${lastSeq}`;
    es = new EventSource(url);

    es.onopen = () => {
      if (closed) return;
      stopPollingFallback();
      params.onConnectionChange?.('connected');
    };

    const handleEvent = (ev: MessageEvent) => {
      if (closed) return;
      try {
        const env = JSON.parse(ev.data) as SSEEnvelope;
        if (env.seq > lastSeq) lastSeq = env.seq;
        if (env.event === 'snapshot' && env.data) {
          params.onSession(env.data as Session);
        } else {
          if (env.event === 'violation' && params.onViolation && env.data) {
            const d = env.data as {
              displayName: string;
              violation?: { type: string };
              totalViolations: number;
            };
            params.onViolation({
              displayName: d.displayName,
              type: d.violation?.type || 'tab_switch',
              totalViolations: d.totalViolations,
            });
          }
          // Pull fresh authoritative session snapshot on incremental events
          void fetchSnapshot();
        }
      } catch {}
    };

    const eventNames = [
      'snapshot',
      'student_joined',
      'student_left',
      'session_started',
      'question_changed',
      'answer_submitted',
      'session_paused',
      'session_resumed',
      'session_ended',
      'timer_update',
      'team_score',
      'vote_open',
      'vote_results',
      'violation',
    ];
    for (const name of eventNames) {
      es.addEventListener(name, handleEvent as EventListener);
    }

    es.onerror = () => {
      if (closed) return;
      es?.close();
      es = null;
      params.onConnectionChange?.('reconnecting');
      startPollingFallback();
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(() => {
        connect();
      }, 3000);
    };
  };

  void fetchSnapshot();
  connect();

  return () => {
    closed = true;
    es?.close();
    stopPollingFallback();
    if (reconnectTimer) clearTimeout(reconnectTimer);
  };
}

export function subscribeStudentSession(params: {
  sessionId: string;
  studentToken: string;
  onView: (view: StudentSessionView) => void;
  onKicked: (reason: string) => void;
  onConnectionChange?: (state: ConnectionState) => void;
}): () => void {
  let closed = false;
  let es: EventSource | null = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  const pollOnce = async () => {
    try {
      const { view } = await api.studentState(params.studentToken);
      if (!closed) params.onView(view);
    } catch (err) {
      const apiErr = err as { status?: number; data?: { kicked?: boolean }; message?: string };
      if (apiErr.status === 403 && apiErr.data?.kicked) {
        params.onKicked(apiErr.message || 'Мұғалім сізді бөлмеден шығарды.');
      }
    }
  };

  const startPolling = () => {
    if (pollTimer || closed) return;
    params.onConnectionChange?.('polling');
    pollTimer = setInterval(() => {
      void pollOnce();
    }, 2000);
  };

  const stopPolling = () => {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  };

  const connect = () => {
    if (closed) return;
    const url = `/api/stream/student/${encodeURIComponent(params.sessionId)}?token=${encodeURIComponent(params.studentToken)}`;
    es = new EventSource(url);

    es.onopen = () => {
      if (closed) return;
      stopPolling();
      params.onConnectionChange?.('connected');
    };

    const handleViewEvent = (ev: MessageEvent) => {
      if (closed) return;
      try {
        const env = JSON.parse(ev.data) as SSEEnvelope;
        if (env.event === 'kicked') {
          const d = env.data as { reason?: string };
          params.onKicked(d?.reason || 'Мұғалім сізді бөлмеден шығарды.');
          return;
        }
        if (env.data && typeof env.data === 'object' && 'sessionId' in (env.data as object)) {
          params.onView(env.data as StudentSessionView);
        } else {
          void pollOnce();
        }
      } catch {}
    };

    const names = [
      'snapshot',
      'student_joined',
      'session_started',
      'question_changed',
      'answer_submitted',
      'session_paused',
      'session_resumed',
      'session_ended',
      'timer_update',
      'team_score',
      'vote_open',
      'vote_results',
      'kicked',
    ];
    for (const n of names) {
      es.addEventListener(n, handleViewEvent as EventListener);
    }

    es.onerror = () => {
      if (closed) return;
      es?.close();
      es = null;
      params.onConnectionChange?.('reconnecting');
      startPolling();
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(() => {
        connect();
      }, 3000);
    };
  };

  // Heartbeat every 12s to keep student presence online
  heartbeatTimer = setInterval(() => {
    if (!closed) {
      void api.studentHeartbeat(params.studentToken).catch(() => {});
    }
  }, 12_000);

  connect();

  return () => {
    closed = true;
    es?.close();
    stopPolling();
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    if (reconnectTimer) clearTimeout(reconnectTimer);
  };
}
