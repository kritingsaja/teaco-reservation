import { randomBytes, randomUUID, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { localMode } from './config.js';

export const hash = value => createHash('sha256').update(value).digest('hex');
export function hashPassword(password) {
  const salt=randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(password,salt,64).toString('hex')}`;
}
export function passwordMatches(password,stored) {
  const [salt,key]=stored.split(':');
  const actual=scryptSync(password,salt,64),expected=Buffer.from(key,'hex');
  return expected.length===actual.length&&timingSafeEqual(actual,expected);
}
export async function createAdmin(tx,username,password) {
  if(!/^[a-zA-Z0-9._-]{3,40}$/.test(username)||password.length<10||password.length>128) throw Object.assign(new Error('Username 3–40 karakter; password minimal 10 karakter.'),{status:400});
  const id=randomUUID();
  await tx.query('INSERT INTO admin_users VALUES ($1,$2,$3,$4)',[id,username,hashPassword(password),new Date().toISOString()]);
  return {id,username};
}
export async function bootstrapAdmin(db) {
  if(!process.env.ADMIN_USERNAME||!process.env.ADMIN_PASSWORD) return;
  await db.transaction(async tx=>{
    if(!(await tx.query('SELECT id FROM admin_users LIMIT 1')).length) await createAdmin(tx,process.env.ADMIN_USERNAME,process.env.ADMIN_PASSWORD);
  });
}
export async function sessionAdmin(db,req) {
  const token=(req.headers.cookie||'').match(/(?:^|;\s*)teaco_session=([a-f0-9]{64})/)?.[1];
  if(!token) return null;
  return (await db.query('SELECT a.id,a.username FROM admin_sessions s JOIN admin_users a ON a.id=s.admin_id WHERE s.token_hash=$1 AND s.expires_at>$2',[hash(token),new Date().toISOString()]))[0]||null;
}
export async function issueSession(tx,admin,res) {
  const token=randomBytes(32).toString('hex');
  await tx.query('INSERT INTO admin_sessions VALUES ($1,$2,$3)',[hash(token),admin.id,new Date(Date.now()+8*3600000).toISOString()]);
  res.setHeader('Set-Cookie',`teaco_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${localMode()?'':'; Secure'}`);
}
export const fail = (message,status=400) => {throw Object.assign(new Error(message),{status});};
