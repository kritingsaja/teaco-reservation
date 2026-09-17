import {createClient} from '@libsql/client';
import {setTimeout as delay} from 'node:timers/promises';

// The application uses $n placeholders. SQLite binds ? in occurrence order,
// including repeated parameters and parameters written out of numeric order.
export function statement(sql,params=[]) {
  const args=[];
  const converted=sql.replace(/\$(\d+)/g,(_,index)=>{args.push(params[Number(index)-1]);return '?';});
  return {sql:converted,args};
}
function rows(result) {
  return result.rows.map(row=>Object.fromEntries(result.columns.map(column=>[column,row[column]])));
}
export function createTursoDb({url,authToken,allowLocal=false}) {
  const local=url.startsWith('file:');
  if(local&&!allowLocal)throw Object.assign(new Error('Production membutuhkan Turso online, bukan file SQLite lokal.'),{status:503,code:'TURSO_INVALID_URL'});
  if(!local&&!/^(libsql|https):\/\//.test(url))throw Object.assign(new Error('URL Turso harus menggunakan libsql:// atau https://.'),{status:503,code:'TURSO_INVALID_URL'});
  if(!local&&!authToken)throw Object.assign(new Error('TURSO_AUTH_TOKEN belum diatur di server.'),{status:503,code:'TURSO_NOT_CONFIGURED'});
  const client=createClient({url,authToken,intMode:'number'});
  return {kind:'turso',
    query:async(sql,params=[])=>rows(await client.execute(statement(sql,params))),
    // A write transaction takes the database write lock before any reads. This
    // protects capacity checks across different Vercel instances, not just here.
    transaction:async fn=>{
      for(let attempt=0;attempt<5;attempt++) {
        let transaction;
        try {
          transaction=await client.transaction('write');
          const value=await fn({kind:'turso',query:async(sql,params=[])=>rows(await transaction.execute(statement(sql,params)))});
          await transaction.commit();return value;
        }catch(error){
          if(transaction)try{await transaction.rollback();}catch{}
          if(!String(error.code||'').startsWith('SQLITE_BUSY')||attempt===4)throw error;
        }finally{transaction?.close();}
        await delay(40*(attempt+1));
      }
    },
    // One atomic request avoids many network round trips during schema/seed init.
    initialize:async statements=>{await client.batch(statements.map(({sql,params=[]})=>statement(sql,params)),'write');},
    close:()=>client.close()
  };
}
