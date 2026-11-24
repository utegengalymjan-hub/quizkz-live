import React, { useEffect, useState } from 'react';
import {
  Edit3,
  Lock,
  Plus,
  QrCode,
  Trash2,
  Unlock,
  UserX,
  Users,
} from 'lucide-react';
import type { Room } from '../../types.ts';
import { api } from '../../lib/api.ts';
import { useI18n } from '../../lib/i18n.ts';
import { ConfirmDialog, Modal } from '../shared/Modal.tsx';
import { RoomQrModal } from '../shared/TopControls.tsx';
import { useToast } from '../shared/Toast.tsx';

export const Rooms: React.FC<{
  onOpenLive: (sessionId: string) => void;
}> = ({ onOpenLive }) => {
  const { t } = useI18n();
  const toast = useToast();

  const [rooms, setRooms] = useState<Room[]>([]);
  const [loading, setLoading] = useState(true);
  const [newRoomName, setNewRoomName] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<Room | null>(null);
  const [renameVal, setRenameVal] = useState('');
  const [qrRoom, setQrRoom] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Room | null>(null);

  const loadRooms = async () => {
    try {
      const { rooms: list } = await api.getRooms();
      setRooms(list);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadRooms();
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.createRoom(newRoomName.trim());
      setNewRoomName('');
      setCreateOpen(false);
      toast.success('Уақытша бөлме құрылды');
      await loadRooms();
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const handleRename = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!renameTarget) return;
    try {
      await api.updateRoom(renameTarget.id, { name: renameVal.trim() });
      setRenameTarget(null);
      toast.success('Бөлме атауы өзгертілді');
      await loadRooms();
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const handleToggleLock = async (room: Room) => {
    try {
      await api.updateRoom(room.id, { isLocked: !room.isLocked });
      toast.success(room.isLocked ? 'Бөлме ашылды' : 'Бөлме құлыпталды');
      await loadRooms();
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const handleKickAll = async (room: Room) => {
    try {
      await api.kickAllRoom(room.id);
      toast.success('Барлық оқушылар бөлмеден шығарылды');
      await loadRooms();
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const handleUnblock = async (room: Room, name: string) => {
    try {
      await api.updateRoom(room.id, { unblockName: name });
      toast.success('Шектеу алынды');
      await loadRooms();
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-slate-100">
            {t('nav_rooms')}
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
            Тұрақты және уақытша бөлмелерді, QR-кодты және қолжетімділікті басқарыңыз.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setCreateOpen(true)}
          className="h-11 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold inline-flex items-center gap-2 whitespace-nowrap self-start"
        >
          <Plus className="w-4 h-4" />
          Уақытша бөлме құру
        </button>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 animate-pulse">
          {[0, 1].map((i) => (
            <div key={i} className="h-44 rounded-2xl bg-slate-200 dark:bg-slate-800" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {rooms.map((room) => (
            <div
              key={room.id}
              className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 space-y-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    {room.isPersistent ? 'Тұрақты бөлме' : 'Уақытша бөлме'}
                    {room.isLocked ? ' · Құлыпталған' : ' · Ашық'}
                  </div>
                  <div className="font-mono text-3xl font-bold tracking-wider text-slate-900 dark:text-slate-100 mt-1">
                    {room.name}
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      setRenameTarget(room);
                      setRenameVal(room.name);
                    }}
                    title="Атауын өзгерту"
                    className="p-2 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    <Edit3 className="w-4 h-4" />
                  </button>
                  {!room.isPersistent && (
                    <button
                      type="button"
                      onClick={() => setDeleteTarget(room)}
                      title="Жою"
                      className="p-2 rounded-lg border border-slate-200 dark:border-slate-700 text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setQrRoom(room.name)}
                  className="px-3.5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold inline-flex items-center gap-1.5"
                >
                  <QrCode className="w-4 h-4" />
                  QR / Проектор
                </button>
                <button
                  type="button"
                  onClick={() => handleToggleLock(room)}
                  className="px-3.5 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 text-xs font-semibold hover:bg-slate-100 dark:hover:bg-slate-800 inline-flex items-center gap-1.5"
                >
                  {room.isLocked ? <Unlock className="w-4 h-4" /> : <Lock className="w-4 h-4" />}
                  {room.isLocked ? 'Құлыпты ашу' : 'Бөлмені құлыптау'}
                </button>
                {room.currentSessionId && (
                  <>
                    <button
                      type="button"
                      onClick={() => onOpenLive(room.currentSessionId!)}
                      className="px-3.5 py-2 rounded-lg border border-emerald-500 text-emerald-700 dark:text-emerald-400 text-xs font-semibold inline-flex items-center gap-1.5"
                    >
                      <Users className="w-4 h-4" />
                      Белсенді сессия
                    </button>
                    <button
                      type="button"
                      onClick={() => handleKickAll(room)}
                      className="px-3.5 py-2 rounded-lg border border-red-300 dark:border-red-900 text-red-600 text-xs font-semibold inline-flex items-center gap-1.5"
                    >
                      <UserX className="w-4 h-4" />
                      Барлығын шығару
                    </button>
                  </>
                )}
              </div>

              {room.blockedStudents.length > 0 && (
                <div className="pt-3 border-t border-slate-100 dark:border-slate-800 space-y-1.5">
                  <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
                    Блокталған оқушылар:
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {room.blockedStudents.map((name) => (
                      <button
                        key={name}
                        type="button"
                        onClick={() => handleUnblock(room, name)}
                        className="text-xs px-2.5 py-1 rounded-md border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:border-emerald-500"
                      >
                        {name} ×
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Create Temp Room Modal */}
      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Жаңа уақытша бөлме"
        size="sm"
        footer={
          <>
            <button
              type="button"
              onClick={() => setCreateOpen(false)}
              className="px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-sm"
            >
              {t('cancel')}
            </button>
            <button
              type="submit"
              form="create-room-form"
              className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold"
            >
              Құру
            </button>
          </>
        }
      >
        <form id="create-room-form" onSubmit={handleCreate} className="space-y-3">
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
            Бірегей бөлме атауы (латын әріптері мен сандар)
          </label>
          <input
            type="text"
            required
            value={newRoomName}
            onChange={(e) => setNewRoomName(e.target.value.toUpperCase())}
            placeholder="MATH8B"
            className="w-full h-11 px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 font-mono text-lg uppercase"
          />
        </form>
      </Modal>

      {/* Rename Modal */}
      <Modal
        open={Boolean(renameTarget)}
        onClose={() => setRenameTarget(null)}
        title="Бөлме атауын өзгерту"
        size="sm"
        footer={
          <>
            <button
              type="button"
              onClick={() => setRenameTarget(null)}
              className="px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-sm"
            >
              {t('cancel')}
            </button>
            <button
              type="submit"
              form="rename-room-form"
              className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold"
            >
              {t('save')}
            </button>
          </>
        }
      >
        <form id="rename-room-form" onSubmit={handleRename} className="space-y-3">
          <input
            type="text"
            required
            value={renameVal}
            onChange={(e) => setRenameVal(e.target.value.toUpperCase())}
            className="w-full h-11 px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 font-mono text-lg uppercase"
          />
        </form>
      </Modal>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        danger
        title="Бөлмені жою"
        message={`«${deleteTarget?.name}» бөлмесін жойғыңыз келе ме?`}
        confirmLabel="Жою"
        onCancel={() => setDeleteTarget(null)}
        onConfirm={async () => {
          if (!deleteTarget) return;
          try {
            await api.deleteRoom(deleteTarget.id);
            toast.success('Бөлме жойылды');
            setDeleteTarget(null);
            await loadRooms();
          } catch (err) {
            toast.error((err as Error).message);
          }
        }}
      />

      {qrRoom && <RoomQrModal open={Boolean(qrRoom)} onClose={() => setQrRoom(null)} roomName={qrRoom} />}
    </div>
  );
};
