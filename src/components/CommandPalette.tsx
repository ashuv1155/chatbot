import { useEffect, useMemo, useState } from 'react';
import {
  Download,
  Gauge,
  MessageSquare,
  Moon,
  Printer,
  Search,
  Settings,
  ShieldCheck,
  SquarePen,
  Sun,
  X,
} from 'lucide-react';
import type { Conversation } from '../types/chat';

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  conversations: Conversation[];
  activeConversation: Conversation | null;
  theme: 'dark' | 'light';
  isAdmin: boolean;
  onSelectConversation: (id: string) => void;
  onNewChat: () => void;
  onToggleTheme: () => void;
  onOpenSettings: () => void;
  onOpenQuota: () => void;
  onOpenAdminConsole: () => void;
  onExportMarkdown: () => void;
  onExportJson: () => void;
  onPrint: () => void;
}

interface ActionItem {
  id: string;
  label: string;
  hint?: string;
  icon: typeof SquarePen;
  run: () => void;
}

export function CommandPalette({
  isOpen,
  onClose,
  conversations,
  activeConversation,
  theme,
  isAdmin,
  onSelectConversation,
  onNewChat,
  onToggleTheme,
  onOpenSettings,
  onOpenQuota,
  onOpenAdminConsole,
  onExportMarkdown,
  onExportJson,
  onPrint,
}: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);

  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedIndex(0);
    }
  }, [isOpen]);

  const actions = useMemo<ActionItem[]>(() => {
    const base: ActionItem[] = [
      {
        id: 'new-chat',
        label: 'Start a new chat',
        hint: 'Ctrl+Shift+O',
        icon: SquarePen,
        run: () => {
          onNewChat();
          onClose();
        },
      },
      {
        id: 'toggle-theme',
        label:
          theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme',
        icon: theme === 'dark' ? Sun : Moon,
        run: () => {
          onToggleTheme();
          onClose();
        },
      },
      {
        id: 'settings',
        label: 'Model & generation settings',
        icon: Settings,
        run: () => {
          onClose();
          onOpenSettings();
        },
      },
      {
        id: 'quota',
        label: 'Shared token pool & usage status',
        icon: Gauge,
        run: () => {
          onClose();
          onOpenQuota();
        },
      },
    ];

    if (isAdmin) {
      base.push({
        id: 'admin-console',
        label: 'Open Admin Console (Users, Usage & API Keys)',
        icon: ShieldCheck,
        run: () => {
          onClose();
          onOpenAdminConsole();
        },
      });
    }

    if (activeConversation && activeConversation.messages.length > 0) {
      base.push(
        {
          id: 'export-md',
          label: 'Export current chat as Markdown (.md)',
          icon: Download,
          run: () => {
            onExportMarkdown();
            onClose();
          },
        },
        {
          id: 'export-json',
          label: 'Export current chat as JSON (.json)',
          icon: Download,
          run: () => {
            onExportJson();
            onClose();
          },
        },
        {
          id: 'print',
          label: 'Print or save current chat as PDF',
          icon: Printer,
          run: () => {
            onClose();
            setTimeout(() => onPrint(), 100);
          },
        },
      );
    }

    return base;
  }, [
    activeConversation,
    isAdmin,
    onClose,
    onExportJson,
    onExportMarkdown,
    onNewChat,
    onOpenAdminConsole,
    onOpenQuota,
    onOpenSettings,
    onPrint,
    onToggleTheme,
    theme,
  ]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matchedActions = actions.filter(
      (a) => !q || a.label.toLowerCase().includes(q),
    );
    const matchedChats = conversations
      .filter((c) => {
        if (!q) return true;
        if (c.title.toLowerCase().includes(q)) return true;
        return c.messages.some((m) => m.content.toLowerCase().includes(q));
      })
      .slice(0, 6)
      .map<ActionItem>((c) => ({
        id: `chat-${c.id}`,
        label: c.title,
        hint: `${c.messages.length} messages`,
        icon: MessageSquare,
        run: () => {
          onSelectConversation(c.id);
          onClose();
        },
      }));

    return [...matchedActions, ...matchedChats];
  }, [actions, conversations, onClose, onSelectConversation, query]);

  if (!isOpen) return null;

  const clampedIdx = Math.min(selectedIndex, Math.max(0, results.length - 1));

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[12vh] p-4 bg-black/60 backdrop-blur-[2px] no-print"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#19191c] shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center px-4 py-3 border-b border-zinc-200 dark:border-zinc-800 gap-2.5">
          <Search className="w-4 h-4 text-zinc-400 shrink-0" />
          <input
            type="text"
            autoFocus
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setSelectedIndex((i) =>
                  results.length ? (i + 1) % results.length : 0,
                );
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setSelectedIndex((i) =>
                  results.length
                    ? (i - 1 + results.length) % results.length
                    : 0,
                );
              } else if (e.key === 'Enter' && results[clampedIdx]) {
                e.preventDefault();
                results[clampedIdx].run();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                onClose();
              }
            }}
            placeholder="Search chats or run a command..."
            aria-label="Command palette search"
            className="flex-1 bg-transparent text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:outline-none"
          />
          <button
            type="button"
            onClick={onClose}
            aria-label="Close command palette"
            className="p-1 rounded-md text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="max-h-[55vh] overflow-y-auto p-2 space-y-0.5">
          {results.length === 0 ? (
            <div className="py-8 text-center text-xs text-zinc-500">
              No matching chats or commands
            </div>
          ) : (
            results.map((item, idx) => {
              const Icon = item.icon;
              const active = idx === clampedIdx;
              return (
                <button
                  key={item.id}
                  type="button"
                  onMouseEnter={() => setSelectedIndex(idx)}
                  onClick={item.run}
                  className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-left text-sm transition-colors ${
                    active
                      ? 'bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100'
                      : 'text-zinc-700 dark:text-zinc-300'
                  }`}
                >
                  <span className="flex items-center gap-2.5 min-w-0">
                    <Icon className="w-4 h-4 text-zinc-400 shrink-0" />
                    <span className="truncate">{item.label}</span>
                  </span>
                  {item.hint && (
                    <span className="ml-3 text-[11px] font-mono tabular-nums text-zinc-400 shrink-0">
                      {item.hint}
                    </span>
                  )}
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
