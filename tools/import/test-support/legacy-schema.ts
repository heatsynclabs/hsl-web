import type { Client } from '../pg.ts'

/**
 * The six legacy tables the import reads, and only the columns it reads.
 * Column names and types come from db/schema.rb in
 * heatsynclabs/Open-Source-Access-Control-Web-Interface at version
 * 20141120200638. There are no foreign key constraints here because the
 * production database has none anywhere, and the import has to behave the same
 * way against rows that point at nothing.
 */
const LEGACY_DDL = `
  create table users (
    id integer primary key,
    name character varying(255),
    email character varying(255) not null default '',
    encrypted_password character varying(255) not null default '',
    phone character varying(255),
    postal_code character varying(255),
    emergency_name character varying(255),
    emergency_phone character varying(255),
    emergency_email character varying(255),
    member_level integer,
    waiver timestamp without time zone,
    orientation timestamp without time zone,
    oriented_by_id integer,
    hidden boolean,
    email_visible boolean,
    phone_visible boolean,
    current_skills text,
    desired_skills text,
    payment_method character varying(255),
    payee character varying(255),
    admin boolean,
    instructor boolean,
    accountant boolean,
    created_at timestamp without time zone not null,
    updated_at timestamp without time zone not null
  );

  create table cards (
    id integer primary key,
    card_number character varying(255),
    card_permissions integer,
    user_id integer,
    name character varying(255),
    created_at timestamp without time zone not null,
    updated_at timestamp without time zone not null
  );

  create table certifications (
    id integer primary key,
    name character varying(255),
    description character varying(255),
    slug character varying(255),
    created_at timestamp without time zone not null,
    updated_at timestamp without time zone not null
  );

  create table user_certifications (
    id integer primary key,
    user_id integer,
    certification_id integer,
    created_by integer,
    updated_by integer,
    created_at timestamp without time zone not null,
    updated_at timestamp without time zone not null
  );

  create table payments (
    id integer primary key,
    user_id integer,
    date date,
    amount numeric,
    created_by integer,
    created_at timestamp without time zone not null,
    updated_at timestamp without time zone not null
  );

  create table contracts (
    id integer primary key,
    user_id integer,
    first_name character varying(255),
    last_name character varying(255),
    signed_at timestamp without time zone,
    document_file_name character varying(255),
    cosigner character varying(255),
    created_by_id integer,
    created_at timestamp without time zone not null,
    updated_at timestamp without time zone not null
  );
`

export async function rebuildLegacySchema(legacy: Client): Promise<void> {
  await legacy.query('drop schema if exists public cascade')
  await legacy.query('create schema public')
  await legacy.query(LEGACY_DDL)
}
