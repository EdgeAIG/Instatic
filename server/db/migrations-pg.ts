import type { Migration } from './runMigrations'

/**
 * Postgres dialect — single consolidated baseline.
 *
 * Pre-release rules (CLAUDE.md): no backward compatibility, the local dev DB
 * is disposable, and we never carry a forwarded migration trail "just in
 * case". The 19 incremental migrations that built this schema during
 * development have been collapsed into one `001_baseline` representing the
 * final state. New schema work appends a new migration in the usual way
 * (`002_<change>`, etc.); the parity test gates IDs between this file and
 * `migrations-sqlite.ts`.
 *
 * Order within the baseline is dictated by FK dependencies:
 *
 *   1. roles                    — no FKs
 *   2. users                    — FK roles; `avatar_media_id` added below
 *   3. sessions, audit_events,
 *      pages, page_versions,
 *      data_*, installed_plugins,
 *      plugin_*, published_runtime_assets,
 *      login_attempts, plugin_crash_events
 *                              — all FK users (and various siblings)
 *   4. media_assets             — FK users; needed before the users
 *                                  `avatar_media_id` self-add
 *   5. media_folders, media_*   — FK media_assets / each other
 *   6. ALTER users ADD avatar_media_id REFERENCES media_assets
 *   7. ALTER data_rows ADD active_version_id FK → data_row_versions
 *
 * `schema_migrations` is created by `runMigrations.ts` itself before any
 * migration runs, so the baseline does not re-declare it.
 */
export const pgMigrations: Migration[] = [
  {
    id: '001_baseline',
    sql: `
      -- ─── Roles + Users ─────────────────────────────────────────────────────

      create table if not exists roles (
        id text primary key,
        slug text not null unique,
        name text not null,
        description text not null default '',
        is_system boolean not null default false,
        capabilities_json jsonb not null default '[]'::jsonb,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      );

      -- Built-in roles seed. The Owner row is also force-resynced on every
      -- server boot (see syncSystemRoles in server/repositories/roles.ts),
      -- so adding new capabilities to code automatically propagates to the
      -- Owner without a migration. Other built-ins are inserted on first
      -- boot only - subsequent edits via the admin UI are preserved.
      insert into roles (id, slug, name, description, is_system, capabilities_json)
      values
        ('owner', 'owner', 'Owner', 'Permanent installation owner with full system access.', true, '["site.read","site.structure.edit","site.content.edit","site.style.edit","pages.edit","pages.publish","content.create","content.edit.own","content.edit.any","content.publish.own","content.publish.any","content.manage","media.manage","runtime.manage","plugins.manage","users.manage","roles.manage","audit.read"]'::jsonb),
        ('admin', 'admin', 'Admin', 'Full admin access (cannot manage roles).', true, '["site.read","site.structure.edit","site.content.edit","site.style.edit","pages.edit","pages.publish","content.create","content.edit.own","content.edit.any","content.publish.own","content.publish.any","content.manage","media.manage","runtime.manage","plugins.manage","users.manage","audit.read"]'::jsonb),
        ('client', 'client', 'Client', 'Can edit page copy (text, images, links) but not structure or styles.', true, '["site.read","site.content.edit"]'::jsonb),
        ('member', 'member', 'Member', 'Public-facing member account — no admin access by default.', true, '[]'::jsonb)
      on conflict (id) do update
        set slug = excluded.slug,
            name = excluded.name,
            description = excluded.description,
            is_system = excluded.is_system,
            capabilities_json = excluded.capabilities_json,
            updated_at = current_timestamp;

      -- avatar_media_id is added after media_assets exists (see below).
      create table if not exists users (
        id text primary key,
        email text not null,
        email_normalized text not null,
        display_name text not null,
        password_hash text not null,
        status text not null default 'active',
        role_id text not null references roles(id) on delete restrict,
        last_login_at timestamptz,
        failed_login_count integer not null default 0,
        locked_until timestamptz,
        password_updated_at timestamptz,
        mfa_enabled boolean not null default false,
        mfa_enabled_at timestamptz,
        mfa_totp_secret text,
        mfa_recovery_code_hashes_json jsonb not null default '[]'::jsonb,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        deleted_at timestamptz,
        constraint users_status_check check (status in ('active', 'suspended'))
      );

      create unique index if not exists users_email_normalized_active_idx
        on users (email_normalized)
        where deleted_at is null;

      create unique index if not exists users_single_active_owner_idx
        on users (role_id)
        where role_id = 'owner' and status = 'active' and deleted_at is null;

      -- ─── Site ──────────────────────────────────────────────────────────────

      create table if not exists site (
        id text primary key default 'default',
        name text not null,
        settings_json jsonb not null default '{}'::jsonb,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      );

      -- ─── Sessions + Audit ──────────────────────────────────────────────────

      create table if not exists sessions (
        id_hash text primary key,
        user_id text not null references users(id) on delete cascade,
        created_at timestamptz not null default now(),
        last_seen_at timestamptz not null default now(),
        expires_at timestamptz not null,
        revoked_at timestamptz,
        ip_address text,
        user_agent text,
        device_label text not null default '',
        mfa_passed_at timestamptz,
        step_up_expires_at timestamptz
      );

      create index if not exists sessions_user_idx
        on sessions (user_id, last_seen_at desc);

      create index if not exists sessions_user_active_idx
        on sessions (user_id, expires_at)
        where revoked_at is null;

      create table if not exists audit_events (
        id text primary key,
        actor_user_id text references users(id) on delete set null,
        action text not null,
        target_type text,
        target_id text,
        metadata_json jsonb not null default '{}'::jsonb,
        ip_address text,
        user_agent text,
        created_at timestamptz not null default now()
      );

      create index if not exists audit_events_created_idx
        on audit_events (created_at desc);

      -- Login-attempts audit. Append-only forensic trail of every login
      -- attempt: successes, wrong passwords, no-user, suspensions, locks,
      -- rate-limits, MFA failures. user_agent is captured so the Account →
      -- Sign-in history tab can derive a friendly "Browser on Platform"
      -- label per row.
      create table if not exists login_attempts (
        id text primary key,
        attempted_at timestamptz not null default now(),
        email_norm text,
        ip_address text,
        user_agent text,
        user_id text references users(id) on delete set null,
        result text not null
          constraint login_attempts_result_check
          check (result in ('success', 'bad_password', 'no_user', 'account_disabled', 'locked', 'rate_limited', 'mfa_failed'))
      );

      create index if not exists login_attempts_ip_idx
        on login_attempts (ip_address, attempted_at desc);

      create index if not exists login_attempts_email_idx
        on login_attempts (email_norm, attempted_at desc)
        where email_norm is not null;

      -- ─── Pages + Page versions ────────────────────────────────────────────

      create table if not exists pages (
        id text primary key,
        title text not null,
        slug text not null unique,
        status text not null default 'draft',
        draft_document_json jsonb not null,
        active_version_id text,
        sort_order integer not null default 0,
        owner_user_id text references users(id) on delete set null,
        created_by_user_id text references users(id) on delete set null,
        updated_by_user_id text references users(id) on delete set null,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      );

      create table if not exists page_versions (
        id text primary key,
        page_id text not null references pages(id) on delete cascade,
        version integer not null,
        snapshot_json jsonb not null,
        published_at timestamptz not null default now(),
        published_by_user_id text references users(id) on delete set null,
        unique (page_id, version)
      );

      -- ─── Data tables (unified content schema) ─────────────────────────────

      create table if not exists data_tables (
        id text primary key,
        name text not null,
        slug text not null,
        kind text not null default 'data',
        route_base text not null default '',
        singular_label text not null,
        plural_label text not null,
        primary_field_id text not null default 'title',
        fields_json jsonb not null default '[]'::jsonb,
        created_by_user_id text references users(id) on delete set null,
        updated_by_user_id text references users(id) on delete set null,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        deleted_at timestamptz,
        constraint data_tables_kind_check check (kind in ('postType', 'data'))
      );

      create unique index if not exists data_tables_slug_active_idx
        on data_tables (slug)
        where deleted_at is null;

      insert into data_tables (
        id, name, slug, kind, route_base, singular_label, plural_label,
        primary_field_id, fields_json
      )
      values (
        'posts',
        'Posts',
        'posts',
        'postType',
        '/posts',
        'Post',
        'Posts',
        'title',
        '[
          {"type":"text","id":"title","label":"Title","required":true,"builtIn":true},
          {"type":"text","id":"slug","label":"Slug","required":true,"builtIn":true},
          {"type":"richText","id":"body","label":"Body","format":"markdown","builtIn":true},
          {"type":"media","id":"featuredMedia","label":"Featured media","mediaKind":"image","builtIn":true},
          {"type":"text","id":"seoTitle","label":"SEO title","builtIn":true},
          {"type":"longText","id":"seoDescription","label":"SEO description","builtIn":true}
        ]'::jsonb
      )
      on conflict (id) do update
        set name = excluded.name,
            slug = excluded.slug,
            kind = excluded.kind,
            route_base = excluded.route_base,
            singular_label = excluded.singular_label,
            plural_label = excluded.plural_label,
            primary_field_id = excluded.primary_field_id,
            fields_json = excluded.fields_json,
            updated_at = current_timestamp,
            deleted_at = null;

      -- data_rows ↔ data_row_versions form a cycle (rows.active_version_id
      -- → versions.id, versions.row_id → rows.id). Create rows without the
      -- active-version FK first, then versions, then attach the FK via
      -- ALTER TABLE at the bottom of the baseline.
      create table if not exists data_rows (
        id text primary key,
        table_id text not null references data_tables(id) on delete restrict,
        cells_json jsonb not null default '{}'::jsonb,
        slug text not null default '',
        status text not null default 'draft',
        active_version_id text,
        author_user_id text references users(id) on delete set null,
        created_by_user_id text references users(id) on delete set null,
        updated_by_user_id text references users(id) on delete set null,
        published_by_user_id text references users(id) on delete set null,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        published_at timestamptz,
        deleted_at timestamptz,
        constraint data_rows_status_check check (status in ('draft', 'published', 'unpublished'))
      );

      create unique index if not exists data_rows_table_slug_active_idx
        on data_rows (table_id, slug)
        where deleted_at is null and slug <> '';

      create index if not exists data_rows_table_idx
        on data_rows (table_id, updated_at desc)
        where deleted_at is null;

      create table if not exists data_row_versions (
        id text primary key,
        row_id text not null references data_rows(id) on delete cascade,
        version_number integer not null,
        cells_json jsonb not null default '{}'::jsonb,
        slug text not null default '',
        published_by_user_id text references users(id) on delete set null,
        published_at timestamptz not null default now(),
        created_at timestamptz not null default now(),
        unique (row_id, version_number)
      );

      create index if not exists data_row_versions_row_latest_idx
        on data_row_versions (row_id, version_number desc);

      create table if not exists data_row_redirects (
        id text primary key,
        table_id text not null references data_tables(id) on delete cascade,
        from_route_base text not null,
        from_slug text not null,
        target_row_id text not null references data_rows(id) on delete cascade,
        created_at timestamptz not null default now()
      );

      create unique index if not exists data_row_redirects_source_idx
        on data_row_redirects (from_route_base, from_slug);

      create index if not exists data_row_redirects_target_idx
        on data_row_redirects (target_row_id, created_at desc);

      -- ─── Plugins ──────────────────────────────────────────────────────────

      create table if not exists installed_plugins (
        id text primary key,
        name text not null,
        version text not null,
        enabled boolean not null default true,
        granted_permissions_json jsonb not null default '[]'::jsonb,
        manifest_json jsonb not null,
        lifecycle_status text not null default 'installed',
        last_error text,
        settings_json jsonb not null default '{}'::jsonb,
        installed_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      );

      create index if not exists installed_plugins_enabled_idx
        on installed_plugins (enabled, installed_at desc);

      create table if not exists plugin_records (
        id text primary key,
        plugin_id text not null references installed_plugins(id) on delete cascade,
        resource_id text not null,
        data_json jsonb not null,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      );

      create index if not exists plugin_records_resource_idx
        on plugin_records (plugin_id, resource_id, created_at desc);

      create table if not exists plugin_crash_events (
        id text primary key,
        plugin_id text not null,
        occurred_at timestamptz not null default now(),
        reason text not null,
        stack text
      );

      create index if not exists plugin_crash_events_plugin_idx
        on plugin_crash_events (plugin_id, occurred_at desc);

      -- ─── Media ────────────────────────────────────────────────────────────
      --
      -- Media inspector metadata (alt/caption/title/tags/dominant_color/
      -- deleted/replaced), responsive pipeline outputs (blur_hash, variants,
      -- poster), and intrinsic dimensions (width/height/duration_ms) are
      -- inline. Folders are many-to-many (HappyFiles-style). Smart folders
      -- run a TypeBox-validated query at list time. Usage refs are a reverse
      -- index populated by the publish pipeline.

      create table if not exists media_assets (
        id text primary key,
        filename text not null,
        mime_type text not null,
        size_bytes bigint not null,
        storage_path text not null,
        public_path text not null unique,
        uploaded_by_user_id text references users(id) on delete set null,
        alt_text text not null default '',
        caption text not null default '',
        title text not null default '',
        tags_json jsonb not null default '[]'::jsonb,
        width integer,
        height integer,
        duration_ms integer,
        dominant_color text,
        blur_hash text,
        variants_json jsonb not null default '[]'::jsonb,
        poster_path text,
        deleted_at timestamptz,
        replaced_at timestamptz,
        created_at timestamptz not null default now()
      );

      create index if not exists media_assets_deleted_idx
        on media_assets (deleted_at);

      create table if not exists media_folders (
        id text primary key,
        parent_id text references media_folders(id) on delete cascade,
        name text not null,
        slug text not null,
        sort_order integer not null default 0,
        created_by_user_id text references users(id) on delete set null,
        created_at timestamptz not null default now()
      );

      create unique index if not exists media_folders_parent_slug_idx
        on media_folders (coalesce(parent_id, ''), slug);

      create table if not exists media_asset_folders (
        asset_id text not null references media_assets(id) on delete cascade,
        folder_id text not null references media_folders(id) on delete cascade,
        primary key (asset_id, folder_id)
      );

      create index if not exists media_asset_folders_folder_idx
        on media_asset_folders (folder_id);

      create table if not exists media_smart_folders (
        id text primary key,
        name text not null,
        query_json jsonb not null,
        created_by_user_id text references users(id) on delete set null,
        created_at timestamptz not null default now()
      );

      create table if not exists media_usage_refs (
        asset_id text not null references media_assets(id) on delete cascade,
        ref_kind text not null,
        ref_id text not null,
        ref_path text not null default '',
        computed_at timestamptz not null default now(),
        primary key (asset_id, ref_kind, ref_id, ref_path)
      );

      create index if not exists media_usage_refs_asset_idx
        on media_usage_refs (asset_id);

      create table if not exists published_runtime_assets (
        id text primary key,
        page_version_id text not null references page_versions(id) on delete cascade,
        asset_path text not null,
        public_path text not null unique,
        content_type text not null,
        content_bytes bytea not null,
        created_at timestamptz not null default now()
      );

      create index if not exists published_runtime_assets_page_version_idx
        on published_runtime_assets (page_version_id);

      -- ─── Cross-FK fixups ──────────────────────────────────────────────────

      -- users.avatar_media_id → media_assets. Added now that media_assets
      -- exists (users itself had to exist first because most other tables
      -- FK it).
      alter table users
        add column if not exists avatar_media_id text references media_assets(id) on delete set null;

      -- data_rows.active_version_id → data_row_versions. The DO block guards
      -- against re-applying the constraint when the migration is replayed.
      do $$ begin
        if not exists (
          select 1 from pg_constraint where conname = 'data_rows_active_version_fk'
        ) then
          alter table data_rows
            add constraint data_rows_active_version_fk
            foreign key (active_version_id) references data_row_versions(id) on delete set null;
        end if;
      end $$;
    `,
  },
]
