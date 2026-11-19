import { describe, expect, it } from 'vitest';
import { postgresPoolOptions } from '../../server/lib/db/pool.js';

describe('postgresPoolOptions', () => {
  it('relaxes TLS for sslmode=require so hosted Postgres works', () => {
    const options = postgresPoolOptions('postgresql://u:p@db.example.supabase.co:5432/postgres?sslmode=require');

    expect(options.ssl).toEqual({ rejectUnauthorized: false });
    expect(options.connectionString).not.toContain('sslmode');
    expect(options.connectionString).toContain('db.example.supabase.co');
  });

  it('relaxes TLS when no sslmode is given', () => {
    const options = postgresPoolOptions('postgresql://u:p@db.example.supabase.co:5432/postgres');

    expect(options.ssl).toEqual({ rejectUnauthorized: false });
    expect(options.connectionString).not.toContain('sslmode=');
  });

  it('keeps strict TLS modes untouched', () => {
    const url = 'postgresql://u:p@db.example.supabase.co:5432/postgres?sslmode=verify-full';

    const options = postgresPoolOptions(url);

    expect(options.ssl).toBeUndefined();
    expect(options.connectionString).toBe(url);
  });

  it('keeps sslmode=disable untouched', () => {
    const url = 'postgresql://u:p@db.example.supabase.co:5432/postgres?sslmode=disable';

    const options = postgresPoolOptions(url);

    expect(options.ssl).toBeUndefined();
    expect(options.connectionString).toBe(url);
  });

  it('passes through a malformed connection string untouched', () => {
    const options = postgresPoolOptions('not-a-url');

    expect(options).toEqual({ connectionString: 'not-a-url' });
  });
});
