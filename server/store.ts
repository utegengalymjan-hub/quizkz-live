import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import type {
  Folder,
  Quiz,
  Room,
  Session,
  StoreData,
  Teacher,
} from '../src/types.ts';

const CURRENT_SCHEMA_VERSION = 1;
const TRASH_RETENTION_DAYS = 30;
const MAX_BACKUPS = 7;

export interface StoreAdapter {
  init(): Promise<void>;
  getTeacherById(id: string): Teacher | undefined;
  getTeacherByEmail(email: string): Teacher | undefined;
  getTeacherByResetToken(token: string): Teacher | undefined;
  getAllTeachers(): Teacher[];
  saveTeacher(teacher: Teacher): Promise<void>;
  deleteTeacherCascade(teacherId: string): Promise<void>;

  getFoldersByOwner(ownerId: string): Folder[];
  getFolderById(id: string): Folder | undefined;
  saveFolder(folder: Folder): Promise<void>;
  deleteFolder(folderId: string, ownerId: string): Promise<void>;

  getQuizzesByOwner(ownerId: string, includeDeleted?: boolean): Quiz[];
  getQuizById(id: string): Quiz | undefined;
  getQuizByShareCode(code: string): Quiz | undefined;
  saveQuiz(quiz: Quiz): Promise<void>;
  deleteQuizPermanently(quizId: string): Promise<void>;
  purgeExpiredTrash(): Promise<number>;

  getRoomsByOwner(ownerId: string): Room[];
  getRoomById(id: string): Room | undefined;
  getRoomByName(name: string): Room | undefined;
  getAllRooms(): Room[];
  saveRoom(room: Room): Promise<void>;
  deleteRoom(roomId: string): Promise<void>;

  getSessionsByOwner(ownerId: string): Session[];
  getActiveSessions(): Session[];
  getAllSessions(): Session[];
  getSessionById(id: string): Session | undefined;
  saveSession(session: Session): Promise<void>;
  deleteSession(sessionId: string): Promise<void>;

  exportAll(): StoreData;
  exportTeacherData(ownerId: string): {
    teacher: Omit<Teacher, 'passwordHash' | 'passwordSalt' | 'resetToken'>;
    folders: Folder[];
    quizzes: Quiz[];
    rooms: Room[];
    sessions: Session[];
  } | null;
  getStorageStats(): Promise<{
    fileSizeBytes: number;
    backupCount: number;
    dataDir: string;
    teacherCount: number;
    quizCount: number;
    sessionCount: number;
    activeSessionCount: number;
    todaySessionCount: number;
  }>;
  createBackupNow(): Promise<string>;
}

function defaultStoreData(): StoreData {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    teachers: [],
    folders: [],
    quizzes: [],
    rooms: [],
    sessions: [],
  };
}

function migrateStoreData(raw: unknown): StoreData {
  if (!raw || typeof raw !== 'object') {
    return defaultStoreData();
  }
  const obj = raw as Partial<StoreData>;
  const data: StoreData = {
    schemaVersion: typeof obj.schemaVersion === 'number' ? obj.schemaVersion : 0,
    teachers: Array.isArray(obj.teachers) ? obj.teachers : [],
    folders: Array.isArray(obj.folders) ? obj.folders : [],
    quizzes: Array.isArray(obj.quizzes) ? obj.quizzes : [],
    rooms: Array.isArray(obj.rooms) ? obj.rooms : [],
    sessions: Array.isArray(obj.sessions) ? obj.sessions : [],
    lastBackupDate: obj.lastBackupDate,
  };

  if (data.schemaVersion < 1) {
    // Normalize missing fields for v0 -> v1
    data.rooms = data.rooms.map((r) => ({
      ...r,
      isLocked: Boolean(r.isLocked),
      blockedStudents: Array.isArray(r.blockedStudents) ? r.blockedStudents : [],
      createdAt: r.createdAt || new Date().toISOString(),
    }));
    data.quizzes = data.quizzes.map((q) => ({
      ...q,
      deletedAt: q.deletedAt ?? null,
      isPublic: Boolean(q.isPublic),
    }));
    data.sessions = data.sessions.map((s) => ({
      ...s,
      lastActivityAt: s.lastActivityAt || s.endedAt || s.startedAt || new Date().toISOString(),
      students: Array.isArray(s.students) ? s.students : [],
      answers: Array.isArray(s.answers) ? s.answers : [],
    }));
    data.schemaVersion = CURRENT_SCHEMA_VERSION;
  }

  return data;
}

export function generateId(prefix = ''): string {
  const raw = crypto.randomBytes(8).toString('hex');
  return prefix ? `${prefix}_${raw}` : raw;
}

export function generateShareCode(existingCodes: Set<string>): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (let attempt = 0; attempt < 50; attempt++) {
    let part = '';
    const bytes = crypto.randomBytes(6);
    for (let i = 0; i < 6; i++) {
      part += alphabet[bytes[i] % alphabet.length];
    }
    const code = `QZ-${part}`;
    if (!existingCodes.has(code)) return code;
  }
  return `QZ-${crypto.randomBytes(4).toString('hex').toUpperCase().slice(0, 6)}`;
}

export function generateRoomName(existingNames: Set<string>): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (let attempt = 0; attempt < 50; attempt++) {
    let suffix = '';
    const bytes = crypto.randomBytes(4);
    for (let i = 0; i < 4; i++) {
      suffix += alphabet[bytes[i] % alphabet.length];
    }
    const name = `SYNYP${suffix}`;
    if (!existingNames.has(name.toLowerCase())) return name;
  }
  return `ROOM${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}

function buildRightTriangleSvgDataUrl(): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="420" height="240" viewBox="0 0 420 240">
  <rect width="420" height="240" rx="14" fill="#f8fafc" stroke="#cbd5e1" stroke-width="2"/>
  <polygon points="80,190 310,190 80,55" fill="#d1fae5" fill-opacity="0.55" stroke="#059669" stroke-width="3"/>
  <rect x="80" y="170" width="20" height="20" fill="none" stroke="#059669" stroke-width="2"/>
  <text x="55" y="130" font-family="sans-serif" font-size="18" font-weight="700" fill="#0f172a">a = 6</text>
  <text x="175" y="216" font-family="sans-serif" font-size="18" font-weight="700" fill="#0f172a">b = 8</text>
  <text x="206" y="112" font-family="sans-serif" font-size="18" font-weight="700" fill="#059669">c = ?</text>
  <text x="64" y="48" font-family="sans-serif" font-size="15" font-weight="600" fill="#475569">A</text>
  <text x="64" y="205" font-family="sans-serif" font-size="15" font-weight="600" fill="#475569">C</text>
  <text x="318" y="205" font-family="sans-serif" font-size="15" font-weight="600" fill="#475569">B</text>
</svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg, 'utf-8').toString('base64')}`;
}

export function createWelcomeQuiz(ownerId: string, existingCodes: Set<string>): Quiz {
  const now = new Date().toISOString();
  return {
    id: generateId('qz'),
    ownerId,
    title: 'Үлгі викторина — Математика (8 сұрақ)',
    description: 'Алгебра, геометрия және логика бойынша дайын үлгі викторина. Өңдеуге немесе жоюға болады.',
    folderId: null,
    shareCode: generateShareCode(existingCodes),
    isPublic: false,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    questions: [
      {
        id: generateId('q'),
        type: 'multiple_choice',
        text: 'Квадрат теңдеудің түбірлерін табыңыз: $x^2 - 5x + 6 = 0$',
        options: [
          { id: 'a', text: '$x_1 = 2,\\; x_2 = 3$' },
          { id: 'b', text: '$x_1 = -2,\\; x_2 = -3$' },
          { id: 'c', text: '$x_1 = 1,\\; x_2 = 6$' },
          { id: 'd', text: '$x_1 = -1,\\; x_2 = 6$' },
        ],
        correct: ['a'],
        points: 1,
        explanation: 'Виет теоремасы бойынша: $x_1 + x_2 = 5$ және $x_1 \\cdot x_2 = 6$, сондықтан $x_1 = 2, x_2 = 3$.',
        order: 0,
      },
      {
        id: generateId('q'),
        type: 'multiple_choice',
        text: 'Суреттегі тікбұрышты үшбұрыштың $c$ гипотенузасын Пифагор теоремасымен есептеңіз ($a^2 + b^2 = c^2$).',
        imageUrl: buildRightTriangleSvgDataUrl(),
        options: [
          { id: 'a', text: '$c = 10$' },
          { id: 'b', text: '$c = 12$' },
          { id: 'c', text: '$c = 14$' },
          { id: 'd', text: '$c = \\sqrt{14}$' },
        ],
        correct: ['a'],
        points: 2,
        explanation: '$c = \\sqrt{6^2 + 8^2} = \\sqrt{36 + 64} = \\sqrt{100} = 10$.',
        order: 1,
      },
      {
        id: generateId('q'),
        type: 'true_false',
        text: 'Кез келген жай сан тақ сан болады.',
        options: [
          { id: 'true', text: 'Дұрыс' },
          { id: 'false', text: 'Қате' },
        ],
        correct: ['false'],
        points: 1,
        explanation: 'Қате: $2$ саны — жұп әрі жай сан.',
        order: 2,
      },
      {
        id: generateId('q'),
        type: 'short_answer',
        text: 'Өрнектің мәнін табыңыз: $\\frac{3^4}{9} + \\sqrt{49}$',
        correct: ['16'],
        points: 1,
        caseSensitive: false,
        ignoreSpacesAndDashes: true,
        explanation: '$\\frac{81}{9} + 7 = 9 + 7 = 16$.',
        order: 3,
      },
      {
        id: generateId('q'),
        type: 'multiple_choice',
        text: 'Төмендегі сандардың қайсысы $3$-ке қалдықсыз бөлінеді? (Бірнеше дұрыс жауап бар)',
        options: [
          { id: 'a', text: '$123$' },
          { id: 'b', text: '$245$' },
          { id: 'c', text: '$516$' },
          { id: 'd', text: '$701$' },
        ],
        correct: ['a', 'c'],
        multiCorrectMode: 'partial',
        points: 2,
        explanation: 'Цифрларының қосындысы $3$-ке бөлінетін сандар: $1+2+3=6$ және $5+1+6=12$.',
        order: 4,
      },
      {
        id: generateId('q'),
        type: 'true_false',
        text: 'Үшбұрыштың ішкі бұрыштарының қосындысы $180^\\circ$-қа тең.',
        options: [
          { id: 'true', text: 'Дұрыс' },
          { id: 'false', text: 'Қате' },
        ],
        correct: ['true'],
        points: 1,
        explanation: 'Евклид геометриясында кез келген үшбұрыштың ішкі бұрыштарының қосындысы $180^\\circ$.',
        order: 5,
      },
      {
        id: generateId('q'),
        type: 'multiple_choice',
        text: 'Функцияның туындысын табыңыз: $$f(x) = 3x^2 - 4x + 7$$',
        options: [
          { id: 'a', text: "$f'(x) = 6x - 4$" },
          { id: 'b', text: "$f'(x) = 3x - 4$" },
          { id: 'c', text: "$f'(x) = 6x + 7$" },
          { id: 'd', text: "$f'(x) = x^3 - 2x^2$" },
        ],
        correct: ['a'],
        points: 2,
        explanation: 'Дәрежелік функцияның туындысы: $(x^n)\' = n x^{n-1}$, тұрақтының туындысы $0$.',
        order: 6,
      },
      {
        id: generateId('q'),
        type: 'short_answer',
        text: 'Қазақстан Республикасының елордасы қай қала?',
        correct: ['Астана', 'Astana'],
        points: 1,
        caseSensitive: false,
        ignoreSpacesAndDashes: true,
        explanation: 'Қазақстанның елордасы — Астана.',
        order: 7,
      },
    ],
  };
}

class JsonFileStore implements StoreAdapter {
  private readonly dataDir: string;
  private readonly storePath: string;
  private readonly backupsDir: string;
  private data: StoreData = defaultStoreData();
  private writeChain: Promise<void> = Promise.resolve();
  private backupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(dataDir: string) {
    this.dataDir = path.resolve(dataDir);
    this.storePath = path.join(this.dataDir, 'quizkz-store.json');
    this.backupsDir = path.join(this.dataDir, 'backups');
  }

  private assertInsideDataDir(targetPath: string): string {
    const resolved = path.resolve(targetPath);
    if (resolved !== this.dataDir && !resolved.startsWith(this.dataDir + path.sep)) {
      throw new Error('Invalid storage path');
    }
    return resolved;
  }

  async init(): Promise<void> {
    await fsp.mkdir(this.dataDir, { recursive: true });
    await fsp.mkdir(this.backupsDir, { recursive: true });

    if (fs.existsSync(this.storePath)) {
      try {
        const raw = await fsp.readFile(this.storePath, 'utf-8');
        const parsed = JSON.parse(raw);
        this.data = migrateStoreData(parsed);
        await this.persist();
      } catch (err) {
        console.error('[store] Failed reading store file, backing up corrupt file:', err);
        const corruptCopy = this.assertInsideDataDir(
          path.join(this.backupsDir, `corrupt-${Date.now()}.json`)
        );
        await fsp.copyFile(this.storePath, corruptCopy).catch(() => {});
        this.data = defaultStoreData();
        await this.persist();
      }
    } else {
      this.data = defaultStoreData();
      await this.persist();
    }

    await this.purgeExpiredTrash();
    await this.maybeRunDailyBackup();

    // Check every hour for daily backup + expired trash purge
    this.backupTimer = setInterval(() => {
      void this.maybeRunDailyBackup();
      void this.purgeExpiredTrash();
    }, 60 * 60 * 1000);
    if (this.backupTimer.unref) {
      this.backupTimer.unref();
    }
  }

  private persist(): Promise<void> {
    const snapshot = JSON.stringify(this.data, null, 2);
    this.writeChain = this.writeChain
      .catch(() => {})
      .then(async () => {
        const tmpPath = this.assertInsideDataDir(
          path.join(this.dataDir, `.quizkz-store.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`)
        );
        await fsp.writeFile(tmpPath, snapshot, 'utf-8');
        await fsp.rename(tmpPath, this.storePath);
      });
    return this.writeChain;
  }

  private async maybeRunDailyBackup(): Promise<void> {
    const today = new Date().toISOString().slice(0, 10);
    if (this.data.lastBackupDate === today) return;
    try {
      await this.createBackupNow();
      this.data.lastBackupDate = today;
      await this.persist();
    } catch (err) {
      console.error('[store] Nightly backup failed:', err);
    }
  }

  async createBackupNow(): Promise<string> {
    await fsp.mkdir(this.backupsDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `quizkz-backup-${stamp}.json`;
    const dest = this.assertInsideDataDir(path.join(this.backupsDir, filename));
    const tmp = this.assertInsideDataDir(path.join(this.backupsDir, `.${filename}.tmp`));
    await fsp.writeFile(tmp, JSON.stringify(this.data, null, 2), 'utf-8');
    await fsp.rename(tmp, dest);

    // Keep last MAX_BACKUPS backup files
    const entries = await fsp.readdir(this.backupsDir);
    const backupFiles = entries
      .filter((f) => f.startsWith('quizkz-backup-') && f.endsWith('.json'))
      .sort()
      .reverse();
    for (const oldFile of backupFiles.slice(MAX_BACKUPS)) {
      const target = this.assertInsideDataDir(path.join(this.backupsDir, oldFile));
      await fsp.unlink(target).catch(() => {});
    }
    return filename;
  }

  // --- Teachers ---
  getTeacherById(id: string): Teacher | undefined {
    return this.data.teachers.find((t) => t.id === id);
  }

  getTeacherByEmail(email: string): Teacher | undefined {
    const normalized = email.trim().toLowerCase();
    return this.data.teachers.find((t) => t.email.toLowerCase() === normalized);
  }

  getTeacherByResetToken(token: string): Teacher | undefined {
    const now = Date.now();
    return this.data.teachers.find(
      (t) =>
        t.resetToken &&
        t.resetToken === token &&
        t.resetTokenExpiresAt &&
        new Date(t.resetTokenExpiresAt).getTime() > now
    );
  }

  getAllTeachers(): Teacher[] {
    return [...this.data.teachers];
  }

  async saveTeacher(teacher: Teacher): Promise<void> {
    const idx = this.data.teachers.findIndex((t) => t.id === teacher.id);
    if (idx >= 0) this.data.teachers[idx] = teacher;
    else this.data.teachers.push(teacher);
    await this.persist();
  }

  async deleteTeacherCascade(teacherId: string): Promise<void> {
    this.data.teachers = this.data.teachers.filter((t) => t.id !== teacherId);
    this.data.folders = this.data.folders.filter((f) => f.ownerId !== teacherId);
    this.data.quizzes = this.data.quizzes.filter((q) => q.ownerId !== teacherId);
    this.data.rooms = this.data.rooms.filter((r) => r.ownerId !== teacherId);
    this.data.sessions = this.data.sessions.filter((s) => s.ownerId !== teacherId);
    await this.persist();
  }

  // --- Folders ---
  getFoldersByOwner(ownerId: string): Folder[] {
    return this.data.folders.filter((f) => f.ownerId === ownerId);
  }

  getFolderById(id: string): Folder | undefined {
    return this.data.folders.find((f) => f.id === id);
  }

  async saveFolder(folder: Folder): Promise<void> {
    const idx = this.data.folders.findIndex((f) => f.id === folder.id);
    if (idx >= 0) this.data.folders[idx] = folder;
    else this.data.folders.push(folder);
    await this.persist();
  }

  async deleteFolder(folderId: string, ownerId: string): Promise<void> {
    // Collect folder and all descendant folders
    const toRemove = new Set<string>([folderId]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const f of this.data.folders) {
        if (f.ownerId === ownerId && f.parentId && toRemove.has(f.parentId) && !toRemove.has(f.id)) {
          toRemove.add(f.id);
          changed = true;
        }
      }
    }
    this.data.folders = this.data.folders.filter((f) => !(f.ownerId === ownerId && toRemove.has(f.id)));
    // Move affected quizzes back to root folder (null)
    for (const q of this.data.quizzes) {
      if (q.ownerId === ownerId && q.folderId && toRemove.has(q.folderId)) {
        q.folderId = null;
      }
    }
    await this.persist();
  }

  // --- Quizzes ---
  getQuizzesByOwner(ownerId: string, includeDeleted = false): Quiz[] {
    return this.data.quizzes.filter(
      (q) => q.ownerId === ownerId && (includeDeleted || !q.deletedAt)
    );
  }

  getQuizById(id: string): Quiz | undefined {
    return this.data.quizzes.find((q) => q.id === id);
  }

  getQuizByShareCode(code: string): Quiz | undefined {
    const normalized = code.trim().toUpperCase();
    return this.data.quizzes.find(
      (q) => q.shareCode.toUpperCase() === normalized && !q.deletedAt
    );
  }

  async saveQuiz(quiz: Quiz): Promise<void> {
    const idx = this.data.quizzes.findIndex((q) => q.id === quiz.id);
    if (idx >= 0) this.data.quizzes[idx] = quiz;
    else this.data.quizzes.push(quiz);
    await this.persist();
  }

  async deleteQuizPermanently(quizId: string): Promise<void> {
    this.data.quizzes = this.data.quizzes.filter((q) => q.id !== quizId);
    await this.persist();
  }

  async purgeExpiredTrash(): Promise<number> {
    const cutoff = Date.now() - TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000;
    const before = this.data.quizzes.length;
    this.data.quizzes = this.data.quizzes.filter((q) => {
      if (!q.deletedAt) return true;
      return new Date(q.deletedAt).getTime() > cutoff;
    });
    const removed = before - this.data.quizzes.length;
    if (removed > 0) {
      await this.persist();
    }
    return removed;
  }

  // --- Rooms ---
  getRoomsByOwner(ownerId: string): Room[] {
    return this.data.rooms.filter((r) => r.ownerId === ownerId);
  }

  getRoomById(id: string): Room | undefined {
    return this.data.rooms.find((r) => r.id === id);
  }

  getRoomByName(name: string): Room | undefined {
    const normalized = name.trim().toLowerCase();
    return this.data.rooms.find((r) => r.name.toLowerCase() === normalized);
  }

  getAllRooms(): Room[] {
    return [...this.data.rooms];
  }

  async saveRoom(room: Room): Promise<void> {
    const idx = this.data.rooms.findIndex((r) => r.id === room.id);
    if (idx >= 0) this.data.rooms[idx] = room;
    else this.data.rooms.push(room);
    await this.persist();
  }

  async deleteRoom(roomId: string): Promise<void> {
    this.data.rooms = this.data.rooms.filter((r) => r.id !== roomId);
    await this.persist();
  }

  // --- Sessions ---
  getSessionsByOwner(ownerId: string): Session[] {
    return this.data.sessions
      .filter((s) => s.ownerId === ownerId)
      .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
  }

  getActiveSessions(): Session[] {
    return this.data.sessions.filter((s) => s.status !== 'ended');
  }

  getAllSessions(): Session[] {
    return [...this.data.sessions];
  }

  getSessionById(id: string): Session | undefined {
    return this.data.sessions.find((s) => s.id === id);
  }

  async saveSession(session: Session): Promise<void> {
    const idx = this.data.sessions.findIndex((s) => s.id === session.id);
    if (idx >= 0) this.data.sessions[idx] = session;
    else this.data.sessions.push(session);
    await this.persist();
  }

  async deleteSession(sessionId: string): Promise<void> {
    this.data.sessions = this.data.sessions.filter((s) => s.id !== sessionId);
    for (const r of this.data.rooms) {
      if (r.currentSessionId === sessionId) {
        r.currentSessionId = null;
      }
    }
    await this.persist();
  }

  exportAll(): StoreData {
    return structuredClone(this.data);
  }

  exportTeacherData(ownerId: string) {
    const t = this.getTeacherById(ownerId);
    if (!t) return null;
    const { passwordHash: _ph, passwordSalt: _ps, resetToken: _rt, ...safeTeacher } = t;
    return {
      teacher: safeTeacher,
      folders: this.getFoldersByOwner(ownerId),
      quizzes: this.getQuizzesByOwner(ownerId, true),
      rooms: this.getRoomsByOwner(ownerId),
      sessions: this.getSessionsByOwner(ownerId),
    };
  }

  async getStorageStats() {
    let fileSizeBytes = 0;
    try {
      const stat = await fsp.stat(this.storePath);
      fileSizeBytes = stat.size;
    } catch {
      fileSizeBytes = 0;
    }

    let backupCount = 0;
    try {
      const files = await fsp.readdir(this.backupsDir);
      backupCount = files.filter((f) => f.startsWith('quizkz-backup-') && f.endsWith('.json')).length;
    } catch {
      backupCount = 0;
    }

    const todayPrefix = new Date().toISOString().slice(0, 10);
    const todaySessionCount = this.data.sessions.filter((s) =>
      s.startedAt.startsWith(todayPrefix)
    ).length;

    return {
      fileSizeBytes,
      backupCount,
      dataDir: this.dataDir,
      teacherCount: this.data.teachers.length,
      quizCount: this.data.quizzes.filter((q) => !q.deletedAt).length,
      sessionCount: this.data.sessions.length,
      activeSessionCount: this.data.sessions.filter((s) => s.status !== 'ended').length,
      todaySessionCount,
    };
  }
}

export const DATA_DIR = process.env.DATA_DIR || './data';
export const store: StoreAdapter = new JsonFileStore(DATA_DIR);
