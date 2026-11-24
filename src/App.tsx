import React, { useEffect, useState } from 'react';
import type { PublicTeacher } from './types.ts';
import { api, setTeacherToken } from './lib/api.ts';
import { I18nProvider, useI18n } from './lib/i18n.ts';
import { useRoute } from './lib/utils.ts';
import { ErrorBoundary, ToastProvider } from './components/shared/Toast.tsx';
import { StudentPortal } from './components/student/StudentPortal.tsx';
import { AuthView, PublicShareQuizView } from './components/teacher/AuthView.tsx';
import { TeacherShell } from './components/teacher/TeacherShell.tsx';

function AppRouter() {
  const { pathname, params, navigate } = useRoute();
  const { setLocale } = useI18n();

  const [teacher, setTeacher] = useState<PublicTeacher | null>(null);
  const [aiEnabled, setAiEnabled] = useState(false);

  useEffect(() => {
    api
      .getConfig()
      .then((cfg) => setAiEnabled(cfg.aiEnabled))
      .catch(() => setAiEnabled(false));
  }, []);

  const handleAuthenticated = (loggedInTeacher: PublicTeacher) => {
    setTeacher(loggedInTeacher);
    if (loggedInTeacher.language) {
      setLocale(loggedInTeacher.language);
    }
    navigate('/teacher', true);
  };

  const handleLogout = () => {
    setTeacherToken(null);
    setTeacher(null);
    navigate('/', true);
  };

  // Public quiz share view: /share/:code
  if (pathname.startsWith('/share/')) {
    const code = decodeURIComponent(pathname.slice('/share/'.length)).split('/')[0];
    return (
      <PublicShareQuizView
        code={code}
        onBack={() => navigate('/')}
        onGoLogin={() => navigate('/login')}
      />
    );
  }

  // Password reset link: /reset-password?token=...
  if (pathname === '/reset-password') {
    const token = params.get('token') || '';
    return (
      <AuthView
        initialMode="reset"
        resetToken={token}
        onAuthenticated={handleAuthenticated}
        onBackToStudent={() => navigate('/')}
      />
    );
  }

  // Teacher dashboard when authenticated
  if (teacher && (pathname.startsWith('/teacher') || pathname === '/login' || pathname === '/register')) {
    return (
      <TeacherShell
        teacher={teacher}
        aiEnabled={aiEnabled}
        onTeacherUpdated={setTeacher}
        onLogout={handleLogout}
      />
    );
  }

  // Teacher authentication views
  if (pathname === '/login' || pathname === '/register' || pathname.startsWith('/teacher')) {
    return (
      <AuthView
        initialMode={pathname === '/register' ? 'register' : 'login'}
        onAuthenticated={handleAuthenticated}
        onBackToStudent={() => navigate('/')}
      />
    );
  }

  // Default landing page (/) and /join?room=... — Student entry is primary focus
  const initialRoom = params.get('room') || '';
  return (
    <StudentPortal
      initialRoom={initialRoom}
      onGoTeacherLogin={() => navigate(teacher ? '/teacher' : '/login')}
    />
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <I18nProvider>
        <ToastProvider>
          <AppRouter />
        </ToastProvider>
      </I18nProvider>
    </ErrorBoundary>
  );
}
