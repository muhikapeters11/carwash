import React, { useState, useEffect, useRef } from 'react';
import { Eye, EyeOff, Lock, Sun, Moon } from 'lucide-react';
import { useStore } from '../store/useStore';
import { useIsMobile } from '../hooks/useIsMobile';
import { loginWithPin, buildDemoUsers } from '../lib/auth';
import { allowDemoMode, isSupabaseConfigured, isElectronBuild } from '../lib/config';

const LOCK_KEY = 'pub-pos-lock-until';
const FAIL_KEY = 'pub-pos-fail-count';

export default function Login() {
  const [pin, setPin] = useState('');
  const [showPin, setShowPin] = useState(false);
  const [error, setError] = useState('');
  const [lockedUntil, setLockedUntil] = useState<number | null>(null);
  const [remaining, setRemaining] = useState(0);
  const theme = useStore((s) => s.theme);
  const setTheme = useStore((s) => s.setTheme);
  const setCurrentUser = useStore((s) => s.setCurrentUser);
  const setActiveTab = useStore((s) => s.setActiveTab);
  const setStaffUsers = useStore((s) => s.setStaffUsers);
  const staffUsers = useStore((s) => s.staffUsers);
  const settings = useStore((s) => s.settings);
  const isMobile = useIsMobile();
  const hiddenPinRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Desktop / demo: ensure local users exist so PIN works without cloud
    if (!allowDemoMode) return;
    if (staffUsers.length === 0) {
      buildDemoUsers().then((users) => {
        setStaffUsers(users);
      });
    }
  }, [staffUsers.length, setStaffUsers]);

  useEffect(() => {
    const until = localStorage.getItem(LOCK_KEY);
    if (until) {
      const t = parseInt(until, 10);
      if (t > Date.now()) setLockedUntil(t);
      else {
        localStorage.removeItem(LOCK_KEY);
        localStorage.removeItem(FAIL_KEY);
      }
    }
  }, []);

  useEffect(() => {
    if (!lockedUntil) return;
    const tick = () => {
      const left = Math.max(0, Math.ceil((lockedUntil - Date.now()) / 1000));
      setRemaining(left);
      if (left <= 0) {
        setLockedUntil(null);
        localStorage.removeItem(LOCK_KEY);
        localStorage.removeItem(FAIL_KEY);
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [lockedUntil]);

  useEffect(() => {
    if (pin.length === 6 && !lockedUntil) attemptLogin(pin);
  }, [pin, lockedUntil]);

  // On mobile: focus hidden input so the system number keyboard opens
  useEffect(() => {
    if (isMobile && !lockedUntil && hiddenPinRef.current) {
      const t = setTimeout(() => hiddenPinRef.current?.focus(), 100);
      return () => clearTimeout(t);
    }
  }, [isMobile, lockedUntil]);

  const attemptLogin = async (enteredPin: string) => {
    if (lockedUntil && Date.now() < lockedUntil) return;
    const pool = staffUsers.length ? staffUsers : (allowDemoMode ? await buildDemoUsers() : []);
    if (allowDemoMode && staffUsers.length === 0) setStaffUsers(pool);
    const result = await loginWithPin(enteredPin, pool);
    if (result.ok) {
      localStorage.removeItem(FAIL_KEY);
      localStorage.removeItem(LOCK_KEY);
      // Instant login — show UI immediately with last stored (localStorage) data
      setCurrentUser(result.user);
      setError('');
      setPin('');
      // Always land each role on the correct starting workspace.
      setActiveTab(result.user.role === 'cashier' ? 'sell' : 'dashboard');
      // Cloud sync runs in background after login (App.tsx). Never block the PIN screen.
    } else {
      const isPinRejection = /invalid pin/i.test(result.error || '');
      if (!isPinRejection) {
        // Network/RPC/schema errors must never consume PIN attempts or lock out
        // the administrator. Show the real service error so it can be fixed.
        setError(result.error || 'Login failed. Please try again.');
        setTimeout(() => setPin(''), 3500);
        return;
      }
      const fails = parseInt(localStorage.getItem(FAIL_KEY) || '0', 10) + 1;
      localStorage.setItem(FAIL_KEY, String(fails));
      if (fails >= 5) {
        const until = Date.now() + 15 * 60 * 1000;
        localStorage.setItem(LOCK_KEY, String(until));
        setLockedUntil(until);
        setError('Locked');
      } else {
        setError(`Invalid PIN (${fails}/5)`);
      }
      setTimeout(() => {
        setPin('');
        if (fails < 5) setError('');
      }, 1500);
    }
  };

  const handleKey = (key: string) => {
    if (lockedUntil) return;
    if (key === 'C') {
      setPin('');
      setError('');
      return;
    }
    if (key === '←') {
      setPin((p) => p.slice(0, -1));
      return;
    }
    if (pin.length < 6) setPin((p) => p + key);
  };

  // Physical keyboard support (desktop numpad / top-row digits)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (lockedUntil) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      if (e.key >= '0' && e.key <= '9') {
        e.preventDefault();
        handleKey(e.key);
      } else if (e.key === 'Backspace') {
        e.preventDefault();
        handleKey('←');
      } else if (e.key === 'Escape' || e.key === 'Delete') {
        e.preventDefault();
        handleKey('C');
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [lockedUntil, pin]);

  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', '←'];
  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const isDark = theme === 'dark';
  const bgStyle = settings.login_bg_url
    ? {
        backgroundImage: `url(${settings.login_bg_url})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      }
    : {
        background: isDark
          ? 'linear-gradient(135deg, #0f0c29 0%, #302b63 50%, #24243e 100%)'
          : 'linear-gradient(135deg, #e0e7ff 0%, #f0f9ff 50%, #fafafa 100%)',
      };

  return (
    <div className="h-[100dvh] w-screen flex overflow-hidden relative" style={bgStyle}>
      {/* Soft overlay */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: isDark
            ? 'linear-gradient(90deg, rgba(0,0,0,0.35) 0%, rgba(0,0,0,0.45) 45%, rgba(0,0,0,0.55) 100%)'
            : 'linear-gradient(90deg, rgba(255,255,255,0.25) 0%, rgba(255,255,255,0.35) 45%, rgba(255,255,255,0.5) 100%)',
        }}
      />

      {/* Theme toggle */}
      <button
        onClick={() => setTheme(isDark ? 'light' : 'dark')}
        className={`absolute top-4 right-4 z-20 p-3 rounded-full touch-manipulation ${
          isDark ? 'bg-white/15 text-white hover:bg-white/25' : 'bg-black/10 text-gray-800 hover:bg-black/15'
        }`}
        title={isDark ? 'Light mode' : 'Dark mode'}
      >
        {isDark ? <Sun size={22} /> : <Moon size={22} />}
      </button>

      <div
        className={`relative z-10 w-full h-full flex ${
          isMobile ? 'flex-col' : 'flex-row'
        }`}
      >
        {/* Branding / logo — top on mobile, left on desktop */}
        <div
          className={`flex flex-col items-center justify-center relative ${
            isMobile ? 'pt-10 pb-4 px-6 shrink-0' : 'w-1/2 p-8 md:p-12'
          }`}
        >
          {!isMobile && (
            <div
              className="absolute inset-0 pointer-events-none"
              style={{
                background: isDark
                  ? 'radial-gradient(ellipse 60% 50% at 50% 45%, rgba(255,200,120,0.12) 0%, transparent 70%)'
                  : 'radial-gradient(ellipse 60% 50% at 50% 45%, rgba(255,255,255,0.25) 0%, transparent 70%)',
              }}
            />
          )}

          {settings.logo_url ? (
            <div
              className="relative flex items-center justify-center"
              style={{
                width: isMobile ? 'min(55%, 180px)' : 'min(88%, 460px)',
                maxHeight: isMobile ? '18vh' : '52vh',
              }}
            >
              {/*
                Transparent / no-background logo: single image, object-contain,
                no solid box behind it so it blends with the page gradient / system bg.
              */}
              <img
                src={settings.logo_url}
                alt="Logo"
                className="w-full h-full object-contain"
                style={{
                  // No white plate / card behind the logo
                  background: 'transparent',
                  // Soft integration with scene without washing out the mark
                  filter: isDark
                    ? 'drop-shadow(0 6px 20px rgba(0,0,0,0.45))'
                    : 'drop-shadow(0 4px 14px rgba(0,0,0,0.12))',
                }}
              />
            </div>
          ) : (
            <div
              className={`${isMobile ? 'text-6xl' : 'text-[8rem] md:text-[10rem]'} mb-2`}
              style={{
                filter: 'drop-shadow(0 8px 20px rgba(0,0,0,0.3))',
                opacity: isDark ? 0.9 : 0.85,
              }}
            >
              🍺
            </div>
          )}

          <h1
            className={`relative font-bold tracking-wide text-center mt-2 ${
              isMobile ? 'text-2xl' : 'text-3xl md:text-5xl'
            } ${isDark ? 'text-white' : 'text-gray-900'}`}
            style={{
              textShadow: isDark
                ? '0 2px 20px rgba(0,0,0,0.5), 0 0 40px rgba(0,0,0,0.25)'
                : '0 1px 12px rgba(255,255,255,0.8)',
              opacity: 0.95,
            }}
          >
            {settings.pub_name}
          </h1>
        </div>

        {/* PIN area */}
        <div
          className={`flex flex-col items-center justify-center ${
            isMobile ? 'flex-1 px-4 pb-8' : 'w-1/2 p-6'
          }`}
        >
          {lockedUntil ? (
            <div className={`text-center ${isDark ? 'text-white' : 'text-gray-900'}`}>
              <Lock size={56} className="mx-auto text-red-400 mb-4" />
              <h2 className="text-2xl font-semibold mb-2">Locked</h2>
              
              <p className="text-4xl font-mono font-bold text-red-400">{formatTime(remaining)}</p>
            </div>
          ) : (
            <>
              <div className="mb-4" />

              {/* Hidden native PIN input for mobile system keyboard */}
              {isMobile && (
                <input
                  ref={hiddenPinRef}
                  type="tel"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  autoComplete="one-time-code"
                  value={pin}
                  onChange={(e) => {
                    const v = e.target.value.replace(/\D/g, '').slice(0, 6);
                    setPin(v);
                  }}
                  className="sr-only"
                  aria-label="PIN"
                />
              )}

              <div className="flex items-center gap-3 mb-2">
                <div className="flex gap-2 sm:gap-3 md:gap-4">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <div
                      key={i}
                      onClick={() => isMobile && hiddenPinRef.current?.focus()}
                      className={`rounded-2xl border-2 flex items-center justify-center font-bold transition-all ${
                        isMobile ? 'w-11 h-12 text-2xl' : 'w-14 h-16 md:w-16 md:h-18 text-3xl'
                      } ${
                        pin.length > i
                          ? isDark
                            ? 'border-amber-400 bg-amber-400/25 text-white'
                            : 'border-primary-500 bg-primary-100 text-primary-800'
                          : isDark
                          ? 'border-white/40 bg-white/10 text-white'
                          : 'border-gray-300 bg-white/80 text-gray-800'
                      }`}
                    >
                      {pin.length > i ? (showPin ? pin[i] : '•') : ''}
                    </div>
                  ))}
                </div>
                <button
                  onClick={() => setShowPin(!showPin)}
                  className={`p-3 rounded-full touch-manipulation ${
                    isDark ? 'hover:bg-white/20 text-white' : 'hover:bg-black/10 text-gray-700'
                  }`}
                >
                  {showPin ? <EyeOff size={26} /> : <Eye size={26} />}
                </button>
              </div>

              {error && <p className="text-red-400 font-medium mb-3 text-base sm:text-lg">{error}</p>}
              {!error && <div className="h-6 mb-3" />}

              {/* Virtual pad: always on desktop; optional on mobile if they dismiss native keyboard */}
              {!isMobile ? (
                <div className="grid grid-cols-3 gap-4 md:gap-5 w-[min(100%,20rem)]">
                  {keys.map((k) => (
                    <button
                      key={k}
                      onClick={() => handleKey(k)}
                      className={`h-18 md:h-20 w-full aspect-square max-h-[5.5rem] rounded-2xl text-3xl font-bold shadow-lg active:scale-95 transition-transform touch-manipulation ${
                        k === 'C'
                          ? 'bg-red-500 text-white hover:bg-red-600'
                          : k === '←'
                          ? isDark
                            ? 'bg-white/25 text-white hover:bg-white/35'
                            : 'bg-gray-200 text-gray-800 hover:bg-gray-300'
                          : isDark
                          ? 'bg-white/15 text-white hover:bg-white/25 border border-white/30'
                          : 'bg-white text-gray-900 hover:bg-gray-50 border border-gray-200'
                      }`}
                    >
                      {k === '←' ? '⌫' : k}
                    </button>
                  ))}
                </div>
              ) : (
                <div className="w-full max-w-xs space-y-3">
                  <button
                    type="button"
                    onClick={() => hiddenPinRef.current?.focus()}
                    className={`w-full py-3 rounded-xl font-semibold touch-manipulation ${
                      isDark ? 'bg-white/15 text-white' : 'bg-white/90 text-gray-900 border border-gray-200'
                    }`}
                  >
                    Keyboard
                  </button>
                  <div className="grid grid-cols-3 gap-2 pt-2">
                    {keys.map((k) => (
                      <button
                        key={k}
                        onClick={() => handleKey(k)}
                        className={`h-14 rounded-xl text-xl font-bold active:scale-95 touch-manipulation ${
                          k === 'C'
                            ? 'bg-red-500 text-white'
                            : k === '←'
                            ? isDark
                              ? 'bg-white/25 text-white'
                              : 'bg-gray-200 text-gray-800'
                            : isDark
                            ? 'bg-white/15 text-white border border-white/20'
                            : 'bg-white text-gray-900 border border-gray-200'
                        }`}
                      >
                        {k === '←' ? '⌫' : k}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
