import type { Response } from 'express';
import {
  TEAM_COLORS,
  type Answer,
  type Question,
  type Quiz,
  type Room,
  type Session,
  type SessionKind,
  type SessionSettings,
  type SSEEnvelope,
  type Student,
  type StudentSessionView,
  type Team,
  type ViolationEvent,
  type ViolationType,
  type VoteRound,
} from '../src/types.ts';
export type { StudentSessionView };
import { generateId, store } from './store.ts';
import { evaluateAnswer, recalculateTeamScores, regradeSessionAnswers } from './scoring.ts';

const IDLE_SESSION_TIMEOUT_MS = 6 * 60 * 60 * 1000; // 6 hours
const STUDENT_OFFLINE_MS = 28_000;
const MAX_STUDENTS_PER_ROOM = 150;
const MAX_EVENT_BUFFER = 120;

interface TeacherClient {
  res: Response;
  connectedAt: number;
}

interface StudentClient {
  studentId: string;
  res: Response;
  connectedAt: number;
}

interface LiveSessionRuntime {
  session: Session;
  seq: number;
  eventBuffer: SSEEnvelope[];
  teacherClients: Set<TeacherClient>;
  studentClients: Set<StudentClient>;
}

function shuffleArray<T>(items: T[]): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

class SessionManager {
  private live = new Map<string, LiveSessionRuntime>();
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private keepAliveTimer: ReturnType<typeof setInterval> | null = null;

  async init(): Promise<void> {
    const active = store.getActiveSessions();
    for (const session of active) {
      this.live.set(session.id, {
        session,
        seq: 1,
        eventBuffer: [],
        teacherClients: new Set(),
        studentClients: new Set(),
      });
    }
    if (active.length > 0) {
      console.log(`[sessions] Restored ${active.length} active session(s) from disk`);
    }

    this.tickTimer = setInterval(() => {
      void this.tick();
    }, 1000);
    if (this.tickTimer.unref) this.tickTimer.unref();

    this.keepAliveTimer = setInterval(() => {
      this.sendKeepAlives();
    }, 15_000);
    if (this.keepAliveTimer.unref) this.keepAliveTimer.unref();
  }

  private sendKeepAlives(): void {
    for (const rt of this.live.values()) {
      for (const tc of rt.teacherClients) {
        try {
          tc.res.write(': keepalive\n\n');
        } catch {
          rt.teacherClients.delete(tc);
        }
      }
      for (const sc of rt.studentClients) {
        try {
          sc.res.write(': keepalive\n\n');
        } catch {
          rt.studentClients.delete(sc);
        }
      }
    }
  }

  private async tick(): Promise<void> {
    const now = Date.now();
    for (const rt of [...this.live.values()]) {
      const s = rt.session;
      if (s.status === 'ended') {
        this.live.delete(s.id);
        continue;
      }

      // 1. Check 6-hour idle timeout
      const lastAct = new Date(s.lastActivityAt || s.startedAt).getTime();
      if (now - lastAct > IDLE_SESSION_TIMEOUT_MS) {
        console.log(`[sessions] Auto-closing idle session ${s.id} after 6h`);
        await this.endSession(s.id);
        continue;
      }

      // 2. Check student presence timeout
      let presenceChanged = false;
      for (const st of s.students) {
        if (st.connected && !st.kicked) {
          const hasOpenSse = [...rt.studentClients].some((c) => c.studentId === st.id);
          const lastSeen = new Date(st.lastSeenAt).getTime();
          if (!hasOpenSse && now - lastSeen > STUDENT_OFFLINE_MS) {
            st.connected = false;
            presenceChanged = true;
            this.broadcastTeacher(rt, 'student_left', { studentId: st.id });
          }
        }
      }
      if (presenceChanged) {
        await store.saveSession(s);
      }

      // 3. Check overall session timer
      if (s.status === 'running' && s.timerEndsAt) {
        if (now >= new Date(s.timerEndsAt).getTime()) {
          await this.endSession(s.id);
          continue;
        }
      }

      // 4. Check per-question timer in teacher_paced mode
      if (
        s.status === 'running' &&
        s.settings.pacing === 'teacher_paced' &&
        s.questionTimerEndsAt
      ) {
        if (now >= new Date(s.questionTimerEndsAt).getTime()) {
          const nextIdx = s.currentQuestionIndex + 1;
          if (nextIdx < s.quizSnapshot.questions.length) {
            await this.setQuestionIndex(s.id, nextIdx);
          } else {
            s.questionTimerEndsAt = null;
            this.broadcastAll(rt, 'timer_update', {
              timerEndsAt: s.timerEndsAt,
              questionTimerEndsAt: null,
            });
            await store.saveSession(s);
          }
        }
      }
    }
  }

  getRuntime(sessionId: string): LiveSessionRuntime | undefined {
    return this.live.get(sessionId);
  }

  getSession(sessionId: string): Session | undefined {
    const rt = this.live.get(sessionId);
    if (rt) return rt.session;
    return store.getSessionById(sessionId);
  }

  getActiveStudentCountTotal(): number {
    let total = 0;
    for (const rt of this.live.values()) {
      if (rt.session.status !== 'ended') {
        total += rt.session.students.filter((st) => st.connected && !st.kicked).length;
      }
    }
    return total;
  }

  private pushEnvelope(rt: LiveSessionRuntime, event: string, data: unknown): SSEEnvelope {
    const env: SSEEnvelope = {
      seq: ++rt.seq,
      event,
      data,
      at: new Date().toISOString(),
    };
    rt.eventBuffer.push(env);
    if (rt.eventBuffer.length > MAX_EVENT_BUFFER) {
      rt.eventBuffer.splice(0, rt.eventBuffer.length - MAX_EVENT_BUFFER);
    }
    return env;
  }

  private writeSSE(res: Response, env: SSEEnvelope): void {
    res.write(`id: ${env.seq}\nevent: ${env.event}\ndata: ${JSON.stringify(env)}\n\n`);
  }

  private broadcastTeacher(rt: LiveSessionRuntime, event: string, data: unknown): SSEEnvelope {
    const env = this.pushEnvelope(rt, event, data);
    for (const tc of rt.teacherClients) {
      try {
        this.writeSSE(tc.res, env);
      } catch {
        rt.teacherClients.delete(tc);
      }
    }
    return env;
  }

  private broadcastStudent(
    rt: LiveSessionRuntime,
    studentId: string,
    event: string,
    data: unknown
  ): void {
    const env: SSEEnvelope = {
      seq: rt.seq,
      event,
      data,
      at: new Date().toISOString(),
    };
    for (const sc of rt.studentClients) {
      if (sc.studentId !== studentId) continue;
      try {
        this.writeSSE(sc.res, env);
      } catch {
        rt.studentClients.delete(sc);
      }
    }
  }

  private broadcastAll(rt: LiveSessionRuntime, event: string, data: unknown): void {
    const env = this.broadcastTeacher(rt, event, data);
    for (const sc of rt.studentClients) {
      try {
        // For state-sensitive events, send a tailored student snapshot refresh signal
        this.writeSSE(sc.res, {
          ...env,
          data:
            event === 'session_started' ||
            event === 'question_changed' ||
            event === 'session_paused' ||
            event === 'session_resumed' ||
            event === 'session_ended' ||
            event === 'vote_open' ||
            event === 'vote_results' ||
            event === 'team_score' ||
            event === 'timer_update'
              ? this.getStudentSessionView(rt.session, sc.studentId, rt.seq)
              : data,
        });
      } catch {
        rt.studentClients.delete(sc);
      }
    }
  }

  attachTeacherStream(sessionId: string, res: Response, lastSeq?: number): void {
    const rt = this.live.get(sessionId);
    if (!rt) {
      const historical = store.getSessionById(sessionId);
      if (historical) {
        const env: SSEEnvelope = {
          seq: 1,
          event: 'snapshot',
          data: historical,
          at: new Date().toISOString(),
        };
        this.writeSSE(res, env);
      }
      res.end();
      return;
    }

    const client: TeacherClient = { res, connectedAt: Date.now() };
    rt.teacherClients.add(client);

    // Send missed events if within buffer, otherwise full snapshot
    const oldestSeq = rt.eventBuffer[0]?.seq ?? rt.seq;
    if (typeof lastSeq === 'number' && lastSeq > 0 && lastSeq >= oldestSeq - 1 && lastSeq < rt.seq) {
      for (const env of rt.eventBuffer) {
        if (env.seq > lastSeq) {
          this.writeSSE(res, env);
        }
      }
    } else {
      this.writeSSE(res, {
        seq: rt.seq,
        event: 'snapshot',
        data: rt.session,
        at: new Date().toISOString(),
      });
    }

    res.on('close', () => {
      rt.teacherClients.delete(client);
    });
  }

  attachStudentStream(sessionId: string, studentId: string, res: Response): void {
    const rt = this.live.get(sessionId);
    const session = rt ? rt.session : store.getSessionById(sessionId);
    if (!session) {
      res.end();
      return;
    }
    const student = session.students.find((s) => s.id === studentId);
    if (!student) {
      res.end();
      return;
    }

    if (!rt) {
      this.writeSSE(res, {
        seq: 1,
        event: 'snapshot',
        data: this.getStudentSessionView(session, studentId, 1),
        at: new Date().toISOString(),
      });
      res.end();
      return;
    }

    student.connected = true;
    student.lastSeenAt = new Date().toISOString();
    const client: StudentClient = { studentId, res, connectedAt: Date.now() };
    rt.studentClients.add(client);

    this.writeSSE(res, {
      seq: rt.seq,
      event: 'snapshot',
      data: this.getStudentSessionView(rt.session, studentId, rt.seq),
      at: new Date().toISOString(),
    });
    this.broadcastTeacher(rt, 'student_joined', { student });

    res.on('close', () => {
      rt.studentClients.delete(client);
    });
  }

  async createSession(params: {
    ownerId: string;
    room: Room;
    kind: SessionKind;
    quiz: Quiz;
    settings: SessionSettings;
    title?: string;
    votePrompt?: string;
    startImmediately?: boolean;
  }): Promise<Session> {
    // End any previous active session in this room
    if (params.room.currentSessionId) {
      await this.endSession(params.room.currentSessionId);
    }

    const now = new Date().toISOString();
    const quizSnapshot: Quiz = structuredClone(params.quiz);
    quizSnapshot.questions = quizSnapshot.questions
      .sort((a, b) => a.order - b.order)
      .map((q, idx) => ({ ...q, order: idx }));

    let teams: Team[] | undefined;
    if (params.kind === 'space_race') {
      const count = Math.min(10, Math.max(2, params.settings.spaceRaceTeamCount || 4));
      teams = TEAM_COLORS.slice(0, count).map((c) => ({
        id: `team_${c.id}`,
        name: c.nameKk,
        color: c.hex,
        score: 0,
        progress: 0,
      }));
    }

    let votes: VoteRound[] | undefined;
    if (params.kind === 'vote') {
      votes = [
        {
          id: generateId('vr'),
          prompt: params.votePrompt?.trim() || params.title || 'Ойыңызды қысқаша жазыңыз',
          phase: 'collecting',
          submissions: [],
          ballots: [],
          createdAt: now,
        },
      ];
    }

    const status: Session['status'] = params.startImmediately ? 'running' : 'lobby';
    const timerEndsAt =
      status === 'running' && params.settings.timeLimitSeconds
        ? new Date(Date.now() + params.settings.timeLimitSeconds * 1000).toISOString()
        : null;
    const firstQSec =
      quizSnapshot.questions[0]?.timeLimitSeconds || params.settings.perQuestionSeconds;
    const questionTimerEndsAt =
      status === 'running' && params.settings.pacing === 'teacher_paced' && firstQSec
        ? new Date(Date.now() + firstQSec * 1000).toISOString()
        : null;

    const session: Session = {
      id: generateId('ses'),
      roomId: params.room.id,
      roomName: params.room.name,
      ownerId: params.ownerId,
      kind: params.kind,
      title: params.title?.trim() || quizSnapshot.title,
      quizId: quizSnapshot.id,
      quizSnapshot,
      settings: structuredClone(params.settings),
      status,
      currentQuestionIndex: 0,
      timerEndsAt,
      questionTimerEndsAt,
      startedAt: now,
      lastActivityAt: now,
      students: [],
      answers: [],
      teams,
      votes,
    };

    const rt: LiveSessionRuntime = {
      session,
      seq: 1,
      eventBuffer: [],
      teacherClients: new Set(),
      studentClients: new Set(),
    };
    this.live.set(session.id, rt);

    params.room.currentSessionId = session.id;
    await store.saveRoom(params.room);
    await store.saveSession(session);
    console.log(`[sessions] Started session ${session.id} (${session.kind}) in room ${params.room.name}`);
    return session;
  }

  async startSession(sessionId: string): Promise<Session> {
    const rt = this.live.get(sessionId);
    if (!rt) throw new Error('Сессия табылмады');
    const s = rt.session;
    if (s.status === 'ended') throw new Error('Сессия аяқталған');
    s.status = 'running';
    s.lastActivityAt = new Date().toISOString();
    if (s.settings.timeLimitSeconds && !s.timerEndsAt) {
      s.timerEndsAt = new Date(Date.now() + s.settings.timeLimitSeconds * 1000).toISOString();
    }
    const q = s.quizSnapshot.questions[s.currentQuestionIndex];
    const qSec = q?.timeLimitSeconds || s.settings.perQuestionSeconds;
    if (s.settings.pacing === 'teacher_paced' && qSec) {
      s.questionTimerEndsAt = new Date(Date.now() + qSec * 1000).toISOString();
    }
    await store.saveSession(s);
    this.broadcastAll(rt, 'session_started', {
      status: s.status,
      timerEndsAt: s.timerEndsAt,
      questionTimerEndsAt: s.questionTimerEndsAt,
    });
    return s;
  }

  async pauseSession(sessionId: string): Promise<Session> {
    const rt = this.live.get(sessionId);
    if (!rt) throw new Error('Сессия табылмады');
    const s = rt.session;
    if (s.status !== 'running') return s;
    s.status = 'paused';
    s.lastActivityAt = new Date().toISOString();
    await store.saveSession(s);
    this.broadcastAll(rt, 'session_paused', { status: 'paused' });
    return s;
  }

  async resumeSession(sessionId: string): Promise<Session> {
    const rt = this.live.get(sessionId);
    if (!rt) throw new Error('Сессия табылмады');
    const s = rt.session;
    if (s.status !== 'paused') return s;
    s.status = 'running';
    s.lastActivityAt = new Date().toISOString();
    await store.saveSession(s);
    this.broadcastAll(rt, 'session_resumed', { status: 'running' });
    return s;
  }

  async setQuestionIndex(sessionId: string, index: number): Promise<Session> {
    const rt = this.live.get(sessionId);
    if (!rt) throw new Error('Сессия табылмады');
    const s = rt.session;
    const maxIdx = Math.max(0, s.quizSnapshot.questions.length - 1);
    const clamped = Math.max(0, Math.min(maxIdx, index));
    s.currentQuestionIndex = clamped;
    s.settings.revealCorrectAnswer = false;
    s.lastActivityAt = new Date().toISOString();

    const q = s.quizSnapshot.questions[clamped];
    const qSec = q?.timeLimitSeconds || s.settings.perQuestionSeconds;
    if (s.status === 'running' && s.settings.pacing === 'teacher_paced' && qSec) {
      s.questionTimerEndsAt = new Date(Date.now() + qSec * 1000).toISOString();
    } else {
      s.questionTimerEndsAt = null;
    }

    await store.saveSession(s);
    this.broadcastAll(rt, 'question_changed', {
      currentQuestionIndex: clamped,
      questionTimerEndsAt: s.questionTimerEndsAt,
    });
    return s;
  }

  async updateTimer(
    sessionId: string,
    action: 'add_seconds' | 'clear' | 'set_seconds',
    seconds?: number
  ): Promise<Session> {
    const rt = this.live.get(sessionId);
    if (!rt) throw new Error('Сессия табылмады');
    const s = rt.session;
    const now = Date.now();
    if (action === 'clear') {
      s.timerEndsAt = null;
      s.questionTimerEndsAt = null;
    } else if (action === 'set_seconds' && seconds && seconds > 0) {
      if (s.settings.pacing === 'teacher_paced') {
        s.questionTimerEndsAt = new Date(now + seconds * 1000).toISOString();
      } else {
        s.timerEndsAt = new Date(now + seconds * 1000).toISOString();
      }
    } else if (action === 'add_seconds' && seconds) {
      const targetField =
        s.settings.pacing === 'teacher_paced' ? 'questionTimerEndsAt' : 'timerEndsAt';
      const base = s[targetField] ? Math.max(now, new Date(s[targetField]!).getTime()) : now;
      s[targetField] = new Date(base + seconds * 1000).toISOString();
    }
    s.lastActivityAt = new Date().toISOString();
    await store.saveSession(s);
    this.broadcastAll(rt, 'timer_update', {
      timerEndsAt: s.timerEndsAt,
      questionTimerEndsAt: s.questionTimerEndsAt,
    });
    return s;
  }

  async toggleRevealAnswer(sessionId: string, reveal: boolean): Promise<Session> {
    const rt = this.live.get(sessionId);
    if (!rt) throw new Error('Сессия табылмады');
    const s = rt.session;
    s.settings.revealCorrectAnswer = reveal;
    s.lastActivityAt = new Date().toISOString();
    await store.saveSession(s);
    this.broadcastAll(rt, 'question_changed', {
      currentQuestionIndex: s.currentQuestionIndex,
      revealCorrectAnswer: reveal,
    });
    return s;
  }

  async addQuickQuestion(sessionId: string, question: Question): Promise<Session> {
    const rt = this.live.get(sessionId);
    if (!rt) throw new Error('Сессия табылмады');
    const s = rt.session;
    const nextOrder = s.quizSnapshot.questions.length;
    const q: Question = {
      ...question,
      id: question.id || generateId('qq'),
      order: nextOrder,
    };
    s.quizSnapshot.questions.push(q);
    s.currentQuestionIndex = nextOrder;
    s.settings.revealCorrectAnswer = false;
    if (s.status === 'lobby') {
      s.status = 'running';
    }
    s.lastActivityAt = new Date().toISOString();
    await store.saveSession(s);
    this.broadcastAll(rt, 'question_changed', {
      currentQuestionIndex: nextOrder,
      question: q,
    });
    return s;
  }

  async updateVotePhase(
    sessionId: string,
    phase: VoteRound['phase'],
    newPrompt?: string
  ): Promise<Session> {
    const rt = this.live.get(sessionId);
    if (!rt) throw new Error('Сессия табылмады');
    const s = rt.session;
    if (!s.votes) s.votes = [];
    if (newPrompt && phase === 'collecting') {
      s.votes.push({
        id: generateId('vr'),
        prompt: newPrompt.trim(),
        phase: 'collecting',
        submissions: [],
        ballots: [],
        createdAt: new Date().toISOString(),
      });
    } else if (s.votes.length > 0) {
      s.votes[s.votes.length - 1].phase = phase;
    }
    if (s.status === 'lobby') s.status = 'running';
    s.lastActivityAt = new Date().toISOString();
    await store.saveSession(s);
    this.broadcastAll(
      rt,
      phase === 'voting' ? 'vote_open' : 'vote_results',
      { votes: s.votes }
    );
    return s;
  }

  async assignStudentTeam(sessionId: string, studentId: string, teamId: string): Promise<Session> {
    const rt = this.live.get(sessionId);
    if (!rt) throw new Error('Сессия табылмады');
    const s = rt.session;
    const student = s.students.find((st) => st.id === studentId);
    if (!student) throw new Error('Оқушы табылмады');
    if (!s.teams?.some((t) => t.id === teamId)) throw new Error('Команда табылмады');
    student.teamId = teamId;
    recalculateTeamScores(s);
    s.lastActivityAt = new Date().toISOString();
    await store.saveSession(s);
    this.broadcastAll(rt, 'team_score', { teams: s.teams, studentId, teamId });
    return s;
  }

  async endSession(sessionId: string): Promise<Session | undefined> {
    const rt = this.live.get(sessionId);
    const session = rt ? rt.session : store.getSessionById(sessionId);
    if (!session) return undefined;

    if (session.status !== 'ended') {
      session.status = 'ended';
      session.endedAt = new Date().toISOString();
      session.lastActivityAt = session.endedAt;
      regradeSessionAnswers(session);
      await store.saveSession(session);
    }

    const room = store.getRoomById(session.roomId);
    if (room && room.currentSessionId === session.id) {
      room.currentSessionId = null;
      await store.saveRoom(room);
    }

    if (rt) {
      this.broadcastAll(rt, 'session_ended', { status: 'ended', endedAt: session.endedAt });
      this.live.delete(session.id);
    }
    console.log(`[sessions] Ended session ${session.id} (${session.students.length} students)`);
    return session;
  }

  async kickStudent(sessionId: string, studentId: string, blockInRoom = false): Promise<Session> {
    const rt = this.live.get(sessionId);
    if (!rt) throw new Error('Сессия табылмады');
    const s = rt.session;
    const student = s.students.find((st) => st.id === studentId);
    if (!student) throw new Error('Оқушы табылмады');

    student.kicked = true;
    student.connected = false;
    s.lastActivityAt = new Date().toISOString();

    if (blockInRoom) {
      const room = store.getRoomById(s.roomId);
      if (room) {
        const key = student.displayName.trim().toLowerCase();
        if (!room.blockedStudents.includes(key)) {
          room.blockedStudents.push(key);
          await store.saveRoom(room);
        }
      }
    }

    recalculateTeamScores(s);
    await store.saveSession(s);

    this.broadcastStudent(rt, studentId, 'kicked', {
      reason: 'Мұғалім сізді бөлмеден шығарды.',
    });
    for (const sc of [...rt.studentClients]) {
      if (sc.studentId === studentId) {
        try {
          sc.res.end();
        } catch {}
        rt.studentClients.delete(sc);
      }
    }
    this.broadcastTeacher(rt, 'student_left', { studentId, kicked: true });
    return s;
  }

  async kickAllStudents(roomId: string): Promise<void> {
    const room = store.getRoomById(roomId);
    if (!room || !room.currentSessionId) return;
    const rt = this.live.get(room.currentSessionId);
    if (!rt) return;
    for (const st of rt.session.students) {
      if (!st.kicked) {
        st.kicked = true;
        st.connected = false;
        this.broadcastStudent(rt, st.id, 'kicked', {
          reason: 'Мұғалім барлық оқушыларды бөлмеден шығарды.',
        });
      }
    }
    for (const sc of [...rt.studentClients]) {
      try {
        sc.res.end();
      } catch {}
      rt.studentClients.delete(sc);
    }
    await store.saveSession(rt.session);
    this.broadcastTeacher(rt, 'snapshot', rt.session);
  }

  async allowStudentRetry(sessionId: string, studentId: string): Promise<Session> {
    const rt = this.live.get(sessionId);
    if (!rt) throw new Error('Сессия табылмады');
    const s = rt.session;
    const student = s.students.find((st) => st.id === studentId);
    if (!student) throw new Error('Оқушы табылмады');

    s.answers = s.answers.filter((a) => a.studentId !== studentId);
    student.finishedAt = undefined;
    student.autoClosedByProctoring = false;
    student.attemptNumber = (student.attemptNumber || 1) + 1;
    recalculateTeamScores(s);
    s.lastActivityAt = new Date().toISOString();
    await store.saveSession(s);

    this.broadcastTeacher(rt, 'snapshot', s);
    this.broadcastStudent(
      rt,
      studentId,
      'snapshot',
      this.getStudentSessionView(s, studentId, rt.seq)
    );
    return s;
  }

  async joinStudent(params: {
    room: Room;
    displayName: string;
    studentCode?: string;
    teamId?: string;
  }): Promise<{ session: Session; student: Student }> {
    if (params.room.isLocked) {
      throw new Error('Бөлме мұғалім тарапынан құлыпталған.');
    }
    if (!params.room.currentSessionId) {
      throw new Error('Бұл бөлмеде қазір белсенді тапсырма жоқ. Мұғалім бастауын күтіңіз.');
    }
    const rt = this.live.get(params.room.currentSessionId);
    if (!rt || rt.session.status === 'ended') {
      throw new Error('Бөлмедегі сессия аяқталған.');
    }

    const s = rt.session;
    const activeCount = s.students.filter((st) => !st.kicked).length;
    if (activeCount >= MAX_STUDENTS_PER_ROOM) {
      throw new Error(`Бөлмедегі оқушылар шегі (${MAX_STUDENTS_PER_ROOM}) толды.`);
    }

    let baseName = params.displayName.trim();
    if (!baseName) {
      if (s.settings.requireNames) {
        throw new Error('Аты-жөніңізді енгізіңіз.');
      }
      baseName = `Оқушы ${activeCount + 1}`;
    }

    if (params.room.blockedStudents.includes(baseName.toLowerCase())) {
      throw new Error('Сізге бұл бөлмеге кіруге шектеу қойылған.');
    }

    // Deduplicate identical student names: "Айдос" -> "Айдос (2)"
    let finalName = baseName;
    const existingLower = new Set(s.students.filter((st) => !st.kicked).map((st) => st.displayName.toLowerCase()));
    if (existingLower.has(finalName.toLowerCase())) {
      let n = 2;
      while (existingLower.has(`${baseName} (${n})`.toLowerCase())) {
        n++;
      }
      finalName = `${baseName} (${n})`;
    }

    // Team assignment for Space Race
    let assignedTeamId: string | undefined;
    if (s.kind === 'space_race' && s.teams && s.teams.length > 0) {
      if (params.teamId && s.teams.some((t) => t.id === params.teamId)) {
        assignedTeamId = params.teamId;
      } else {
        // Balanced auto-assignment to team with fewest members
        const counts = new Map<string, number>();
        for (const t of s.teams) counts.set(t.id, 0);
        for (const st of s.students) {
          if (st.teamId && !st.kicked) {
            counts.set(st.teamId, (counts.get(st.teamId) || 0) + 1);
          }
        }
        const sortedTeams = [...s.teams].sort(
          (a, b) => (counts.get(a.id) || 0) - (counts.get(b.id) || 0)
        );
        assignedTeamId = sortedTeams[0].id;
      }
    }

    // Per-student shuffling if enabled (not in teacher_paced where everyone views same question)
    const qIds = s.quizSnapshot.questions.map((q) => q.id);
    const questionOrder =
      s.settings.shuffleQuestions && s.settings.pacing !== 'teacher_paced'
        ? shuffleArray(qIds)
        : qIds;

    const optionOrders: Record<string, string[]> = {};
    if (s.settings.shuffleAnswers) {
      for (const q of s.quizSnapshot.questions) {
        if (q.type === 'multiple_choice' && q.options && q.options.length > 1) {
          optionOrders[q.id] = shuffleArray(q.options.map((o) => o.id));
        }
      }
    }

    const now = new Date().toISOString();
    const student: Student = {
      id: generateId('st'),
      displayName: finalName,
      studentCode: params.studentCode?.trim() || undefined,
      joinedAt: now,
      lastSeenAt: now,
      connected: true,
      teamId: assignedTeamId,
      attemptNumber: 1,
      questionOrder,
      optionOrders,
      violations: [],
    };

    s.students.push(student);
    s.lastActivityAt = now;
    await store.saveSession(s);

    this.broadcastTeacher(rt, 'student_joined', { student });
    if (s.status === 'lobby') {
      this.broadcastAll(rt, 'student_joined', { lobbyCount: s.students.filter((x) => !x.kicked).length });
    }

    return { session: s, student };
  }

  async submitAnswer(params: {
    sessionId: string;
    studentId: string;
    questionId: string;
    value: string[];
    timeSpentMs: number;
  }): Promise<{ answer: Answer; view: StudentSessionView }> {
    const rt = this.live.get(params.sessionId);
    if (!rt) throw new Error('Сессия белсенді емес.');
    const s = rt.session;
    if (s.status !== 'running') {
      throw new Error('Сессия қазір жауап қабылдамайды.');
    }

    const student = s.students.find((st) => st.id === params.studentId);
    if (!student || student.kicked) throw new Error('Оқушы сессияда табылмады.');
    if (student.finishedAt) throw new Error('Сіз тапсырманы аяқтап қойдыңыз.');

    const question = s.quizSnapshot.questions.find((q) => q.id === params.questionId);
    if (!question) throw new Error('Сұрақ табылмады.');

    // Enforce forward-only / teacher-paced locks
    const existingIdx = s.answers.findIndex(
      (a) => a.studentId === params.studentId && a.questionId === params.questionId
    );
    if (
      existingIdx >= 0 &&
      s.settings.pacing === 'student_paced_forward'
    ) {
      throw new Error('Бұл режимде жіберілген жауапты өзгертуге болмайды.');
    }

    const result = evaluateAnswer(question, params.value, s.settings.multiCorrectMode);
    const now = new Date().toISOString();
    const answer: Answer = {
      id: existingIdx >= 0 ? s.answers[existingIdx].id : generateId('ans'),
      studentId: params.studentId,
      questionId: params.questionId,
      value: params.value.map((v) => String(v ?? '').slice(0, 2000)),
      isCorrect: result.isCorrect,
      points: result.points,
      submittedAt: now,
      timeSpentMs: Math.max(0, Math.min(3_600_000, Math.round(params.timeSpentMs || 0))),
    };

    if (existingIdx >= 0) {
      // Preserve manual grade if teacher already graded it
      if (s.answers[existingIdx].manualGrade) {
        answer.manualGrade = s.answers[existingIdx].manualGrade;
        answer.points = answer.manualGrade.points;
        answer.isCorrect = answer.manualGrade.isCorrect;
      }
      s.answers[existingIdx] = answer;
    } else {
      s.answers.push(answer);
    }

    student.lastSeenAt = now;
    student.connected = true;
    s.lastActivityAt = now;

    if (s.kind === 'space_race') {
      recalculateTeamScores(s);
    }

    await store.saveSession(s);

    this.broadcastTeacher(rt, 'answer_submitted', {
      answer,
      teams: s.teams,
    });

    if (s.kind === 'space_race' && s.teams) {
      this.broadcastAll(rt, 'team_score', { teams: s.teams });
    } else {
      this.broadcastStudent(rt, params.studentId, 'answer_submitted', { answer });
    }

    return {
      answer,
      view: this.getStudentSessionView(s, params.studentId, rt.seq),
    };
  }

  async submitVoteEntry(sessionId: string, studentId: string, text: string): Promise<StudentSessionView> {
    const rt = this.live.get(sessionId);
    if (!rt) throw new Error('Сессия белсенді емес.');
    const s = rt.session;
    const round = s.votes?.[s.votes.length - 1];
    if (!round || round.phase !== 'collecting') {
      throw new Error('Жауап қабылдау кезеңі аяқталды.');
    }
    const trimmed = text.trim().slice(0, 500);
    if (!trimmed) throw new Error('Жауап мәтіні бос болмауы керек.');

    const existing = round.submissions.find((sub) => sub.studentId === studentId);
    if (existing) {
      existing.text = trimmed;
    } else {
      round.submissions.push({
        id: generateId('vsub'),
        studentId,
        text: trimmed,
        createdAt: new Date().toISOString(),
      });
    }
    s.lastActivityAt = new Date().toISOString();
    await store.saveSession(s);
    this.broadcastTeacher(rt, 'vote_results', { votes: s.votes });
    return this.getStudentSessionView(s, studentId, rt.seq);
  }

  async submitVoteBallot(
    sessionId: string,
    studentId: string,
    submissionId: string
  ): Promise<StudentSessionView> {
    const rt = this.live.get(sessionId);
    if (!rt) throw new Error('Сессия белсенді емес.');
    const s = rt.session;
    const round = s.votes?.[s.votes.length - 1];
    if (!round || round.phase !== 'voting') {
      throw new Error('Дауыс беру қазір ашық емес.');
    }
    if (!round.submissions.some((sub) => sub.id === submissionId)) {
      throw new Error('Нұсқа табылмады.');
    }
    const existing = round.ballots.find((b) => b.studentId === studentId);
    if (existing) {
      existing.submissionId = submissionId;
      existing.at = new Date().toISOString();
    } else {
      round.ballots.push({
        studentId,
        submissionId,
        at: new Date().toISOString(),
      });
    }
    s.lastActivityAt = new Date().toISOString();
    await store.saveSession(s);
    this.broadcastTeacher(rt, 'vote_results', { votes: s.votes });
    return this.getStudentSessionView(s, studentId, rt.seq);
  }

  async finishStudent(sessionId: string, studentId: string): Promise<StudentSessionView> {
    const rt = this.live.get(sessionId);
    if (!rt) throw new Error('Сессия белсенді емес.');
    const s = rt.session;
    const student = s.students.find((st) => st.id === studentId);
    if (!student) throw new Error('Оқушы табылмады.');

    student.finishedAt = new Date().toISOString();
    student.lastSeenAt = student.finishedAt;
    s.lastActivityAt = student.finishedAt;
    await store.saveSession(s);

    this.broadcastTeacher(rt, 'student_joined', { student });
    return this.getStudentSessionView(s, studentId, rt.seq);
  }

  async recordViolation(params: {
    sessionId: string;
    studentId: string;
    type: ViolationType;
    details?: string;
  }): Promise<{ violation: ViolationEvent; autoClosed: boolean; view: StudentSessionView }> {
    const rt = this.live.get(params.sessionId);
    if (!rt) throw new Error('Сессия белсенді емес.');
    const s = rt.session;
    const student = s.students.find((st) => st.id === params.studentId);
    if (!student) throw new Error('Оқушы табылмады.');

    const violation: ViolationEvent = {
      id: generateId('vio'),
      type: params.type,
      at: new Date().toISOString(),
      details: params.details?.slice(0, 200),
    };
    student.violations.push(violation);
    student.lastSeenAt = violation.at;
    s.lastActivityAt = violation.at;

    let autoClosed = false;
    const proct = s.settings.proctoring;
    if (
      proct?.enabled &&
      proct.maxViolations > 0 &&
      student.violations.length >= proct.maxViolations &&
      proct.actionOnLimit === 'auto_submit' &&
      !student.finishedAt
    ) {
      student.finishedAt = violation.at;
      student.autoClosedByProctoring = true;
      autoClosed = true;
    }

    await store.saveSession(s);
    this.broadcastTeacher(rt, 'violation', {
      studentId: student.id,
      displayName: student.displayName,
      violation,
      totalViolations: student.violations.length,
      autoClosed,
    });

    return {
      violation,
      autoClosed,
      view: this.getStudentSessionView(s, params.studentId, rt.seq),
    };
  }

  async heartbeatStudent(sessionId: string, studentId: string): Promise<StudentSessionView | null> {
    const rt = this.live.get(sessionId);
    const session = rt ? rt.session : store.getSessionById(sessionId);
    if (!session) return null;
    const student = session.students.find((st) => st.id === studentId);
    if (!student) return null;

    if (rt && !student.kicked) {
      const wasDisconnected = !student.connected;
      student.connected = true;
      student.lastSeenAt = new Date().toISOString();
      if (wasDisconnected) {
        this.broadcastTeacher(rt, 'student_joined', { student });
      }
    }
    return this.getStudentSessionView(session, studentId, rt?.seq ?? 1);
  }

  async gradeAnswer(params: {
    sessionId: string;
    answerId: string;
    points: number;
    isCorrect: boolean;
    gradedBy: string;
    acceptForAll?: boolean;
  }): Promise<Session> {
    const rt = this.live.get(params.sessionId);
    const s = rt ? rt.session : store.getSessionById(params.sessionId);
    if (!s) throw new Error('Сессия табылмады.');

    const ans = s.answers.find((a) => a.id === params.answerId);
    if (!ans) throw new Error('Жауап табылмады.');

    const now = new Date().toISOString();
    ans.manualGrade = {
      points: Math.max(0, Number(params.points) || 0),
      isCorrect: Boolean(params.isCorrect),
      gradedBy: params.gradedBy,
      at: now,
    };
    ans.points = ans.manualGrade.points;
    ans.isCorrect = ans.manualGrade.isCorrect;

    // Optionally add this short-answer value as an accepted answer for the question and regrade others
    if (params.acceptForAll && ans.value[0]) {
      const q = s.quizSnapshot.questions.find((qq) => qq.id === ans.questionId);
      if (q && q.type === 'short_answer') {
        const text = ans.value[0].trim();
        if (text && !q.correct.includes(text)) {
          q.correct.push(text);
        }
        regradeSessionAnswers(s);
      }
    } else {
      recalculateTeamScores(s);
    }

    s.lastActivityAt = now;
    await store.saveSession(s);

    if (rt) {
      this.broadcastTeacher(rt, 'snapshot', s);
      if (s.kind === 'space_race' && s.teams) {
        this.broadcastAll(rt, 'team_score', { teams: s.teams });
      }
    }
    return s;
  }

  getStudentSessionView(session: Session, studentId: string, seq = 1): StudentSessionView {
    const student = session.students.find((st) => st.id === studentId)!;
    const myAnswers: Record<string, Answer> = {};
    for (const a of session.answers) {
      if (a.studentId === studentId) {
        myAnswers[a.questionId] = a;
      }
    }

    // Order questions according to student's questionOrder
    const qMap = new Map(session.quizSnapshot.questions.map((q) => [q.id, q]));
    const orderedIds =
      student.questionOrder && student.questionOrder.length === session.quizSnapshot.questions.length
        ? student.questionOrder
        : session.quizSnapshot.questions.map((q) => q.id);

    const canSeeAnswersGlobally =
      session.status === 'ended' || Boolean(student.finishedAt);

    const questions = orderedIds
      .map((id) => qMap.get(id))
      .filter((q): q is Question => Boolean(q))
      .map((q) => {
        const myAns = myAnswers[q.id];
        const revealThis =
          (canSeeAnswersGlobally && session.settings.showFinalScore) ||
          (Boolean(myAns) && session.settings.showFeedbackAfterEach) ||
          (session.settings.pacing === 'teacher_paced' &&
            Boolean(session.settings.revealCorrectAnswer));

        let options = q.options;
        if (options && student.optionOrders?.[q.id]) {
          const optMap = new Map(options.map((o) => [o.id, o]));
          options = student.optionOrders[q.id]
            .map((oid) => optMap.get(oid))
            .filter((o): o is NonNullable<typeof o> => Boolean(o));
        }

        return {
          id: q.id,
          type: q.type,
          text: q.text,
          imageUrl: q.imageUrl,
          options,
          points: q.points,
          caseSensitive: q.caseSensitive,
          ignoreSpacesAndDashes: q.ignoreSpacesAndDashes,
          multiCorrectMode: q.multiCorrectMode,
          timeLimitSeconds: q.timeLimitSeconds,
          order: q.order,
          ...(revealThis
            ? { correct: q.correct, explanation: q.explanation }
            : {}),
        };
      });

    let activeVote: StudentSessionView['activeVote'];
    if (session.kind === 'vote' && session.votes && session.votes.length > 0) {
      const round = session.votes[session.votes.length - 1];
      const mySub = round.submissions.find((sub) => sub.studentId === studentId);
      const myBallot = round.ballots.find((b) => b.studentId === studentId);
      const counts = new Map<string, number>();
      for (const b of round.ballots) {
        counts.set(b.submissionId, (counts.get(b.submissionId) || 0) + 1);
      }
      activeVote = {
        id: round.id,
        prompt: round.prompt,
        phase: round.phase,
        mySubmissionId: mySub?.id,
        myBallotSubmissionId: myBallot?.submissionId,
        submissions:
          round.phase === 'collecting'
            ? []
            : round.submissions.map((sub) => ({
                id: sub.id,
                text: sub.text,
                ...(round.phase === 'results' ? { votes: counts.get(sub.id) || 0 } : {}),
              })),
      };
    }

    let finalSummary: StudentSessionView['finalSummary'];
    if (canSeeAnswersGlobally && session.settings.showFinalScore) {
      const totalPointsPossible = session.quizSnapshot.questions.reduce(
        (acc, q) => acc + (q.points ?? 1),
        0
      );
      let earnedPoints = 0;
      let correctCount = 0;
      for (const ans of Object.values(myAnswers)) {
        const pts = ans.manualGrade ? ans.manualGrade.points : ans.points;
        const ok = ans.manualGrade ? ans.manualGrade.isCorrect : ans.isCorrect;
        earnedPoints += pts;
        if (ok === true) correctCount++;
      }
      earnedPoints = Math.round(earnedPoints * 100) / 100;
      finalSummary = {
        earnedPoints,
        totalPointsPossible,
        percent:
          totalPointsPossible > 0
            ? Math.round((earnedPoints / totalPointsPossible) * 1000) / 10
            : 0,
        correctCount,
        totalQuestions: session.quizSnapshot.questions.length,
      };
    }

    return {
      seq,
      sessionId: session.id,
      roomName: session.roomName,
      kind: session.kind,
      title: session.title,
      status: session.status,
      currentQuestionIndex: session.currentQuestionIndex,
      timerEndsAt: session.timerEndsAt,
      questionTimerEndsAt: session.questionTimerEndsAt,
      settings: session.settings,
      student,
      lobbyCount: session.students.filter((st) => !st.kicked).length,
      questions,
      myAnswers,
      teams: session.teams,
      activeVote,
      finalSummary,
    };
  }
}

export const sessionManager = new SessionManager();
