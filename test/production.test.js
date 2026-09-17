import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
process.env.NODE_ENV='production';
delete process.env.DATABASE_URL;
const {default:handler}=await import('../server/handler.js');
test('production without PostgreSQL has no temporary database or pretend availability',async t=>{
  const server=createServer(handler);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const origin=`http://127.0.0.1:${server.address().port}`;
  const response=await fetch(origin+'/api/public');const data=await response.json();assert.equal(data.ready,false);assert.equal(data.days.length,28);assert.ok(data.days.every(d=>d.remaining===null));
  assert.equal((await fetch(origin+'/api/auth/session')).status,503);
  assert.equal((await fetch(origin+'/api/holds',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({date:'2027-02-08',guests:4})})).status,503);
});
