const $=selector=>document.querySelector(selector);
const $$=selector=>[...document.querySelectorAll(selector)];
const icon=(name,cls='')=>`<svg class="${cls}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=value=>new Intl.NumberFormat('id-ID',{style:'currency',currency:'IDR',maximumFractionDigits:0}).format(value);
const dateText=(date,short=false)=>new Intl.DateTimeFormat('id-ID',{...(short?{}:{weekday:'long'}),day:'numeric',month:short?'short':'long',...(short?{}:{year:'numeric'}),timeZone:'Asia/Jakarta'}).format(new Date(date+'T12:00:00+07:00'));
const storage={get(key,session=false){try{return(session?sessionStorage:localStorage).getItem(key);}catch{return null;}},set(key,value,session=false){try{(session?sessionStorage:localStorage).setItem(key,value);}catch{}},remove(key,session=false){try{(session?sessionStorage:localStorage).removeItem(key);}catch{}}};
const state={public:null,month:1,selectedDate:null,guests:4,booking:null,token:null,units:[],selected:[],zone:'indoor',split:false,admin:null,setup:false,tab:'overview'};
const bookedStatuses=['CONFIRMED','MENU_SELECTED','CHECKED_IN','DONE'];
const statusLabels={HOLD:'Tempat disimpan',PENDING_PAYMENT:'Menunggu DP',PENDING_VERIFICATION:'Perlu verifikasi',CONFIRMED:'Dikonfirmasi',MENU_SELECTED:'Menu final',CHECKED_IN:'Hadir',DONE:'Selesai',EXPIRED:'Kedaluwarsa',CANCELLED:'Dibatalkan'};
const badge=status=>`<span class="status-badge ${status==='PENDING_VERIFICATION'?'pending':bookedStatuses.includes(status)?'confirmed':['EXPIRED','CANCELLED'].includes(status)?'expired':''}">${escape(statusLabels[status]||status)}</span>`;
let toastTimer;
function toast(message){$('#toast').textContent=message;$('#toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').hidden=true,4500);}
async function request(path,options={}) {
  let response;try{response=await fetch('/api/'+path,{credentials:'same-origin',...options,headers:{...(options.body?{'Content-Type':'application/json'}:{}),...(path.startsWith('holds/')?{'X-Booking-Token':state.token||''}:{}),...options.headers}});}catch{throw new Error('Koneksi terputus. Silakan coba lagi.');}
  let data;try{data=await response.json();}catch{throw new Error('Sistem reservasi belum dapat diakses.');}
  if(!response.ok)throw Object.assign(new Error(data.error||'Permintaan belum berhasil.'),{status:response.status,code:data.code});return data;
}
const post=(path,data)=>request(path,{method:'POST',body:JSON.stringify(data)});
async function busy(button,fn){if(button.classList.contains('is-loading'))return;const disabled=button.disabled;button.classList.add('is-loading');button.disabled=true;try{return await fn();}finally{button.classList.remove('is-loading');button.disabled=disabled;}}
function setTheme(theme){document.documentElement.dataset.theme=theme;$('#theme-toggle').innerHTML=icon(theme==='dark'?'sun':'moon');$('#theme-toggle').setAttribute('aria-label',`Ubah ke ${theme==='dark'?'light':'dark'} mode`);$('meta[name="theme-color"]').content=theme==='dark'?'#1b1411':'#f4ede7';}
setTheme(storage.get('teaco-theme')==='light'?'light':'dark');
$('#theme-toggle').addEventListener('click',()=>{const theme=document.documentElement.dataset.theme==='dark'?'light':'dark';setTheme(theme);storage.set('teaco-theme',theme);});
function setScreen(id){$$('.screen').forEach(s=>s.classList.toggle('active',s.id===id));const step={ 'date-screen':1,'seat-screen':2,'payment-screen':3 }[id];$('#steps').hidden=!step;$$('[data-step]').forEach(el=>{el.classList.toggle('current',Number(el.dataset.step)===step);el.classList.toggle('done',Number(el.dataset.step)<step);});$('#app-shell').classList.toggle('admin-shell',id==='admin-screen');window.scrollTo({top:0,behavior:'instant'});if(!['admin-screen','login-screen'].includes(id))history.replaceState(null,'','#/');}
function openDialog(id){$('#'+id).showModal();}
$$('.close-dialog').forEach(button=>button.addEventListener('click',()=>button.closest('dialog').close()));
$$('dialog').forEach(dialog=>dialog.addEventListener('click',event=>{if(event.target===dialog){const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)dialog.close();}}));
function saveBooking(){storage.set('teaco-booking',JSON.stringify({booking:state.booking,token:state.token}),true);}

async function loadCalendar(){
  try{state.public=await request('public');$('#service-notice').hidden=state.public.ready;$('#service-notice').textContent='Reservasi belum dibuka. Sistem sedang disiapkan.';}
  catch(error){state.public=null;$('#service-notice').hidden=false;$('#service-notice').textContent=error.message;}
  renderCalendar();
}
function renderCalendar(){
  $('#calendar-month').innerHTML=`${state.month===1?'Februari':'Maret'} <span>2027</span>`;
  $('#month-prev').disabled=state.month===1;$('#month-next').disabled=state.month===2;
  const month=state.month+1,count=state.month===1?28:7;
  const offset=(new Date(2027,state.month,1).getDay()+6)%7;
  let html=Array.from({length:offset},()=>'<span class="calendar-empty"></span>').join('');
  for(let d=1;d<=count;d++){
    const date=`2027-${String(month).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const day=state.public?.days.find(day=>day.visit_date===date),outside=!day,ready=state.public?.ready&&day?.remaining!==null;
    html+=`<button class="date ${outside?'outside':ready&&day.remaining===0?'full':ready&&day.remaining<=10?'limited':''}" data-date="${date}" ${outside||!ready||day.remaining===0?'disabled':''} aria-label="${dateText(date)}${day?`, ${ready?day.remaining+' kursi tersedia':'belum tersedia'}`:''}"><strong>${d}</strong>${outside?'':`<small>${ready?(day.remaining===0?'Penuh':`${day.remaining} kursi`):'—'}</small>`}</button>`;
  }
  $('#calendar').innerHTML=html;$('#calendar').setAttribute('aria-busy','false');
  $$('#calendar button:not(:disabled)').forEach(button=>button.addEventListener('click',()=>{state.selectedDate=button.dataset.date;$('#selected-date-label').textContent=dateText(state.selectedDate);$('#guest-error').textContent='';$('#guest-count').value=state.guests;updateGuestCount();openDialog('guest-dialog');}));
}
function updateGuestCount(){
  state.guests=Math.max(1,Math.min(65,Number($('#guest-count').value)||1));
  const remaining=state.public?.days.find(d=>d.visit_date===state.selectedDate)?.remaining||0;
  $('#availability').textContent=`${remaining} kursi tersedia pada tanggal ini.`;
  $('#guest-deposit').textContent=money(state.guests*(state.public?.event.deposit_per_guest||20000));
  $('#guest-minus').disabled=state.guests<=1;$('#guest-plus').disabled=state.guests>=remaining;
  $('#start-seat').disabled=state.guests>remaining;$('#guest-error').textContent=state.guests>remaining?'Jumlah tamu melebihi kursi tersedia.':'';
}
$('#guest-count').addEventListener('input',updateGuestCount);
$('#guest-count').addEventListener('blur',()=>$('#guest-count').value=state.guests);
['minus','plus'].forEach(kind=>$('#guest-'+kind).addEventListener('click',()=>{$('#guest-count').value=state.guests+(kind==='plus'?1:-1);updateGuestCount();}));
$('#month-prev').addEventListener('click',()=>{state.month=1;renderCalendar();});$('#month-next').addEventListener('click',()=>{state.month=2;renderCalendar();});
$('#start-seat').addEventListener('click',()=>busy($('#start-seat'),async()=>{
  try{await releaseHold();const result=await post('holds',{date:state.selectedDate,guests:state.guests});state.booking=result.reservation;state.token=result.token;state.selected=[];state.split=false;$('#allow-split').checked=false;state.zone='indoor';saveBooking();await loadSeats();$('#guest-dialog').close();setScreen('seat-screen');}
  catch(error){$('#guest-error').textContent=error.message;await loadCalendar();}
}));
async function releaseHold(){if(state.booking?.status==='HOLD'){try{await request('holds/'+state.booking.id,{method:'DELETE'});}catch{}state.booking=null;state.token=null;storage.remove('teaco-booking',true);}}
async function loadSeats(){const result=await request('holds/'+state.booking.id);state.booking=result.reservation;state.units=result.units;state.public.payment=result.payment;state.selected=result.seats.map(s=>s.unit_id);renderSeats();saveBooking();}
function allocations(){
  const chosen=state.selected.map(id=>state.units.find(u=>u.id===id)).filter(Boolean);
  if(!chosen.length)return {result:[],rest:state.booking?.guest_count||0};
  const options=state.split?[...chosen,...state.units.filter(u=>!Number(u.occupied)&&!state.selected.includes(u.id))]:chosen;
  const result=[];let rest=state.booking?.guest_count||0;
  for(const unit of options){if(rest<=0)break;const guests=Math.min(rest,Number(unit.capacity));result.push({...unit,guests});rest-=guests;}
  return {result,rest};
}
function renderSeats(){
  if(!state.booking)return;
  $('#seat-context').textContent=dateText(state.booking.visit_date)+' · 17.00 — 20.00';$('#seat-party').textContent=state.booking.guest_count+' orang';
  const zones=[{id:'indoor',name:'Indoor'},{id:'ac',name:'AC'},{id:'outdoor',name:'Outdoor'}];
  $('#zone-tabs').innerHTML=zones.map(z=>`<button class="zone-tab ${state.zone===z.id?'active':''}" data-zone="${z.id}" role="tab" aria-selected="${state.zone===z.id}" aria-controls="seat-map">${z.name}<small>${state.units.filter(u=>u.zone_id===z.id&&!Number(u.occupied)).reduce((s,u)=>s+Number(u.capacity),0)}</small></button>`).join('');
  $$('#zone-tabs button').forEach(button=>button.addEventListener('click',()=>{state.zone=button.dataset.zone;renderSeats();}));
  $('#floor-title').textContent=zones.find(z=>z.id===state.zone).name;$('#floor-caption').textContent=state.zone==='indoor'?'Pilih satu atau beberapa meja':'Pilih section untuk rombongan';
  const selected=allocations().result;
  $('#seat-map').className='seat-map '+state.zone;
  $('#seat-map').innerHTML=state.units.filter(u=>u.zone_id===state.zone).map(unit=>{
    const chosen=selected.some(s=>s.id===unit.id),occupied=Number(unit.occupied)>0;
    return `<button class="seat ${chosen?'selected':''} ${occupied?'occupied':''}" data-unit="${unit.id}" aria-pressed="${chosen}" ${occupied?'disabled':''}>${icon('seat')}<strong>${escape(unit.name)}</strong><small>${occupied?'Terisi':unit.capacity+' kursi'}</small>${chosen?icon('check','seat-check'):''}</button>`;
  }).join('');
  $$('#seat-map button:not(:disabled)').forEach(button=>button.addEventListener('click',()=>{const id=button.dataset.unit;if(state.selected.includes(id))state.selected=state.selected.filter(x=>x!==id);else if(state.selected.reduce((sum,id)=>sum+Number(state.units.find(u=>u.id===id)?.capacity||0),0)>=state.booking.guest_count)state.selected=[id];else state.selected.push(id);renderSeats();}));
  const {result,rest}=allocations();$('#selection').textContent=result.length?result.map(s=>s.name).join(' + '):'Belum ada';
  $('#selection-detail').textContent=result.length?(rest>0?`Masih perlu tempat untuk ${rest} orang.`:result.map(s=>`${s.zone_name}: ${s.guests} orang`).join(' · ')):'';
  $('#to-payment').disabled=!state.selected.length||rest>0||state.booking.status!=='HOLD';updateTimer();
}
function updateTimer(){if(state.booking?.status!=='HOLD')return;const seconds=Math.max(0,Math.ceil((Date.parse(state.booking.expires_at)-Date.now())/1000));$('#hold-timer').textContent=`${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`;if(!seconds){$('#to-payment').disabled=true;$('#selection-detail').textContent='Waktu habis. Pilih tanggal kembali.';$('#submit-payment').disabled=true;}}
setInterval(updateTimer,1000);
$('#allow-split').addEventListener('change',event=>{state.split=event.target.checked;renderSeats();});
$('#to-payment').addEventListener('click',()=>busy($('#to-payment'),async()=>{try{const selected=allocations().result;await request(`holds/${state.booking.id}/seats`,{method:'PATCH',body:JSON.stringify({unitIds:selected.map(s=>s.id)})});state.selected=selected.map(s=>s.id);renderPayment(selected);setScreen('payment-screen');}catch(error){toast(error.message);await loadSeats();}}));
function row(label,value){return `<div class="summary-row"><span>${escape(label)}</span><strong>${escape(value)}</strong></div>`;}
function renderPayment(seats=allocations().result){
  const r=state.booking;$('#payment-summary').innerHTML=row('Tanggal',dateText(r.visit_date,true))+row('Jumlah tamu',r.guest_count+' orang')+row('Tempat',seats.map(s=>s.name).join(' + '))+row('DP',money(r.deposit_amount))+row('Kode unik',String(r.unique_code).padStart(3,'0'));
  $('#total-transfer').textContent=money(r.total_transfer);const bank=state.public?.payment;
  $('#bank-details').innerHTML=bank?.configured?`<small>Transfer ke</small><strong>${escape(bank.bank_name)}</strong><strong class="account-number">${escape(bank.account_number)}</strong><small>a.n. ${escape(bank.account_holder)}</small>`:'<h2>Pembayaran belum tersedia</h2><p class="muted" style="margin:8px 0 0">Admin belum mengatur rekening DP.</p>';
  $('#submit-payment').disabled=!bank?.configured;$('#payment-error').textContent='';
}
$('#payment-proof').addEventListener('change',event=>{const file=event.target.files[0];$('#file-name').textContent=file?.name||'Pilih bukti transfer';$('#payment-error').textContent=file&&file.size>2*1024*1024?'File terlalu besar. Maksimal 2 MB.':'';});
const readProof=file=>new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve({name:file.name,data:reader.result.split(',')[1]});reader.onerror=()=>reject(new Error('File belum dapat dibaca.'));reader.readAsDataURL(file);});
$('#payment-form').addEventListener('submit',event=>{event.preventDefault();busy($('#submit-payment'),async()=>{
  try{const file=$('#payment-proof').files[0];if(!file||file.size>2*1024*1024)throw new Error('Pilih bukti DP maksimal 2 MB.');const data=Object.fromEntries(new FormData(event.target));data.proof=await readProof(file);const result=await post(`holds/${state.booking.id}/payment`,data);state.booking=result.reservation;saveBooking();renderTicket(result.seats);setScreen('pending-screen');await loadCalendar();}
  catch(error){$('#payment-error').textContent=error.message;}
});});
function renderTicket(seats=[]){const r=state.booking;if(!r)return;const confirmed=bookedStatuses.includes(r.status);$('#status-label').textContent=confirmed?'RESERVASI DIKONFIRMASI':r.status==='PENDING_PAYMENT'?'BUKTI PERLU DIPERBAIKI':r.status==='EXPIRED'?'RESERVASI KEDALUWARSA':'BUKTI DP DITERIMA';$('#pending-title').textContent=confirmed?'Tempatmu sudah siap.':r.status==='PENDING_PAYMENT'?'Kirim ulang bukti DP':r.status==='EXPIRED'?'Waktu pembayaran habis':'Menunggu verifikasi';$('#status-description').textContent=confirmed?'Sampai bertemu saat berbuka di TEACO.':r.status==='PENDING_PAYMENT'?'Admin belum menyetujui bukti sebelumnya.':r.status==='EXPIRED'?'Silakan buat reservasi baru.':'Admin akan memeriksa pembayaranmu.';$('#booking-code').textContent=r.code;$('#ticket-details').innerHTML=row('Tanggal',dateText(r.visit_date,true))+row('Tamu',r.guest_count+' orang')+row('Tempat',seats.map(s=>s.name).join(' + '));$('#reupload-proof').hidden=r.status!=='PENDING_PAYMENT';}
$('#refresh-booking').addEventListener('click',()=>busy($('#refresh-booking'),async()=>{try{const result=await request('holds/'+state.booking.id);state.booking=result.reservation;saveBooking();renderTicket(result.seats);toast('Status diperbarui.');}catch(error){toast(error.message);}}));
$('#copy-code').addEventListener('click',async()=>{try{await navigator.clipboard.writeText(state.booking.code);toast('Kode disalin.');}catch{toast('Kode: '+state.booking.code);}});
$('#new-booking').addEventListener('click',()=>{state.booking=null;state.token=null;storage.remove('teaco-booking',true);setScreen('date-screen');loadCalendar();});
$('.brand').addEventListener('click',async event=>{event.preventDefault();await releaseHold();setScreen('date-screen');loadCalendar();});
$('#reupload-proof').addEventListener('click',async()=>{try{const result=await request('holds/'+state.booking.id);state.public.payment=result.payment;renderPayment(result.seats);$('#customer-name').value=state.booking.customer_name||'';setScreen('payment-screen');}catch(error){toast(error.message);}});
$$('[data-back]').forEach(button=>button.addEventListener('click',async()=>{try{if(button.dataset.back==='date-screen'){await releaseHold();setScreen('date-screen');loadCalendar();}else{await loadSeats();setScreen(button.dataset.back);}}catch(error){toast(error.message);}}));
$('#open-lookup').addEventListener('click',()=>{$('#lookup-error').textContent='';openDialog('lookup-dialog');});
$('#lookup-form').addEventListener('submit',event=>{event.preventDefault();busy(event.target.querySelector('button[type=submit]'),async()=>{try{const result=await post('reservations/lookup',Object.fromEntries(new FormData(event.target)));state.booking=result.reservation;state.token=result.token;saveBooking();renderTicket(result.seats);$('#lookup-dialog').close();setScreen('pending-screen');}catch(error){$('#lookup-error').textContent=error.message;}});});

async function openAdmin(){
  history.replaceState(null,'','#/admin');
  try{const session=await request('auth/session');state.setup=session.setupAllowed;if(session.authenticated){await loadAdmin();setScreen('admin-screen');return;}$('#login-title').textContent=state.setup?'Buat akun admin.':'Selamat datang.';$('#login-subtitle').textContent=state.setup?'Buat akun pertama untuk pengujian lokal.':'Masuk untuk mengelola reservasi.';$('#login-submit').innerHTML=(state.setup?'Buat akun':'Masuk')+' '+icon('arrow');$('#login-form [name=password]').minLength=state.setup?10:1;$('#login-form [name=password]').autocomplete=state.setup?'new-password':'current-password';$('#login-error').textContent='';$('#login-submit').disabled=false;}
  catch(error){state.setup=false;$('#login-error').textContent=error.status===503?'Panel admin belum terhubung ke database production.':error.message;$('#login-submit').disabled=true;}
  setScreen('login-screen');
}
$('#open-admin').addEventListener('click',openAdmin);
$('#show-password').addEventListener('click',()=>{const field=$('#login-form [name=password]'),hidden=field.type==='password';field.type=hidden?'text':'password';$('#show-password').textContent=hidden?'Sembunyi':'Lihat';$('#show-password').setAttribute('aria-label',hidden?'Sembunyikan password':'Tampilkan password');});
$('#login-form').addEventListener('submit',event=>{event.preventDefault();busy($('#login-submit'),async()=>{try{await post('auth/'+(state.setup?'setup':'login'),Object.fromEntries(new FormData(event.target)));event.target.reset();await loadAdmin();setScreen('admin-screen');}catch(error){$('#login-error').textContent=error.message;}});});
$('#logout').addEventListener('click',async()=>{try{await post('auth/logout',{});state.admin=null;await openAdmin();}catch(error){toast(error.message);}});
async function loadAdmin(){state.admin=await request('admin/dashboard');renderAdmin();}
function setAdminTab(tab){state.tab=tab;$$('.admin-tab').forEach(el=>el.classList.toggle('active',el.id==='admin-'+tab));$$('.nav-item').forEach(el=>el.classList.toggle('active',el.dataset.adminTab===tab));$('#admin-title').textContent={overview:'Dashboard',reservations:'Reservasi',menus:'Menu kasir',settings:'Pengaturan',data:'Data'}[tab];history.replaceState(null,'','#/admin/'+tab);}
$$('[data-admin-tab]').forEach(button=>button.addEventListener('click',()=>setAdminTab(button.dataset.adminTab)));
function empty(title,description,ico='seat'){return `<div class="empty-state">${icon(ico)}<strong>${escape(title)}</strong><p>${escape(description)}</p></div>`;}
function bookingRows(rows){return rows.length?rows.map(r=>`<button class="booking-row" data-booking="${r.id}" aria-label="Detail reservasi ${escape(r.customer_name)}"><div class="customer-cell"><strong>${escape(r.customer_name)}</strong><small>${escape(r.code)}</small></div><div class="visit-cell"><strong>${dateText(r.visit_date,true)}</strong><small>${r.guest_count} orang</small></div><div class="status-cell">${badge(r.status)}</div>${icon('chevron')}</button>`).join(''):empty('Belum ada reservasi','Booking yang masuk akan tampil di sini.');}
function bindBookingRows(container){container.querySelectorAll('[data-booking]').forEach(button=>button.addEventListener('click',()=>openBookingDetail(button.dataset.booking)));}
function renderAdmin(){
  const data=state.admin;$('#admin-name').textContent=data.admin.username;
  for(const selector of ['#dashboard-date','#reservation-date']){const select=$(selector);if(select.options.length===1)select.innerHTML+=(state.public?.days||[]).map(day=>`<option value="${day.visit_date}">${dateText(day.visit_date,true)}</option>`).join('');}
  renderStats();renderReservationList();
  $('#menu-list').innerHTML=data.menu.length?data.menu.map(p=>`<div class="menu-row"><div><strong>${escape(p.name)}</strong><small>${escape(p.category)} · ID ${escape(p.external_id)}</small></div><span>${money(p.price)}</span></div>`).join(''):empty('Menu belum dihubungkan','Menu akan diambil dari aplikasi kasir, tanpa menu contoh.','list');
  $('#menu-source').textContent=data.menu.length?`${data.menu.length} produk tersinkron`:'Belum ada menu tersinkron';$('#sync-menu').disabled=!data.posConfigured;
  $('#menu-integration-note').textContent=data.posConfigured?(data.draftConfigured?'Menu final siap dikirim sebagai draft kasir.':'Menu dapat diambil; endpoint draft kasir belum dihubungkan.'):'Hubungkan API aplikasi kasir untuk mengambil menu dan membuat draft otomatis.';
  for(const key of ['bank_name','account_number','account_holder'])$('#settings-form').elements[key].value=data.settings[key]||'';
  $('#data-status').innerHTML=`<div class="storage-badge">${icon('database')}${data.storage==='postgres'?'PostgreSQL · database online':'SQLite · database pengujian lokal'}</div><p class="muted">${data.storage==='postgres'?'Data tersimpan di server dan digunakan bersama oleh semua perangkat.':'Data tersimpan di file .data/teaco.sqlite pada komputer ini. Versi Vercel memerlukan koneksi PostgreSQL tersendiri.'}</p>`;
  setAdminTab(state.tab);
}
function renderStats(){
  const date=$('#dashboard-date').value,rows=state.admin.reservations.filter(r=>!date||r.visit_date===date),booked=rows.filter(r=>bookedStatuses.includes(r.status)),pending=rows.filter(r=>r.status==='PENDING_VERIFICATION'),sum=(rows,key)=>rows.reduce((s,r)=>s+Number(r[key]||0),0);
  const verified=rows.filter(r=>r.payment?.status==='VERIFIED'),held=state.admin.holds.filter(r=>!date||r.visit_date===date).reduce((s,r)=>s+Number(r.guests),0);
  const stat=(title,value,foot,cls='')=>`<div class="stat ${cls}"><small>${title}</small><strong>${value}</strong><span>${foot}</span></div>`;
  $('#admin-stats').innerHTML=stat('Reservasi',booked.length,'Sudah dikonfirmasi')+stat('Tamu booked',sum(booked,'guest_count'),'Kursi terkonfirmasi')+stat('Perlu verifikasi',pending.length,'Bukti DP masuk')+stat('DP terverifikasi',money(verified.reduce((s,r)=>s+Number(r.payment.amount),0)),'Pembayaran diterima','money');
  const zones=[['indoor','Indoor',24],['ac','AC',20],['outdoor','Outdoor',44]],dayCount=date?1:28;
  $('#zone-stats').innerHTML=zones.map(([id,name,capacity])=>{const guests=booked.reduce((s,r)=>s+r.seats.filter(seat=>seat.zone_id===id).reduce((s,seat)=>s+Number(seat.guest_count),0),0);return `<div class="zone-stat"><div><strong>${name}</strong><span>${guests} tamu</span></div><div class="zone-track"><i style="width:${Math.min(100,guests/(capacity*dayCount)*100)}%"></i></div></div>`;}).join('');
  $('#admin-tasks').innerHTML=`<div class="task-row"><span>Verifikasi DP</span><b>${pending.length}</b></div><div class="task-row"><span>Belum pilih menu</span><b>${rows.filter(r=>r.status==='CONFIRMED').length}</b></div><div class="task-row"><span>Tamu dalam hold</span><b>${held}</b></div>`;
  $('#recent-reservations').innerHTML=bookingRows(rows.slice(0,5));bindBookingRows($('#recent-reservations'));
}
function renderReservationList(){const q=$('#reservation-search').value.toLowerCase(),status=$('#reservation-status').value,date=$('#reservation-date').value;const rows=state.admin.reservations.filter(r=>(!q||(r.customer_name+' '+r.code).toLowerCase().includes(q))&&(!status||r.status===status)&&(!date||r.visit_date===date));$('#reservation-list').innerHTML=bookingRows(rows);bindBookingRows($('#reservation-list'));}
$('#dashboard-date').addEventListener('change',renderStats);['reservation-search','reservation-status','reservation-date'].forEach(id=>$('#'+id).addEventListener(id==='reservation-search'?'input':'change',renderReservationList));
$('#refresh-admin').addEventListener('click',()=>busy($('#refresh-admin'),async()=>{try{await loadAdmin();toast('Data diperbarui.');}catch(error){if(error.status===401)await openAdmin();else toast(error.message);}}));
$('#settings-form').addEventListener('submit',event=>{event.preventDefault();busy(event.target.querySelector('button[type=submit]'),async()=>{try{await request('admin/settings',{method:'PATCH',body:JSON.stringify(Object.fromEntries(new FormData(event.target)))});await loadAdmin();await loadCalendar();toast('Rekening DP disimpan.');}catch(error){toast(error.message);}});});
$('#sync-menu').addEventListener('click',()=>busy($('#sync-menu'),async()=>{try{const result=await post('admin/menu/sync',{});await loadAdmin();toast(`${result.count} menu dari kasir disinkronkan.`);}catch(error){toast(error.message);}}));
function openBookingDetail(id){
  const r=state.admin.reservations.find(r=>r.id===id);if(!r)return;
  const canMenu=['CONFIRMED','MENU_SELECTED'].includes(r.status),products=state.admin.menu;
  $('#booking-detail').innerHTML=`<p class="eyebrow">DETAIL RESERVASI</p><h2 id="detail-title">${escape(r.customer_name)}</h2><div class="detail-status">${badge(r.status)}</div>${row('Kode',r.code)}${row('Tanggal',dateText(r.visit_date,true))}${row('WhatsApp',r.phone)}${row('Tamu',r.guest_count+' orang')}${row('Tempat',r.seats.map(s=>s.zone+' · '+s.name+' ('+s.guest_count+')').join(', '))}${row('Total DP',money(r.total_transfer))}${r.note?row('Catatan',r.note):''}${r.payment?`<a class="button secondary detail-proof" href="/api/admin/proofs/${r.payment.id}" target="_blank" rel="noopener">${icon('upload')}Lihat bukti DP</a>`:''}${r.status==='PENDING_VERIFICATION'?'<div class="detail-actions"><button class="button danger" data-verify="reject">Tolak bukti</button><button class="button primary" data-verify="approve">Konfirmasi DP '+icon('check')+'</button></div>':''}${canMenu?`<div class="detail-menu-form"><h3>Menu reservasi</h3>${products.length?`<form id="order-form">${products.map(p=>`<div class="order-menu-row"><label for="qty-${p.id}">${escape(p.name)}<small class="muted"> · ${escape(p.category)}</small></label><input id="qty-${p.id}" type="number" inputmode="numeric" value="0" min="0" max="100" data-product="${p.id}" aria-label="Jumlah ${escape(p.name)}"/><textarea rows="1" placeholder="Catatan ${escape(p.name)}" aria-label="Catatan ${escape(p.name)}" data-note="${p.id}" maxlength="300"></textarea></div>`).join('')}<button class="button primary" type="submit">Finalkan menu ${icon('arrow')}</button><p class="muted" style="margin:12px 0 0;font-size:10px">${state.admin.draftConfigured?'Menu final otomatis dikirim sebagai draft kasir.':'Menu disimpan. Pengiriman draft menunggu koneksi kasir.'}</p></form>`:empty('Menu kasir belum tersedia','Sinkronkan menu dari aplikasi kasir sebelum mengisi pesanan.','list')}</div>`:'<div class="inline-notice">Menu dapat diisi setelah DP dikonfirmasi.</div>'}`;
  $$('#booking-detail [data-verify]').forEach(button=>button.addEventListener('click',()=>busy(button,async()=>{try{await post(`admin/reservations/${id}/verify`,{action:button.dataset.verify});await loadAdmin();$('#detail-dialog').close();toast(button.dataset.verify==='approve'?'DP dikonfirmasi. Menu bisa mulai diisi.':'Bukti ditolak. Tamu perlu mengunggah ulang.');}catch(error){toast(error.message);}})));
  for(const item of r.items||[]){const quantity=$(`#order-form [data-product="${item.product_id}"]`),note=$(`#order-form [data-note="${item.product_id}"]`);if(quantity)quantity.value=item.quantity;if(note)note.value=item.note||'';}
  if(r.pos){const notice=document.createElement('p');notice.className='inline-notice';notice.textContent=r.pos.status==='SYNCED'?'Draft kasir: '+r.pos.draft_id:r.pos.status==='NOT_CONFIGURED'?'Menu final tersimpan; integrasi draft kasir belum dihubungkan.':r.pos.status==='FAILED'?'Menu final tersimpan; pengiriman draft kasir perlu dicoba ulang.':'Draft kasir sedang diproses.';$('#booking-detail').append(notice);}
  $('#order-form')?.addEventListener('submit',event=>{event.preventDefault();busy(event.target.querySelector('button[type=submit]'),async()=>{try{const items=$$('#order-form [data-product]').filter(input=>Number(input.value)>0).map(input=>({productId:input.dataset.product,quantity:Number(input.value),note:$(`#order-form [data-note="${input.dataset.product}"]`).value}));const result=await post(`admin/reservations/${id}/menu`,{items});await loadAdmin();$('#detail-dialog').close();toast(result.synced?'Menu final. Draft kasir dibuat.':result.message);}catch(error){toast(error.message);}});});
  openDialog('detail-dialog');
}
window.addEventListener('hashchange',()=>{if(location.hash.startsWith('#/admin'))openAdmin();else{setScreen('date-screen');loadCalendar();}});
async function init(){
  await loadCalendar();
  if(location.hash.startsWith('#/admin')){const tab=location.hash.split('/')[2];if(['overview','reservations','menus','settings','data'].includes(tab))state.tab=tab;return openAdmin();}
  const saved=storage.get('teaco-booking',true);if(saved&&state.public?.ready){try{const value=JSON.parse(saved);state.booking=value.booking;state.token=value.token;const result=await request('holds/'+state.booking.id);state.booking=result.reservation;if(state.booking.status==='HOLD'){state.units=result.units;state.selected=result.seats.map(s=>s.unit_id);renderSeats();setScreen('seat-screen');}else{renderTicket(result.seats);setScreen('pending-screen');}}catch{storage.remove('teaco-booking',true);state.booking=null;state.token=null;}}
}
init();
