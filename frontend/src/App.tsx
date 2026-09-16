import { useState, useEffect, useCallback } from 'react';
import { Navbar } from './components/Navbar';
import { FilterBar } from './components/FilterBar';
import { GameCard } from './components/GameCard';
import { GameModal } from './components/GameModal';
import { WorkerDashboard } from './components/WorkerDashboard';
import { AdminAuthModal } from './components/AdminAuthModal';
import type {
  GameItem,
  CrawlState,
  WorkerLog,
  WorkerProgressPayload
} from './types';
import { Gamepad2, Sparkles, AlertTriangle, CheckCircle2, XCircle, Info, X } from 'lucide-react';

export function App() {
  const [games, setGames] = useState<GameItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [search, setSearch] = useState('');
  const [selectedPlatform, setSelectedPlatform] = useState('');
  const [availablePlatforms, setAvailablePlatforms] = useState<string[]>([]);
  const [sortBy, setSortBy] = useState<'recent' | 'metascore' | 'userscore' | 'title'>('recent');

  // Modal states
  const [selectedGameId, setSelectedGameId] = useState<string | null>(null);
  const [isMonitorOpen, setIsMonitorOpen] = useState(false);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);

  // Auth & Quota states
  const [isAdmin, setIsAdmin] = useState(false);
  const [freeRunsRemaining, setFreeRunsRemaining] = useState(3);

  // Worker real-time states
  const [crawlState, setCrawlState] = useState<CrawlState | null>(null);
  const [progress, setProgress] = useState<WorkerProgressPayload | null>(null);
  const [logs, setLogs] = useState<WorkerLog[]>([]);
  const [isRunning, setIsRunning] = useState(false);

  // Toast notification state
  const [toast, setToast] = useState<{ type: 'info' | 'error' | 'success'; message: string } | null>(null);

  const showToast = useCallback((type: 'info' | 'error' | 'success', message: string) => {
    setToast({ type, message });
    setTimeout(() => {
      setToast(curr => (curr?.message === message ? null : curr));
    }, 4000);
  }, []);

  // Fetch Auth & Quota status
  const fetchAuthStatus = useCallback(async () => {
    try {
      const token = localStorage.getItem('metacritic_admin_token') || '';
      const headers: Record<string, string> = {};
      if (token) headers['x-admin-key'] = token;
      const res = await fetch('/api/auth/status', { headers });
      const json = await res.json();
      if (json.success) {
        setIsAdmin(json.data.isAdmin);
        setFreeRunsRemaining(json.data.freeRunsRemaining);
      }
    } catch (e) {
      console.warn('Failed to fetch auth status:', e);
    }
  }, []);

  // Load Games
  const fetchGames = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (search.trim()) params.set('search', search.trim());
      if (selectedPlatform) params.set('platform', selectedPlatform);
      if (sortBy) params.set('sortBy', sortBy);

      const res = await fetch(`/api/games?${params.toString()}`);
      const json = await res.json();
      if (json.success) {
        setGames(json.data);
      } else {
        setError(json.error || 'Ошибка загрузки игр');
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [search, selectedPlatform, sortBy]);

  // Load Platforms
  const fetchPlatforms = async () => {
    try {
      const res = await fetch('/api/platforms');
      const json = await res.json();
      if (json.success) {
        setAvailablePlatforms(json.data);
      }
    } catch (e) {
      console.warn('Failed to fetch platforms:', e);
    }
  };

  useEffect(() => {
    fetchGames();
  }, [fetchGames]);

  useEffect(() => {
    fetchPlatforms();
    fetchAuthStatus();
  }, [fetchAuthStatus]);

  // Setup WebSocket Connection
  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    let ws: WebSocket | null = null;
    let reconnectTimeout: any = null;

    function connect() {
      ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        console.log('[WebSocket] Connected to worker stream');
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'init') {
            setCrawlState(msg.data.state);
            setIsRunning(msg.data.isRunning);
            setLogs(msg.data.logs || []);
          } else if (msg.type === 'progress') {
            const p: WorkerProgressPayload = msg.data;
            setProgress(p);
            setIsRunning(p.status === 'running');
            if (p.status === 'idle' || p.status === 'completed') {
              // Refresh games list when worker finishes
              fetchGames();
              fetchPlatforms();
              fetchAuthStatus();
            }
          } else if (msg.type === 'log') {
            setLogs((prev) => [...prev, msg.data]);
            // If game was saved, refresh catalog
            if (msg.data.level === 'success') {
              fetchGames();
            }
          }
        } catch (err) {
          console.error('[WebSocket] Message parse error:', err);
        }
      };

      ws.onclose = () => {
        console.log('[WebSocket] Disconnected, attempting reconnect in 3s...');
        reconnectTimeout = setTimeout(connect, 3000);
      };

      ws.onerror = (e) => {
        console.warn('[WebSocket] Error:', e);
      };
    }

    connect();

    return () => {
      if (ws) ws.close();
      clearTimeout(reconnectTimeout);
    };
  }, [fetchGames, fetchAuthStatus]);

  // Force Run Handler
  const handleForceRun = async () => {
    try {
      setIsRunning(true);
      const token = localStorage.getItem('metacritic_admin_token') || '';
      const headers: Record<string, string> = {};
      if (token) headers['x-admin-key'] = token;

      const res = await fetch('/api/worker/run', { method: 'POST', headers });
      const json = await res.json();

      if (!res.ok) {
        if (res.status === 403 && json.code === 'QUOTA_EXCEEDED') {
          showToast('error', json.message || 'Демо-лимит исчерпан');
          setIsAuthModalOpen(true);
        } else {
          showToast('error', json.message || 'Ошибка запуска воркера');
        }
        setIsRunning(false);
        fetchAuthStatus();
        return;
      }

      if (!json.success) {
        showToast('error', json.message || 'Ошибка запуска воркера');
        setIsRunning(false);
      } else {
        showToast('success', 'Воркер сбора данных успешно запущен!');
        setIsMonitorOpen(true);
        if (json.freeRunsRemaining !== undefined) {
          setFreeRunsRemaining(json.freeRunsRemaining);
        }
      }
      fetchAuthStatus();
    } catch (err: any) {
      showToast('error', `Ошибка сетевого запроса: ${err.message}`);
      setIsRunning(false);
    }
  };

  const handleLoginSuccess = (token: string) => {
    localStorage.setItem('metacritic_admin_token', token);
    setIsAdmin(true);
    showToast('success', 'Авторизован как Администратор');
    fetchAuthStatus();
  };

  const handleLogout = () => {
    localStorage.removeItem('metacritic_admin_token');
    setIsAdmin(false);
    showToast('info', 'Вы вышли из учетной записи администратора');
    fetchAuthStatus();
  };

  return (
    <div className="min-h-screen bg-[#0b0f19] text-slate-100 flex flex-col selection:bg-amber-500 selection:text-slate-950">
      {/* Navigation */}
      <Navbar
        crawlState={crawlState}
        isRunning={isRunning}
        totalGames={games.length}
        isAdmin={isAdmin}
        freeRunsRemaining={freeRunsRemaining}
        onOpenMonitor={() => setIsMonitorOpen(true)}
        onForceRun={handleForceRun}
        onOpenAuth={() => setIsAuthModalOpen(true)}
      />

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Banner / Intro */}
        <div className="relative rounded-3xl overflow-hidden bg-gradient-to-r from-slate-900 via-slate-900/90 to-slate-950 border border-slate-800/80 p-6 sm:p-8 mb-8 shadow-2xl">
          <div className="relative z-10 max-w-2xl">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20 text-xs font-semibold mb-3">
              <Sparkles className="w-3.5 h-3.5" />
              <span>Metacritic Game Releases & AI Intelligence</span>
            </div>
            <h1 className="text-2xl sm:text-4xl font-extrabold text-white tracking-tight leading-tight">
              Каталог игр Metacritic с авто-аналитикой отзывов
            </h1>
            <p className="text-sm sm:text-base text-slate-400 mt-2 leading-relaxed">
              Сервис каждый час автоматически собирает по 20 новых релизов, суммаризирует отзывы критиков и игроков через <strong>Gemini 2.5 Flash Lite</strong>, подбирает похожие игры и находит популярные летсплеи YouTube.
            </p>
          </div>
          <div className="absolute right-0 top-0 bottom-0 w-1/3 bg-gradient-to-l from-orange-500/10 via-amber-500/5 to-transparent pointer-events-none" />
        </div>

        {/* Filter & Search Bar */}
        <FilterBar
          search={search}
          onSearchChange={setSearch}
          selectedPlatform={selectedPlatform}
          onPlatformChange={setSelectedPlatform}
          availablePlatforms={availablePlatforms}
          sortBy={sortBy}
          onSortByChange={setSortBy}
          totalFiltered={games.length}
        />

        {/* Content States */}
        {loading ? (
          <div className="py-24 flex flex-col items-center justify-center gap-4">
            <div className="w-12 h-12 border-4 border-amber-500/20 border-t-amber-500 rounded-full animate-spin" />
            <p className="text-sm text-slate-400 font-medium">Загрузка каталога игр...</p>
          </div>
        ) : error ? (
          <div className="py-16 text-center bg-rose-950/20 border border-rose-900/30 rounded-3xl p-8">
            <AlertTriangle className="w-10 h-10 text-rose-400 mx-auto mb-3" />
            <p className="text-sm font-semibold text-rose-300">{error}</p>
            <button
              onClick={fetchGames}
              className="mt-4 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-xs font-semibold rounded-xl text-white transition-colors"
            >
              Попробовать снова
            </button>
          </div>
        ) : games.length === 0 ? (
          <div className="py-20 text-center bg-slate-900/40 border border-slate-800/80 rounded-3xl p-8 max-w-md mx-auto">
            <Gamepad2 className="w-12 h-12 text-slate-600 mx-auto mb-3" />
            <h3 className="text-base font-bold text-slate-200">Игры не найдены</h3>
            <p className="text-xs text-slate-400 mt-1 mb-5">
              Попробуйте сбросить фильтры или запустите воркер для сбора новой партии игр.
            </p>
            <button
              onClick={() => {
                setSearch('');
                setSelectedPlatform('');
              }}
              className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-200 transition-colors cursor-pointer"
            >
              Сбросить фильтры
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 sm:gap-6">
            {games.map((game) => (
              <GameCard
                key={game.id}
                game={game}
                onClick={() => setSelectedGameId(game.id)}
              />
            ))}
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-800/80 bg-slate-950 py-6 text-center text-xs text-slate-500">
        <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-3">
          <p>© 2026 Metacritic AI Game Analyzer • Выполнено для Skytec Games</p>
          <p className="font-mono text-[11px] text-slate-600">
            Node.js 24 • React 19 • Dual-Driver (PostgreSQL + SQLite WAL) • Puppeteer • Gemini 2.5 Flash Lite
          </p>
        </div>
      </footer>

      {/* Game Detail Modal */}
      <GameModal
        gameId={selectedGameId}
        onClose={() => setSelectedGameId(null)}
        onSelectGame={(id) => setSelectedGameId(id)}
      />

      {/* Worker Monitoring Dashboard Modal */}
      <WorkerDashboard
        isOpen={isMonitorOpen}
        onClose={() => setIsMonitorOpen(false)}
        crawlState={crawlState}
        progress={progress}
        logs={logs}
        isRunning={isRunning}
        totalGames={games.length}
        isAdmin={isAdmin}
        freeRunsRemaining={freeRunsRemaining}
        onForceRun={handleForceRun}
        onOpenAuth={() => setIsAuthModalOpen(true)}
      />

      {/* Admin Auth Modal */}
      <AdminAuthModal
        isOpen={isAuthModalOpen}
        onClose={() => setIsAuthModalOpen(false)}
        isAdmin={isAdmin}
        onLoginSuccess={handleLoginSuccess}
        onLogout={handleLogout}
      />

      {/* Floating Toast Notification */}
      {toast && (
        <div
          className={`fixed bottom-6 right-6 z-50 flex items-center gap-3 px-4 py-3 rounded-xl shadow-2xl backdrop-blur-md border transition-all duration-300 max-w-md ${
            toast.type === 'error'
              ? 'bg-rose-950/90 border-rose-500/50 text-rose-200'
              : toast.type === 'success'
              ? 'bg-emerald-950/90 border-emerald-500/50 text-emerald-200'
              : 'bg-slate-900/90 border-slate-700 text-slate-200'
          }`}
        >
          {toast.type === 'error' && <XCircle className="w-5 h-5 text-rose-400 shrink-0" />}
          {toast.type === 'success' && <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />}
          {toast.type === 'info' && <Info className="w-5 h-5 text-amber-400 shrink-0" />}
          <span className="text-sm font-medium">{toast.message}</span>
          <button
            onClick={() => setToast(null)}
            className="ml-auto p-1 hover:bg-white/10 rounded-lg transition-colors text-slate-400 hover:text-white cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
}

export default App;
