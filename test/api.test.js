import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';

process.env.SQLITE_PATH=':memory:';
process.env.NODE_ENV='test';
delete process.env.DATABASE_URL;
delete process.env.TURSO_DATABASE_URL;
delete process.env.TURSO_AUTH_TOKEN;
if(process.env.TEACO_TEST_TURSO==='1')process.env.TURSO_DATABASE_URL=pathToFileURL(join(mkdtempSync(join(tmpdir(),'teaco-turso-api-')),'test.sqlite')).href;
delete process.env.ADMIN_USERNAME;
delete process.env.ADMIN_PASSWORD;
const {default:handler}=await import('../server/handler.js');
const {getDb}=await import('../server/db.js');

test('booking, authentication, capacity and payment use the database end to end',async t=>{
  const server=createServer(handler);
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  t.after(async()=>{(await getDb()).close?.();});
  const origin=`http://127.0.0.1:${server.address().port}`;
  let cookie='';
  async function call(path,{method='GET',data,token,admin=false,originHeader=origin}={}) {
    const r=await fetch(origin+'/api/'+path,{method,headers:{Origin:originHeader,...(data?{'Content-Type':'application/json'}:{}),...(token?{'X-Booking-Token':token}:{}),...(admin?{Cookie:cookie}:{})},body:data?JSON.stringify(data):undefined});
    const type=r.headers.get('content-type');const body=type?.includes('application/json')?await r.json():await r.arrayBuffer();
    return {status:r.status,body,headers:r.headers};
  }
  await t.test('empty database has no invented bookings or menus',async()=>{
    const result=await call('public');assert.equal(result.status,200);assert.equal(result.body.days.length,28);assert.equal(result.body.days[0].remaining,65);assert.equal(result.body.days[0].booked,0);assert.equal(result.body.payment.configured,false);
    assert.equal((await call('admin/dashboard')).status,401);
    assert.equal((await call('holds',{method:'POST',data:{date:'2027-02-08',guests:4},originHeader:'https://other.example'})).status,403);
  });
  await t.test('concurrent holds cannot exceed 65 guests; expiry returns capacity',async()=>{
    const responses=await Promise.all([call('holds',{method:'POST',data:{date:'2027-02-08',guests:40}}),call('holds',{method:'POST',data:{date:'2027-02-08',guests:40}})]);
    assert.deepEqual(responses.map(r=>r.status).sort(),[201,409]);
    assert.equal((await call('public')).body.days[0].remaining,25);
    const db=await getDb();await db.query("UPDATE reservations SET expires_at=$1 WHERE visit_date='2027-02-08'",['2000-01-01T00:00:00.000Z']);
    assert.equal((await call('public')).body.days[0].remaining,65);
  });
  let first,second;
  await t.test('sections share capacity but cannot be overbooked and invalid tokens fail',async()=>{
    first=(await call('holds',{method:'POST',data:{date:'2027-02-09',guests:4}})).body;
    second=(await call('holds',{method:'POST',data:{date:'2027-02-09',guests:4}})).body;
    assert.equal((await call(`holds/${first.reservation.id}`)).status,403);
    assert.equal((await call(`holds/${first.reservation.id}/seats`,{method:'PATCH',data:{unitIds:['invalid']},token:first.token})).status,409);
    assert.equal((await call(`holds/${first.reservation.id}/seats`,{method:'PATCH',data:{unitIds:['indoor-side']},token:first.token})).status,200);
    assert.equal((await call(`holds/${second.reservation.id}/seats`,{method:'PATCH',data:{unitIds:['indoor-side']},token:second.token})).status,409);
    assert.equal((await call(`holds/${second.reservation.id}`,{method:'DELETE',token:second.token})).status,200);
  });
  await t.test('first local admin is hashed and sessions are HttpOnly; wrong login fails',async()=>{
    const setup=await call('auth/setup',{method:'POST',data:{username:'test_admin',password:'only-for-isolated-tests'}});
    assert.equal(setup.status,201);cookie=setup.headers.get('set-cookie').split(';')[0];assert.match(setup.headers.get('set-cookie'),/HttpOnly/);assert.match(setup.headers.get('set-cookie'),/SameSite=Strict/);
    assert.equal((await call('auth/setup',{method:'POST',data:{username:'another',password:'only-for-isolated-tests'}})).status,409);
    assert.equal((await call('auth/login',{method:'POST',data:{username:'test_admin',password:'wrong'}})).status,401);
    const db=await getDb();const account=(await db.query('SELECT password_hash FROM admin_users'))[0];assert.notEqual(account.password_hash,'only-for-isolated-tests');
    const dashboard=await call('admin/dashboard',{admin:true});assert.equal(dashboard.status,200);assert.equal(dashboard.body.menu.length,0);assert.equal(dashboard.body.reservations.length,0);
  });
  let paymentId;
  await t.test('valid receipt can be reviewed even before public bank details are configured',async()=>{
    const payment={name:'Test Pemesan',phone:'081234567890',proof:{name:'test.png',data:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII='}};
    const path=`holds/${first.reservation.id}/payment`;
    assert.equal((await call('public')).body.payment.configured,false);
    assert.equal((await call(path,{method:'POST',data:{...payment,proof:{name:'evil.svg',data:Buffer.from('<svg><script>alert(1)</script></svg>').toString('base64')}},token:first.token})).status,400);
    const paid=await call(path,{method:'POST',data:payment,token:first.token});assert.equal(paid.status,200);assert.equal(paid.body.reservation.status,'PENDING_VERIFICATION');
    assert.equal((await call(`holds/${first.reservation.id}/menu`,{token:first.token})).status,409);
    assert.equal((await call(`holds/${first.reservation.id}/menu`,{method:'POST',token:first.token,data:{items:[{productId:'invented',quantity:4}]}})).status,409);
    const dashboard=(await call('admin/dashboard',{admin:true})).body;assert.equal(dashboard.reservations.length,1);paymentId=dashboard.reservations[0].payment.id;assert.equal(JSON.stringify(dashboard).includes('proof_base64'),false);
    assert.equal((await call('admin/proofs/'+paymentId)).status,401);
    const proof=await call('admin/proofs/'+paymentId,{admin:true});assert.equal(proof.status,200);assert.equal(proof.headers.get('content-type'),'image/png');assert.ok(proof.body.byteLength>0);
  });
  await t.test('guest can save a reservation and resume DP payment with reservation code',async()=>{
    const later=(await call('holds',{method:'POST',data:{date:'2027-02-10',guests:2}})).body;
    assert.equal((await call(`holds/${later.reservation.id}/seats`,{method:'PATCH',data:{unitIds:['indoor-sofa']},token:later.token})).status,200);
    const saved=await call(`holds/${later.reservation.id}/payment-intent`,{method:'POST',token:later.token,data:{name:'Bayar Nanti',phone:'081234567891',note:'Akan transfer nanti'}});
    assert.equal(saved.status,200);assert.equal(saved.body.reservation.status,'PENDING_PAYMENT');
    const lookup=await call('reservations/lookup',{method:'POST',data:{code:later.reservation.code,phone:'081234567891'}});
    assert.equal(lookup.status,200);assert.equal(lookup.body.reservation.status,'PENDING_PAYMENT');
    const proof={name:'lanjut-bayar.png',data:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII='};
    const paid=await call(`holds/${later.reservation.id}/payment`,{method:'POST',token:lookup.body.token,data:{name:'Bayar Nanti',phone:'081234567891',note:'Akan transfer nanti',proof}});
    assert.equal(paid.status,200);assert.equal(paid.body.reservation.status,'PENDING_VERIFICATION');
  });
  await t.test('only admin confirms DP; menu cannot be invented or entered before approval',async()=>{
    const path=`admin/reservations/${first.reservation.id}`;
    assert.equal((await call(path+'/verify',{method:'POST',data:{action:'approve'}})).status,401);
    assert.equal((await call(path+'/menu',{method:'POST',admin:true,data:{items:[{productId:'invented',quantity:4}]}})).status,409);
    assert.equal((await call(path+'/verify',{method:'POST',admin:true,data:{action:'approve'}})).status,200);
    assert.equal((await call(path+'/verify',{method:'POST',admin:true,data:{action:'approve'}})).status,409);
    assert.equal((await call(path+'/menu',{method:'POST',admin:true,data:{items:[{productId:'invented',quantity:4}]}})).status,400);
    assert.equal((await call('admin/menu/sync',{method:'POST',admin:true,data:{}})).status,503);
    const day=(await call('public')).body.days[1];assert.equal(day.booked,4);assert.equal(day.remaining,61);assert.equal(day.held,0);
    const lookup=await call('reservations/lookup',{method:'POST',data:{code:first.reservation.code,phone:'081234567890'}});assert.equal(lookup.status,200);assert.equal(lookup.body.reservation.status,'CONFIRMED');assert.equal(lookup.body.seats[0].name,'Samping Kasir');
    first.token=lookup.body.token;
    assert.equal((await call('reservations/lookup',{method:'POST',data:{code:first.reservation.code,phone:'081299999999'}})).status,404);
    const publicData=JSON.stringify((await call('public')).body);assert.equal(publicData.includes('Test Pemesan'),false);assert.equal(publicData.includes('081234567890'),false);
  });
  await t.test('confirmed guest chooses real cashier menus, edits persist and draft uses source IDs',async()=>{
    const requests=[];let unavailable=false;
    const cashier=createServer(async(req,res)=>{
      res.setHeader('Content-Type','application/json');
      if(req.url==='/menu'){res.end(JSON.stringify({products:[{id:'pos-nasi',name:'Menu pengujian',category:'Makanan',price:20000}]}));return;}
      let raw='';for await(const chunk of req)raw+=chunk;
      requests.push({key:req.headers['idempotency-key'],body:JSON.parse(raw)});
      if(unavailable){res.statusCode=503;res.end('{}');return;}
      res.end(JSON.stringify({draft_id:'isolated-draft'}));
    });
    await new Promise(resolve=>cashier.listen(0,'127.0.0.1',resolve));
    const url=`http://127.0.0.1:${cashier.address().port}`;
    process.env.POS_MENU_URL=url+'/menu';process.env.POS_DRAFT_URL=url+'/draft';
    try{
      assert.equal((await call('admin/menu/sync',{method:'POST',admin:true,data:{}})).status,200);
      const path=`holds/${first.reservation.id}/menu`;
      assert.equal((await call(path)).status,403);
      const menu=(await call(path,{token:first.token})).body;
      assert.equal(menu.editable,true);assert.equal(menu.products.length,1);assert.equal(menu.items.length,0);assert.equal(menu.deadline,'2027-02-09T07:00:00+07:00');
      const id=menu.products[0].id;
      assert.equal((await call(path,{method:'POST',token:first.token,data:{items:[{productId:id,quantity:0}]}})).status,400);
      assert.equal((await call(path,{method:'POST',token:first.token,data:{items:[{productId:id,quantity:2},{productId:id,quantity:2}]}})).status,400);
      const save=await call(path,{method:'POST',token:first.token,data:{items:[{productId:id,quantity:4,note:'Tanpa pedas'}]}});
      assert.equal(save.status,200);assert.equal(save.body.synced,true);
      let saved=(await call(path,{token:first.token})).body;
      assert.equal(saved.reservation.status,'MENU_SELECTED');assert.equal(saved.items[0].quantity,4);assert.equal(saved.items[0].note,'Tanpa pedas');assert.equal(saved.pos.status,'SYNCED');
      assert.equal(requests[0].body.items[0].product_id,'pos-nasi');assert.equal(requests[0].key,first.reservation.code);
      const edited=await call(path,{method:'POST',token:first.token,data:{items:[{productId:id,quantity:3,note:'Less sugar'}]}});assert.equal(edited.status,200);
      assert.equal(requests[1].key,requests[0].key);
      saved=(await call(path,{token:first.token})).body;assert.equal(saved.items.length,1);assert.equal(saved.items[0].quantity,3);
      const dashboard=(await call('admin/dashboard',{admin:true})).body;assert.equal(dashboard.reservations.find(r=>r.id===first.reservation.id).items[0].quantity,3);
      unavailable=true;
      const failed=await call(path,{method:'POST',token:first.token,data:{items:[{productId:id,quantity:4}]}});assert.equal(failed.body.saved,true);assert.equal(failed.body.synced,false);
      assert.equal((await call(path,{token:first.token})).body.pos.status,'FAILED');
      const realNow=Date.now;
      try{
        Date.now=()=>Date.parse('2027-02-09T07:00:00+07:00');
        assert.equal((await call(path,{token:first.token})).body.editable,false);
        assert.equal((await call(path,{method:'POST',token:first.token,data:{items:[{productId:id,quantity:2}]}})).status,409);
        assert.equal((await call(path,{token:first.token})).body.items[0].quantity,4);
      }finally{Date.now=realNow;}
    }finally{delete process.env.POS_MENU_URL;delete process.env.POS_DRAFT_URL;await new Promise(resolve=>cashier.close(resolve));}
  });
  await t.test('logout invalidates the server session',async()=>{
    assert.equal((await call('auth/logout',{method:'POST',admin:true,data:{}})).status,200);
    assert.equal((await call('admin/dashboard',{admin:true})).status,401);
  });
  await t.test('single AC section fits 20 and daily quota remains 65',async()=>{
    const units=[['ac',20],['indoor-sofa',10],['indoor-front',16],['indoor-side',6],['out-right',13]];
    for(const [unit,guests] of units){const hold=(await call('holds',{method:'POST',data:{date:'2027-02-11',guests}})).body;assert.equal((await call(`holds/${hold.reservation.id}/seats`,{method:'PATCH',data:{unitIds:[unit]},token:hold.token})).status,200);}
    const day=(await call('public')).body.days.find(d=>d.visit_date==='2027-02-11');assert.equal(day.used,65);assert.equal(day.remaining,0);
    assert.equal((await call('holds',{method:'POST',data:{date:'2027-02-11',guests:1}})).status,409);
  });
  await t.test('partial sections stay bookable and concurrent allocations respect capacity',async()=>{
    const a=(await call('holds',{method:'POST',data:{date:'2027-02-12',guests:6}})).body;
    const b=(await call('holds',{method:'POST',data:{date:'2027-02-12',guests:6}})).body;
    const results=await Promise.all([a,b].map(h=>call(`holds/${h.reservation.id}/seats`,{method:'PATCH',token:h.token,data:{unitIds:['indoor-sofa']}})));
    assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
    const small=(await call('holds',{method:'POST',data:{date:'2027-02-12',guests:4}})).body;
    let units=(await call(`holds/${small.reservation.id}`,{token:small.token})).body.units;
    assert.equal(units.find(u=>u.id==='indoor-sofa').remaining,4);
    assert.equal((await call(`holds/${small.reservation.id}/seats`,{method:'PATCH',token:small.token,data:{unitIds:['indoor-sofa']}})).status,200);
    assert.equal((await call(`holds/${a.reservation.id}`,{token:a.token})).body.units.filter(u=>u.zone_id==='indoor').length,3);
    const shared=(await call('holds',{method:'POST',data:{date:'2027-02-13',guests:7}})).body;
    assert.equal((await call(`holds/${shared.reservation.id}/seats`,{method:'PATCH',token:shared.token,data:{unitIds:['ac']}})).status,200);
    const other=(await call('holds',{method:'POST',data:{date:'2027-02-13',guests:13}})).body;
    assert.equal((await call(`holds/${other.reservation.id}/seats`,{method:'PATCH',token:other.token,data:{unitIds:['ac']}})).status,200);
  });
  await t.test('existing legacy allocations remain intact and count against new availability',async()=>{
    const db=await getDb();
    await db.query("INSERT INTO seating_units VALUES ('ac-right','ac','Sisi kanan',10,0)");
    await db.query("INSERT INTO seating_units VALUES ('m1','indoor','Meja 1',2,0)");
    const legacy=(await call('holds',{method:'POST',data:{date:'2027-02-14',guests:8}})).body;
    await db.query('INSERT INTO reservation_seats VALUES ($1,$2,$3)',[legacy.reservation.id,'ac-right',6]);
    await db.query('INSERT INTO reservation_seats VALUES ($1,$2,$3)',[legacy.reservation.id,'m1',2]);
    const fresh=(await call('holds',{method:'POST',data:{date:'2027-02-14',guests:14}})).body;
    const units=(await call(`holds/${fresh.reservation.id}`,{token:fresh.token})).body.units;
    assert.equal(units.find(u=>u.id==='ac').remaining,14);
    assert.equal(units.find(u=>u.id==='indoor-sofa').remaining,8);
    assert.equal(units.some(u=>u.id==='m1'||u.id==='ac-right'),false);
    assert.equal((await call(`holds/${fresh.reservation.id}/seats`,{method:'PATCH',token:fresh.token,data:{unitIds:['ac']}})).status,200);
    assert.equal((await db.query('SELECT * FROM reservation_seats WHERE reservation_id=$1',[legacy.reservation.id])).length,2);
  });
});
