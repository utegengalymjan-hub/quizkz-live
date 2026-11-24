import React, { createContext, useContext, useEffect, useState } from 'react';
import type { Locale, ThemeMode } from '../types.ts';

const DICT: Record<Locale, Record<string, string>> = {
  kk: {
    brand: 'QuizKZ Live',
    tagline: 'Сынып-ішілік нақты уақыттағы сұрау және бағалау',
    // Nav
    nav_dashboard: 'Басты бет',
    nav_launch: 'Іске қосу',
    nav_quizzes: 'Викториналар',
    nav_rooms: 'Бөлмелер',
    nav_reports: 'Есептер',
    nav_settings: 'Параметрлер',
    nav_admin: 'Әкімші',
    teacher_login: 'Мұғалімге кіру',
    student_join: 'Оқушы кіруі',
    logout: 'Шығу',
    // Student Join
    join_title: 'Бөлмеге кіру',
    join_subtitle: 'Мұғалім берген бөлме атауын енгізіңіз — аккаунт қажет емес',
    room_name_label: 'Бөлме атауы',
    room_name_placeholder: 'Мысалы: MATH7A',
    join_btn: 'Кіру',
    student_name_label: 'Аты-жөніңіз',
    student_name_placeholder: 'Мысалы: Айдос Серіков',
    student_code_label: 'Оқушы ID (міндетті емес)',
    student_code_placeholder: 'Мысалы: 7A-14',
    choose_team: 'Команданы таңдаңыз',
    continue_btn: 'Жалғастыру',
    back_btn: 'Артқа',
    waiting_teacher: 'Мұғалім сабақты бастағанша күтіңіз',
    connected_students: 'Қосылған оқушылар',
    reconnecting: 'Қайта қосылу…',
    offline_queued: 'Интернет жоқ — жауаптар сақталды, қосылғанда жіберіледі',
    kicked_title: 'Бөлмеден шығарылдыңыз',
    kicked_desc: 'Мұғалім сізді осы сессиядан шығарды. Қате болса мұғалімге хабарласыңыз.',
    // Auth
    login_title: 'Мұғалім аккаунтына кіру',
    register_title: 'Мұғалім ретінде тіркелу',
    name_label: 'Аты-жөні',
    email_label: 'Электрондық пошта',
    password_label: 'Құпиясөз (кемінде 8 таңба)',
    login_btn: 'Кіру',
    register_btn: 'Тіркелу',
    no_account: 'Аккаунтыңыз жоқ па?',
    has_account: 'Аккаунтыңыз бар ма?',
    // Dashboard
    my_room: 'Тұрақты бөлме',
    copy_code: 'Көшіру',
    copied: 'Көшірілді',
    qr_link: 'QR-код / Сілтеме',
    active_session: 'Белсенді сессия жүріп жатыр',
    resume_session: 'Жалғастыру',
    quick_actions: 'Жылдам әрекеттер',
    new_quiz: 'Жаңа викторина',
    recent_sessions: 'Соңғы сессиялар',
    stat_quizzes: 'Викториналар',
    stat_sessions: 'Өткізілген сабақтар',
    stat_avg: 'Орташа нәтиже',
    // Activities
    act_quiz: 'Викторина',
    act_quiz_desc: 'Сақталған викторинаны үш қарқын режимінің бірінде іске қосу',
    act_space_race: 'Space Race',
    act_space_race_desc: '2–10 команда арасындағы нақты уақыттағы жарыс',
    act_quick_question: 'Жылдам сұрақ',
    act_quick_question_desc: 'Сабақ үстінде бірден сұрақ қойып, тірі диаграмма көру',
    act_exit_ticket: 'Шығу билеті',
    act_exit_ticket_desc: 'Сабақ соңындағы 3 сұрақтық кері байланыс',
    act_vote: 'Дауыс беру',
    act_vote_desc: 'Оқушылар қысқа жауап жазып, ең үздігіне анонимді дауыс береді',
    // Pacing
    pacing_open: 'Оқушы өз қарқынымен (еркін навигация)',
    pacing_forward: 'Оқушы өз қарқынымен (тек алға)',
    pacing_teacher: 'Мұғалім қарқынымен (бір сұрақтан)',
    // Question types
    qt_multiple_choice: 'Көп таңдау',
    qt_true_false: 'Дұрыс / Қате',
    qt_short_answer: 'Қысқа жауап',
    true_label: 'Дұрыс',
    false_label: 'Қате',
    // Common
    save: 'Сақтау',
    saved: 'Сақталды',
    saving: 'Сақталуда…',
    cancel: 'Бас тарту',
    delete: 'Жою',
    confirm: 'Растау',
    close: 'Жабу',
    search: 'Іздеу…',
    loading: 'Жүктелуде…',
    empty: 'Деректер әзірге жоқ',
    start: 'Бастау',
    pause: 'Үзіліс',
    resume: 'Жалғастыру',
    end_session: 'Сессияны аяқтау',
    projector_mode: 'Проектор режимі',
    next: 'Келесі',
    prev: 'Алдыңғы',
    submit: 'Жіберу',
    finish: 'Аяқтау',
    points: 'ұпай',
    correct: 'Дұрыс',
    incorrect: 'Қате',
    pending_review: 'Қолмен тексеру',
    unanswered: 'Жауап жоқ',
    proctoring_disclaimer:
      'Ескерту: прокторинг браузерлік шектеулерге негізделген және 100% қорғаныс кепілдігін бермейді.',
    ai_disabled_notice:
      'GEMINI_API_KEY серверде орнатылмаған — AI мүмкіндіктері уақытша өшірулі, қалған барлық функция толық жұмыс істейді.',
  },
  ru: {
    brand: 'QuizKZ Live',
    tagline: 'Облачная платформа для живых викторин и опросов в классе',
    nav_dashboard: 'Главная',
    nav_launch: 'Запуск',
    nav_quizzes: 'Викторины',
    nav_rooms: 'Комнаты',
    nav_reports: 'Отчеты',
    nav_settings: 'Настройки',
    nav_admin: 'Админ',
    teacher_login: 'Вход для учителя',
    student_join: 'Вход ученика',
    logout: 'Выйти',
    join_title: 'Вход в комнату',
    join_subtitle: 'Введите название комнаты от учителя — регистрация не требуется',
    room_name_label: 'Название комнаты',
    room_name_placeholder: 'Например: MATH7A',
    join_btn: 'Войти',
    student_name_label: 'Имя и фамилия',
    student_name_placeholder: 'Например: Айдос Сериков',
    student_code_label: 'ID ученика (необязательно)',
    student_code_placeholder: 'Например: 7A-14',
    choose_team: 'Выберите команду',
    continue_btn: 'Продолжить',
    back_btn: 'Назад',
    waiting_teacher: 'Ожидайте начала урока от учителя',
    connected_students: 'Подключено учеников',
    reconnecting: 'Переподключение…',
    offline_queued: 'Нет сети — ответы сохранены и отправятся автоматически',
    kicked_title: 'Вы удалены из комнаты',
    kicked_desc: 'Учитель завершил ваше участие в текущей сессии.',
    login_title: 'Вход в аккаунт учителя',
    register_title: 'Регистрация учителя',
    name_label: 'Имя и фамилия',
    email_label: 'Электронная почта',
    password_label: 'Пароль (минимум 8 символов)',
    login_btn: 'Войти',
    register_btn: 'Зарегистрироваться',
    no_account: 'Нет аккаунта?',
    has_account: 'Уже есть аккаунт?',
    my_room: 'Постоянная комната',
    copy_code: 'Копировать',
    copied: 'Скопировано',
    qr_link: 'QR-код / Ссылка',
    active_session: 'Идет активная сессия',
    resume_session: 'Продолжить',
    quick_actions: 'Быстрые действия',
    new_quiz: 'Новая викторина',
    recent_sessions: 'Последние сессии',
    stat_quizzes: 'Викторины',
    stat_sessions: 'Проведено уроков',
    stat_avg: 'Средний балл',
    act_quiz: 'Викторина',
    act_quiz_desc: 'Запуск сохраненной викторины в одном из 3 режимов темпа',
    act_space_race: 'Space Race',
    act_space_race_desc: 'Командная гонка в реальном времени (2–10 команд)',
    act_quick_question: 'Быстрый вопрос',
    act_quick_question_desc: 'Мгновенный вопрос прямо на уроке с живой диаграммой',
    act_exit_ticket: 'Выходной билет',
    act_exit_ticket_desc: 'Рефлексия из 3 вопросов в конце урока',
    act_vote: 'Голосование',
    act_vote_desc: 'Ученики пишут короткие ответы и анонимно голосуют за лучший',
    pacing_open: 'Свободный темп ученика',
    pacing_forward: 'Темп ученика (только вперед)',
    pacing_teacher: 'Темп учителя (по одному вопросу)',
    qt_multiple_choice: 'Выбор ответа',
    qt_true_false: 'Верно / Неверно',
    qt_short_answer: 'Короткий ответ',
    true_label: 'Верно',
    false_label: 'Неверно',
    save: 'Сохранить',
    saved: 'Сохранено',
    saving: 'Сохранение…',
    cancel: 'Отмена',
    delete: 'Удалить',
    confirm: 'Подтвердить',
    close: 'Закрыть',
    search: 'Поиск…',
    loading: 'Загрузка…',
    empty: 'Пока нет данных',
    start: 'Начать',
    pause: 'Пауза',
    resume: 'Продолжить',
    end_session: 'Завершить сессию',
    projector_mode: 'Режим проектора',
    next: 'Далее',
    prev: 'Назад',
    submit: 'Отправить',
    finish: 'Завершить',
    points: 'баллов',
    correct: 'Верно',
    incorrect: 'Неверно',
    pending_review: 'На проверке',
    unanswered: 'Нет ответа',
    proctoring_disclaimer:
      'Внимание: прокторинг работает на уровне браузера и не дает 100% защиты от списывания.',
    ai_disabled_notice:
      'GEMINI_API_KEY не задан на сервере — функции AI отключены, остальной функционал работает полностью.',
  },
  en: {
    brand: 'QuizKZ Live',
    tagline: 'Real-time classroom quizzes, polling & live assessment',
    nav_dashboard: 'Dashboard',
    nav_launch: 'Launch',
    nav_quizzes: 'Quizzes',
    nav_rooms: 'Rooms',
    nav_reports: 'Reports',
    nav_settings: 'Settings',
    nav_admin: 'Admin',
    teacher_login: 'Teacher Login',
    student_join: 'Student Join',
    logout: 'Sign out',
    join_title: 'Join a Room',
    join_subtitle: 'Enter the room name shared by your teacher — no account needed',
    room_name_label: 'Room Name',
    room_name_placeholder: 'e.g. MATH7A',
    join_btn: 'Join',
    student_name_label: 'Full Name',
    student_name_placeholder: 'e.g. Aidos Serikov',
    student_code_label: 'Student ID (optional)',
    student_code_placeholder: 'e.g. 7A-14',
    choose_team: 'Choose your team',
    continue_btn: 'Continue',
    back_btn: 'Back',
    waiting_teacher: 'Waiting for teacher to start the activity',
    connected_students: 'Students connected',
    reconnecting: 'Reconnecting…',
    offline_queued: 'Offline — answers queued and will sync automatically',
    kicked_title: 'Removed from Room',
    kicked_desc: 'The teacher removed you from this live session.',
    login_title: 'Teacher Sign In',
    register_title: 'Create Teacher Account',
    name_label: 'Full Name',
    email_label: 'Email Address',
    password_label: 'Password (min 8 characters)',
    login_btn: 'Sign In',
    register_btn: 'Register',
    no_account: 'No account yet?',
    has_account: 'Already have an account?',
    my_room: 'Permanent Room',
    copy_code: 'Copy',
    copied: 'Copied',
    qr_link: 'QR Code / Link',
    active_session: 'Live session in progress',
    resume_session: 'Resume',
    quick_actions: 'Quick Actions',
    new_quiz: 'New Quiz',
    recent_sessions: 'Recent Sessions',
    stat_quizzes: 'Quizzes',
    stat_sessions: 'Sessions Run',
    stat_avg: 'Average Score',
    act_quiz: 'Quiz',
    act_quiz_desc: 'Run a saved quiz in open, forward-only, or teacher-paced mode',
    act_space_race: 'Space Race',
    act_space_race_desc: 'Real-time team competition across 2–10 colorful lanes',
    act_quick_question: 'Quick Question',
    act_quick_question_desc: 'Launch instant on-the-fly polls with live bar charts',
    act_exit_ticket: 'Exit Ticket',
    act_exit_ticket_desc: '3-question end-of-lesson understanding check',
    act_vote: 'Vote',
    act_vote_desc: 'Collect short answers and let students vote anonymously',
    pacing_open: 'Student-paced (open navigation)',
    pacing_forward: 'Student-paced (forward only)',
    pacing_teacher: 'Teacher-paced (one question at a time)',
    qt_multiple_choice: 'Multiple Choice',
    qt_true_false: 'True / False',
    qt_short_answer: 'Short Answer',
    true_label: 'True',
    false_label: 'False',
    save: 'Save',
    saved: 'Saved',
    saving: 'Saving…',
    cancel: 'Cancel',
    delete: 'Delete',
    confirm: 'Confirm',
    close: 'Close',
    search: 'Search…',
    loading: 'Loading…',
    empty: 'No items yet',
    start: 'Start',
    pause: 'Pause',
    resume: 'Resume',
    end_session: 'End Session',
    projector_mode: 'Projector Mode',
    next: 'Next',
    prev: 'Previous',
    submit: 'Submit',
    finish: 'Finish',
    points: 'pts',
    correct: 'Correct',
    incorrect: 'Incorrect',
    pending_review: 'Manual Review',
    unanswered: 'Unanswered',
    proctoring_disclaimer:
      'Note: browser proctoring provides deterrent signals and is not 100% foolproof.',
    ai_disabled_notice:
      'GEMINI_API_KEY is not configured on the server — AI tools are disabled while all core features work normally.',
  },
};

interface I18nContextValue {
  locale: Locale;
  setLocale: (loc: Locale) => void;
  t: (key: string) => string;
  theme: ThemeMode;
  resolvedTheme: 'light' | 'dark';
  setTheme: (mode: ThemeMode) => void;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() => {
    try {
      const saved = localStorage.getItem('quizkz_locale');
      if (saved === 'kk' || saved === 'ru' || saved === 'en') return saved;
    } catch {}
    return 'kk';
  });

  const [theme, setThemeState] = useState<ThemeMode>(() => {
    try {
      const saved = localStorage.getItem('quizkz_theme');
      if (saved === 'light' || saved === 'dark' || saved === 'system') return saved;
    } catch {}
    return 'system';
  });

  const [systemDark, setSystemDark] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
  });

  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!mq) return;
    const handler = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  const resolvedTheme: 'light' | 'dark' =
    theme === 'system' ? (systemDark ? 'dark' : 'light') : theme;

  useEffect(() => {
    const root = document.documentElement;
    if (resolvedTheme === 'dark') root.classList.add('dark');
    else root.classList.remove('dark');
  }, [resolvedTheme]);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const setLocale = (loc: Locale) => {
    setLocaleState(loc);
    try {
      localStorage.setItem('quizkz_locale', loc);
    } catch {}
  };

  const setTheme = (mode: ThemeMode) => {
    setThemeState(mode);
    try {
      localStorage.setItem('quizkz_theme', mode);
    } catch {}
  };

  const t = (key: string) => DICT[locale][key] || DICT.kk[key] || key;

  return React.createElement(
    I18nContext.Provider,
    { value: { locale, setLocale, t, theme, resolvedTheme, setTheme } },
    children,
  );
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used inside I18nProvider');
  return ctx;
}
