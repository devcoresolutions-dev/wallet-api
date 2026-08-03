import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { pool } from '../config/database';

async function ensureMigrationsTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      filename TEXT PRIMARY KEY,
      run_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function hasRun(filename: string): Promise<boolean> {
  const result = await pool.query(
    'SELECT 1 FROM _migrations WHERE filename = $1',
    [filename]
  );
  return (result.rowCount ?? 0) > 0;
}

async function markAsRun(filename: string) {
  await pool.query('INSERT INTO _migrations (filename) VALUES ($1)', [filename]);
}

async function runSqlFiles(folder: string, trackHistory: boolean) {
  const dir = join(__dirname, folder);
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    if (trackHistory && (await hasRun(file))) {
      console.log(`⏭  ${folder}/${file} (already run)`);
      continue;
    }

    console.log(`Running ${folder}/${file}...`);
    const sql = readFileSync(join(dir, file), 'utf-8');
    await pool.query(sql);
    if (trackHistory) await markAsRun(file);
    console.log(`✔ ${file} done`);
  }
}

async function main() {
  await ensureMigrationsTable();
  await runSqlFiles('migrations', true);
  await runSqlFiles('seeds', false); // seeds sí pueden repetirse (usan ON CONFLICT)
  console.log('All done!');
  await pool.end();
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});