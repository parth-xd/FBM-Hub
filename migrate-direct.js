const { Client } = require('pg');

// Old Render DB
const oldClient = new Client({
  host: 'dpg-d6qtrpbuibrs739h8lhg-a.oregon-postgres.render.com',
  port: 5432,
  user: 'fbm_hub_prod_user',
  password: 'z43mWrvEALD72DpvwKh8TvSNWUGSMGmJ',
  database: 'fbm_hub_prod',
  ssl: true,
  rejectUnauthorized: false
});

// New Supabase DB
const newClient = new Client({
  host: 'db.khkzdadcabontyweginryx.supabase.co',
  port: 5432,
  user: 'postgres',
  password: 'N50N3ot8uxOjfMPh',
  database: 'postgres',
  ssl: true
});

const tables = [
  'audit_logs',
  'fba_approvals',
  'fba_products',
  'fba_stb_counter',
  'import_tracking',
  'orders',
  'role_requests',
  'settings',
  'users'
];

async function migrate() {
  try {
    // Connect to both databases
    console.log('Connecting to old Render database...');
    await oldClient.connect();
    console.log('✅ Connected to Render');

    console.log('Connecting to new Supabase database...');
    await newClient.connect();
    console.log('✅ Connected to Supabase');

    // Disable foreign key checks temporarily
    await newClient.query('SET session_replication_role = REPLICA');
    console.log('✅ Disabled foreign key constraints');

    // Migrate each table
    for (const table of tables) {
      try {
        // Get all data from old DB
        const result = await oldClient.query(`SELECT * FROM public."${table}"`);
        const rows = result.rows;

        if (rows.length === 0) {
          console.log(`⏭️  ${table}: 0 rows (skipped)`);
          continue;
        }

        // Delete existing data in Supabase table
        await newClient.query(`DELETE FROM public."${table}"`);

        // Build insert query
        if (rows.length > 0) {
          const columns = Object.keys(rows[0]);
          const columnList = columns.map(c => `"${c}"`).join(', ');
          
          // Insert in batches of 100 rows
          const batchSize = 100;
          for (let i = 0; i < rows.length; i += batchSize) {
            const batch = rows.slice(i, i + batchSize);
            
            const placeholders = batch.map((_, idx) => {
              const colCount = columns.length;
              return '(' + Array.from({length: colCount}, (_, j) => `$${idx * colCount + j + 1}`).join(', ') + ')';
            }).join(', ');
            
            const values = [];
            batch.forEach(row => {
              columns.forEach(col => {
                values.push(row[col]);
              });
            });

            const query = `INSERT INTO public."${table}" (${columnList}) VALUES ${placeholders}`;
            await newClient.query(query, values);
          }
        }

        console.log(`✅ ${table}: ${rows.length} rows migrated`);
      } catch (err) {
        console.error(`❌ Error migrating ${table}:`, err.message);
      }
    }

    // Re-enable foreign key checks
    await newClient.query('SET session_replication_role = DEFAULT');
    console.log('✅ Re-enabled foreign key constraints');

    console.log('\n✅ Migration complete!');
  } catch (err) {
    console.error('❌ Migration failed:', err.message);
  } finally {
    await oldClient.end();
    await newClient.end();
  }
}

migrate();
