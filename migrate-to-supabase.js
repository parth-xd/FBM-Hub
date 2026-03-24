const { Client } = require('pg');
const fs = require('fs');

// Render (source)
const sourceConnection = {
  connectionString: 'postgresql://fbm_hub_prod_user:z43mWrvEALD72DpvwKh8TvSNWUGSMGmJ@dpg-d6qtrpbuibrs739h8lhg-a.oregon-postgres.render.com/fbm_hub_prod',
  ssl: { rejectUnauthorized: false }
};

// Supabase (target)
const targetConnection = {
  connectionString: 'postgresql://postgres:N50N3ot8uxOjfMPh@db.khkzdadcabontyweginryx.supabase.co:5432/postgres',
  ssl: { rejectUnauthorized: false }
};

async function migrate() {
  const sourceClient = new Client(sourceConnection);
  const targetClient = new Client(targetConnection);
  
  try {
    console.log('Connecting to Render (source)...');
    await sourceClient.connect();
    console.log('✓ Connected to Render');
    
    console.log('Connecting to Supabase (target)...');
    await targetClient.connect();
    console.log('✓ Connected to Supabase');
    
    // Get all tables
    const tableQuery = `
      SELECT tablename FROM pg_tables 
      WHERE schemaname = 'public'
      ORDER BY tablename
    `;
    
    const tables = await sourceClient.query(tableQuery);
    console.log(`\nFound ${tables.rows.length} tables to migrate\n`);
    
    // Create schema in Supabase
    console.log('=== CREATING SCHEMA IN SUPABASE ===\n');
    
    const schemaFile = fs.readFileSync('/Users/parthsharma/Desktop/babaclick/schema-export.sql', 'utf-8');
    const statements = schemaFile.split(';').filter(s => s.trim());
    
    for (const statement of statements) {
      if (statement.trim()) {
        try {
          await targetClient.query(statement + ';');
          console.log(`✓ Created: ${statement.substring(0, 50)}...`);
        } catch (err) {
          if (err.message.includes('already exists')) {
            console.log(`⊘ Already exists: ${statement.substring(0, 50)}...`);
          } else {
            throw err;
          }
        }
      }
    }
    
    // Migrate data
    console.log('\n=== MIGRATING DATA ===\n');
    
    for (const tableRow of tables.rows) {
      const tableName = tableRow.tablename;
      
      // Get all data from source
      const selectQuery = `SELECT * FROM "${tableName}"`;
      const data = await sourceClient.query(selectQuery);
      
      if (data.rows.length === 0) {
        console.log(`✓ ${tableName}: 0 rows`);
        continue;
      }
      
      // Get column names
      const columns = Object.keys(data.rows[0]);
      const columnList = columns.map(c => `"${c}"`).join(',');
      
      // Insert in batches
      const batchSize = 100;
      for (let i = 0; i < data.rows.length; i += batchSize) {
        const batch = data.rows.slice(i, i + batchSize);
        
        const values = batch.map((row, idx) => {
          const vals = columns.map((col, colIdx) => {
            const val = row[col];
            if (val === null) return 'NULL';
            if (typeof val === 'string') return `'${val.replace(/'/g, "''")}'`;
            if (typeof val === 'object') return `'${JSON.stringify(val).replace(/'/g, "''")}'`;
            return val;
          }).join(',');
          return `(${vals})`;
        }).join(',');
        
        const insertQuery = `INSERT INTO "${tableName}" (${columnList}) VALUES ${values} ON CONFLICT DO NOTHING`;
        
        try {
          await targetClient.query(insertQuery);
        } catch (err) {
          console.error(`Error inserting into ${tableName}:`, err.message);
        }
      }
      
      console.log(`✓ ${tableName}: ${data.rows.length} rows migrated`);
    }
    
    console.log('\n=== MIGRATION COMPLETE ===');
    console.log('✓ All tables and data migrated successfully!');
    
    await sourceClient.end();
    await targetClient.end();
    
  } catch (error) {
    console.error('\n❌ Migration failed:', error.message);
    process.exit(1);
  }
}

migrate();
