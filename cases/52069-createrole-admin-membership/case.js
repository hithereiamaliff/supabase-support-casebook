// Discussion #52069: since Postgres 16, a non-superuser that creates a role is made an
// admin of it automatically. Can postgres revoke that membership, as one reply claims?

const membership = `
select r.rolname as role, m.rolname as member, g.rolname as grantor,
       am.admin_option, am.inherit_option, am.set_option
from pg_auth_members am
join pg_roles r on r.oid = am.roleid
join pg_roles m on m.oid = am.member
join pg_roles g on g.oid = am.grantor
where r.rolname = 'trucking_importer_owner'
order by member`;

const automaticRow = {
  role: "trucking_importer_owner",
  member: "postgres",
  grantor: "supabase_admin",
  admin_option: true,
  inherit_option: false,
  set_option: false,
};

export default {
  title: "Postgres 16+ makes the role's creator its admin, and postgres can't revoke it",
  link: "https://github.com/supabase/supabase/discussions/52069",
  steps: [
    {
      title: "postgres creates a NOLOGIN owner role, as the migration does",
      as: "postgres",
      sql: "create role trucking_importer_owner nologin;",
      expect: { ok: true },
    },
    {
      title: "Postgres has added a membership by itself, granted by the superuser",
      as: "postgres",
      sql: membership,
      expect: { rows: [automaticRow] },
    },
    {
      title: "One reply says postgres can revoke it",
      as: "postgres",
      sql: "revoke trucking_importer_owner from postgres;",
      expect: { ok: true, notice: /has not been granted membership/ },
    },
    {
      title: "...and the admin option along with it",
      as: "postgres",
      sql: "revoke admin option for trucking_importer_owner from postgres;",
      expect: { ok: true, notice: /has not been granted membership/ },
    },
    {
      title: "Neither did anything: the membership is unchanged",
      as: "postgres",
      sql: membership,
      expect: { rows: [automaticRow] },
    },
    {
      title: "What it allows: managing the role, but not acting as it",
      as: "postgres",
      sql: `select pg_has_role('postgres', 'trucking_importer_owner', 'USAGE') as uses_its_privileges,
                   pg_has_role('postgres', 'trucking_importer_owner', 'SET') as can_set_role_to_it,
                   pg_has_role('postgres', 'trucking_importer_owner', 'MEMBER WITH ADMIN OPTION') as can_manage_its_members`,
      expect: { rows: [{ uses_its_privileges: false, can_set_role_to_it: false, can_manage_its_members: true }] },
    },
    {
      title: "Trying to act as the role confirms it",
      as: "postgres",
      sql: "set role trucking_importer_owner;",
      expect: { error: /permission denied to set role/ },
    },
    {
      title: "A guard that allows exactly this automatic row, and nothing else",
      as: "postgres",
      sql: `
select r.rolname as role, m.rolname as member, g.rolname as grantor,
       am.admin_option, am.inherit_option, am.set_option
from pg_auth_members am
join pg_roles r on r.oid = am.roleid
join pg_roles m on m.oid = am.member
join pg_roles g on g.oid = am.grantor
where r.rolname = 'trucking_importer_owner'
  and not (m.rolname = 'postgres' and g.rolname = 'supabase_admin'
           and am.admin_option and not am.inherit_option and not am.set_option)`,
      expect: { rows: [] },
    },
    {
      title: "The guard still catches a real membership",
      as: "postgres",
      sql: `
create role importer_api_role nologin;
grant trucking_importer_owner to importer_api_role with inherit true;
select r.rolname as role, m.rolname as member, g.rolname as grantor,
       am.admin_option, am.inherit_option, am.set_option
from pg_auth_members am
join pg_roles r on r.oid = am.roleid
join pg_roles m on m.oid = am.member
join pg_roles g on g.oid = am.grantor
where r.rolname = 'trucking_importer_owner'
  and not (m.rolname = 'postgres' and g.rolname = 'supabase_admin'
           and am.admin_option and not am.inherit_option and not am.set_option)`,
      expect: {
        rows: [
          {
            role: "trucking_importer_owner",
            member: "importer_api_role",
            grantor: "postgres",
            admin_option: false,
            inherit_option: true,
            set_option: true,
          },
        ],
      },
    },
  ],
};
