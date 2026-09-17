import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createTursoDb,statement} from '../server/turso.js';

test('Turso configuration and positional parameters are safe',()=>{
  assert.deepEqual(statement('SELECT $2 AS b,$1 AS a,$2 AS again',['one','two']),{sql:'SELECT ? AS b,? AS a,? AS again',args:['two','one','two']});
  assert.throws(()=>createTursoDb({url:'file:test.sqlite'}),error=>error.code==='TURSO_INVALID_URL');
  assert.throws(()=>createTursoDb({url:'http://example.test',authToken:'test-only'}),error=>error.code==='TURSO_INVALID_URL');
  assert.throws(()=>createTursoDb({url:'libsql://example.turso.io'}),error=>error.code==='TURSO_NOT_CONFIGURED');
});

test('libSQL transactions preserve constraints, rollback, persistence and cross-client capacity',async t=>{
  const url=pathToFileURL(join(mkdtempSync(join(tmpdir(),'teaco-turso-driver-')),'test.sqlite')).href;
  let first=createTursoDb({url,allowLocal:true}),second=createTursoDb({url,allowLocal:true});
  t.after(()=>{first.close();second.close();});
  await first.initialize([
    {sql:'CREATE TABLE capacity (id TEXT PRIMARY KEY,used INTEGER NOT NULL CHECK(used BETWEEN 0 AND 65))'},
    {sql:'CREATE TABLE child (id TEXT PRIMARY KEY,parent_id TEXT NOT NULL REFERENCES capacity(id))'},
    {sql:'INSERT INTO capacity VALUES ($1,$2)',params:['day',0]}
  ]);
  assert.deepEqual(await first.query('SELECT $2 AS second,$1 AS first,$2 AS repeated',['a','b']),[{second:'b',first:'a',repeated:'b'}]);
  await assert.rejects(first.query('INSERT INTO child VALUES ($1,$2)',['child','missing']));
  await assert.rejects(first.transaction(async tx=>{await tx.query('UPDATE capacity SET used=10');throw new Error('rollback-test');}),/rollback-test/);
  assert.equal((await second.query('SELECT used FROM capacity'))[0].used,0);
  const book=db=>db.transaction(async tx=>{
    const used=(await tx.query('SELECT used FROM capacity WHERE id=$1',['day']))[0].used;
    if(used+40>65)return false;
    await tx.query('UPDATE capacity SET used=$1 WHERE id=$2',[used+40,'day']);return true;
  });
  const result=await Promise.all([book(first),book(second)]);
  assert.deepEqual(result.sort(),[false,true]);
  assert.equal((await first.query('SELECT used FROM capacity'))[0].used,40);
  first.close();first=createTursoDb({url,allowLocal:true});
  assert.equal((await first.query('SELECT used FROM capacity'))[0].used,40);
  await assert.rejects(first.transaction(async tx=>{await tx.query('UPDATE capacity SET used=66');}));
  assert.equal((await second.query('SELECT used FROM capacity'))[0].used,40);
});
