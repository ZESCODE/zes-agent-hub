-- ZESCODE workflow ownership (zes.workflow/v1)
-- Every workflow definition records the principal that owns it. A definition
-- without an owner is a platform shared definition and stays visible to every
-- authenticated builder user.

ALTER TABLE workflow_definitions ADD COLUMN IF NOT EXISTS owner_principal TEXT;

UPDATE workflow_definitions d
   SET owner_principal = u.email
  FROM users u
 WHERE u.id = d.created_by
   AND d.owner_principal IS NULL;

CREATE INDEX IF NOT EXISTS idx_workflow_definitions_owner ON workflow_definitions(owner_principal);
