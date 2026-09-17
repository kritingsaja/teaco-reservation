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
  if(process.env.TURSO_DATABASE_URL||process.env.TURSO_AUTH_TOKEN) {
    if(!process.env.TURSO_DATABASE_URL)throw Object.assign(new Error('TURSO_DATABASE_URL belum diatur di server.'),{status:503,code:'TURSO_NOT_CONFIGURED'});
    const {createTursoDb}=await import('./turso.js');
    db=createTursoDb({url:process.env.TURSO_DATABASE_URL,authToken:process.env.TURSO_AUTH_TOKEN,allowLocal:localMode()});
  } else {
    if(!localMode()) throw Object.assign(new Error('Turso belum terhubung. Atur TURSO_DATABASE_URL dan TURSO_AUTH_TOKEN di server.'),{status:503,code:'TURSO_NOT_CONFIGURED'});
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
  const statements=schema.split(';').map(x=>x.trim()).filter(Boolean).map(sql=>({sql}));
  statements.push({sql:'INSERT INTO events VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT(id) DO NOTHING',params:Object.values(EVENT)});
  for(const day of days())statements.push({sql:'INSERT INTO event_days VALUES ($1,$2) ON CONFLICT(visit_date) DO NOTHING',params:[day,EVENT.id]});
  for(const [i,zone] of ZONES.entries()) {
    statements.push({sql:'INSERT INTO zones VALUES ($1,$2,$3,$4,$5) ON CONFLICT(id) DO NOTHING',params:[zone.id,EVENT.id,zone.name,zone.capacity,i]});
    for(const [j,[id,name,capacity]] of zone.units.entries())statements.push({sql:'INSERT INTO seating_units VALUES ($1,$2,$3,$4,$5) ON CONFLICT(id) DO NOTHING',params:[id,zone.id,name,capacity,j]});
  }
  try {
    if(db.initialize)await db.initialize(statements);
    else await db.transaction(async tx=>{for(const {sql,params=[]} of statements)await tx.query(sql,params);});
  }catch(error){db.close?.();throw error;}
  return db;
}
export async function lockDay(tx,date) {
  const rows=await tx.query('SELECT visit_date FROM event_days WHERE visit_date=$1',[date]);
  if(!rows.length) throw Object.assign(new Error('Tanggal di luar periode reservasi.'),{status:400});
}
export async function expire(tx,date) {
  await tx.query("UPDATE reservations SET status='EXPIRED' WHERE status IN ('HOLD','PENDING_PAYMENT','PENDING_VERIFICATION') AND expires_at < $1"+(date?' AND visit_date=$2':''),[new Date().toISOString(),...(date?[date]:[])]);
}
