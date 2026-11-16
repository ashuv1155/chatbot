import { useState } from 'react';
import {
  Check,
  Command,
  Gauge,
  MessageSquare,
  Moon,
  PanelLeftClose,
  Pencil,
  Pin,
  Search,
  Settings,
  SquarePen,
  Sun,
  Trash2,
  X,
} from 'lucide-react';
import type { Conversation, PoolSummary, QuotaInfo } from '../types/chat';
import {
  formatCompactNumber,
  formatTimeUntilReset,
  groupConversationsByDate,
} from '../lib/storage';

interface SidebarProps {
  isOpen: boolean;
  onCloseMobile: () => void;
  onCollapseDesktop: () => void;
  conversations: Conversation[];
  activeId: string | null;
  onSelectConversation: (id: string) => void;
  onNewChat: () => void;
  onRenameConversation: (id: string, title: string) => void;
  onTogglePinConversation: (id: string) => void;
  onDeleteConversation: (id: string) => void;
  quota: QuotaInfo;
  poolSummary: PoolSummary | null;
  priceLabel: string;
  onOpenQuotaModal: () => void;
  onOpenSettings: () => void;
  onOpenCommandPalette: () => void;
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
}

export function Sidebar({
  isOpen,
  onCloseMobile,
  onCollapseDesktop,
  conversations,
  activeId,
  onSelectConversation,
  onNewChat,
  onRenameConversation,
  onTogglePinConversation,
  onDeleteConversation,
  quota,
  poolSummary,
  priceLabel,
  onOpenQuotaModal,
  onOpenSettings,
  onOpenCommandPalette,
  theme,
  onToggleTheme,
}: SidebarProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');

  const filtered = searchQuery.trim()
    ? conversations.filter((c) => {
        const q = searchQuery.toLowerCase();
        if (c.title.toLowerCase().includes(q)) return true;
        return c.messages.some((m) => m.content.toLowerCase().includes(q));
      })
    : conversations;

  const grouped = groupConversationsByDate(filtered);

  const startRename = (conv: Conversation) => {
    setEditingId(conv.id);
    setEditTitle(conv.title);
  };

  const commitRename = (id: string) => {
    const trimmed = editTitle.trim();
    if (trimmed) {
      onRenameConversation(id, trimmed);
    }
    setEditingId(null);
  };

  const limit = quota.limit ?? 100_000_000;
  const remaining = quota.remaining ?? limit;
  const used = quota.used ?? Math.max(0, limit - remaining);
  const pctRemaining =
    limit > 0 ? Math.max(0, Math.min(100, (remaining / limit) * 100)) : 100;

  return (
    <>
      {isOpen && (
        <div
          onClick={onCloseMobile}
          className="fixed inset-0 z-30 bg-black/50 backdrop-blur-[1px] md:hidden no-print"
          aria-hidden="true"
        />
      )}

      <aside
        className={`fixed md:static inset-y-0 left-0 z-40 flex flex-col w-[264px] shrink-0 bg-zinc-50 dark:bg-[#111113] border-r border-zinc-200 dark:border-zinc-800/80 transition-transform duration-200 ease-out no-print ${
          isOpen ? 'translate-x-0' : '-translate-x-full md:hidden'
        }`}
      >
        {/* Top controls */}
        <div className="flex items-center justify-between px-3 pt-3 pb-2 gap-2">
          <button
            type="button"
            onClick={onCollapseDesktop}
            title="Close sidebar"
            className="hidden md:inline-flex items-center justify-center w-9 h-9 rounded-lg text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100 hover:bg-zinc-200/70 dark:hover:bg-zinc-800/80 transition-colors"
          >
            <PanelLeftClose className="w-4.5 h-4.5" />
          </button>

          <button
            type="button"
            onClick={onCloseMobile}
            title="Close sidebar"
            className="md:hidden inline-flex items-center justify-center w-9 h-9 rounded-lg text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100 hover:bg-zinc-200/70 dark:hover:bg-zinc-800/80 transition-colors"
          >
            <X className="w-4.5 h-4.5" />
          </button>

          <button
            type="button"
            onClick={() => {
              onNewChat();
              onCloseMobile();
            }}
            className="flex-1 inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-medium bg-zinc-900 text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white transition-colors whitespace-nowrap shrink-0"
          >
            <SquarePen className="w-4 h-4" />
            <span>New chat</span>
          </button>
        </div>

        {/* Search input + Command Palette trigger */}
        <div className="px-3 pb-2 flex items-center gap-1.5">
          <div className="relative flex-1">
            <Search className="w-3.5 h-3.5 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search chats..."
              aria-label="Search chats"
              className="w-full pl-8 pr-7 py-1.5 text-xs rounded-lg bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 dark:placeholder:text-zinc-500 focus:outline-none focus:border-zinc-400 dark:focus:border-zinc-600 transition-colors"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                aria-label="Clear search"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={onOpenCommandPalette}
            title="Command palette (Ctrl/Cmd + K)"
            aria-label="Open command palette"
            className="inline-flex items-center justify-center w-8 h-[30px] rounded-lg bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors shrink-0"
          >
            <Command className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Conversation history */}
        <div className="flex-1 overflow-y-auto px-2 py-1 space-y-4">
          {grouped.length === 0 ? (
            <div className="px-3 py-8 text-center text-xs text-zinc-500 dark:text-zinc-500">
              {searchQuery
                ? 'No matching conversations'
                : 'Your conversations will appear here'}
            </div>
          ) : (
            grouped.map((group) => (
              <div key={group.label}>
                <div className="px-2.5 pb-1.5 text-[11px] font-medium text-zinc-400 dark:text-zinc-500">
                  {group.label}
                </div>
                <div className="space-y-0.5">
                  {group.items.map((conv) => {
                    const isActive = conv.id === activeId;
                    const isEditing = editingId === conv.id;

                    return (
                      <div
                        key={conv.id}
                        className={`group relative flex items-center rounded-lg transition-colors ${
                          isActive
                            ? 'bg-zinc-200/80 dark:bg-zinc-800/90 text-zinc-900 dark:text-zinc-100'
                            : 'text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200/50 dark:hover:bg-zinc-800/50'
                        }`}
                      >
                        {isEditing ? (
                          <div className="flex items-center w-full px-2 py-1.5 gap-1">
                            <input
                              type="text"
                              autoFocus
                              value={editTitle}
                              onChange={(e) => setEditTitle(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') commitRename(conv.id);
                                if (e.key === 'Escape') setEditingId(null);
                              }}
                              onBlur={() => commitRename(conv.id)}
                              className="flex-1 min-w-0 px-1.5 py-0.5 text-[13px] bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 rounded focus:outline-none"
                            />
                            <button
                              type="button"
                              onMouseDown={(e) => {
                                e.preventDefault();
                                commitRename(conv.id);
                              }}
                              className="p-1 text-emerald-600 dark:text-emerald-400"
                              aria-label="Save title"
                            >
                              <Check className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ) : (
                          <>
                            <button
                              type="button"
                              onClick={() => {
                                onSelectConversation(conv.id);
                                onCloseMobile();
                              }}
                              className="flex-1 min-w-0 flex items-center gap-2 px-2.5 py-2 text-left text-[13.5px]"
                            >
                              <MessageSquare className="w-3.5 h-3.5 shrink-0 text-zinc-400 dark:text-zinc-500" />
                              <span className="truncate">{conv.title}</span>
                            </button>
                            <div
                              className={`flex items-center pr-1 gap-0.5 transition-opacity ${
                                isActive
                                  ? 'opacity-100'
                                  : 'opacity-0 group-hover:opacity-100 focus-within:opacity-100'
                              }`}
                            >
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onTogglePinConversation(conv.id);
                                }}
                                title={conv.pinned ? 'Unpin chat' : 'Pin chat'}
                                aria-label={conv.pinned ? 'Unpin chat' : 'Pin chat'}
                                className={`p-1.5 rounded-md hover:bg-zinc-300/60 dark:hover:bg-zinc-700/60 ${
                                  conv.pinned
                                    ? 'text-emerald-600 dark:text-emerald-400'
                                    : 'text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200'
                                }`}
                              >
                                <Pin className="w-3 h-3" />
                              </button>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  startRename(conv);
                                }}
                                title="Rename chat"
                                aria-label="Rename chat"
                                className="p-1.5 rounded-md text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200 hover:bg-zinc-300/60 dark:hover:bg-zinc-700/60"
                              >
                                <Pencil className="w-3 h-3" />
                              </button>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onDeleteConversation(conv.id);
                                }}
                                title="Delete chat"
                                aria-label="Delete chat"
                                className="p-1.5 rounded-md text-zinc-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-zinc-300/60 dark:hover:bg-zinc-700/60"
                              >
                                <Trash2 className="w-3 h-3" />
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer: Quota + Settings + Theme */}
        <div className="p-3 border-t border-zinc-200 dark:border-zinc-800/80 space-y-2.5">
          <button
            type="button"
            onClick={onOpenQuotaModal}
            className="w-full text-left p-2.5 rounded-xl bg-white dark:bg-zinc-900/90 border border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700 transition-colors"
          >
            <div className="flex items-center justify-between text-xs mb-1.5">
              <span className="font-medium text-zinc-700 dark:text-zinc-200 inline-flex items-center gap-1.5">
                <Gauge className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                {poolSummary && poolSummary.totalKeys > 1
                  ? `Pool (${poolSummary.activeKeys}/${poolSummary.totalKeys} keys)`
                  : 'Daily Allowance'}
              </span>
              <span className="font-mono text-[11px] tabular-nums text-zinc-500 dark:text-zinc-400">
                {formatCompactNumber(remaining)} left
              </span>
            </div>
            <div className="w-full h-1.5 rounded-full bg-zinc-100 dark:bg-zinc-800 overflow-hidden mb-1.5">
              <div
                className="h-full rounded-full bg-emerald-600 dark:bg-emerald-500 transition-all duration-300"
                style={{ width: `${pctRemaining}%` }}
              />
            </div>
            <div className="flex items-center justify-between text-[11px] text-zinc-500 dark:text-zinc-500 tabular-nums">
              <span>{formatCompactNumber(used)} used · $0.00 ({priceLabel})</span>
              <span>Resets {formatTimeUntilReset(quota.resetAt)}</span>
            </div>
          </button>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={onOpenSettings}
              className="flex-1 inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200/70 dark:hover:bg-zinc-800/80 transition-colors whitespace-nowrap shrink-0"
            >
              <Settings className="w-3.5 h-3.5" />
              <span>Model settings</span>
            </button>
            <button
              type="button"
              onClick={onToggleTheme}
              title={
                theme === 'dark'
                  ? 'Switch to light mode'
                  : 'Switch to dark mode'
              }
              aria-label={
                theme === 'dark'
                  ? 'Switch to light mode'
                  : 'Switch to dark mode'
              }
              className="inline-flex items-center justify-center w-9 h-8 rounded-lg text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-200/70 dark:hover:bg-zinc-800/80 transition-colors shrink-0"
            >
              {theme === 'dark' ? (
                <Sun className="w-4 h-4" />
              ) : (
                <Moon className="w-4 h-4" />
              )}
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}
