export const SCOPE_TABLE_MAP: Record<string, string[]> = {
  'Glyphor.Code.Read': ['repositories', 'pull_requests', 'deployments'],
  'Glyphor.Code.Write': ['repositories', 'pull_requests'],
  'Glyphor.Deploy.Preview': ['deployments'],
  'Glyphor.Deploy.Production': ['deployments'],
};
