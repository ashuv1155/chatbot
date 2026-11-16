import { useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  Check,
  Moon,
  Search,
  Sun,
} from 'lucide-react';
import type { QuotaInfo } from '../types/chat';

interface LoginScreenProps {
  onGoogleSignIn: () => Promise<void>;
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
  quota?: QuotaInfo | null;
}

type DemoModeId = 'direct' | 'web' | 'deep';

interface DemoModeSpec {
  id: DemoModeId;
  label: string;
  title: string;
  prompt: string;
  steps: string[];
  answerSummary: string;
  citationNote: string;
}

const DEMO_MODES: Record<DemoModeId, DemoModeSpec> = {
  direct: {
    id: 'direct',
    label: 'Direct Chat',
    title: 'Zero-overhead reasoning & code generation',
    prompt:
      'Write a self-contained Pomodoro timer in HTML/CSS/JS with keyboard shortcuts and minimal styling.',
    steps: [
      'Streams directly from deepseek-v4.1-flash-free with 198K context',
      'Syntax-highlights code blocks with one-click copy and download',
      'Opens HTML and SVG blocks in a live side-by-side preview pane',
    ],
    answerSummary:
      'Produces complete single-file components immediately with live DOM preview, full markdown rendering, and branching edit history.',
    citationNote: 'Direct model output · Up to 64K tokens per reply',
  },
  web: {
    id: 'web',
    label: 'Web Search',
    title: 'Live search synthesis with clickable citations',
    prompt:
      'What changed in the latest PostgreSQL and SQLite WAL performance benchmarks?',
    steps: [
      'Rewrites conversational prompt into focused search queries',
      'Retrieves current web results with optional day, week, month, or year filter',
      'Reads top source excerpts and attaches inline clickable references',
    ],
    answerSummary:
      'Combines live web snippets and extracted page context before streaming, grounding answers in verifiable URLs.',
    citationNote: 'Live DuckDuckGo search + page excerpt extraction',
  },
  deep: {
    id: 'deep',
    label: 'Deep Search',
    title: 'Multi-query research across full source documents',
    prompt:
      'Compare SQLite WAL mode vs PostgreSQL for high-concurrency read-heavy SaaS workloads.',
    steps: [
      'Expands topic into multiple complementary research sub-queries',
      'Fetches and extracts full readable text across top technical articles',
      'Cross-references findings into a structured comparative report',
    ],
    answerSummary:
      'Delivers long-form technical comparisons, architectural trade-offs, and numbered source lists without manual tab switching.',
    citationNote: 'Multi-pass retrieval · Full-document reading · Inline citations',
  },
};

function formatCompactTokens(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return '100M / key';
  }
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B`;
  if (value >= 1_000_000) return `${Math.round(value / 1_000_000)}M`;
  if (value >= 1_000) return `${Math.round(value / 1_000)}K`;
  return String(value);
}

function GoogleMark() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="w-4 h-4 shrink-0"
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
  );
}

export function LoginScreen({
  onGoogleSignIn,
  theme,
  onToggleTheme,
  quota,
}: LoginScreenProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeMode, setActiveMode] = useState<DemoModeId>('deep');
  const [heroImgError, setHeroImgError] = useState(false);
  const [archImgError, setArchImgError] = useState(false);

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
          'Popup was blocked by your browser. Allow popups for this site and try again.',
        );
      } else if (code === 'auth/unauthorized-domain') {
        const host =
          typeof window !== 'undefined' ? window.location.hostname : 'this domain';
        setError(
          `Domain "${host}" is not authorized in Firebase Authentication yet. Add "${host}" under Authentication -> Settings -> Authorized domains in the Firebase Console.`,
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

  const currentDemo = DEMO_MODES[activeMode];
  const poolDisplay = quota?.remaining
    ? formatCompactTokens(quota.remaining)
    : quota?.limit
      ? formatCompactTokens(quota.limit)
      : '100M / key';

  return (
    <div
      id="top"
      className="min-h-dvh w-full bg-white dark:bg-[#141416] text-zinc-900 dark:text-zinc-100"
    >
      {/* Top Bar: 3 zones (Brand — Nav Links — Primary CTA) */}
      <header className="sticky top-0 z-30 border-b border-zinc-200/90 dark:border-zinc-800/90 bg-white/90 dark:bg-[#141416]/90 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-6 lg:px-10 py-3.5 flex items-center justify-between gap-8">
          <a
            href="#top"
            className="text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-100 whitespace-nowrap shrink-0"
          >
            Ashutosh GPT
          </a>

          <nav
            aria-label="Primary navigation"
            className="hidden md:flex items-center gap-7 text-sm font-medium text-zinc-600 dark:text-zinc-400"
          >
            <a
              href="#capabilities"
              className="hover:text-zinc-900 dark:hover:text-zinc-100 hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0"
            >
              Capabilities
            </a>
            <a
              href="#search-modes"
              className="hover:text-zinc-900 dark:hover:text-zinc-100 hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0"
            >
              Search Modes
            </a>
            <a
              href="#workspace"
              className="hover:text-zinc-900 dark:hover:text-zinc-100 hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0"
            >
              Workspace
            </a>
            <a
              href="#privacy"
              className="hover:text-zinc-900 dark:hover:text-zinc-100 hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0"
            >
              Privacy
            </a>
          </nav>

          <button
            type="button"
            disabled={loading}
            onClick={handleGoogleClick}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold bg-zinc-900 text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-white disabled:opacity-60 transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
          >
            <GoogleMark />
            <span>{loading ? 'Signing in…' : 'Sign in'}</span>
          </button>
        </div>
      </header>

      <main>
        {/* Hero Split */}
        <section className="max-w-7xl mx-auto px-6 lg:px-10 pt-12 pb-14 lg:pt-20 lg:pb-16">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-12 items-stretch">
            <div className="lg:col-span-6 flex flex-col justify-center space-y-6">
              <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
                <span>Ashutosh GPT</span>
                <span aria-hidden="true">·</span>
                <span className="font-mono">deepseek-v4.1-flash-free</span>
                <span aria-hidden="true">·</span>
                <span>Private Cloud Workspace</span>
              </div>

              <h1 className="text-[clamp(2.25rem,4.1vw,3.65rem)] font-semibold tracking-tight leading-[1.08] text-zinc-900 dark:text-zinc-50 [text-wrap:balance]">
                Fast AI research, coding, and private chat in one workspace.
              </h1>

              <p className="text-base sm:text-[17px] text-zinc-600 dark:text-zinc-300 leading-relaxed max-w-xl">
                Stream long-context answers up to 198K tokens, run live Web and
                multi-step Deep Search with clickable citations, preview HTML or
                SVG code side by side, and keep your chat history synced privately
                to your Google account.
              </p>

              {error && (
                <div
                  role="alert"
                  className="flex items-start gap-2.5 rounded-xl border border-rose-200 dark:border-rose-900/60 bg-rose-50/80 dark:bg-rose-950/30 p-3.5 text-xs text-rose-800 dark:text-rose-200 max-w-xl"
                >
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-600 dark:text-rose-400" />
                  <span className="leading-relaxed">{error}</span>
                </div>
              )}

              <div className="space-y-3 pt-1">
                <button
                  type="button"
                  disabled={loading}
                  onClick={handleGoogleClick}
                  className="inline-flex items-center justify-center gap-3 px-6 py-3.5 rounded-xl text-sm font-semibold bg-emerald-600 text-white hover:bg-emerald-500 dark:bg-emerald-500 dark:text-zinc-950 dark:hover:bg-emerald-400 disabled:opacity-60 transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-[#141416]"
                >
                  <span className="inline-flex items-center justify-center w-6 h-6 rounded-md bg-white">
                    <GoogleMark />
                  </span>
                  <span>
                    {loading ? 'Signing in with Google…' : 'Continue with Google'}
                  </span>
                  <ArrowRight className="w-4 h-4" />
                </button>

                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  Google authentication required · Conversations are isolated per
                  account
                </p>
              </div>
            </div>

            {/* Right Visual Carrier */}
            <div className="lg:col-span-6">
              <div className="h-full min-h-[260px] lg:min-h-[420px] rounded-2xl overflow-hidden border border-zinc-200 dark:border-zinc-800 bg-zinc-100 dark:bg-[#1a1a1d]">
                {!heroImgError ? (
                  <img
                    src="/src/assets/images/hero_ashutosh_workspace_1794810098293.jpg"
                    alt="Minimalist architectural studio workstation running Ashutosh GPT"
                    referrerPolicy="no-referrer"
                    onError={() => setHeroImgError(true)}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full min-h-[320px] flex flex-col items-center justify-center p-8 text-center bg-gradient-to-br from-zinc-100 via-zinc-50 to-emerald-50/40 dark:from-[#1b1b1f] dark:via-[#151518] dark:to-emerald-950/30">
                    <div className="w-12 h-12 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 flex items-center justify-center mb-3">
                      <Search className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                    </div>
                    <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
                      Ashutosh GPT Studio
                    </p>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
                      198K context · Web Search · Deep Search
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Full-Width 4-Column Architectural Spec Strip */}
          <div className="mt-12 grid grid-cols-2 lg:grid-cols-4 border border-zinc-200 dark:border-zinc-800 rounded-2xl divide-y lg:divide-y-0 lg:divide-x divide-zinc-200 dark:divide-zinc-800 bg-zinc-50/60 dark:bg-[#19191c]">
            <div className="p-5 sm:p-6">
              <div className="text-2xl sm:text-3xl font-semibold tracking-tight font-mono tabular-nums text-zinc-900 dark:text-zinc-50">
                198K
              </div>
              <div className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
                Input token context window
              </div>
            </div>
            <div className="p-5 sm:p-6">
              <div className="text-2xl sm:text-3xl font-semibold tracking-tight font-mono tabular-nums text-zinc-900 dark:text-zinc-50">
                64K
              </div>
              <div className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
                Maximum output per response
              </div>
            </div>
            <div className="p-5 sm:p-6">
              <div className="text-2xl sm:text-3xl font-semibold tracking-tight font-mono tabular-nums text-zinc-900 dark:text-zinc-50">
                {poolDisplay}
              </div>
              <div className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
                Shared high-speed token allowance
              </div>
            </div>
            <div className="p-5 sm:p-6">
              <div className="text-2xl sm:text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
                Private
              </div>
              <div className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
                Per-account Firestore chat sync
              </div>
            </div>
          </div>
        </section>

        {/* Core Capabilities Asymmetric Bento */}
        <section
          id="capabilities"
          className="border-t border-zinc-200/80 dark:border-zinc-800/80 bg-zinc-50/40 dark:bg-[#17171a]"
        >
          <div className="max-w-7xl mx-auto px-6 lg:px-10 py-16 lg:py-24 space-y-10">
            <div className="max-w-2xl space-y-3">
              <p className="text-xs font-medium text-emerald-700 dark:text-emerald-400">
                Core Capabilities
              </p>
              <h2 className="text-2xl sm:text-3xl lg:text-4xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50 [text-wrap:balance]">
                Designed for daily technical work and verified research.
              </h2>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <article className="lg:col-span-2 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#141416] p-7 sm:p-8 space-y-4">
                <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                  01. Live Web & Multi-Step Deep Search
                </div>
                <h3 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
                  Retrieve current sources, read full pages, and cite every claim.
                </h3>
                <p className="text-sm sm:text-[15px] text-zinc-600 dark:text-zinc-300 leading-relaxed max-w-2xl">
                  Switch seamlessly between direct model inference, single-pass Web
                  Search, and multi-query Deep Search. Filter results by past day,
                  week, month, or year, watch live search progress steps, and
                  click straight into the exact reference URLs used in the answer.
                </p>
                <div className="pt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-zinc-500 dark:text-zinc-400">
                  <span>Query sanitization</span>
                  <span aria-hidden="true">·</span>
                  <span>Full-page text extraction</span>
                  <span aria-hidden="true">·</span>
                  <span>Time-range filters</span>
                  <span aria-hidden="true">·</span>
                  <span>Inline citations</span>
                </div>
              </article>

              <article className="lg:col-span-1 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#141416] p-7 sm:p-8 space-y-4">
                <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                  02. Interactive Code Previews
                </div>
                <h3 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
                  Render HTML and SVG artifacts side by side.
                </h3>
                <p className="text-sm sm:text-[15px] text-zinc-600 dark:text-zinc-300 leading-relaxed">
                  Open generated HTML, CSS, JavaScript, and SVG code blocks
                  inside a sandboxed split-screen preview pane, inspect raw source,
                  or download standalone files in one click.
                </p>
              </article>

              <article className="lg:col-span-1 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#141416] p-7 sm:p-8 space-y-4">
                <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                  03. Shared High-Speed Pool
                </div>
                <h3 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
                  Multi-key pooling without rate bottlenecks.
                </h3>
                <p className="text-sm sm:text-[15px] text-zinc-600 dark:text-zinc-300 leading-relaxed">
                  Signed-in users share a centrally managed pool of 100milionseek
                  API keys with automatic load balancing and failover across
                  active keys.
                </p>
              </article>

              <article className="lg:col-span-2 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#141416] p-7 sm:p-8 space-y-4">
                <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                  04. Attachments, Voice Input & Conversation Control
                </div>
                <h3 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
                  Drop files, dictate prompts, edit branches, and export cleanly.
                </h3>
                <p className="text-sm sm:text-[15px] text-zinc-600 dark:text-zinc-300 leading-relaxed max-w-2xl">
                  Attach code or text documents via drag-and-drop, dictate queries
                  using browser speech recognition, tailor response style and
                  tone, edit earlier messages to branch conversations, or navigate
                  quickly with the command palette.
                </p>
                <div className="pt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-zinc-500 dark:text-zinc-400">
                  <span>Drag & drop files</span>
                  <span aria-hidden="true">·</span>
                  <span>Voice dictation</span>
                  <span aria-hidden="true">·</span>
                  <span>Response style & tone</span>
                  <span aria-hidden="true">·</span>
                  <span>Markdown / JSON / PDF export</span>
                </div>
              </article>
            </div>
          </div>
        </section>

        {/* Interactive Search Modes Explorer */}
        <section
          id="search-modes"
          className="border-t border-zinc-200/80 dark:border-zinc-800/80 bg-white dark:bg-[#141416]"
        >
          <div className="max-w-7xl mx-auto px-6 lg:px-10 py-16 lg:py-24 space-y-10">
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
              <div className="max-w-xl space-y-3">
                <p className="text-xs font-medium text-emerald-700 dark:text-emerald-400">
                  Search Modes
                </p>
                <h2 className="text-2xl sm:text-3xl lg:text-4xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50 [text-wrap:balance]">
                  Pick the level of depth each question needs.
                </h2>
              </div>

              {/* Interactive Segmented Mode Switcher */}
              <div
                role="tablist"
                aria-label="Search mode preview"
                className="inline-flex items-center gap-1 p-1 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-100/80 dark:bg-[#1b1b1e] self-start md:self-auto"
              >
                {(['direct', 'web', 'deep'] as DemoModeId[]).map((modeId) => {
                  const selected = activeMode === modeId;
                  return (
                    <button
                      key={modeId}
                      type="button"
                      role="tab"
                      aria-selected={selected}
                      onClick={() => setActiveMode(modeId)}
                      className={`px-3.5 py-2 rounded-lg text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                        selected
                          ? 'bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 shadow-xs'
                          : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100'
                      }`}
                    >
                      {DEMO_MODES[modeId].label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/60 dark:bg-[#18181b] p-7 sm:p-9">
              <div className="lg:col-span-5 space-y-5">
                <div className="space-y-2">
                  <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                    {currentDemo.label} workflow
                  </div>
                  <h3 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
                    {currentDemo.title}
                  </h3>
                </div>

                <ul className="space-y-3">
                  {currentDemo.steps.map((step, idx) => (
                    <li
                      key={step}
                      className="flex items-start gap-3 text-sm text-zinc-600 dark:text-zinc-300"
                    >
                      <span className="font-mono text-xs tabular-nums text-emerald-700 dark:text-emerald-400 mt-0.5 shrink-0">
                        0{idx + 1}.
                      </span>
                      <span className="leading-relaxed">{step}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="lg:col-span-7 flex flex-col justify-between space-y-5 lg:border-l lg:border-zinc-200 dark:lg:border-zinc-800 lg:pl-8">
                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                      Example prompt
                    </div>
                    <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100 leading-relaxed">
                      “{currentDemo.prompt}”
                    </p>
                  </div>

                  <div className="pt-4 border-t border-zinc-200/80 dark:border-zinc-800/80 space-y-1.5">
                    <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                      Execution result
                    </div>
                    <p className="text-sm text-zinc-600 dark:text-zinc-300 leading-relaxed">
                      {currentDemo.answerSummary}
                    </p>
                  </div>
                </div>

                <div className="pt-4 border-t border-zinc-200/80 dark:border-zinc-800/80 flex flex-wrap items-center justify-between gap-3 text-xs text-zinc-500 dark:text-zinc-400">
                  <span>{currentDemo.citationNote}</span>
                  <span>Available immediately after sign-in</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Workspace & Privacy Section */}
        <section
          id="workspace"
          className="border-t border-zinc-200/80 dark:border-zinc-800/80 bg-zinc-50/40 dark:bg-[#17171a]"
        >
          <div
            id="privacy"
            className="max-w-7xl mx-auto px-6 lg:px-10 py-16 lg:py-24 grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-14 items-center"
          >
            <div className="lg:col-span-6">
              <div className="aspect-[4/3] rounded-2xl overflow-hidden border border-zinc-200 dark:border-zinc-800 bg-zinc-100 dark:bg-[#1a1a1d]">
                {!archImgError ? (
                  <img
                    src="/src/assets/images/deep_search_architecture_1794810097670.jpg"
                    alt="Layered glass planes and optical precision lens illustrating Ashutosh GPT search isolation"
                    referrerPolicy="no-referrer"
                    onError={() => setArchImgError(true)}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex flex-col items-center justify-center p-8 text-center bg-gradient-to-br from-zinc-100 to-zinc-200 dark:from-[#1d1d22] dark:to-[#141417]">
                    <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
                      Private Cloud Architecture
                    </p>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
                      Owner-only Firestore documents · Shared server key pool
                    </p>
                  </div>
                )}
              </div>
            </div>

            <div className="lg:col-span-6 space-y-6">
              <div className="space-y-3">
                <p className="text-xs font-medium text-emerald-700 dark:text-emerald-400">
                  Workspace & Privacy
                </p>
                <h2 className="text-2xl sm:text-3xl lg:text-4xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50 [text-wrap:balance]">
                  Your conversations stay private to your Google account.
                </h2>
                <p className="text-sm sm:text-[15px] text-zinc-600 dark:text-zinc-300 leading-relaxed">
                  Every signed-in member receives an isolated Firestore workspace
                  protected by owner-only security rules. Chats sync automatically
                  across desktop and mobile browsers without exposing threads to
                  other accounts.
                </p>
              </div>

              <ul className="space-y-3 text-sm text-zinc-700 dark:text-zinc-300">
                <li className="flex items-start gap-2.5">
                  <Check className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                  <span>
                    Verified Google Authentication synced with per-user Firestore
                    collections
                  </span>
                </li>
                <li className="flex items-start gap-2.5">
                  <Check className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                  <span>
                    Export any conversation cleanly as Markdown, JSON, or
                    print-ready PDF
                  </span>
                </li>
                <li className="flex items-start gap-2.5">
                  <Check className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                  <span>
                    Cross-browser support across Chrome, Edge, Firefox, and Safari
                    in Light or Dark mode
                  </span>
                </li>
              </ul>

              <div className="pt-2">
                <button
                  type="button"
                  disabled={loading}
                  onClick={handleGoogleClick}
                  className="inline-flex items-center justify-center gap-3 px-6 py-3 rounded-xl text-sm font-semibold bg-zinc-900 text-white hover:bg-zinc-800 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-100 disabled:opacity-60 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <GoogleMark />
                  <span>
                    {loading ? 'Signing in…' : 'Sign in with Google to Start'}
                  </span>
                </button>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* Quiet Footer */}
      <footer className="border-t border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#141416]">
        <div className="max-w-7xl mx-auto px-6 lg:px-10 py-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
            <span className="font-semibold text-zinc-900 dark:text-zinc-100">
              Ashutosh GPT
            </span>
            <span aria-hidden="true">·</span>
            <span>Secured by Firebase Authentication</span>
            <span aria-hidden="true">·</span>
            <span>Private per-user Firestore history</span>
          </div>

          <div className="flex items-center gap-6">
            <a
              href="#capabilities"
              className="text-xs text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100 transition-colors whitespace-nowrap shrink-0"
            >
              Capabilities
            </a>
            <a
              href="#search-modes"
              className="text-xs text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100 transition-colors whitespace-nowrap shrink-0"
            >
              Search Modes
            </a>
            <button
              type="button"
              onClick={onToggleTheme}
              aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-800 text-xs font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              {theme === 'dark' ? (
                <>
                  <Sun className="w-3.5 h-3.5" />
                  <span>Light mode</span>
                </>
              ) : (
                <>
                  <Moon className="w-3.5 h-3.5" />
                  <span>Dark mode</span>
                </>
              )}
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
}
