const { Client } = require('pg');
const fs = require('fs');

const connectionString = 'postgresql://fbm_hub_prod_user:z43mWrvEALD72DpvwKh8TvSNWUGSMGmJ@dpg-d6qtrpbuibrs739h8lhg-a.oregon-postgres.render.com/fbm_hub_prod';

const client = new Client({ 
  connectionString,
  ssl: { rejectUnauthorized: false }
});

async function exportSchema() {
  try {
    await client.connect();
    console.log('Connected to database...');
    
    // Get all table definitions
    const query = `
      SELECT tablename FROM pg_tables 
      WHERE schemaname = 'public'
    `;
    
    const tables = await client.query(query);
    console.log(`Found ${tables.rows.length} tables`);
    
    let schema = '-- Schema backup from Render PostgreSQL\n\n';
    
    for (const table of tables.rows) {
      const tableName = table.tablename;
      console.log(`Exporting ${tableName}...`);
      
      // Get CREATE TABLE statement
      const createTableQuery = `
        SELECT pg_get_ddl('pg_class'::regclass, oid) 
        FROM pg_class 
        WHERE relname = $1 AND relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
      `;
      
      try {
        const createTableResult = await client.query(createTableQuery, [tableName]);
        if (createTableResult.rows[0]) {
          schema += createTableResult.rows[0]['pg_get_ddl'] + ';\n\n';
        }
      } catch (e) {
        // Fallback: get from information schema
        const altQuery = `
          SELECT 'CREATE TABLE ' || table_name || ' (' || 
          string_agg(
            column_name || ' ' || udt_name || 
            CASE WHEN is_nullable = 'NO' THEN ' NOT NULL' ELSE '' END,
            ', '
          ) || ');'
          FROM information_schema.columns
          WHERE table_name = $1
          GROUP BY table_name
        `;
        
        const altResult = await client.query(altQuery, [tableName]);
        if (altResult.rows[0]) {
          schema += altResult.rows[0]['?column?'] + '\n\n';
        }
      }
    }
    
    // Save to file
    fs.writeFileSync('/Users/parthsharma/Desktop/babaclick/schema-export.sql', schema);
    console.log('\nSchema exported to schema-export.sql');
    
    await client.end();
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

exportSchema();
