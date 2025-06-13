import initSqlJs from 'sql.js';
import { readFileSync } from 'fs';

async function testThemeQuery() {
  const SQL = await initSqlJs();
  const dbData = readFileSync('../output/abstractions.db');
  const db = new SQL.Database(dbData);
  
  console.log('\n=== Testing theme query ===');
  
  // Test direct query without parameter
  console.log('\n1. Direct query for theme 2:');
  const direct = db.exec(`
    SELECT 
      t.code,
      t.description,
      t.level,
      t.parent_code
    FROM taxonomy_ref t
    WHERE t.code = '2'
  `);
  console.log('Direct result:', direct);
  
  // Test parameterized query (how it's used in the app)
  console.log('\n2. Parameterized query for theme 2:');
  try {
    const parameterized = db.exec(`
      SELECT 
        t.code,
        t.description,
        t.level,
        t.parent_code
      FROM taxonomy_ref t
      WHERE t.code = ?
    `, ['2']);
    console.log('Parameterized result:', parameterized);
  } catch (e) {
    console.error('Parameterized query error:', e);
  }
  
  // Test with explicit parameter binding
  console.log('\n3. Testing prepared statement:');
  try {
    const stmt = db.prepare(`
      SELECT 
        t.code,
        t.description,
        t.level,
        t.parent_code
      FROM taxonomy_ref t
      WHERE t.code = ?
    `);
    const result = stmt.bind(['2']);
    console.log('Prepared statement bound successfully');
    while (stmt.step()) {
      console.log('Row:', stmt.getAsObject());
    }
    stmt.free();
  } catch (e) {
    console.error('Prepared statement error:', e);
  }
  
  db.close();
}

testThemeQuery().catch(console.error);
