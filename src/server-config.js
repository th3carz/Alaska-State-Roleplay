// Confirmed by the customer's 2026-10-18 /scan export.
// Only missing settings are filled; later /configure changes take precedence.
export const SERVER_SEED_KEY = 'alaska-scan-2026-10-18-v1';
export const SERVER_SETTINGS = {
  welcome: { channelId: '1560911382294302750' },
  sessions: { channelId: '1560914589066072074', staffRoleId: '1560951618361499718', pingRoleId: '1560951687429099552' },
  tickets: { categoryId: '1553703456055763115', supportRoleId: '1560951618361499718',
    logChannelId: '1553703567314002021', panelChannelId: '1560914284979167252' },
  panels: { homeChannelId: '1560914196898643969' },
};

export const SERVER_EMOJIS = {
  support: { id: '1554358095503949825', name: 'rift_support', animated: false },
  ticket: { id: '1554358147853062244', name: 'rift_ticket', animated: false },
  link: { id: '1554358142220111872', name: 'rift_link', animated: false },
};
