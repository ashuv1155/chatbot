import { initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type User,
} from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocFromServer,
  getDocs,
  getFirestore,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';
import type {
  AdminUsageLog,
  AdminUserUsage,
  ChatMessage,
  Conversation,
  SearchMode,
} from '../types/chat';

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);

const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null,
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes('the client is offline')
    ) {
      console.error('Please check your Firebase configuration.');
    }
  }
}
testConnection();

export function subscribeAuthState(
  callback: (user: User | null) => void,
): () => void {
  return onAuthStateChanged(auth, callback);
}

export async function signInWithGoogle(): Promise<User> {
  const result = await signInWithPopup(auth, googleProvider);
  await syncUserProfile(result.user);
  return result.user;
}

export async function signOutUser(): Promise<void> {
  await signOut(auth);
}

export function sanitizeDocId(id: string): string {
  const cleaned = id.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128);
  return cleaned || `id_${Date.now()}`;
}

function toMillis(val: unknown): number {
  if (val instanceof Timestamp) return val.toMillis();
  if (typeof val === 'number') return val;
  return Date.now();
}

function getTodayUtcDate(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function syncUserProfile(user: User): Promise<void> {
  const userPath = `users/${user.uid}`;
  const userRef = doc(db, 'users', user.uid);
  try {
    const snap = await getDoc(userRef);
    const displayName = (user.displayName || '').slice(0, 120);
    const email = (user.email || '').slice(0, 254);
    const photoURL = (user.photoURL || '').slice(0, 1024);

    if (!snap.exists()) {
      await setDoc(userRef, {
        uid: user.uid,
        displayName,
        email,
        photoURL,
        totalTokensUsed: 0,
        promptTokensUsed: 0,
        completionTokensUsed: 0,
        dailyTokensUsed: 0,
        usageDate: getTodayUtcDate(),
        totalRequests: 0,
        webSearchCount: 0,
        deepSearchCount: 0,
        conversationsCount: 0,
        lastActiveAt: serverTimestamp(),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(userRef, {
        displayName,
        email,
        photoURL,
        lastActiveAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, userPath);
  }
}

export async function syncUserConversationsCount(
  uid: string,
  count: number,
): Promise<void> {
  const userPath = `users/${uid}`;
  const userRef = doc(db, 'users', uid);
  try {
    const safeCount = Math.max(0, Math.min(100000, Math.floor(count)));
    await updateDoc(userRef, {
      conversationsCount: safeCount,
      updatedAt: serverTimestamp(),
    });
  } catch {
    // Non-critical metadata count sync
  }
}

export async function recordUserUsageToFirestore(
  user: User,
  params: {
    model: string;
    searchMode: SearchMode;
    responseStyle?: string;
    tone?: string;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    sourcesCount?: number;
    status: 'completed' | 'aborted' | 'error';
    errorMessage?: string;
  },
): Promise<void> {
  const uid = user.uid;
  const userPath = `users/${uid}`;
  const userRef = doc(db, 'users', uid);
  const todayUtc = getTodayUtcDate();

  const promptTokens = Math.max(0, Math.floor(params.promptTokens || 0));
  const completionTokens = Math.max(0, Math.floor(params.completionTokens || 0));
  const totalTokens = Math.max(
    0,
    Math.floor(params.totalTokens || promptTokens + completionTokens),
  );

  try {
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(userRef);
      const displayName = (user.displayName || '').slice(0, 120);
      const email = (user.email || '').slice(0, 254);
      const photoURL = (user.photoURL || '').slice(0, 1024);

      if (!snap.exists()) {
        tx.set(userRef, {
          uid,
          displayName,
          email,
          photoURL,
          totalTokensUsed: totalTokens,
          promptTokensUsed: promptTokens,
          completionTokensUsed: completionTokens,
          dailyTokensUsed: totalTokens,
          usageDate: todayUtc,
          totalRequests: 1,
          webSearchCount: params.searchMode === 'web' ? 1 : 0,
          deepSearchCount: params.searchMode === 'deep' ? 1 : 0,
          conversationsCount: 1,
          lastModelUsed: params.model.slice(0, 100),
          lastSearchMode: params.searchMode,
          lastActiveAt: serverTimestamp(),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } else {
        const data = snap.data() || {};
        const prevDate = typeof data.usageDate === 'string' ? data.usageDate : '';
        const prevDaily =
          prevDate === todayUtc ? Number(data.dailyTokensUsed || 0) : 0;

        tx.update(userRef, {
          totalTokensUsed: Number(data.totalTokensUsed || 0) + totalTokens,
          promptTokensUsed: Number(data.promptTokensUsed || 0) + promptTokens,
          completionTokensUsed:
            Number(data.completionTokensUsed || 0) + completionTokens,
          dailyTokensUsed: prevDaily + totalTokens,
          usageDate: todayUtc,
          totalRequests: Number(data.totalRequests || 0) + 1,
          webSearchCount:
            Number(data.webSearchCount || 0) +
            (params.searchMode === 'web' ? 1 : 0),
          deepSearchCount:
            Number(data.deepSearchCount || 0) +
            (params.searchMode === 'deep' ? 1 : 0),
          lastModelUsed: params.model.slice(0, 100),
          lastSearchMode: params.searchMode,
          lastActiveAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, userPath);
  }

  const logId = sanitizeDocId(
    `${Date.now()}_${uid.slice(0, 12)}_${Math.random().toString(36).slice(2, 8)}`,
  );
  const logPath = `usageLogs/${logId}`;
  try {
    const logPayload: Record<string, unknown> = {
      id: logId,
      userId: uid,
      userEmail: (user.email || '').slice(0, 254),
      userName: (user.displayName || 'Google User').slice(0, 120),
      model: (params.model || 'deepseek-v4.1-flash-free').slice(0, 100),
      searchMode: params.searchMode,
      promptTokens,
      completionTokens,
      totalTokens,
      status: params.status,
      createdAt: serverTimestamp(),
    };
    if (params.responseStyle) {
      logPayload.responseStyle = params.responseStyle.slice(0, 32);
    }
    if (params.tone) {
      logPayload.tone = params.tone.slice(0, 32);
    }
    if (typeof params.sourcesCount === 'number' && params.sourcesCount >= 0) {
      logPayload.sourcesCount = Math.floor(params.sourcesCount);
    }
    if (params.errorMessage) {
      logPayload.errorMessage = params.errorMessage.slice(0, 500);
    }
    await setDoc(doc(db, logPath), logPayload);
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, logPath);
  }
}

export function subscribeAllUsersForAdmin(
  onData: (users: AdminUserUsage[]) => void,
  onError?: (err: Error) => void,
): () => void {
  const usersPath = 'users';
  return onSnapshot(
    collection(db, usersPath),
    (snapshot) => {
      const items: AdminUserUsage[] = snapshot.docs.map((d) => {
        const data = d.data();
        return {
          uid: String(data.uid || d.id),
          displayName: String(data.displayName || 'Google User'),
          email: String(data.email || ''),
          photoURL: String(data.photoURL || ''),
          totalTokensUsed: Number(data.totalTokensUsed || 0),
          promptTokensUsed: Number(data.promptTokensUsed || 0),
          completionTokensUsed: Number(data.completionTokensUsed || 0),
          dailyTokensUsed: Number(data.dailyTokensUsed || 0),
          usageDate: String(data.usageDate || ''),
          totalRequests: Number(data.totalRequests || 0),
          webSearchCount: Number(data.webSearchCount || 0),
          deepSearchCount: Number(data.deepSearchCount || 0),
          conversationsCount: Number(data.conversationsCount || 0),
          lastModelUsed:
            typeof data.lastModelUsed === 'string'
              ? data.lastModelUsed
              : undefined,
          lastSearchMode:
            data.lastSearchMode === 'web' || data.lastSearchMode === 'deep'
              ? data.lastSearchMode
              : data.lastSearchMode === 'off'
                ? 'off'
                : undefined,
          lastActiveAt: toMillis(data.lastActiveAt ?? data.updatedAt),
          createdAt: toMillis(data.createdAt),
          updatedAt: toMillis(data.updatedAt),
        };
      });
      items.sort(
        (a, b) =>
          b.totalTokensUsed - a.totalTokensUsed ||
          b.lastActiveAt - a.lastActiveAt,
      );
      onData(items);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, usersPath);
      } catch (wrapped) {
        onError?.(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    },
  );
}

export function subscribeUsageLogsForAdmin(
  onData: (logs: AdminUsageLog[]) => void,
  onError?: (err: Error) => void,
  maxLogs = 150,
): () => void {
  const logsPath = 'usageLogs';
  const q = query(
    collection(db, logsPath),
    orderBy('createdAt', 'desc'),
    limit(maxLogs),
  );
  return onSnapshot(
    q,
    (snapshot) => {
      const logs: AdminUsageLog[] = snapshot.docs.map((d) => {
        const data = d.data();
        return {
          id: String(data.id || d.id),
          userId: String(data.userId || ''),
          userEmail: String(data.userEmail || ''),
          userName: String(data.userName || 'User'),
          model: String(data.model || 'deepseek-v4.1-flash-free'),
          searchMode:
            data.searchMode === 'web' || data.searchMode === 'deep'
              ? data.searchMode
              : 'off',
          responseStyle:
            typeof data.responseStyle === 'string'
              ? data.responseStyle
              : undefined,
          tone: typeof data.tone === 'string' ? data.tone : undefined,
          promptTokens: Number(data.promptTokens || 0),
          completionTokens: Number(data.completionTokens || 0),
          totalTokens: Number(data.totalTokens || 0),
          sourcesCount:
            typeof data.sourcesCount === 'number'
              ? data.sourcesCount
              : undefined,
          status:
            data.status === 'aborted' || data.status === 'error'
              ? data.status
              : 'completed',
          errorMessage:
            typeof data.errorMessage === 'string'
              ? data.errorMessage
              : undefined,
          createdAt: toMillis(data.createdAt),
        };
      });
      onData(logs);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, logsPath);
      } catch (wrapped) {
        onError?.(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    },
  );
}

export function subscribeUserConversations(
  uid: string,
  onData: (conversations: Conversation[]) => void,
  onError?: (err: Error) => void,
): () => void {
  const convPath = `users/${uid}/conversations`;
  const q = query(collection(db, convPath), where('ownerId', '==', uid));

  return onSnapshot(
    q,
    (snapshot) => {
      const items: Conversation[] = snapshot.docs.map((d) => {
        const data = d.data();
        return {
          id: String(data.id || d.id),
          title: String(data.title || 'New chat'),
          pinned: Boolean(data.pinned),
          messages: [],
          createdAt: toMillis(data.createdAt),
          updatedAt: toMillis(data.updatedAt),
        };
      });
      items.sort((a, b) => b.updatedAt - a.updatedAt);
      onData(items);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, convPath);
      } catch (wrapped) {
        onError?.(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    },
  );
}

export function subscribeConversationMessages(
  uid: string,
  conversationId: string,
  onData: (messages: ChatMessage[]) => void,
  onError?: (err: Error) => void,
): () => void {
  const safeConvId = sanitizeDocId(conversationId);
  const msgPath = `users/${uid}/conversations/${safeConvId}/messages`;
  const q = query(collection(db, msgPath), where('ownerId', '==', uid));

  return onSnapshot(
    q,
    (snapshot) => {
      const msgs: ChatMessage[] = snapshot.docs.map((d) => {
        const data = d.data();
        return {
          id: String(data.id || d.id),
          role: data.role === 'user' ? 'user' : 'assistant',
          content: String(data.content || ''),
          reasoning:
            typeof data.reasoning === 'string' ? data.reasoning : undefined,
          attachments: Array.isArray(data.attachments)
            ? data.attachments.map((att) => ({
                id: String(att.id || ''),
                name: String(att.name || ''),
                size: Number(att.size || 0),
                content: '',
              }))
            : undefined,
          usage:
            data.usage && typeof data.usage === 'object'
              ? {
                  prompt_tokens: Number(data.usage.prompt_tokens || 0),
                  completion_tokens: Number(data.usage.completion_tokens || 0),
                  total_tokens: Number(data.usage.total_tokens || 0),
                }
              : undefined,
          aborted: Boolean(data.aborted),
          error: typeof data.error === 'string' ? data.error : undefined,
          searchMode:
            data.searchMode === 'web' || data.searchMode === 'deep'
              ? data.searchMode
              : data.searchMode === 'off'
                ? 'off'
                : undefined,
          searchQueries: Array.isArray(data.searchQueries)
            ? data.searchQueries.map((q) => String(q))
            : undefined,
          sources: Array.isArray(data.sources)
            ? data.sources.map((s) => ({
                title: String(s.title || ''),
                url: String(s.url || ''),
                domain: String(s.domain || ''),
                snippet: String(s.snippet || ''),
                fetchedExcerpt: Boolean(s.fetchedExcerpt),
              }))
            : undefined,
          createdAt: toMillis(data.createdAt),
          isStreaming: false,
        };
      });
      msgs.sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
      onData(msgs);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, msgPath);
      } catch (wrapped) {
        onError?.(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    },
  );
}

function buildFirestoreMessagePayload(
  uid: string,
  convId: string,
  msg: ChatMessage,
) {
  const safeMsgId = sanitizeDocId(msg.id);
  const payload: Record<string, unknown> = {
    id: safeMsgId,
    ownerId: uid,
    conversationId: sanitizeDocId(convId),
    role: msg.role,
    content: (msg.content || '').slice(0, 400000),
    createdAt: serverTimestamp(),
  };

  if (msg.reasoning) {
    payload.reasoning = msg.reasoning.slice(0, 200000);
  }
  if (msg.error) {
    payload.error = msg.error.slice(0, 2000);
  }
  if (typeof msg.aborted === 'boolean') {
    payload.aborted = msg.aborted;
  }
  if (msg.searchMode) {
    payload.searchMode = msg.searchMode;
  }
  if (msg.searchQueries && msg.searchQueries.length > 0) {
    payload.searchQueries = msg.searchQueries
      .slice(0, 6)
      .map((q) => String(q).slice(0, 300))
      .filter(Boolean);
  }
  if (msg.sources && msg.sources.length > 0) {
    payload.sources = msg.sources.slice(0, 12).map((s) => ({
      title: (s.title || s.domain || 'Source').slice(0, 240),
      url: (s.url || 'https://example.com').slice(0, 2048),
      domain: (s.domain || 'web').slice(0, 255),
      snippet: (s.snippet || '').slice(0, 1000),
      fetchedExcerpt: Boolean(s.fetchedExcerpt),
    }));
  }
  if (msg.attachments && msg.attachments.length > 0) {
    payload.attachments = msg.attachments.slice(0, 10).map((att) => ({
      id: sanitizeDocId(att.id),
      name: att.name.slice(0, 255),
      size: Math.min(2000000, Math.max(0, Number(att.size) || 0)),
    }));
  }
  if (msg.usage) {
    payload.usage = {
      prompt_tokens: Math.max(0, Number(msg.usage.prompt_tokens) || 0),
      completion_tokens: Math.max(0, Number(msg.usage.completion_tokens) || 0),
      total_tokens: Math.max(0, Number(msg.usage.total_tokens) || 0),
    };
  }

  return payload;
}

export async function createConversationWithMessage(
  uid: string,
  conv: { id: string; title: string; pinned: boolean },
  userMsg: ChatMessage,
  isNewConversation: boolean,
): Promise<void> {
  const safeConvId = sanitizeDocId(conv.id);
  const convPath = `users/${uid}/conversations/${safeConvId}`;
  const msgPath = `${convPath}/messages/${sanitizeDocId(userMsg.id)}`;

  try {
    const batch = writeBatch(db);
    const convRef = doc(db, convPath);

    if (isNewConversation) {
      batch.set(convRef, {
        id: safeConvId,
        ownerId: uid,
        title: (conv.title || 'New chat').slice(0, 200),
        pinned: Boolean(conv.pinned),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      batch.update(convRef, {
        title: (conv.title || 'New chat').slice(0, 200),
        pinned: Boolean(conv.pinned),
        updatedAt: serverTimestamp(),
      });
    }

    const msgRef = doc(db, msgPath);
    batch.set(msgRef, buildFirestoreMessagePayload(uid, safeConvId, userMsg));
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, convPath);
  }
}

export async function saveAssistantMessageToFirestore(
  uid: string,
  convId: string,
  assistantMsg: ChatMessage,
): Promise<void> {
  const safeConvId = sanitizeDocId(convId);
  const safeMsgId = sanitizeDocId(assistantMsg.id);
  const msgPath = `users/${uid}/conversations/${safeConvId}/messages/${safeMsgId}`;

  try {
    const batch = writeBatch(db);
    batch.set(
      doc(db, msgPath),
      buildFirestoreMessagePayload(uid, safeConvId, assistantMsg),
    );
    batch.update(doc(db, `users/${uid}/conversations/${safeConvId}`), {
      updatedAt: serverTimestamp(),
    });
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, msgPath);
  }
}

export async function saveBranchedConversationToFirestore(
  uid: string,
  conv: Conversation,
): Promise<void> {
  const safeConvId = sanitizeDocId(conv.id);
  const convPath = `users/${uid}/conversations/${safeConvId}`;

  try {
    const batch = writeBatch(db);
    batch.set(doc(db, convPath), {
      id: safeConvId,
      ownerId: uid,
      title: (conv.title || 'Branch').slice(0, 200),
      pinned: Boolean(conv.pinned),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    for (const msg of conv.messages) {
      const safeMsgId = sanitizeDocId(msg.id);
      batch.set(
        doc(db, `${convPath}/messages/${safeMsgId}`),
        buildFirestoreMessagePayload(uid, safeConvId, msg),
      );
    }
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, convPath);
  }
}

export async function updateConversationMetaInFirestore(
  uid: string,
  convId: string,
  updates: { title?: string; pinned?: boolean },
): Promise<void> {
  const safeConvId = sanitizeDocId(convId);
  const convPath = `users/${uid}/conversations/${safeConvId}`;
  try {
    const payload: Record<string, unknown> = {
      updatedAt: serverTimestamp(),
    };
    if (typeof updates.title === 'string') {
      payload.title = (updates.title.trim() || 'New chat').slice(0, 200);
    }
    if (typeof updates.pinned === 'boolean') {
      payload.pinned = updates.pinned;
    }
    await updateDoc(doc(db, convPath), payload);
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, convPath);
  }
}

export async function updateUserMessageContentInFirestore(
  uid: string,
  convId: string,
  msgId: string,
  newContent: string,
): Promise<void> {
  const safeConvId = sanitizeDocId(convId);
  const safeMsgId = sanitizeDocId(msgId);
  const msgPath = `users/${uid}/conversations/${safeConvId}/messages/${safeMsgId}`;
  try {
    await updateDoc(doc(db, msgPath), {
      content: newContent.slice(0, 400000),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, msgPath);
  }
}

export async function deleteConversationMessagesAfter(
  uid: string,
  convId: string,
  messageIdsToDelete: string[],
): Promise<void> {
  if (messageIdsToDelete.length === 0) return;
  const safeConvId = sanitizeDocId(convId);
  const basePath = `users/${uid}/conversations/${safeConvId}/messages`;
  try {
    const batch = writeBatch(db);
    for (const id of messageIdsToDelete) {
      batch.delete(doc(db, basePath, sanitizeDocId(id)));
    }
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, basePath);
  }
}

export async function deleteConversationFromFirestore(
  uid: string,
  convId: string,
): Promise<void> {
  const safeConvId = sanitizeDocId(convId);
  const convPath = `users/${uid}/conversations/${safeConvId}`;
  const msgsPath = `${convPath}/messages`;
  try {
    const msgsSnap = await getDocs(
      query(collection(db, msgsPath), where('ownerId', '==', uid)),
    );
    const batch = writeBatch(db);
    for (const msgDoc of msgsSnap.docs) {
      batch.delete(msgDoc.ref);
    }
    batch.delete(doc(db, convPath));
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, convPath);
  }
}
