import { useState } from 'react';
import { AlertCircle, ArrowRight } from 'lucide-react';

interface LoginScreenProps {
  onGoogleSignIn: () => Promise<void>;
  onContinueAsGuest: () => void;
}

export function LoginScreen({
  onGoogleSignIn,
  onContinueAsGuest,
}: LoginScreenProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleGoogleClick = async () => {
    setLoading(true);
    setError(null);
    try {
      await onGoogleSignIn();
    } catch (err) {
      const code =
        err && typeof err === 'object' && 'code' in err
          ? String((err as { code?: unknown }).code)
          : '';
      if (code === 'auth/popup-closed-by-user') {
        setError('Sign-in popup was closed before completing login.');
      } else if (code === 'auth/popup-blocked') {
        setError(
          'Popup was blocked by your browser. Please allow popups for this site and try again.',
        );
      } else {
        setError(
          err instanceof Error
            ? err.message
            : 'Unable to sign in with Google right now.',
        );
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-dvh w-full flex items-center justify-center p-4 bg-white dark:bg-[#141416] text-zinc-900 dark:text-zinc-100">
      <div className="w-full max-w-md rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-[#1a1a1d] p-7 sm:p-8 shadow-sm space-y-6">
        <div className="space-y-2.5 text-center">
          <div
            className="w-11 h-11 mx-auto rounded-full border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 flex items-center justify-center"
            aria-hidden="true"
          >
            <svg
              viewBox="0 0 24 24"
              className="w-5 h-5 text-emerald-600 dark:text-emerald-400"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 3L4 7.5v9L12 21l8-4.5v-9L12 3z" />
              <path d="M12 12l8-4.5" />
              <path d="M12 12v9" />
              <path d="M12 12L4 7.5" />
            </svg>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
            Sign in to Ashutosh GPT
          </h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 leading-relaxed">
            Sync your conversations across devices with Firebase Google
            Authentication, Web Search, Deep Search, and
            deepseek-v4.1-flash-free.
          </p>
        </div>

        {error && (
          <div className="flex items-start gap-2.5 rounded-xl border border-rose-200 dark:border-rose-900/60 bg-rose-50/80 dark:bg-rose-950/30 p-3 text-xs text-rose-800 dark:text-rose-200">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-600 dark:text-rose-400" />
            <span className="leading-relaxed">{error}</span>
          </div>
        )}

        <div className="space-y-3">
          <button
            type="button"
            disabled={loading}
            onClick={handleGoogleClick}
            className="w-full inline-flex items-center justify-center gap-3 px-4 py-3 rounded-xl text-sm font-medium bg-zinc-900 text-white hover:bg-zinc-800 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-100 disabled:opacity-60 transition-colors cursor-pointer"
          >
            <svg
              viewBox="0 0 24 24"
              className="w-4.5 h-4.5 shrink-0"
              aria-hidden="true"
            >
              <path
                fill="#4285F4"
                d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17Z"
              />
              <path
                fill="#34A853"
                d="M12 24c3.3 0 6.08-1.09 8.1-2.96l-3.88-3.05c-1.08.73-2.47 1.16-4.22 1.16-3.24 0-5.98-2.19-6.96-5.13H1.04v3.14C3.05 21.15 7.21 24 12 24Z"
              />
              <path
                fill="#FBBC05"
                d="M5.04 14.02c-.25-.74-.39-1.53-.39-2.34 0-.81.14-1.6.39-2.34V6.2H1.04A11.98 11.98 0 0 0 0 11.68c0 1.93.46 3.76 1.04 5.48l4-3.14Z"
              />
              <path
                fill="#EA4335"
                d="M12 4.75c1.8 0 3.41.62 4.68 1.83l3.51-3.51C18.07 1.19 15.3 0 12 0 7.21 0 3.05 2.85 1.04 7.2l4 3.14c.98-2.94 3.72-5.13 6.96-5.13Z"
              />
            </svg>
            <span>{loading ? 'Signing in…' : 'Continue with Google'}</span>
          </button>

          <button
            type="button"
            disabled={loading}
            onClick={onContinueAsGuest}
            className="w-full inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl text-xs font-medium text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-200/60 dark:hover:bg-zinc-800/70 transition-colors"
          >
            <span>Continue without signing in (local only)</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>

        <p className="text-center text-[11px] text-zinc-400 dark:text-zinc-500">
          Secured by Firebase Authentication · Private per-user Firestore
          history
        </p>
      </div>
    </div>
  );
}
