const EVENT_START = new Date('2027-02-08T12:00:00+07:00');
const DAILY_LIMIT = 65;
const DP_PER_PERSON = 20000;
const usedSeats = [20,31,58,65,16,41,48,60,27,35,14,54,64,19,30,39,51,23,46,65,15,43,57,34,22,49,61,29];
const places = [
  {zone:'Indoor',style:'',seats:[['Meja 1',2,'open'],['Meja 2',2,'taken'],['Meja 3',2,'open'],['Meja 4',2,'open'],['Meja 12',4,'open'],['Meja 13',4,'taken'],['Meja 14',4,'open'],['Meja 15',4,'open']]},
  {zone:'AC',style:'two',seats:[['Sisi kanan',10,'open'],['Sisi kiri',6,'taken']]},
  {zone:'Outdoor',style:'three',seats:[['Bawah TV',10,'taken'],['Kanan',16,'open'],['Kiri',12,'open'],['Tribun',6,'open']]}
];
const cashierMenus = [['Nasi goreng','Makanan'],['Ayam bakar','Makanan'],['Es teh','Minuman'],['Air mineral','Minuman']];
const state = {day:0,guests:4,place:null,split:false,status:'PENDING_PAYMENT',menusLoaded:false};
const $ = selector => document.querySelector(selector);
const rupiah = amount => new Intl.NumberFormat('id-ID',{style:'currency',currency:'IDR',maximumFractionDigits:0}).format(amount);
const dateAt = day => new Date(EVENT_START.getTime()+day*86400000);
const dateText = day => new Intl.DateTimeFormat('id-ID',{weekday:'short',day:'numeric',month:'long',year:'numeric'}).format(dateAt(day));
const remaining = day => DAILY_LIMIT-usedSeats[day];
const setScreen = id => {document.querySelectorAll('.screen').forEach(screen=>screen.classList.toggle('active',screen.id===id));window.scrollTo({top:0,behavior:'instant'});};

function renderCalendar(){
  $('#calendar').innerHTML=usedSeats.map((used,day)=>{const left=DAILY_LIMIT-used,isFull=left===0,limited=left>0&&left<=10,date=dateAt(day);return `<button class="date ${isFull?'full':limited?'limited':''}" data-day="${day}" ${isFull?'disabled':''}><strong>${date.getDate()}</strong><small>${isFull?'Penuh':`${left} sisa`}</small></button>`;}).join('');
  $('#calendar').querySelectorAll('.date:not(:disabled)').forEach(button=>button.addEventListener('click',()=>openGuestDialog(Number(button.dataset.day))));
}
function openGuestDialog(day){state.day=day;state.place=null;$('#selected-date-label').textContent=dateText(day);$('#guest-count').value=state.guests;updateGuestAvailability();$('#guest-dialog').showModal();}
function updateGuestAvailability(){state.guests=Math.max(1,Math.min(20,Number($('#guest-count').value)||1));$('#guest-count').value=state.guests;const left=remaining(state.day);$('#availability').textContent=state.guests<=left?`${left} kursi tersedia`:`Tersisa ${left} kursi; kurangi jumlah tamu.`;$('#start-seat').disabled=state.guests>left;}
function renderSeats(){
  $('#seat-date').textContent=dateText(state.day);$('#seat-guests').textContent=state.guests;
  $('#seat-map').innerHTML=places.map(group=>`<section class="zone"><div class="zone-head"><strong>${group.zone}</strong><small>${group.zone==='Indoor'?'pilih meja':'pilih section'}</small></div><div class="seat-grid ${group.style}">${group.seats.map(([name,capacity,status])=>{const chosen=state.place?.name===name;return `<button class="seat ${status==='taken'?'occupied':''} ${chosen?'chosen':''}" data-place="${name}" data-capacity="${capacity}" ${status==='taken'?'disabled':''}>${name}${chosen?'<svg class="seat-check" viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4 10-10" /></svg>':''}<small>${capacity} kursi</small></button>`;}).join('')}</div></section>`).join('');
  $('#seat-map').querySelectorAll('.seat:not(:disabled)').forEach(button=>button.addEventListener('click',()=>{state.place={name:button.dataset.place,capacity:Number(button.dataset.capacity)};renderSeats();}));updateSelection();
}
function updateSelection(){const action=$('#to-payment');if(!state.place){$('#selection').textContent='Belum memilih tempat.';action.disabled=true;return;}if(state.place.capacity>=state.guests){$('#selection').innerHTML=`<strong>${state.place.name}</strong> untuk ${state.guests} orang.`;action.disabled=false;return;}if(state.split){$('#selection').innerHTML=`<strong>${state.place.capacity} orang</strong> di ${state.place.name}; ${state.guests-state.place.capacity} orang akan dialokasikan ke area lain.`;action.disabled=false;return;}$('#selection').textContent=`${state.place.name} hanya muat ${state.place.capacity} orang.`;action.disabled=true;}
function renderPayment(){$('#payment-summary').innerHTML=`<div class="summary-row"><span>Tanggal</span><strong>${dateText(state.day)}</strong></div><div class="summary-row"><span>Jumlah</span><strong>${state.guests} orang</strong></div><div class="summary-row"><span>Tempat</span><strong>${state.place.name}</strong></div><div class="summary-row"><span>Total DP</span><strong>${rupiah(state.guests*DP_PER_PERSON)}</strong></div>`;}
function renderAdmin(){
  $('#reservation-queue').innerHTML=`<div class="queue-row"><div><strong>TEACO-8FEB-0042</strong><small>${state.guests} orang · ${dateText(state.day)} · ${state.status==='CONFIRMED'?'Sudah dikonfirmasi':'Bukti DP masuk'}</small></div>${state.status==='CONFIRMED'?'<span class="label">Confirmed</span>':'<button class="confirm" id="confirm-dp">Konfirmasi DP <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4 10-10" /></svg></button>'}</div>`;
  $('#menu-list').innerHTML=state.menusLoaded?cashierMenus.map(([name,category])=>`<div class="menu-item"><strong>${name}</strong><small>${category}</small></div>`).join(''):'<p class="hint">Klik “Ambil menu kasir” untuk menampilkan menu aktif.</p>';
  $('#menu-source').textContent=state.menusLoaded?'Menu kasir siap dipakai':'Belum diambil';$('#confirm-dp')?.addEventListener('click',()=>{state.status='CONFIRMED';renderAdmin();});
}

$('#guest-count').addEventListener('input',updateGuestAvailability);
$('#start-seat').addEventListener('click',()=>{$('#guest-dialog').close();renderSeats();setScreen('seat-screen');});
$('#allow-split').addEventListener('change',event=>{state.split=event.target.checked;updateSelection();});
$('#to-payment').addEventListener('click',()=>{renderPayment();setScreen('payment-screen');});
$('#payment-proof').addEventListener('change',event=>{$('#file-name').textContent=event.target.files[0]?.name||'Pilih file';});
$('#submit-payment').addEventListener('click',()=>setScreen('pending-screen'));
$('#new-booking').addEventListener('click',()=>setScreen('date-screen'));
$('#open-admin').addEventListener('click',()=>{renderAdmin();setScreen('admin-screen');});
$('#sync-menu').addEventListener('click',event=>{const button=event.currentTarget;button.classList.add('is-syncing');state.menusLoaded=true;setTimeout(()=>{renderAdmin();button.classList.remove('is-syncing');},350);});
document.querySelectorAll('.back').forEach(button=>button.addEventListener('click',()=>setScreen(button.dataset.back)));
$('.close').addEventListener('click',()=>$('#guest-dialog').close());
renderCalendar();
