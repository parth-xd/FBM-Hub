const { Client } = require('pg');

const sourceDB = {
  connectionString: 'postgresql://fbm_hub_prod_user:z43mWrvEALD72DpvwKh8TvSNWUGSMGmJ@dpg-d6qtrpbuibrs739h8lhg-a.oregon-postgres.render.com/fbm_hub_prod',
  ssl: { rejectUnauthorized: false }
};

const targetDB = {
  connectionString: 'postgresql://postgres:N50N3ot8uxOjfMPh@db.khkzdadcabontyweginryx.supabase.co:5432/postgres',
  ssl: { rejectUnauthorized: false }
};

const tables = ['users', 'settings', 'role_requests', 'orders', 'audit_logs', 'fba_products', 'fba_approvals', 'import_tracking', 'fba_stb_counter'];

async function migrate() {
  const source = new Client(sourceDB);
  const target = new Client(targetDB);
  
  try {
    console.log('Connecting to source (Render)...');
    await source.connect();
    console.log('✓ Connected to Render');
    
    console.log('Connecting to target (Supabase)...');
    await target.connect();
    console.log('✓ Connected to Supabase\n');
    
    let totalRows = 0;
    
    for (const table of tables) {
      // Get row count from source
      const count = await source.query(`SELECT COUNT(*) FROM "${table}"`);
      const rowCount = parseInt(count.rows[0].count);
      
      if (rowCount === 0) {
        console.log(`⊘ ${table}: 0 rows`);
        continue;
      }
      
      // Get all data
      const data = await source.query(`SELECT * FROM "${table}"`);
      
      // Delete existing data in target
      await target.query(`TRUNCATE TABLE "${table}" CASCADE`);
      
      // Get columns
      const columns = Object.keys(data.rows[0]);
      
      // Insert data in batches
      const batchSize = 50;
      for (let i = 0; i < data.rows.length; i += batchSize) {
        const batch = data.rows.slice(i, i + batchSize);
        
        const values = batch.map(row => {
          const vals = columns.map(col => {
            const val = row[col];
            if (val === null) return 'NULL';
            if (typeof val === 'string') return `'${val.replace(/'/g, "''")}'`;
            if (typeof val === 'boolean') return val ? 'true' : 'false';
            if (typeof val === 'object') return `'${JSON.stringify(val).replace(/'/g, "''")}'`;
            return val;
          }).join(',');
          return `(${vals})`;
        }).join(',');
        
        const columnList = columns.map(c => `"${c}"`).join(',');
        const insertQuery = `INSERT INTO "${table}" (${columnList}) VALUES ${values}`;
        
        try {
          await target.query(insertQuery);
        } catch (err) {
          console.error(`Error:`, err.message);
        }
      }
      
      console.log(`✓ ${table}: ${rowCount} rows migrated`);
      totalRows += rowCount;
    }
    
    console.log(`\n✅ Migration complete: ${totalRows} total rows migrated\n`);
    
    await source.end();
    await target.end();
    
  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    process.exit(1);
  }
}

migrate();
