import {randomBytes,randomInt,randomUUID} from 'node:crypto';
import {getDb,lockDay,expire} from './db.js';
import {EVENT,ZONES,SECTION_RULES,ACTIVE_STATUSES,BOOKED_STATUSES,days,localMode} from './config.js';
import {hash,hashPassword,passwordMatches,bootstrapAdmin,sessionAdmin,createAdmin,issueSession,fail} from './auth.js';

const now=()=>new Date().toISOString();
const dummyPasswordHash=hashPassword(randomBytes(32).toString('hex'));
const activeSql=ACTIVE_STATUSES.map(status=>`'${status}'`).join(',');
const clean=(value,max=200)=>typeof value==='string'?value.trim().slice(0,max):'';
const phone=value=>clean(value,30).replace(/[^0-9]/g,'').replace(/^0/,'62');
const email=value=>clean(value,254).toLowerCase();
const send=(res,status,data)=>{res.statusCode=status;res.setHeader('Content-Type','application/json; charset=utf-8');res.end(JSON.stringify(data));};
async function body(req) {
  if(req.body&&typeof req.body==='object'&&!Buffer.isBuffer(req.body)) return req.body;
  let raw=typeof req.body==='string'?req.body:'';
  if(!raw) for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>3000000)fail('Ukuran unggahan terlalu besar.',413);}
  try{return raw?JSON.parse(raw):{};}catch{fail('Data permintaan tidak valid.');}
}
function checkOrigin(req) {
  if(!req.headers.origin) fail('Permintaan harus berasal dari aplikasi TEACO.',403);
  const expected=req.headers['x-forwarded-host']||req.headers.host;
  if(new URL(req.headers.origin).host!==expected) fail('Origin tidak diizinkan.',403);
}
async function owns(tx,id,req) {
  const token=req.headers['x-booking-token'];
  if(typeof token!=='string'||!/^[a-f0-9]{64}$/.test(token))fail('Akses reservasi tidak valid.',403);
  const r=(await tx.query('SELECT * FROM reservations WHERE id=$1 AND token_hash=$2',[id,hash(token)]))[0];
  if(!r)fail('Reservasi tidak ditemukan.',404);
  return r;
}
async function seatsFor(db,id) {
  return db.query('SELECT s.unit_id,s.guest_count,u.name,z.name AS zone FROM reservation_seats s JOIN seating_units u ON u.id=s.unit_id JOIN zones z ON z.id=u.zone_id WHERE s.reservation_id=$1 ORDER BY z.sort_order,u.sort_order',[id]);
}
function publicReservation(r) {
  const {id,code,visit_date,guest_count,customer_name,phone,note,status,deposit_amount,unique_code,expires_at}=r;
  return {id,code,visit_date,guest_count,customer_name,phone,note,status,deposit_amount,unique_code,expires_at,total_transfer:deposit_amount+unique_code};
}
async function paymentSettings(db) {
  const rows=await db.query("SELECT key,value FROM settings WHERE key IN ('bank_name','account_number','account_holder')");
  const settings=Object.fromEntries(rows.map(row=>[row.key,row.value]));
  return {...settings,configured:!!(settings.bank_name&&settings.account_number&&settings.account_holder)};
}
async function posSettings(db) {
  const rows=await db.query("SELECT key,value FROM settings WHERE key IN ('pos_menu_key','pos_orders_key')");
  const saved=Object.fromEntries(rows.map(row=>[row.key,row.value]));
  const base=clean(process.env.POS_BASE_URL||'https://pos.teacoxplus.cloud',1000).replace(/\/+$/,'');
  let origin;try{origin=new URL(base).origin;}catch{fail('Alamat layanan POS belum valid.',503);}
  if(!localMode()&&new URL(origin).protocol!=='https:')fail('Layanan POS harus menggunakan HTTPS.',503);
  const menu_key=saved.pos_menu_key||process.env.POS_MENU_API_KEY||process.env.POS_API_TOKEN||'';
  const orders_key=saved.pos_orders_key||process.env.POS_ORDERS_API_KEY||process.env.POS_API_TOKEN||'';
  return {menu_url:origin+'/api/v1/menu',draft_url:origin+'/api/v1/orders',menu_key,orders_key,menuConfigured:!!menu_key,draftConfigured:!!orders_key};
}
const publicPos=pos=>({provider:'POS Kasir',menuConfigured:pos.menuConfigured,draftConfigured:pos.draftConfigured});
const resetRecipient=()=>email(process.env.ADMIN_RESET_EMAIL||'');
const resetIsConfigured=()=>!!(resetRecipient()&&process.env.RESEND_API_KEY&&process.env.RESET_FROM_EMAIL);
const htmlEscape=value=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
async function sendPasswordReset(recipient,token,origin) {
  const link=`${origin}/#/reset-password?token=${token}`;
  const response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${process.env.RESEND_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({from:process.env.RESET_FROM_EMAIL,to:[recipient],subject:'Reset password admin TEACO',html:`<div style="font-family:Arial,sans-serif;line-height:1.6"><h2>Reset password admin TEACO</h2><p>Kami menerima permintaan untuk membuat password baru.</p><p><a href="${htmlEscape(link)}" style="display:inline-block;padding:12px 18px;background:#a95e43;color:#fff;text-decoration:none;border-radius:8px">Buat password baru</a></p><p>Tautan ini berlaku 15 menit dan hanya dapat digunakan sekali. Jika bukan Anda yang meminta, abaikan email ini.</p></div>`})});
  if(!response.ok)throw new Error('Layanan email belum dapat mengirim tautan reset.');
}
async function unitsFor(db,date,exclude='',guests=0) {
  const usage=await db.query(`SELECT s.unit_id,u.zone_id,SUM(s.guest_count) AS guests
    FROM reservation_seats s JOIN reservations r ON r.id=s.reservation_id JOIN seating_units u ON u.id=s.unit_id
    WHERE r.visit_date=$1 AND r.id<>$2 AND r.status IN (${activeSql}) GROUP BY s.unit_id,u.zone_id`,[date,exclude]);
  return sectionAvailability(usage,guests);
}
function sectionAvailability(usage,guests=0) {
  return ZONES.flatMap((zone,zone_order)=>{
    const ids=new Set(zone.units.map(u=>u[0]));
    // Preserve historical table allocations. Unknown old indoor positions reserve
    // space conservatively in every section until they expire; never relocate a guest.
    const legacy=usage.filter(u=>u.zone_id===zone.id&&!ids.has(u.unit_id)).reduce((s,u)=>s+Number(u.guests),0);
    return zone.units.map(([id,name,maxCapacity])=>{
      const occupied=Number(usage.find(u=>u.unit_id===id)?.guests||0)+legacy;
      const rule=SECTION_RULES[id],normal=rule?.normal??maxCapacity;
      const exclusive=!!rule&&occupied===0&&guests>normal&&guests<=rule.max;
      const capacity=exclusive?rule.max:normal;
      return {id,name,capacity,normal_capacity:normal,max_capacity:maxCapacity,exclusive,
        zone_id:zone.id,zone_name:zone.name,zone_order,occupied,
        normal_remaining:Math.max(0,normal-occupied),remaining:Math.max(0,capacity-occupied)};
    });
  });
}
async function audit(tx,admin,id,action) {await tx.query('INSERT INTO audit_log VALUES ($1,$2,$3,$4,$5)',[randomUUID(),admin?.id||null,id,action,now()]);}
const menuDeadline=r=>r.visit_date+'T07:00:00+07:00';
function requireConfirmed(r) {
  if(!['CONFIRMED','MENU_SELECTED'].includes(r.status))fail('Menu baru dapat dipilih setelah DP disetujui admin.',409);
}
async function menuFor(db,r) {
  requireConfirmed(r);
  const deadline=menuDeadline(r);
  return {reservation:publicReservation(r),deadline,editable:Date.parse(deadline)>Date.now(),
    products:await db.query('SELECT id,name,category,price FROM menu_products WHERE active=1 ORDER BY category,name'),
    items:await db.query('SELECT i.product_id,i.quantity,i.note,p.name,p.active FROM reservation_menu_items i JOIN menu_products p ON p.id=i.product_id WHERE i.reservation_id=$1',[r.id]),
    pos:(await db.query('SELECT status,draft_id FROM pos_drafts WHERE reservation_id=$1',[r.id]))[0]||null};
}
async function saveMenu(db,id,data,{req,admin}={}) {
  const payload=await db.transaction(async tx=>{
    const initial=req?await owns(tx,id,req):(await tx.query('SELECT * FROM reservations WHERE id=$1',[id]))[0];
    if(!initial)fail('Reservasi tidak ditemukan.',404);
    await lockDay(tx,initial.visit_date);
    const r=req?await owns(tx,id,req):(await tx.query('SELECT * FROM reservations WHERE id=$1',[id]))[0];
    requireConfirmed(r);
    if(req&&Date.now()>=Date.parse(menuDeadline(r)))fail('Batas pemilihan menu sudah lewat (07.00 WIB hari kunjungan). Hubungi admin.',409);
    if(!Array.isArray(data.items)||!data.items.length||data.items.length>100)fail('Pilih minimal satu menu.');
    const products=await tx.query('SELECT * FROM menu_products WHERE active=1');
    const items=data.items.map(item=>{if(!item||typeof item!=='object')fail('Menu atau jumlah tidak valid.');const p=products.find(p=>p.id===item.productId);const qty=Number(item.quantity);if(!p||!Number.isInteger(qty)||qty<1||qty>100)fail('Menu atau jumlah tidak valid.');return {product_id:p.external_id,menu_code:p.external_id,quantity:qty,note:clean(item.note,300),id:p.id};});
    if(new Set(items.map(i=>i.id)).size!==items.length)fail('Menu duplikat. Gabungkan jumlahnya.');
    await tx.query('DELETE FROM reservation_menu_items WHERE reservation_id=$1',[id]);
    for(const i of items)await tx.query('INSERT INTO reservation_menu_items VALUES ($1,$2,$3,$4,$5)',[randomUUID(),id,i.id,i.quantity,i.note]);
    await tx.query("UPDATE reservations SET status='MENU_SELECTED' WHERE id=$1",[id]);
    const pos=await posSettings(tx);
    await tx.query('INSERT INTO pos_drafts(reservation_id,external_reference,status,updated_at) VALUES ($1,$2,$3,$4) ON CONFLICT(reservation_id) DO UPDATE SET status=excluded.status,updated_at=excluded.updated_at',[id,r.code,pos.draftConfigured?'PENDING':'NOT_CONFIGURED',now()]);
    await audit(tx,admin,id,req?'GUEST_MENU_SAVED':'ADMIN_MENU_FINALIZED');
    return {external_reference:r.code,visit_date:r.visit_date,customer:{name:r.customer_name,phone:r.phone},party_size:r.guest_count,seating:await seatsFor(tx,id),items:items.map(({id,...item})=>item),source_status:'MENU_SELECTED'};
  });
  const pos=await posSettings(db);
  if(!pos.draftConfigured)return {saved:true,synced:false,message:'Menu tersimpan. Koneksi draft kasir belum tersedia.'};
  try {
    const order={nama_pelanggan:`${payload.customer.name} · ${payload.external_reference}`,items:payload.items.map(item=>({kode_barang:item.menu_code,qty:item.quantity,catatan:item.note}))};
    const result=await cashierFetch(pos.draft_url,{method:'POST',headers:{'Idempotency-Key':payload.external_reference},body:JSON.stringify(order)},pos.orders_key);
    const draft=result.data||result;
    const draftId=clean(String(draft.draft_id||draft.id||''),150);if(!draftId)fail('Kasir tidak mengembalikan ID draft.',502);
    await db.query("UPDATE pos_drafts SET status='SYNCED',draft_id=$1,last_error=NULL,updated_at=$2 WHERE reservation_id=$3",[draftId,now(),id]);
    return {saved:true,synced:true,draftId};
  } catch(error) {
    await db.query("UPDATE pos_drafts SET status='FAILED',last_error=$1,updated_at=$2 WHERE reservation_id=$3",[clean(error.message,300),now(),id]);
    return {saved:true,synced:false,message:'Menu tersimpan; pengiriman draft kasir belum berhasil.'};
  }
}
function validateProof(proof) {
  if(!proof||typeof proof.data!=='string'||!/^[A-Za-z0-9+/]+={0,2}$/.test(proof.data))fail('Pilih bukti pembayaran yang valid.');
  const buffer=Buffer.from(proof.data,'base64');
  if(buffer.length<8||buffer.length>2*1024*1024)fail('Bukti pembayaran maksimal 2 MB.');
  const isPng=buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  const isJpeg=buffer[0]===255&&buffer[1]===216&&buffer[2]===255;
  const isPdf=buffer.subarray(0,5).toString()==='%PDF-';
  const isWebp=buffer.subarray(0,4).toString()==='RIFF'&&buffer.subarray(8,12).toString()==='WEBP';
  const type=isPng?'image/png':isJpeg?'image/jpeg':isPdf?'application/pdf':isWebp?'image/webp':null;
  if(!type)fail('Gunakan gambar JPG, PNG, WebP atau PDF.');
  return {data:buffer.toString('base64'),type,name:clean(proof.name,120).replace(/[^\w. -]/g,'_')||'bukti-pembayaran'};
}
async function cashierFetch(url,options={},token='') {
  if(!url)fail('Integrasi kasir belum dihubungkan.',503);
  if(!localMode()&&new URL(url).protocol!=='https:')fail('Endpoint kasir harus HTTPS.',503);
  const response=await fetch(url,{...options,signal:AbortSignal.timeout(10000),headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`} : {}),...options.headers}});
  if(!response.ok)fail('Kasir belum dapat menerima permintaan. Data tetap tersimpan.',502);
  return response.json();
}

export default async function handler(req,res) {
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
  try {
    const url=new URL(req.url,'http://'+(req.headers.host||'localhost'));
    const path=String(req.query?.route??url.searchParams.get('route')??url.pathname.replace(/^\/api\/?/,'')).replace(/^\/+|\/+$/g,'');
    const method=req.method;
    if(!['GET','HEAD'].includes(method))checkOrigin(req);
    if(path==='public'&&method==='GET') {
      let db;try{db=await getDb();}catch(error){if(error.status===503)return send(res,200,{ready:false,event:EVENT,days:days().map(visit_date=>({visit_date,remaining:null,held:null,booked:null})),payment:{configured:false}});throw error;}
      await expire(db);
      const rows=await db.query(`SELECT d.visit_date,
        COALESCE(SUM(CASE WHEN r.status IN (${activeSql}) THEN r.guest_count ELSE 0 END),0) AS used,
        COALESCE(SUM(CASE WHEN r.status IN (${BOOKED_STATUSES.map(x=>`'${x}'`).join(',')}) THEN r.guest_count ELSE 0 END),0) AS booked,
        COALESCE(SUM(CASE WHEN r.status IN ('HOLD','PENDING_PAYMENT','PENDING_VERIFICATION') THEN r.guest_count ELSE 0 END),0) AS held,
        (SELECT COALESCE(SUM(s.guest_count),0) FROM reservation_seats s JOIN reservations rr ON rr.id=s.reservation_id WHERE rr.visit_date=d.visit_date AND rr.status IN (${activeSql})) AS allocated_guests,
        (SELECT COALESCE(SUM(rr.guest_count),0) FROM reservations rr WHERE rr.visit_date=d.visit_date AND rr.status IN (${activeSql}) AND NOT EXISTS (SELECT 1 FROM reservation_seats s WHERE s.reservation_id=rr.id)) AS unallocated_guests
        FROM event_days d LEFT JOIN reservations r ON r.visit_date=d.visit_date GROUP BY d.visit_date ORDER BY d.visit_date`);
      const usage=await db.query(`SELECT r.visit_date,s.unit_id,u.zone_id,SUM(s.guest_count) AS guests FROM reservation_seats s JOIN reservations r ON r.id=s.reservation_id JOIN seating_units u ON u.id=s.unit_id WHERE r.status IN (${activeSql}) GROUP BY r.visit_date,s.unit_id,u.zone_id`);
      return send(res,200,{ready:true,event:EVENT,days:rows.map(row=>{
        const available=sectionAvailability(usage.filter(u=>u.visit_date===row.visit_date)).reduce((s,u)=>s+u.remaining,0);
        return {...row,used:Number(row.used),available_capacity:available,remaining:Math.max(0,Math.min(EVENT.daily_capacity-Number(row.used),available-Number(row.unallocated_guests))),booked:Number(row.booked),held:Number(row.held)};
      }),payment:await paymentSettings(db)});
    }
    const db=await getDb();
    if(path.startsWith('auth/')) {
      await bootstrapAdmin(db);
      if(path==='auth/session'&&method==='GET') {
        const admin=await sessionAdmin(db,req),exists=(await db.query('SELECT id FROM admin_users LIMIT 1')).length>0;
        return send(res,200,{authenticated:!!admin,admin,setupAllowed:localMode()&&!exists,ready:true,storage:db.kind});
      }
      const data=await body(req);
      if(path==='auth/setup'&&method==='POST') {
        if(!localMode())fail('Pembuatan akun dilakukan dari konfigurasi server.',403);
        const admin=await db.transaction(async tx=>{
          if((await tx.query('SELECT id FROM admin_users LIMIT 1')).length)fail('Akun admin sudah tersedia.',409);
          const user=await createAdmin(tx,clean(data.username,40),String(data.password||''));await issueSession(tx,user,res);return user;
        });return send(res,201,{admin});
      }
      if(path==='auth/login'&&method==='POST') {
        const username=clean(data.username,40),password=String(data.password||'');
        if(password.length>128)fail('Username atau password salah.',401);
        const ip=String(req.headers['x-forwarded-for']||req.socket?.remoteAddress||'').split(',')[0].trim();
        const key=hash(ip+':'+username.toLowerCase());
        const result=await db.transaction(async tx=>{
          const attempts=(await tx.query('SELECT * FROM login_attempts WHERE attempt_key=$1',[key]))[0];
          if(attempts&&attempts.expires_at>now()&&Number(attempts.failures)>=5) return {error:'Terlalu banyak percobaan. Coba lagi dalam 15 menit.',status:429};
          const admin=(await tx.query('SELECT * FROM admin_users WHERE username=$1',[username]))[0];
          const matches=passwordMatches(password,admin?.password_hash||dummyPasswordHash);
          if(!admin||!matches) {
            const failures=attempts&&attempts.expires_at>now()?Number(attempts.failures)+1:1;
            await tx.query('INSERT INTO login_attempts VALUES ($1,$2,$3) ON CONFLICT(attempt_key) DO UPDATE SET failures=excluded.failures,expires_at=excluded.expires_at',[key,failures,attempts?.expires_at>now()?attempts.expires_at:new Date(Date.now()+900000).toISOString()]);
            return {error:'Username atau password salah.',status:401};
          }
          await tx.query('DELETE FROM login_attempts WHERE attempt_key=$1',[key]);await issueSession(tx,admin,res);
          return {admin:{id:admin.id,username:admin.username}};
        });return send(res,result.status||200,result);
      }
      if(path==='auth/reset/request'&&method==='POST') {
        const requested=email(data.email),recipient=resetRecipient();
        // Keep the same response for an unregistered address to avoid account enumeration.
        const done={message:'Jika email terdaftar, tautan reset sudah dikirim.'};
        if(!requested||requested!==recipient)return send(res,200,done);
        if(!resetIsConfigured())fail('Reset password via email belum diaktifkan. Hubungi pengelola sistem.',503);
        const ip=String(req.headers['x-forwarded-for']||req.socket?.remoteAddress||'').split(',')[0].trim();
        const requestKey=hash(`reset:${ip}:${requested}`),token=randomBytes(32).toString('hex');
        const result=await db.transaction(async tx=>{
          const attempts=(await tx.query('SELECT * FROM login_attempts WHERE attempt_key=$1',[requestKey]))[0];
          if(attempts&&attempts.expires_at>now()&&Number(attempts.failures)>=3)return {status:429};
          const admin=(await tx.query('SELECT * FROM admin_users LIMIT 1'))[0];
          if(!admin)return {status:200};
          const expiry=new Date(Date.now()+15*60*1000).toISOString();
          await tx.query('DELETE FROM password_reset_tokens WHERE expires_at<$1 OR used_at IS NOT NULL',[now()]);
          await tx.query('DELETE FROM password_reset_tokens WHERE admin_id=$1',[admin.id]);
          await tx.query('INSERT INTO password_reset_tokens VALUES ($1,$2,$3,NULL,$4)',[hash(token),admin.id,expiry,now()]);
          const failures=attempts&&attempts.expires_at>now()?Number(attempts.failures)+1:1;
          await tx.query('INSERT INTO login_attempts VALUES ($1,$2,$3) ON CONFLICT(attempt_key) DO UPDATE SET failures=excluded.failures,expires_at=excluded.expires_at',[requestKey,failures,new Date(Date.now()+15*60*1000).toISOString()]);
          return {admin};
        });
        if(result.status===429)fail('Terlalu banyak permintaan reset. Coba lagi dalam 15 menit.',429);
        if(!result.admin)return send(res,200,done);
        try{await sendPasswordReset(recipient,token,new URL(req.headers.origin).origin);}
        catch(error){await db.query('DELETE FROM password_reset_tokens WHERE token_hash=$1',[hash(token)]);throw error;}
        return send(res,200,done);
      }
      if(path==='auth/reset/confirm'&&method==='POST') {
        const token=clean(data.token,128),password=String(data.password||'');
        if(!/^[a-f0-9]{64}$/.test(token)||password.length<10||password.length>128)fail('Tautan atau password tidak valid. Password minimal 10 karakter.',400);
        await db.transaction(async tx=>{
          const reset=(await tx.query('SELECT * FROM password_reset_tokens WHERE token_hash=$1 AND used_at IS NULL AND expires_at>$2',[hash(token),now()]))[0];
          if(!reset)fail('Tautan reset tidak valid atau sudah kedaluwarsa.',400);
          await tx.query('UPDATE admin_users SET password_hash=$1 WHERE id=$2',[hashPassword(password),reset.admin_id]);
          await tx.query('UPDATE password_reset_tokens SET used_at=$1 WHERE token_hash=$2',[now(),hash(token)]);
          await tx.query('DELETE FROM admin_sessions WHERE admin_id=$1',[reset.admin_id]);
          await audit(tx,{id:reset.admin_id},null,'ADMIN_PASSWORD_RESET');
        });
        return send(res,200,{message:'Password berhasil diperbarui. Silakan masuk kembali.'});
      }
      if(path==='auth/logout'&&method==='POST') {
        const token=(req.headers.cookie||'').match(/teaco_session=([a-f0-9]{64})/)?.[1];if(token)await db.query('DELETE FROM admin_sessions WHERE token_hash=$1',[hash(token)]);
        res.setHeader('Set-Cookie',`teaco_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${localMode()?'':'; Secure'}`);return send(res,200,{ok:true});
      }
    }
    if(path==='holds'&&method==='POST') {
      const data=await body(req),date=clean(data.date,10),count=Number(data.guests);
      if(!Number.isInteger(count)||count<1||count>65)fail('Jumlah tamu harus 1–65 orang.');
      const token=randomBytes(32).toString('hex');
      const r=await db.transaction(async tx=>{
        await lockDay(tx,date);await expire(tx,date);
        const used=Number((await tx.query(`SELECT COALESCE(SUM(guest_count),0) AS total FROM reservations WHERE visit_date=$1 AND status IN (${activeSql})`,[date]))[0].total);
        if(used+count>EVENT.daily_capacity)fail('Kursi tidak cukup. Pilih tanggal atau jumlah tamu lain.',409);
        const available=(await unitsFor(tx,date,'',count)).reduce((sum,u)=>sum+u.remaining,0);
        const unallocated=Number((await tx.query(`SELECT COALESCE(SUM(r.guest_count),0) AS guests FROM reservations r WHERE r.visit_date=$1 AND r.status IN (${activeSql}) AND NOT EXISTS (SELECT 1 FROM reservation_seats s WHERE s.reservation_id=r.id)`,[date]))[0].guests);
        if(count>available-unallocated)fail('Tempat duduk tidak cukup pada tanggal ini.',409);
        const usedCodes=new Set((await tx.query(`SELECT unique_code FROM reservations WHERE visit_date=$1 AND status IN (${activeSql})`,[date])).map(x=>Number(x.unique_code)));
        let uniqueCode=randomInt(1,1000);while(usedCodes.has(uniqueCode))uniqueCode=uniqueCode%999+1;
        const r={id:randomUUID(),code:`TEACO-${date.slice(5).replace('-','')}-${randomBytes(4).toString('hex').toUpperCase()}`,token_hash:hash(token),event_id:EVENT.id,visit_date:date,guest_count:count,status:'HOLD',deposit_amount:count*EVENT.deposit_per_guest,unique_code:uniqueCode,expires_at:new Date(Date.now()+900000).toISOString(),created_at:now()};
        await tx.query('INSERT INTO reservations(id,code,token_hash,event_id,visit_date,guest_count,status,deposit_amount,unique_code,expires_at,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',Object.values(r));return r;
      });return send(res,201,{reservation:publicReservation(r),token});
    }
    const holdMatch=path.match(/^holds\/([^/]+)(?:\/(seats|payment|payment-intent|menu))?$/);
    if(holdMatch) {
      const [,id,action]=holdMatch;
      if(action==='menu') {
        await expire(db);
        if(method==='GET')return send(res,200,await menuFor(db,await owns(db,id,req)));
        if(method==='POST')return send(res,200,await saveMenu(db,id,await body(req),{req}));
        fail('Permintaan tidak ditemukan.',404);
      }
      if(method==='GET') {
        await expire(db);const r=await owns(db,id,req);
        return send(res,200,{reservation:publicReservation(r),seats:await seatsFor(db,id),units:await unitsFor(db,r.visit_date,id,r.guest_count),payment:await paymentSettings(db)});
      }
      const data=await body(req);
      const r=await db.transaction(async tx=>{
        let r=await owns(tx,id,req);await lockDay(tx,r.visit_date);await expire(tx,r.visit_date);r=await owns(tx,id,req);
        if(method==='DELETE'&&!action) {if(r.status==='HOLD')await tx.query("UPDATE reservations SET status='CANCELLED' WHERE id=$1",[id]);return r;}
        if(r.status==='EXPIRED'||r.status==='CANCELLED')fail('Waktu pemesanan habis. Silakan pilih tanggal kembali.',409);
        if(action==='seats'&&method==='PATCH') {
          if(r.status!=='HOLD')fail('Tempat duduk sudah dikunci.',409);
          const ids=Array.isArray(data.unitIds)?[...new Set(data.unitIds)].slice(0,14):[];
          if(!ids.length)fail('Pilih tempat duduk terlebih dahulu.');
          const units=await unitsFor(tx,r.visit_date,id,r.guest_count);
          const chosen=ids.map(id=>units.find(u=>u.id===id));
          if(chosen.some(u=>!u||u.remaining<=0))fail('Seksi sudah penuh. Pilih tempat lain.',409);
          let rest=r.guest_count;
          const allocations=[];
          for(const unit of chosen){
            if(!rest)break;
            // Expanded capacity is only for the whole party, never a split fragment.
            const available=unit.exclusive&&rest!==r.guest_count?unit.normal_remaining:unit.remaining;
            const qty=Math.min(rest,available);
            if(qty){allocations.push([id,unit.id,qty]);rest-=qty;}
          }
          if(rest)fail('Sisa tempat di seksi pilihan tidak cukup. Pilih seksi lain atau gabungkan beberapa seksi.',409);
          await tx.query('DELETE FROM reservation_seats WHERE reservation_id=$1',[id]);
          for(const allocation of allocations)await tx.query('INSERT INTO reservation_seats VALUES ($1,$2,$3)',allocation);
          return r;
        }
        if(action==='payment-intent'&&method==='POST') {
          if(!['HOLD','PENDING_PAYMENT'].includes(r.status))fail('Reservasi ini sudah diproses.',409);
          if(!(await seatsFor(tx,id)).length)fail('Pilih tempat duduk dahulu.');
          const name=clean(data.name,100),number=phone(data.phone);
          if(name.length<2||!/^62\d{8,13}$/.test(number))fail('Isi nama dan nomor WhatsApp yang valid.');
          const paymentDeadline=new Date(Math.min(Date.now()+86400000,Date.parse(r.visit_date+'T17:00:00+07:00'))).toISOString();
          if(paymentDeadline<=now())fail('Reservasi untuk tanggal ini sudah ditutup.');
          await tx.query("UPDATE reservations SET customer_name=$1,phone=$2,note=$3,status='PENDING_PAYMENT',expires_at=$4 WHERE id=$5",[name,number,clean(data.note,500),paymentDeadline,id]);
          return (await tx.query('SELECT * FROM reservations WHERE id=$1',[id]))[0];
        }
        if(action==='payment'&&method==='POST') {
          if(!['HOLD','PENDING_PAYMENT'].includes(r.status))fail('Bukti sudah diterima atau reservasi sudah dikonfirmasi.',409);
          // Receipts from transfers arranged with the admin can still be reviewed
          // when the public bank details have not been configured yet.
          if(!(await seatsFor(tx,id)).length)fail('Pilih tempat duduk dahulu.');
          const name=clean(data.name,100),number=phone(data.phone);
          if(name.length<2||!/^62\d{8,13}$/.test(number))fail('Isi nama dan nomor WhatsApp yang valid.');
          const proof=validateProof(data.proof);
          const paymentDeadline=new Date(Math.min(Date.now()+86400000,Date.parse(r.visit_date+'T17:00:00+07:00'))).toISOString();
          if(paymentDeadline<=now())fail('Reservasi untuk tanggal ini sudah ditutup.');
          await tx.query("UPDATE reservations SET customer_name=$1,phone=$2,note=$3,status='PENDING_VERIFICATION',expires_at=$4 WHERE id=$5",[name,number,clean(data.note,500),paymentDeadline,id]);
          await tx.query("INSERT INTO payments(id,reservation_id,amount,proof_name,proof_type,proof_base64,status,uploaded_at) VALUES ($1,$2,$3,$4,$5,$6,'PENDING',$7)",[randomUUID(),id,r.deposit_amount+r.unique_code,proof.name,proof.type,proof.data,now()]);
          return (await tx.query('SELECT * FROM reservations WHERE id=$1',[id]))[0];
        }
        fail('Permintaan tidak ditemukan.',404);
      });return send(res,200,{reservation:publicReservation(r),seats:await seatsFor(db,id)});
    }
    if(path==='reservations/lookup'&&method==='POST') {
      const data=await body(req);await expire(db);
      const r=(await db.query('SELECT * FROM reservations WHERE code=$1 AND phone=$2',[clean(data.code,40).toUpperCase(),phone(data.phone)]))[0];
      if(!r)fail('Kode reservasi atau nomor WhatsApp tidak cocok.',404);
      const token=randomBytes(32).toString('hex');await db.query('UPDATE reservations SET token_hash=$1 WHERE id=$2',[hash(token),r.id]);
      return send(res,200,{reservation:publicReservation(r),seats:await seatsFor(db,r.id),payment:await paymentSettings(db),token});
    }
    if(path.startsWith('admin/')) {
      const admin=await sessionAdmin(db,req);if(!admin)fail('Silakan login admin.',401);
      await expire(db);
      if(path==='admin/dashboard'&&method==='GET') {
        const reservations=await db.query("SELECT * FROM reservations WHERE status<>'HOLD' AND customer_name IS NOT NULL ORDER BY created_at DESC");
        const payments=await db.query('SELECT id,reservation_id,amount,status,uploaded_at,proof_name FROM payments ORDER BY uploaded_at DESC');
        const allocations=await db.query('SELECT s.*,u.name,z.name AS zone,z.id AS zone_id FROM reservation_seats s JOIN seating_units u ON u.id=s.unit_id JOIN zones z ON z.id=u.zone_id');
        const items=await db.query('SELECT i.*,p.name FROM reservation_menu_items i JOIN menu_products p ON p.id=i.product_id');
        const drafts=await db.query('SELECT * FROM pos_drafts');
        const rows=reservations.map(r=>({...publicReservation(r),phone:r.phone,created_at:r.created_at,seats:allocations.filter(s=>s.reservation_id===r.id),payment:payments.find(p=>p.reservation_id===r.id),items:items.filter(i=>i.reservation_id===r.id),pos:drafts.find(d=>d.reservation_id===r.id)}));
        const pendingHolds=await db.query("SELECT visit_date,COALESCE(SUM(guest_count),0) AS guests FROM reservations WHERE status='HOLD' GROUP BY visit_date");
        const pos=await posSettings(db);
        return send(res,200,{admin,reservations:rows,holds:pendingHolds,settings:await paymentSettings(db),pos:publicPos(pos),menu:await db.query('SELECT * FROM menu_products WHERE active=1 ORDER BY category,name'),storage:db.kind,posConfigured:pos.menuConfigured,draftConfigured:pos.draftConfigured});
      }
      if(path==='admin/settings'&&method==='PATCH') {
        const data=await body(req);
        if(!clean(data.bank_name,60)||!/^\d{5,30}$/.test(clean(data.account_number,30))||!clean(data.account_holder,100))fail('Isi bank, nomor rekening, dan nama pemilik yang valid.');
        await db.transaction(async tx=>{for(const key of ['bank_name','account_number','account_holder'])await tx.query('INSERT INTO settings VALUES ($1,$2) ON CONFLICT(key) DO UPDATE SET value=excluded.value',[key,clean(data[key],100)]);await audit(tx,admin,null,'PAYMENT_SETTINGS_UPDATED');});
        return send(res,200,{settings:await paymentSettings(db)});
      }
      if(path==='admin/pos-settings'&&method==='PATCH') {
        const data=await body(req),menuKey=clean(data.menu_key,1000),ordersKey=clean(data.orders_key,1000);
        if(!menuKey||!ordersKey||/\s/.test(menuKey)||/\s/.test(ordersKey))fail('Isi kode API Menu dan kode API Pesanan dari POS Kasir.');
        await db.transaction(async tx=>{
          await tx.query('INSERT INTO settings VALUES ($1,$2) ON CONFLICT(key) DO UPDATE SET value=excluded.value',['pos_menu_key',menuKey]);
          await tx.query('INSERT INTO settings VALUES ($1,$2) ON CONFLICT(key) DO UPDATE SET value=excluded.value',['pos_orders_key',ordersKey]);
          await audit(tx,admin,null,'POS_API_SETTINGS_UPDATED');
        });
        return send(res,200,{pos:publicPos(await posSettings(db))});
      }
      const proofMatch=path.match(/^admin\/proofs\/([^/]+)$/);
      if(proofMatch&&method==='GET') {
        const proof=(await db.query('SELECT * FROM payments WHERE id=$1',[proofMatch[1]]))[0];if(!proof)fail('Bukti tidak ditemukan.',404);
        res.statusCode=200;res.setHeader('Content-Type',proof.proof_type);res.setHeader('Content-Disposition',`inline; filename="${proof.proof_name}"`);res.setHeader('Content-Security-Policy',"default-src 'none'; sandbox");return res.end(Buffer.from(proof.proof_base64,'base64'));
      }
      const verifyMatch=path.match(/^admin\/reservations\/([^/]+)\/verify$/);
      if(verifyMatch&&method==='POST') {
        const data=await body(req),id=verifyMatch[1];if(!['approve','reject'].includes(data.action))fail('Pilih valid atau tolak.');
        await db.transaction(async tx=>{
          let r=(await tx.query('SELECT * FROM reservations WHERE id=$1',[id]))[0];if(!r)fail('Reservasi tidak ditemukan.',404);
          await lockDay(tx,r.visit_date);r=(await tx.query('SELECT * FROM reservations WHERE id=$1',[id]))[0];
          if(r.status!=='PENDING_VERIFICATION')fail('Bukti ini sudah diproses atau kedaluwarsa.',409);
          const verified= data.action==='approve',stamp=now();
          await tx.query('UPDATE payments SET status=$1,verified_by=$2,verified_at=$3 WHERE reservation_id=$4 AND status=\'PENDING\'',[verified?'VERIFIED':'REJECTED',admin.id,stamp,id]);
          await tx.query('UPDATE reservations SET status=$1,confirmed_at=$2,expires_at=$3 WHERE id=$4',[verified?'CONFIRMED':'PENDING_PAYMENT',verified?stamp:null,verified?null:new Date(Date.now()+86400000).toISOString(),id]);
          await audit(tx,admin,id,verified?'PAYMENT_APPROVED':'PAYMENT_REJECTED');
        });return send(res,200,{ok:true});
      }
      if(path==='admin/menu/sync'&&method==='POST') {
        const pos=await posSettings(db);
        if(!pos.menuConfigured)fail('Kode API Menu POS Kasir belum dihubungkan.',503);
        const result=await cashierFetch(pos.menu_url,{},pos.menu_key);
        const products=Array.isArray(result)?result:result.data||result.products||result.menus;
        if(!Array.isArray(products)||!products.length||products.length>1000)fail('Daftar menu kasir belum valid.',502);
        const mapped=products.map(p=>({external_id:clean(String(p.product_id||p.id||p.sku||p.kode_barang||''),100),name:clean(p.name||p.nama||p.nama_barang,150),category:clean(p.category?.name||p.category||p.kategori,80)||'Menu',price:Math.max(0,Math.round(Number(p.price||p.harga||p.harga_jual)||0))}));
        if(mapped.some(p=>!p.external_id||!p.name)||new Set(mapped.map(p=>p.external_id)).size!==mapped.length)fail('Menu kasir memerlukan ID unik dan nama.',502);
        await db.transaction(async tx=>{
          await tx.query('UPDATE menu_products SET active=0');
          for(const p of mapped)await tx.query('INSERT INTO menu_products VALUES ($1,$2,$3,$4,$5,1,$6) ON CONFLICT(external_id) DO UPDATE SET name=excluded.name,category=excluded.category,price=excluded.price,active=1,synced_at=excluded.synced_at',[randomUUID(),p.external_id,p.name,p.category,p.price,now()]);
          await audit(tx,admin,null,'MENU_SYNCED');
        });return send(res,200,{count:mapped.length});
      }
      const menuMatch=path.match(/^admin\/reservations\/([^/]+)\/menu$/);
      if(menuMatch&&method==='POST') {
        const data=await body(req),id=menuMatch[1];
        return send(res,200,await saveMenu(db,id,data,{admin}));
      }
    }
    fail('Permintaan tidak ditemukan.',404);
  } catch(error) {
    const status=error.status||500;
    if(!error.status)console.error('TEACO API:',error.code||error.name);
    send(res,status,{error:status===500?'Layanan belum dapat diakses. Coba lagi.':error.message,code:error.code});
  }
}

