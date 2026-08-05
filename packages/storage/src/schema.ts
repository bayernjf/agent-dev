import { integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const projects = sqliteTable('projects', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  productType: text('product_type').notNull(),
  status: text('status').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const blueprintRevisions = sqliteTable(
  'blueprint_revisions',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id').notNull(),
    revision: integer('revision').notNull(),
    blueprintJson: text('blueprint_json').notNull(),
    createdAt: text('created_at').notNull(),
  },
  table => [uniqueIndex('blueprint_revisions_project_revision').on(table.projectId, table.revision)],
);

export const deliveryRuns = sqliteTable('delivery_runs', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull(),
  state: text('state').notNull(),
  snapshotJson: text('snapshot_json').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const baselineApprovals = sqliteTable(
  'baseline_approvals',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id').notNull(),
    blueprintRevision: integer('blueprint_revision').notNull(),
    status: text('status').notNull(),
    approvedBy: text('approved_by').notNull(),
    approvedAt: text('approved_at').notNull(),
  },
  table => [uniqueIndex('baseline_approvals_project_revision').on(table.projectId, table.blueprintRevision)],
);
