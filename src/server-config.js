// Confirmed by the customer's 2026-10-18 /scan export.
// Only missing settings are filled; later /configure changes take precedence.
export const SERVER_SEED_KEY = 'alaska-scan-2026-10-18-v1';
export const SERVER_SETTINGS = {
  welcome: { channelId: '1560914979354583191' },
  sessions: { channelId: '1560914589066072074', staffRoleId: '1560951618361499718', pingRoleId: '1560951687429099552' },
  tickets: { categoryId: '1553703456055763115', supportRoleId: '1560951618361499718',
    logChannelId: '1553703567314002021', panelChannelId: '1560914284979167252' },
  panels: { homeChannelId: '1560914196898643969' },
};
export const REFERENCE_SEED_KEY = 'alaska-reference-flows-2026-10-18-v1';
export const REFERENCE_SETTINGS = {
  sessions: { code: 'Alaskasrp', ownerLabel: 'AEMeoow' },
  tickets: { reportRoleId: '1553703181282709506', managementRoleId: '1553703178023997493',
    leadershipRoleIds: ['1560949789141766184','1553703178023997493'] },
  panels: { affiliationChannelId: '1560915371865935882' },
};

// The customer explicitly moved welcomes to general and requested the compact layout.
// Apply once to existing databases as well, preserving subsequent /configure edits.
export const COMPACT_WELCOME_SEED_KEY = 'alaska-compact-welcome-general-2026-10-18-v1';
export const COMPACT_WELCOME_SETTINGS = {
  welcome: { channelId: '1560914979354583191', banner: null,
    message: 'Welcome to **Alaska State Roleplay**, {user}! Thank you for joining; we hope you enjoy your time here.' },
};
