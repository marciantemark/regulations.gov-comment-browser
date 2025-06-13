import initSqlJs from 'sql.js';
import { readFileSync } from 'fs';

async function testThemes() {
  const SQL = await initSqlJs();
  const dbData = readFileSync('../output/abstractions.db');
  const db = new SQL.Database(dbData);
  
  console.log('\n=== Theme Codes in Database ===');
  const result = db.exec(`
    SELECT code, description, level 
    FROM taxonomy_ref 
    ORDER BY code 
    LIMIT 20
  `);
  
  if (result[0]) {
    result[0].values.forEach(row => {
      console.log(`Code: ${row[0]}, Level: ${row[2]}, Description: ${row[1]}`);
    });
  }
  
  console.log('\n=== Checking specific theme "2.2" ===');
  const specific = db.exec(`
    SELECT * FROM taxonomy_ref WHERE code = '2.2'
  `);
  
  if (specific[0] && specific[0].values.length > 0) {
    console.log('Theme 2.2 found:', specific[0].values[0]);
  } else {
    console.log('Theme 2.2 NOT found in database');
  }
  
  console.log('\n=== Checking theme codes that start with "2." ===');
  const pattern = db.exec(`
    SELECT code FROM taxonomy_ref WHERE code LIKE '2.%' ORDER BY code
  `);
  
  if (pattern[0]) {
    console.log('Found themes:', pattern[0].values.map(r => r[0]).join(', '));
  }
  
  db.close();
}

testThemes().catch(console.error);
