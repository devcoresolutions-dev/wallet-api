import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { pool } from '../config/database';

async function runSqlFiles(folder: string) {
  const dir = join(__dirname, folder);
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    console.log(`Running ${folder}/${file}...`);
    const sql = readFileSync(join(dir, file), 'utf-8');
    await pool.query(sql);
    console.log(`✔ ${file} done`);
  }
}

async function main() {
  await runSqlFiles('migrations');
  await runSqlFiles('seeds');
  console.log('All done!');
  await pool.end();
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});