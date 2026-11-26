import type { RecoveryRecord, Workspace } from './types.ts';

export function normalizeRecovery(value: unknown): RecoveryRecord[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.slice(0, 200).flatMap((item) => {
    if (!item || typeof item !== 'object' || typeof item.id !== 'string' || typeof item.message !== 'string') return [];
    if (seen.has(item.id)) return [];
    seen.add(item.id);
    const row: RecoveryRecord = { id: item.id.slice(0, 200), at: typeof item.at === 'string' ? item.at : '', action: typeof item.action === 'string' ? item.action.slice(0, 100) : 'review', target: typeof item.target === 'string' ? item.target.slice(0, 300) : '', message: item.message.slice(0, 1200), state: item.state === 'resolved' || item.state === 'dismissed' ? item.state : 'open' };
    for (const key of ['chatId', 'workspaceId', 'operationId', 'outcome'] as const) if (typeof item[key] === 'string') row[key] = item[key].slice(0, 200);
    if (typeof item.text === 'string') row.text = item.text.slice(0, 8000);
    if (typeof item.pageId === 'string' || item.pageId === null) row.pageId = item.pageId;
    return [row];
  });
}

export function saveRecovery(ws: Workspace, record: RecoveryRecord): Workspace {
  return { ...ws, recovery: [record, ...(ws.recovery ?? []).filter((item) => item.id !== record.id)].slice(0, 200) };
}
export function closeRecovery(ws: Workspace, id: string, state: 'dismissed' | 'resolved'): Workspace {
  return { ...ws, recovery: (ws.recovery ?? []).map((item) => item.id === id ? { ...item, state } : item) };
}
