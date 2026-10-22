-- PeakPic: check after deleting an account that nothing of it is left.
--
-- Replace the uuid in the first line (the old user id, e.g. noted from the dashboard before
-- deleting) and run the whole query in the Supabase SQL editor. Read-only.
--
-- It searches EVERY column of type uuid / uuid[] in the schemas public, auth and storage for
-- the id, and every text / jsonb column for the id as text (storage paths, mention lists).
--
-- Expected hits (pseudonymous logs, documented in docs/moderation.md):
--   public.moderation_actions.target_user_id / target_id   (uuid only, texts redacted)
--   public.reports.target_user_id                           (uuid only)
--   public.report_snapshots.sender_id                       (uuid only)
--   auth.audit_log_entries.payload                          (Supabase's own auth log, see moderation.md)
-- Everything else must return 0 rows. account_deletions holds only a hash, compare with:
--   select * from public.account_deletions
--   where user_hash = encode(sha256(convert_to('00000000-0000-0000-0000-000000000000', 'UTF8')), 'hex');

with target as (
  select '00000000-0000-0000-0000-000000000000'::uuid as id
),
cols as (
  select c.table_schema, c.table_name, c.column_name, c.data_type, c.udt_name
  from information_schema.columns c
  join information_schema.tables t
    on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
  where c.table_schema in ('public', 'auth', 'storage')
    and (c.udt_name in ('uuid', '_uuid', 'text', 'varchar', 'jsonb', 'json'))
),
hits as (
  select
    cols.table_schema, cols.table_name, cols.column_name,
    (xpath('/row/n/text()', query_to_xml(format(
      'select count(*) as n from %I.%I where %s',
      cols.table_schema, cols.table_name,
      case
        when cols.udt_name = 'uuid' then format('%I = %L::uuid', cols.column_name, target.id)
        when cols.udt_name = '_uuid' then format('%L::uuid = any (%I)', target.id, cols.column_name)
        else format('%I::text like %L', cols.column_name, '%' || target.id::text || '%')
      end
    ), false, true, '')))[1]::text::bigint as n
  from cols, target
)
select table_schema, table_name, column_name, n
from hits
where n > 0
order by table_schema, table_name, column_name;
