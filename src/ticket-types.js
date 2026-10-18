export const TICKET_TYPES = {
  general: { label: 'General Support', prefix: 'gen', description: 'Questions and assistance with the server.' },
  internal: { label: 'Internal Affairs Support', prefix: 'ia', description: 'Privately report a staff member to management.' },
  management: { label: 'Management Support', prefix: 'mgmt', description: 'Matters that need senior leadership.' },
};
export function ticketDetails(ticket) {
  try { return JSON.parse(ticket.details || '{}'); } catch { return {}; }
}
export function ticketRoles(ticket) {
  return [...new Set([ticket.support_role_id, ...(ticketDetails(ticket).accessRoleIds || [])].filter(Boolean))];
}
export function ticketName(ticket) {
  const details = ticketDetails(ticket);
  const prefix = TICKET_TYPES[details.type]?.prefix ?? 'gen';
  const label = details.customName || details.username || 'member';
  const safe = label.toLowerCase().replace(/[^\p{L}\p{N}_-]/gu, '-').replace(/-+/g, '-').slice(0, 60) || 'member';
  return `${ticket.claimed_by ? '🟢' : '🔴'}・${prefix}-${safe}-${ticket.id}`;
}
export function typeConfiguration(settings, type) {
  if (!TICKET_TYPES[type]) throw new Error('Choose a valid assistance type.');
  const leaders = settings.leadershipRoleIds || [];
  const supportRoleId = type === 'internal' ? settings.reportRoleId : type === 'management' ? settings.managementRoleId : settings.supportRoleId;
  if (!supportRoleId) throw new Error('This assistance type needs its staff role configured.');
  return { ...settings, supportRoleId, accessRoleIds: [...new Set([supportRoleId, ...leaders])] };
}
