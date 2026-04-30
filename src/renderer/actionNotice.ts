export const actionNoticeEvent = 'performance-monitor:action-notice';

export interface ActionNoticeDetail {
  message: string;
  detail?: unknown;
}

export function notifyAction(message: string, detail?: unknown): void {
  console.info(`[Performance Monitor] ${message}`, detail ?? '');
  window.dispatchEvent(new CustomEvent<ActionNoticeDetail>(actionNoticeEvent, { detail: { message, detail } }));
}
