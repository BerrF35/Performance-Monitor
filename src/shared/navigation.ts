export const tabs = ['Overview', 'System', 'Processes', 'Network', 'Sensors', 'Storage', 'Logs'] as const;

export type TabId = (typeof tabs)[number];
