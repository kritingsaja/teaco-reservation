import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';

process.env.SQLITE_PATH=':memory:';
process.env.NODE_ENV='test';
process.env.ADMIN_USERNAME='reset_admin';
process.env.ADMIN_PASSWORD='old-password-for-test';
process.env.ADMIN_RESET_EMAIL='kritingsaja@gmail.com';
process.env.RESEND_API_KEY='test-key';
process.env.RESET_FROM_EMAIL='TEACO <onboarding@resend.dev>';
delete process.env.TURSO_DATABASE_URL;
delete process.env.TURSO_AUTH_TOKEN;
const {default:handler}=await import('../server/handler.js');

test('password reset only sends to the configured email and invalidates old sessions',async t=>{
  const server=createServer(handler);
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const origin=`http://127.0.0.1:${server.address().port}`;
  const nativeFetch=globalThis.fetch;let sent=[];
  globalThis.fetch=async(input,init)=>{
    if(String(input)==='https://api.resend.com/emails'){
      sent.push(JSON.parse(init.body));
      return new Response(JSON.stringify({id:'email-test'}),{status:200,headers:{'Content-Type':'application/json'}});
    }
    return nativeFetch(input,init);
  };
  t.after(()=>{globalThis.fetch=nativeFetch;});
  async function call(path,data) {
    const response=await nativeFetch(origin+'/api/'+path,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(data)});
    return {status:response.status,body:await response.json(),headers:response.headers};
  }
  assert.equal((await call('auth/login',{username:'reset_admin',password:'old-password-for-test'})).status,200);
  const unknown=await call('auth/reset/request',{email:'not-the-admin@example.com'});
  assert.equal(unknown.status,200);assert.equal(sent.length,0);
  const request=await call('auth/reset/request',{email:'kritingsaja@gmail.com'});
  assert.equal(request.status,200);assert.equal(sent.length,1);assert.deepEqual(sent[0].to,['kritingsaja@gmail.com']);
  const token=sent[0].html.match(/token=([a-f0-9]{64})/)[1];
  assert.equal((await call('auth/reset/confirm',{token,password:'new-password-for-test'})).status,200);
  assert.equal((await call('auth/login',{username:'reset_admin',password:'old-password-for-test'})).status,401);
  assert.equal((await call('auth/login',{username:'reset_admin',password:'new-password-for-test'})).status,200);
  assert.equal((await call('auth/reset/confirm',{token,password:'another-password'})).status,400);
});
