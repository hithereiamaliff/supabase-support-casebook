// Discussion #52113: "REVOKE ALL ON public.spatial_ref_sys FROM anon, authenticated"
// run as postgres, and anon can still delete. Why, and what actually works?

const grants = `
select a.grantee::regrole::text as grantee, a.grantor::regrole::text as grantor,
       string_agg(a.privilege_type, ', ' order by a.privilege_type) as privileges
from pg_class c, aclexplode(c.relacl) a
where c.oid = 'public.spatial_ref_sys'::regclass
  and a.grantee::regrole::text in ('anon', 'authenticated')
group by 1, 2
order by 1`;

const allPrivileges = "DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE";

export default {
  title: "REVOKE as postgres does nothing on a table supabase_admin owns",
  link: "https://github.com/supabase/supabase/discussions/52113",
  setup: [
    {
      // Installing PostGIS into public creates spatial_ref_sys as supabase_admin.
      // This plain table stands in for it: same name, columns and owner.
      as: "supabase_admin",
      sql: `
create table public.spatial_ref_sys (
  srid integer primary key,
  auth_name varchar(256),
  auth_srid integer,
  srtext varchar(2048),
  proj4text varchar(2048)
);`,
    },
  ],
  steps: [
    {
      title: "Supabase's default privileges gave anon and authenticated full access",
      as: "postgres",
      sql: grants,
      expect: {
        rows: [
          { grantee: "anon", grantor: "supabase_admin", privileges: allPrivileges },
          { grantee: "authenticated", grantor: "supabase_admin", privileges: allPrivileges },
        ],
      },
    },
    {
      title: "REVOKE as postgres, as in the SQL editor: it \"succeeds\", with warnings",
      as: "postgres",
      sql: "revoke all on table public.spatial_ref_sys from anon, authenticated;",
      expect: { ok: true, notice: /no privileges could be revoked for "spatial_ref_sys"/ },
    },
    {
      title: "anon can still delete",
      as: "postgres",
      sql: "select has_table_privilege('anon', 'public.spatial_ref_sys', 'DELETE') as anon_can_delete;",
      expect: { rows: [{ anon_can_delete: true }] },
    },
    {
      title: "Only the grantor can take its grants back",
      as: "supabase_admin",
      sql: `
revoke all on table public.spatial_ref_sys from anon, authenticated;
select has_table_privilege('anon', 'public.spatial_ref_sys', 'DELETE') as anon_can_delete;`,
      expect: { rows: [{ anon_can_delete: false }] },
    },
  ],
};
