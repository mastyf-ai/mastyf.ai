/** What each workspace license tier (licenses.tier) allows. A limit of -1 means unlimited. */
export const LICENSE_TIERS: Record<
  string,
  { maxInstances: number; maxTeams: number; maxUsers: number; features: string[] }
> = {
  free:       { maxInstances: 1,  maxTeams: 0, maxUsers: 1,  features: ['policy', 'audit', 'dashboard'] },
  pro:        { maxInstances: 5,  maxTeams: 1, maxUsers: 1, features: ['policy', 'audit', 'dashboard', 'fleet', 'cost', 'health'] },
  team:       { maxInstances: 25, maxTeams: 10, maxUsers: 10, features: ['policy', 'audit', 'dashboard', 'fleet', 'cost', 'health', 'ai', 'swarm'] },
  enterprise: { maxInstances: -1, maxTeams: -1, maxUsers: -1, features: ['policy', 'audit', 'dashboard', 'fleet', 'cost', 'health', 'ai', 'swarm', 'admin', 'sso'] },
};
