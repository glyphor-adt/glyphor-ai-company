-- Fix: Add missing IAM entries for Morgan Blake (global-admin) and
-- the glyphor-directory app registration needed by Riley & Morgan
-- for Directory.Read.All, Group.ReadWrite.All, Application.Read.All

-- 1. Morgan Blake's GCP service account
INSERT INTO platform_iam_state (platform, credential_id, agent_role, permissions, desired_permissions, in_sync) VALUES
  ('gcp', 'glyphor-global-admin@ai-glyphor-company.iam.gserviceaccount.com', 'global-admin',
   '{"roles": ["roles/iam.securityReviewer", "roles/resourcemanager.projectIamAdmin", "roles/iam.serviceAccountAdmin", "roles/secretmanager.admin"]}',
   '{"roles": ["roles/iam.securityReviewer", "roles/resourcemanager.projectIamAdmin", "roles/iam.serviceAccountAdmin", "roles/secretmanager.admin"]}',
   true)
ON CONFLICT (platform, credential_id) DO UPDATE SET
  agent_role = EXCLUDED.agent_role,
  permissions = EXCLUDED.permissions,
  desired_permissions = EXCLUDED.desired_permissions,
  in_sync = EXCLUDED.in_sync,
  last_synced = NOW();

-- 2. glyphor-directory app registration (Directory + Group + AppReg + Audit scopes)
INSERT INTO platform_iam_state (platform, credential_id, agent_role, permissions, desired_permissions, in_sync) VALUES
  ('m365', 'glyphor-directory', NULL,
   '{"scopes": ["Directory.Read.All", "Directory.ReadWrite.All", "Group.Read.All", "Group.ReadWrite.All", "GroupMember.ReadWrite.All", "Application.Read.All", "AuditLog.Read.All", "Organization.Read.All", "RoleManagement.ReadWrite.Directory"]}',
   '{"scopes": ["Directory.Read.All", "Directory.ReadWrite.All", "Group.Read.All", "Group.ReadWrite.All", "GroupMember.ReadWrite.All", "Application.Read.All", "AuditLog.Read.All", "Organization.Read.All", "RoleManagement.ReadWrite.Directory"]}',
   true)
ON CONFLICT (platform, credential_id) DO UPDATE SET
  permissions = EXCLUDED.permissions,
  desired_permissions = EXCLUDED.desired_permissions,
  in_sync = EXCLUDED.in_sync,
  last_synced = NOW();

-- 3. Update glyphor-mail to include Mail.ReadWrite (Riley needs read_inbox + reply)
UPDATE platform_iam_state
SET permissions = '{"scopes": ["Mail.Send", "Mail.ReadWrite"]}',
    desired_permissions = '{"scopes": ["Mail.Send", "Mail.ReadWrite"]}',
    last_synced = NOW()
WHERE platform = 'm365' AND credential_id = 'glyphor-mail';

-- 4. Update glyphor-users to include Directory.Read.All (user + memberOf queries)
UPDATE platform_iam_state
SET permissions = '{"scopes": ["User.Read.All", "User.ReadWrite.All", "Directory.Read.All"]}',
    desired_permissions = '{"scopes": ["User.Read.All", "User.ReadWrite.All", "Directory.Read.All"]}',
    last_synced = NOW()
WHERE platform = 'm365' AND credential_id = 'glyphor-users';
