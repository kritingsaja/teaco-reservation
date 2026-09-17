import { readFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { EVENT, ZONES, days, localMode } from './config.js';

let initialized;
export async function getDb() {
  if (!initialized) initialized = createDb().catch(error=>{initialized=undefined;throw error;});
  return initialized;
}
async function createDb() {
  let db;
  if(process.env.DATABASE_URL) {
    const { default: pg } = await import('pg');
    const pool = new pg.Pool({connectionString:process.env.DATABASE_URL,max:3,connectionTimeoutMillis:10000,idleTimeoutMillis:10000});
    const query = async (sql,params=[]) => (await pool.query(sql,params)).rows;
    db={kind:'postgres',query,transaction:async fn=>{
      const client=await pool.connect();
      try {await client.query('BEGIN');const tx={kind:'postgres',query:async(sql,params=[]) => (await client.query(sql,params)).rows};const value=await fn(tx);await client.query('COMMIT');return value;}
      catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
    }};
  } else {
    if(!localMode()) throw Object.assign(new Error('Database production belum terhubung.'),{status:503,code:'DATABASE_NOT_CONFIGURED'});
    const {DatabaseSync}=await import('node:sqlite');
    const file=process.env.SQLITE_PATH||resolve('.data/teaco.sqlite');
    if(file!==':memory:') mkdirSync(resolve(file,'..'),{recursive:true});
    const sqlite=new DatabaseSync(file);
    sqlite.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
    const rawQuery = async (sql,params=[])=>{
      const ordered=[];
      const converted=sql.replace(/\$(\d+)/g,(_,index)=>{ordered.push(params[Number(index)-1]);return '?';});
      const stmt=sqlite.prepare(converted);
      if(stmt.columns().length) return stmt.all(...ordered);
      stmt.run(...ordered);return [];
    };
    // Reads and writes share a queue: another request never observes an open transaction.
    let tail=Promise.resolve();
    const enqueue=fn=>{const pending=tail.then(fn);tail=pending.catch(()=>{});return pending;};
    db={kind:'sqlite',query:(sql,params)=>enqueue(()=>rawQuery(sql,params)),transaction:fn=>enqueue(async()=>{
      sqlite.exec('BEGIN IMMEDIATE');try{const result=await fn({kind:'sqlite',query:rawQuery});sqlite.exec('COMMIT');return result;}catch(error){sqlite.exec('ROLLBACK');throw error;}
    })};
  }
  const schema=readFileSync(new URL('./schema.sql',import.meta.url),'utf8');
  await db.transaction(async tx=>{
    if(tx.kind==='postgres') await tx.query('SELECT pg_advisory_xact_lock(742013)');
    for(const statement of schema.split(';').map(x=>x.trim()).filter(Boolean)) await tx.query(statement);
    await tx.query('INSERT INTO events VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT(id) DO NOTHING',Object.values(EVENT));
    for(const day of days()) await tx.query('INSERT INTO event_days VALUES ($1,$2) ON CONFLICT(visit_date) DO NOTHING',[day,EVENT.id]);
    for(const [i,zone] of ZONES.entries()) {
      await tx.query('INSERT INTO zones VALUES ($1,$2,$3,$4,$5) ON CONFLICT(id) DO NOTHING',[zone.id,EVENT.id,zone.name,zone.capacity,i]);
      for(const [j,[id,name,capacity]] of zone.units.entries()) await tx.query('INSERT INTO seating_units VALUES ($1,$2,$3,$4,$5) ON CONFLICT(id) DO NOTHING',[id,zone.id,name,capacity,j]);
    }
  });
  return db;
}
export async function lockDay(tx,date) {
  const rows=await tx.query(`SELECT visit_date FROM event_days WHERE visit_date=$1${tx.kind==='postgres'?' FOR UPDATE':''}`,[date]);
  if(!rows.length) throw Object.assign(new Error('Tanggal di luar periode reservasi.'),{status:400});
}
export async function expire(tx,date) {
  await tx.query("UPDATE reservations SET status='EXPIRED' WHERE status IN ('HOLD','PENDING_PAYMENT','PENDING_VERIFICATION') AND expires_at < $1"+(date?' AND visit_date=$2':''),[new Date().toISOString(),...(date?[date]:[])]);
}
