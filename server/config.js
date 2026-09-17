export const EVENT = { id: 'ramadan-2027', name: 'Ramadan 2027', start_date: '2027-02-08', end_date: '2027-03-07', daily_capacity: 65, deposit_per_guest: 20000 };
export const ZONES = [
  {id:'indoor',name:'Indoor',capacity:24,units:[['m1','Meja 1',2],['m2','Meja 2',2],['m3','Meja 3',2],['m4','Meja 4',2],['m12','Meja 12',4],['m13','Meja 13',4],['m14','Meja 14',4],['m15','Meja 15',4]]},
  {id:'ac',name:'AC',capacity:20,units:[['ac-right','Sisi kanan',10],['ac-left','Sisi kiri',6]]},
  {id:'outdoor',name:'Outdoor',capacity:44,units:[['tv','Bawah TV',10],['out-right','Sisi kanan',16],['out-left','Sisi kiri',12],['tribun','Tribun',6]]}
];
export const ACTIVE_STATUSES = ['HOLD','PENDING_PAYMENT','PENDING_VERIFICATION','CONFIRMED','MENU_SELECTED','CHECKED_IN','DONE'];
export const BOOKED_STATUSES = ['CONFIRMED','MENU_SELECTED','CHECKED_IN','DONE'];
export const localMode = () => !process.env.VERCEL && process.env.NODE_ENV !== 'production';
export function days() {
  const result = [];
  for(let i=0;i<28;i++) result.push(new Date(Date.parse(EVENT.start_date+'T12:00:00Z')+i*86400000).toISOString().slice(0,10));
  return result;
}
