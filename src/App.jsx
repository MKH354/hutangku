import { useState, useEffect, useRef } from "react";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";
import { saveData, subscribeData } from "./firebase.js";
import { exportAllToCalendar, exportOneToCalendar, getNextDueDate, daysUntil } from "./calendar.js";

const fmt = (n) => new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", minimumFractionDigits: 0 }).format(n);
const fmtShort = (n) => { if (n>=1e6) return `${(n/1e6).toFixed(1)}jt`; if (n>=1e3) return `${(n/1e3).toFixed(0)}rb`; return n.toLocaleString("id-ID"); };
const fmtDate = (d) => new Date(d).toLocaleDateString("id-ID", { day:"numeric", month:"short", year:"numeric" });

const PALETTE = ["#ff5252","#4d9fff","#ffb347","#a78bfa","#f472b6","#34d399","#60a5fa","#fb923c","#e879f9","#38bdf8","#facc15","#ff8a65"];
const SYNC_KEY = "hutangku_sync_code";
const THEME_KEY = "hutangku_theme";
const CICILAN_TYPES = [
  { value:"paylater", label:"PayLater",         icon:"💳" },
  { value:"pinjol",   label:"Pinjol",            icon:"📱" },
  { value:"angsuran", label:"Angsuran Bulanan",  icon:"🏦" },
  { value:"kredit",   label:"Kredit/Leasing",    icon:"🚗" },
  { value:"lainnya",  label:"Lainnya",           icon:"🔄" },
];

export default function App() {
  /* Theme */
  const [theme, setTheme] = useState(() => {
    const s = localStorage.getItem(THEME_KEY);
    if (s) return s;
    return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  });
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const h = (e) => { if (!localStorage.getItem(THEME_KEY)) setTheme(e.matches?"light":"dark"); };
    mq.addEventListener("change", h);
    return () => mq.removeEventListener("change", h);
  }, []);
  const toggleTheme = () => { const n=theme==="dark"?"light":"dark"; setTheme(n); localStorage.setItem(THEME_KEY,n); };
  const D = theme==="dark";

  /* Sync */
  const [syncCode, setSyncCode] = useState(() => localStorage.getItem(SYNC_KEY)||"");
  const [inputCode, setInputCode] = useState("");
  const [syncing, setSyncing] = useState(false);

  /* Data */
  const [data, setData] = useState({ records:[], cicilans:[] });
  const [loading, setLoading] = useState(true);
  const unsubRef = useRef(null);

  /* UI */
  const [tab, setTab] = useState("rekap");
  const [view, setView] = useState("main");
  const [activeId, setActiveId] = useState(null);
  const [activeCicilanId, setActiveCicilanId] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [showPayForm, setShowPayForm] = useState(false);
  const [showCicilanForm, setShowCicilanForm] = useState(false);
  const [showCicilanPay, setShowCicilanPay] = useState(false);
  const [showSyncModal, setShowSyncModal] = useState(false);
  const [editId, setEditId] = useState(null);
  const [editCicilanId, setEditCicilanId] = useState(null);
  const [filterStatus, setFilterStatus] = useState("all");
  const [toast, setToast] = useState(null);
  const [form, setForm] = useState({ name:"", amount:"", description:"", date:new Date().toISOString().slice(0,10), dueDate:"", status:"belum" });
  const [payForm, setPayForm] = useState({ amount:"", date:new Date().toISOString().slice(0,10), note:"" });
  const [cForm, setCForm] = useState({ name:"", type:"paylater", totalAmount:"", installmentAmount:"", totalInstallments:"", paidInstallments:"0", dueDay:"25", startDate:new Date().toISOString().slice(0,10), notes:"", status:"active" });
  const [cPayForm, setCPayForm] = useState({ amount:"", date:new Date().toISOString().slice(0,10), note:"" });

  /* Firebase */
  const subscribe = (code) => {
    if (unsubRef.current) unsubRef.current();
    unsubRef.current = subscribeData(code, (incoming, exists) => {
      if (exists && incoming) setData({ records:[], cicilans:[], ...incoming });
      setLoading(false); setSyncing(false);
    });
  };
  useEffect(() => {
    if (syncCode) {
      subscribe(syncCode);
      const t = setTimeout(() => setLoading(p => { if(p){showToast("Koneksi lambat. Cek internet.","err");return false;} return p; }), 8000);
      return () => { clearTimeout(t); if(unsubRef.current) unsubRef.current(); };
    } else { setLoading(false); return ()=>{}; }
  }, [syncCode]);

  /* Helpers */
  const showToast = (msg, type="ok") => { setToast({msg,type}); setTimeout(()=>setToast(null),3000); };
  const save = async (nd) => { if(!syncCode) return; setData(nd); try { await saveData(syncCode,nd); } catch(_) { showToast("Gagal menyimpan. Cek koneksi.","err"); } };
  const getPaid   = (r) => (r.payments||[]).reduce((a,b)=>a+b.amount,0);
  const getSisa   = (r) => Math.max(0, r.amount - getPaid(r));
  const getPct    = (r) => Math.min(100, (getPaid(r)/r.amount)*100);
  const isOverdue = (r) => r.dueDate && r.status==="belum" && new Date(r.dueDate)<new Date();
  const activeRecord  = data.records.find(r=>r.id===activeId);
  const activeCicilan = (data.cicilans||[]).find(c=>c.id===activeCicilanId);

  /* HUTANG CRUD */
  const handleSubmit = async () => {
    if (!form.name.trim()||!form.amount||isNaN(Number(form.amount))) { showToast("Nama & jumlah wajib diisi!","err"); return; }
    const rec = { ...form, type:"hutang", amount:Number(form.amount), id:editId||Date.now().toString(), payments:[] };
    if (editId) { const old=data.records.find(r=>r.id===editId); rec.payments=old?.payments||[]; if(getPaid(rec)>=rec.amount) rec.status="lunas"; }
    await save({ ...data, records: editId ? data.records.map(r=>r.id===editId?rec:r) : [rec,...data.records] });
    setShowForm(false); showToast(editId?"Data diperbarui!":"Hutang ditambahkan!");
  };
  const handleAddPayment = async () => {
    const amt=Number(payForm.amount); if(!amt||amt<=0){showToast("Jumlah tidak valid!","err");return;}
    const record=data.records.find(r=>r.id===activeId); if(!record) return;
    const payments=[...(record.payments||[]),{id:Date.now().toString(),amount:amt,date:payForm.date,note:payForm.note}];
    const totalPaid=payments.reduce((a,b)=>a+b.amount,0);
    const newStatus=totalPaid>=record.amount?"lunas":"belum";
    await save({...data,records:data.records.map(r=>r.id===activeId?{...record,payments,status:newStatus}:r)});
    setShowPayForm(false); setPayForm({amount:"",date:new Date().toISOString().slice(0,10),note:""});
    showToast(newStatus==="lunas"?"🎉 Hutang Lunas!":`Angsuran ${fmt(amt)} tercatat!`);
  };
  const deletePayment = async (rid,pid) => {
    const record=data.records.find(r=>r.id===rid);
    const payments=(record.payments||[]).filter(p=>p.id!==pid);
    const totalPaid=payments.reduce((a,b)=>a+b.amount,0);
    await save({...data,records:data.records.map(r=>r.id===rid?{...record,payments,status:totalPaid>=record.amount?"lunas":"belum"}:r)});
    showToast("Angsuran dihapus.","err");
  };
  const deleteRecord = async (id) => { await save({...data,records:data.records.filter(r=>r.id!==id)}); setView("main"); setActiveId(null); showToast("Catatan dihapus.","err"); };
  const toggleStatus = async (id) => { const r=data.records.find(x=>x.id===id); await save({...data,records:data.records.map(x=>x.id===id?{...r,status:r.status==="lunas"?"belum":"lunas"}:x)}); showToast("Status diperbarui!"); };
  const openEdit = (r) => { setEditId(r.id); setForm({name:r.name,amount:String(r.amount),description:r.description||"",date:r.date,dueDate:r.dueDate||"",status:r.status}); setShowForm(true); };
  const openAdd  = () => { setEditId(null); setForm({name:"",amount:"",description:"",date:new Date().toISOString().slice(0,10),dueDate:"",status:"belum"}); setShowForm(true); };

  /* CICILAN CRUD */
  const handleCicilanSubmit = async () => {
    if (!cForm.name.trim()||!cForm.installmentAmount||!cForm.totalInstallments) { showToast("Data cicilan tidak lengkap!","err"); return; }
    const c = { ...cForm, id:editCicilanId||Date.now().toString(), totalAmount:Number(cForm.totalAmount)||Number(cForm.installmentAmount)*Number(cForm.totalInstallments), installmentAmount:Number(cForm.installmentAmount), totalInstallments:Number(cForm.totalInstallments), paidInstallments:Number(cForm.paidInstallments)||0, dueDay:Number(cForm.dueDay), payments:[] };
    if (editCicilanId) { const old=(data.cicilans||[]).find(x=>x.id===editCicilanId); c.payments=old?.payments||[]; c.paidInstallments=old?.paidInstallments||c.paidInstallments; }
    if (c.paidInstallments>=c.totalInstallments) c.status="done";
    const cicilans = editCicilanId ? (data.cicilans||[]).map(x=>x.id===editCicilanId?c:x) : [c,...(data.cicilans||[])];
    await save({...data,cicilans}); setShowCicilanForm(false); showToast(editCicilanId?"Cicilan diperbarui!":"Cicilan ditambahkan!");
  };
  const handleCicilanPay = async () => {
    const amt=Number(cPayForm.amount); if(!amt||amt<=0){showToast("Jumlah tidak valid!","err");return;}
    const c=(data.cicilans||[]).find(x=>x.id===activeCicilanId); if(!c) return;
    const payments=[...(c.payments||[]),{id:Date.now().toString(),amount:amt,date:cPayForm.date,note:cPayForm.note}];
    const newPaid=c.paidInstallments+1;
    const newStatus=newPaid>=c.totalInstallments?"done":"active";
    await save({...data,cicilans:(data.cicilans||[]).map(x=>x.id===activeCicilanId?{...c,payments,paidInstallments:newPaid,status:newStatus}:x)});
    setShowCicilanPay(false); setCPayForm({amount:"",date:new Date().toISOString().slice(0,10),note:""});
    showToast(newStatus==="done"?"🎉 Cicilan Selesai!":`Angsuran ke-${newPaid} tercatat!`);
  };
  const deleteCicilanPayment = async (cid,pid) => {
    const c=(data.cicilans||[]).find(x=>x.id===cid);
    const payments=(c.payments||[]).filter(p=>p.id!==pid);
    const newPaid=Math.max(0,c.paidInstallments-1);
    await save({...data,cicilans:(data.cicilans||[]).map(x=>x.id===cid?{...c,payments,paidInstallments:newPaid,status:newPaid>=c.totalInstallments?"done":"active"}:x)});
    showToast("Pembayaran dihapus.","err");
  };
  const deleteCicilan = async (id) => { await save({...data,cicilans:(data.cicilans||[]).filter(c=>c.id!==id)}); setView("main"); setActiveCicilanId(null); showToast("Cicilan dihapus.","err"); };
  const openCicilanEdit = (c) => { setEditCicilanId(c.id); setCForm({name:c.name,type:c.type,totalAmount:String(c.totalAmount),installmentAmount:String(c.installmentAmount),totalInstallments:String(c.totalInstallments),paidInstallments:String(c.paidInstallments),dueDay:String(c.dueDay),startDate:c.startDate,notes:c.notes||"",status:c.status}); setShowCicilanForm(true); };
  const openCicilanAdd  = () => { setEditCicilanId(null); setCForm({name:"",type:"paylater",totalAmount:"",installmentAmount:"",totalInstallments:"",paidInstallments:"0",dueDay:"25",startDate:new Date().toISOString().slice(0,10),notes:"",status:"active"}); setShowCicilanForm(true); };

  /* Calendar */
  const handleExportAll = () => { const ok=exportAllToCalendar(data.records,data.cicilans||[]); showToast(ok?"📅 File kalender diunduh! Buka untuk import.":"Tidak ada jatuh tempo aktif."); };

  /* Sync code */
  const handleSetSyncCode = () => { const code=inputCode.trim().toLowerCase().replace(/\s+/g,"-"); if(code.length<4){showToast("Kode minimal 4 karakter!","err");return;} localStorage.setItem(SYNC_KEY,code); setSyncCode(code); setSyncing(true); setLoading(true); setShowSyncModal(false); showToast(`Terhubung ke: ${code}`); };
  const handleLogout = () => { localStorage.removeItem(SYNC_KEY); setSyncCode(""); setData({records:[],cicilans:[]}); setView("main"); setTab("rekap"); };

  /* Stats */
  const allBelum      = data.records.filter(r=>r.status==="belum");
  const allLunas      = data.records.filter(r=>r.status==="lunas");
  const totalHutang   = data.records.reduce((a,b)=>a+b.amount,0);
  const totalTerbayar = data.records.reduce((a,b)=>a+getPaid(b),0);
  const totalSisa     = allBelum.reduce((a,b)=>a+getSisa(b),0);
  const filtered      = data.records.filter(r=>filterStatus==="all"||r.status===filterStatus);
  const cicilans      = data.cicilans||[];
  const activeCicilans= cicilans.filter(c=>c.status==="active");
  const totalCicilanBulan = activeCicilans.reduce((a,c)=>a+c.installmentAmount,0);
  const overallDonut = [{name:"Sudah Dibayar",value:totalTerbayar,color:"#00e5a0"},{name:"Sisa Hutang",value:totalSisa,color:"#ff5252"}].filter(d=>d.value>0);
  const donutPerOrang = allBelum.filter(r=>getSisa(r)>0).map((r,i)=>({name:r.name,value:getSisa(r),color:PALETTE[i%PALETTE.length]}));

  const CustomTip = ({ active, payload }) => {
    if (!active||!payload?.length) return null; const d=payload[0];
    return <div style={{background:D?"#1a1d27":"#fff",border:`1px solid ${D?"#2e3350":"#dde1ee"}`,borderRadius:10,padding:"10px 14px"}}><div style={{fontSize:12,fontWeight:700,color:d.payload.color,marginBottom:4}}>{d.name}</div><div style={{fontFamily:"monospace",fontSize:13,color:D?"#e8eaf6":"#1a1d2e"}}>{fmt(d.value)}</div></div>;
  };

  const cv = D
    ? "--bg:#0f1117;--surface:#1a1d27;--surface2:#22263a;--border:#2e3350;--text:#e8eaf6;--muted:#7b82a8;--shadow:rgba(0,0,0,.4);"
    : "--bg:#f5f7fc;--surface:#ffffff;--surface2:#eef0f8;--border:#dde1ee;--text:#1a1d2e;--muted:#6b7394;--shadow:rgba(100,110,160,.12);";

  const css = `
    @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=DM+Mono:wght@400;500&display=swap');
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
    :root{${cv}--green:#00e5a0;--red:#ff5252;--blue:#4d9fff;--orange:#ffb347;--purple:#a78bfa;--radius:14px;}
    body{background:var(--bg);font-family:'Plus Jakarta Sans',sans-serif;color:var(--text);-webkit-font-smoothing:antialiased;transition:background .25s,color .25s}
    .app{min-height:100vh;padding-bottom:90px;background-image:radial-gradient(ellipse at 20% 0%,rgba(255,82,82,.07) 0%,transparent 55%),radial-gradient(ellipse at 80% 15%,rgba(77,159,255,.05) 0%,transparent 55%)}
    .header{padding:28px 24px 0;display:flex;justify-content:space-between;align-items:flex-start}
    .h-left{display:flex;align-items:center;gap:10px}
    .back-btn{width:34px;height:34px;border-radius:10px;border:1px solid var(--border);background:var(--surface2);color:var(--muted);cursor:pointer;font-size:16px;display:flex;align-items:center;justify-content:center;flex-shrink:0}
    .h-label{font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);margin-bottom:3px}
    .h-title{font-size:26px;font-weight:800;background:linear-gradient(135deg,${D?"#fff":"#1a1d2e"} 30%,var(--red));-webkit-background-clip:text;-webkit-text-fill-color:transparent}
    .h-title.sm{font-size:20px}.h-title.purple{background:linear-gradient(135deg,${D?"#fff":"#1a1d2e"} 30%,var(--purple));-webkit-background-clip:text;-webkit-text-fill-color:transparent}
    .hdr-actions{display:flex;align-items:center;gap:8px}
    .theme-btn{width:34px;height:34px;border-radius:10px;border:1px solid var(--border);background:var(--surface2);color:var(--muted);cursor:pointer;font-size:16px;display:flex;align-items:center;justify-content:center}
    .add-btn{background:var(--red);color:#fff;border:none;border-radius:50px;padding:10px 20px;font-family:inherit;font-weight:700;font-size:14px;cursor:pointer;box-shadow:0 0 20px rgba(255,82,82,.3);transition:transform .15s}
    .add-btn:hover{transform:translateY(-1px)}.add-btn.purple{background:var(--purple);box-shadow:0 0 20px rgba(167,139,250,.3)}
    .pay-btn{background:var(--blue);color:#fff;border:none;border-radius:50px;padding:10px 20px;font-family:inherit;font-weight:700;font-size:14px;cursor:pointer;transition:transform .15s}
    .pay-btn:hover{transform:translateY(-1px)}.pay-btn:disabled{opacity:.4;cursor:not-allowed;transform:none}
    .sync-row{display:flex;align-items:center;justify-content:space-between;padding:12px 24px 0}
    .sync-badge{display:inline-flex;align-items:center;gap:6px;background:var(--surface);border:1px solid var(--border);border-radius:50px;padding:6px 12px;cursor:pointer;font-size:12px;font-weight:600;color:var(--muted)}
    .sync-badge:hover{border-color:var(--blue);color:var(--blue)}
    .sync-dot{width:7px;height:7px;border-radius:50%;background:var(--green);flex-shrink:0;animation:pulse 2s infinite}
    .sync-dot.off{background:var(--muted);animation:none}
    @keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
    .cal-btn{background:var(--surface2);color:var(--muted);border:1px solid var(--border);border-radius:50px;padding:7px 12px;font-family:inherit;font-weight:700;font-size:12px;cursor:pointer;display:flex;align-items:center;gap:4px}
    .cal-btn:hover{border-color:var(--green);color:var(--green)}
    .bottom-nav{position:fixed;bottom:0;left:0;right:0;background:var(--surface);border-top:1px solid var(--border);display:flex;z-index:50;box-shadow:0 -4px 20px var(--shadow)}
    .nav-btn{flex:1;padding:12px 0 16px;background:none;border:none;font-family:inherit;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--muted);cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:3px;transition:color .15s}
    .nav-btn .ni{font-size:20px}
    .nav-btn.act-red{color:var(--red)}.nav-btn.act-blue{color:var(--blue)}.nav-btn.act-purple{color:var(--purple)}
    .rekap{padding:16px 24px 0}
    .hero-card{background:var(--surface);border:1px solid var(--border);border-radius:20px;padding:24px;margin-bottom:16px;position:relative;overflow:hidden;text-align:center;box-shadow:0 2px 12px var(--shadow)}
    .hero-card::before{content:'';position:absolute;top:0;left:0;right:0;height:3px;background:linear-gradient(90deg,var(--red),#ff8a65)}
    .hero-eyebrow{font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);margin-bottom:8px}
    .hero-amount{font-family:'DM Mono',monospace;font-size:36px;font-weight:500;color:var(--red);margin-bottom:4px}
    .hero-sub{font-size:12px;color:var(--muted)}
    .stat-row{display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:16px}
    .stat-card{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:14px;text-align:center;box-shadow:0 1px 6px var(--shadow)}
    .stat-label{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.09em;color:var(--muted);margin-bottom:6px}
    .stat-val{font-family:'DM Mono',monospace;font-size:15px;font-weight:500}
    .sv-r{color:var(--red)}.sv-g{color:var(--green)}.sv-b{color:var(--blue)}.sv-p{color:var(--purple)}.sv-o{color:var(--orange)}
    .stat-sub{font-size:10px;color:var(--muted);margin-top:3px}
    .donut-card{background:var(--surface);border:1px solid var(--border);border-radius:18px;padding:20px;margin-bottom:16px;box-shadow:0 1px 6px var(--shadow)}
    .donut-title{font-size:14px;font-weight:700;margin-bottom:2px}
    .donut-sub{font-size:12px;color:var(--muted);margin-bottom:16px}
    .legend-list{display:flex;flex-direction:column;gap:8px;margin-top:16px}
    .legend-item{display:flex;align-items:center;gap:10px}
    .legend-dot{width:10px;height:10px;border-radius:50%;flex-shrink:0}
    .legend-name{flex:1;font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .legend-val{font-family:'DM Mono',monospace;font-size:12px;color:var(--muted);flex-shrink:0}
    .legend-pct{font-size:11px;font-weight:700;color:var(--muted);background:var(--surface2);padding:2px 7px;border-radius:50px;flex-shrink:0}
    .no-data{text-align:center;padding:30px;color:var(--muted);font-size:14px}
    .cicilan-summary{background:var(--surface);border:1px solid rgba(167,139,250,.3);border-radius:18px;padding:18px;margin-bottom:16px;box-shadow:0 1px 6px var(--shadow);position:relative;overflow:hidden}
    .cicilan-summary::before{content:'';position:absolute;top:0;left:0;right:0;height:3px;background:linear-gradient(90deg,var(--purple),#c4b5fd)}
    .cs-row{display:flex;justify-content:space-between;align-items:center;margin-bottom:6px}
    .cs-title{font-size:14px;font-weight:700}
    .cs-val{font-family:'DM Mono',monospace;font-size:18px;font-weight:600;color:var(--purple)}
    .cs-sub{font-size:12px;color:var(--muted)}
    .filters{padding:14px 24px 0;display:flex;gap:6px}
    .filter-btn{background:var(--surface);border:1px solid var(--border);border-radius:50px;padding:6px 14px;font-family:inherit;font-size:12px;font-weight:600;color:var(--muted);cursor:pointer}
    .filter-btn.active{background:var(--surface2);border-color:var(--blue);color:var(--blue)}
    .records{padding:14px 24px 0;display:flex;flex-direction:column;gap:10px}
    .record-card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:14px 16px;cursor:pointer;transition:border-color .15s,transform .1s,box-shadow .15s;animation:slideIn .25s ease;box-shadow:0 1px 6px var(--shadow)}
    .record-card:hover{border-color:var(--blue);transform:translateY(-1px);box-shadow:0 4px 16px var(--shadow)}
    .record-card.lunas{opacity:.5}
    @keyframes slideIn{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
    .rc-top{display:flex;align-items:center;gap:12px}
    .rc-dot{width:10px;height:10px;border-radius:50%;flex-shrink:0}
    .rc-info{flex:1;min-width:0}
    .rc-name{font-weight:700;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .rc-sub{font-size:12px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:1px}
    .rc-right{display:flex;flex-direction:column;align-items:flex-end;gap:2px}
    .rc-amount{font-family:'DM Mono',monospace;font-size:14px;font-weight:600;color:var(--red)}
    .rc-amount.done{color:var(--muted);text-decoration:line-through}.rc-amount.purple{color:var(--purple)}
    .rc-sisa-txt{font-family:'DM Mono',monospace;font-size:11px;color:var(--muted)}
    .prog-wrap{margin-top:10px}
    .prog-bg{height:5px;background:var(--surface2);border-radius:99px;overflow:hidden}
    .prog-fill{height:100%;border-radius:99px;background:linear-gradient(90deg,var(--blue),var(--green));transition:width .4s}
    .prog-fill.purple{background:linear-gradient(90deg,var(--purple),#c4b5fd)}
    .prog-label{display:flex;justify-content:space-between;font-size:10px;color:var(--muted);margin-top:4px}
    .rc-badges{display:flex;gap:5px;margin-top:8px;align-items:center;flex-wrap:wrap}
    .badge{font-size:10px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;padding:2px 8px;border-radius:50px}
    .badge.lunas{background:rgba(0,229,160,.1);color:var(--green);border:1px solid rgba(0,229,160,.2)}
    .badge.overdue{background:rgba(255,82,82,.1);color:var(--red)}
    .badge.muted{background:var(--surface2);color:var(--muted)}
    .badge.belum{background:rgba(255,82,82,.08);color:var(--red)}
    .badge.purple{background:rgba(167,139,250,.12);color:var(--purple)}
    .badge.soon{background:rgba(255,179,71,.15);color:var(--orange)}
    .empty-state{text-align:center;padding:50px 24px;color:var(--muted)}
    .empty-state .emo{font-size:36px;margin-bottom:10px}
    .empty-state p{font-size:14px;line-height:1.7}
    .detail-hero{margin:20px 24px 0;background:var(--surface);border:1px solid var(--border);border-radius:18px;padding:22px;position:relative;overflow:hidden;box-shadow:0 2px 12px var(--shadow)}
    .detail-hero::before{content:'';position:absolute;top:0;left:0;right:0;height:3px}
    .dh-red::before{background:linear-gradient(90deg,var(--red),transparent)}
    .dh-purple::before{background:linear-gradient(90deg,var(--purple),transparent)}
    .d-name{font-size:22px;font-weight:800;margin-bottom:4px}
    .d-desc{font-size:13px;color:var(--muted);margin-bottom:18px}
    .d-amounts{display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:16px}
    .amt-block{background:var(--surface2);border-radius:10px;padding:12px;text-align:center}
    .amt-label{font-size:10px;color:var(--muted);font-weight:700;text-transform:uppercase;letter-spacing:.08em;margin-bottom:6px}
    .amt-val{font-family:'DM Mono',monospace;font-size:13px;font-weight:500}
    .av-paid{color:var(--blue)}.av-sisa{color:var(--red)}.av-purple{color:var(--purple)}
    .d-prog-bg{height:10px;background:var(--surface2);border-radius:99px;overflow:hidden;margin-bottom:6px}
    .d-prog-fill{height:100%;border-radius:99px;transition:width .5s}
    .dpf-red{background:linear-gradient(90deg,var(--blue),var(--green))}
    .dpf-purple{background:linear-gradient(90deg,var(--purple),#c4b5fd)}
    .d-prog-label{display:flex;justify-content:space-between;font-size:11px;color:var(--muted)}
    .d-meta{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px}
    .d-next-due{background:rgba(167,139,250,.1);border:1px solid rgba(167,139,250,.25);border-radius:12px;padding:12px 16px;margin-top:14px;display:flex;justify-content:space-between;align-items:center}
    .dnd-label{font-size:12px;color:var(--muted);font-weight:600;margin-bottom:4px}
    .dnd-val{font-size:13px;font-weight:700;color:var(--purple)}
    .detail-actions{margin:12px 24px 0;display:grid;grid-template-columns:1fr 1fr;gap:10px}
    .action-btn{padding:12px;border-radius:12px;border:1px solid var(--border);background:var(--surface);font-family:inherit;font-weight:700;font-size:13px;color:var(--muted);cursor:pointer;transition:all .15s}
    .action-btn:hover{border-color:var(--blue);color:var(--blue)}
    .action-btn.danger:hover{border-color:var(--red);color:var(--red)}
    .action-btn.cal:hover{border-color:var(--green);color:var(--green)}
    .section-title{padding:20px 24px 10px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:var(--muted)}
    .pay-list{padding:0 24px;display:flex;flex-direction:column;gap:8px}
    .pay-item{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:13px 15px;display:flex;align-items:center;gap:12px;animation:slideIn .2s ease;box-shadow:0 1px 4px var(--shadow)}
    .pay-icon{width:32px;height:32px;border-radius:8px;background:rgba(77,159,255,.12);color:var(--blue);display:flex;align-items:center;justify-content:center;font-size:14px;flex-shrink:0}
    .pay-icon.purple{background:rgba(167,139,250,.12);color:var(--purple)}
    .pay-info{flex:1;min-width:0}.pay-date{font-size:12px;color:var(--muted)}.pay-note{font-size:12px;font-weight:600}
    .pay-amount{font-family:'DM Mono',monospace;font-size:14px;font-weight:600;color:var(--blue);flex-shrink:0}
    .pay-del{width:26px;height:26px;border-radius:6px;border:1px solid var(--border);background:transparent;color:var(--muted);cursor:pointer;font-size:11px;display:flex;align-items:center;justify-content:center;flex-shrink:0}
    .pay-del:hover{border-color:var(--red);color:var(--red)}
    .overlay{position:fixed;inset:0;background:rgba(0,0,0,.65);display:flex;align-items:flex-end;z-index:100;animation:fadeIn .2s}
    @keyframes fadeIn{from{opacity:0}to{opacity:1}}
    .modal{width:100%;background:var(--surface);border-radius:20px 20px 0 0;padding:24px;animation:slideUp .25s ease;max-height:92vh;overflow-y:auto;border-top:1px solid var(--border)}
    @keyframes slideUp{from{transform:translateY(100%)}to{transform:translateY(0)}}
    .modal-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:20px}
    .modal-title{font-size:18px;font-weight:800}
    .close-btn{width:32px;height:32px;border-radius:50%;border:1px solid var(--border);background:var(--surface2);color:var(--muted);cursor:pointer;font-size:18px;display:flex;align-items:center;justify-content:center}
    .type-tabs{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:16px}
    .type-tab{padding:7px 12px;border-radius:50px;border:1.5px solid var(--border);font-family:inherit;font-size:12px;font-weight:700;color:var(--muted);cursor:pointer;background:var(--surface2)}
    .type-tab.active{border-color:var(--purple);color:var(--purple);background:rgba(167,139,250,.1)}
    .form-group{margin-bottom:14px}
    .form-label{font-size:12px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.08em;margin-bottom:6px;display:block}
    .form-input{width:100%;background:var(--surface2);border:1px solid var(--border);border-radius:10px;padding:12px 14px;font-family:inherit;font-size:14px;color:var(--text);outline:none;transition:border-color .15s}
    .form-input:focus{border-color:var(--blue)}
    .form-row{display:grid;grid-template-columns:1fr 1fr;gap:10px}
    .submit-btn{width:100%;border:none;border-radius:12px;padding:14px;font-family:inherit;font-weight:800;font-size:15px;cursor:pointer;margin-top:8px}
    .sb-red{background:var(--red);color:#fff}.sb-blue{background:var(--blue);color:#fff}.sb-purple{background:var(--purple);color:#fff}.sb-muted{background:var(--surface2);color:var(--red)}
    .pay-info-box{background:var(--surface2);border-radius:12px;padding:14px;margin-bottom:16px}
    .pib-row{display:flex;justify-content:space-between;align-items:center}
    .pib-row+.pib-row{margin-top:8px;padding-top:8px;border-top:1px solid var(--border)}
    .pib-label{font-size:12px;color:var(--muted);font-weight:600}
    .pib-val{font-family:'DM Mono',monospace;font-size:13px;font-weight:600}
    .setup-screen{min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:40px 24px;text-align:center;background-image:radial-gradient(ellipse at 50% 20%,rgba(255,82,82,.1) 0%,transparent 60%)}
    .setup-logo{font-size:56px;margin-bottom:24px}
    .setup-title{font-size:28px;font-weight:800;background:linear-gradient(135deg,${D?"#fff":"#1a1d2e"} 30%,var(--red));-webkit-background-clip:text;-webkit-text-fill-color:transparent;margin-bottom:10px}
    .setup-desc{font-size:14px;color:var(--muted);line-height:1.7;margin-bottom:32px;max-width:300px}
    .setup-box{width:100%;max-width:340px;background:var(--surface);border:1px solid var(--border);border-radius:18px;padding:24px}
    .setup-hint{font-size:12px;color:var(--muted);margin-top:10px;line-height:1.6}
    .toast{position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:${D?"#fff":"#1a1d27"};color:${D?"#111":"#fff"};padding:10px 20px;border-radius:50px;font-size:13px;font-weight:700;z-index:200;white-space:nowrap;box-shadow:0 4px 24px rgba(0,0,0,.35);animation:toastIn .25s ease}
    .toast.err{background:var(--red);color:#fff}
    @keyframes toastIn{from{opacity:0;transform:translateX(-50%) translateY(8px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}
    .loading{min-height:100vh;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:14px;color:var(--muted);font-size:14px}
    .spinner{width:32px;height:32px;border:3px solid var(--border);border-top-color:var(--red);border-radius:50%;animation:spin .7s linear infinite}
    @keyframes spin{to{transform:rotate(360deg)}}
  `;

  /* ─── Setup ─── */
  if (!syncCode) return (
    <><style>{css}</style>
    <div className="setup-screen">
      <div className="setup-logo">💸</div>
      <div className="setup-title">HutangKu</div>
      <div className="setup-desc">Buat <strong>Kode Sinkron</strong> untuk menyimpan & sinkronkan data di semua perangkat.</div>
      <div className="setup-box">
        <div className="form-group"><label className="form-label">Kode Sinkron Kamu</label>
          <input className="form-input" placeholder="cth: budi-hutangku-2024" value={inputCode} onChange={e=>setInputCode(e.target.value)} onKeyDown={e=>e.key==="Enter"&&handleSetSyncCode()} /></div>
        <button className="submit-btn sb-red" onClick={handleSetSyncCode}>Mulai Pakai →</button>
        <div className="setup-hint">⚠️ Gunakan kode yang <strong>unik</strong>. Kode ini dipakai untuk sinkron di semua perangkat.</div>
      </div>
    </div>
    {toast && <div className={`toast ${toast.type==="err"?"err":""}`}>{toast.msg}</div>}
    </>
  );

  /* ─── Loading ─── */
  if (loading) return (
    <><style>{css}</style>
    <div className="loading"><div className="spinner"/><span>Menghubungkan ke cloud…</span></div>
    </>
  );

  /* ─── Detail Hutang ─── */
  if (view==="detail-hutang" && activeRecord) {
    const r=activeRecord; const paid=getPaid(r),sisa=getSisa(r),pct=getPct(r);
    return (
      <><style>{css}</style>
      <div className="app">
        <div className="header">
          <div className="h-left"><button className="back-btn" onClick={()=>setView("main")}>←</button>
            <div><div className="h-label">Detail Hutang</div><div className="h-title sm">{r.name}</div></div></div>
          <button className="pay-btn" disabled={r.status==="lunas"} onClick={()=>{setPayForm({amount:"",date:new Date().toISOString().slice(0,10),note:""});setShowPayForm(true);}}>+ Bayar</button>
        </div>
        <div className="detail-hero dh-red">
          <div className="d-name">{r.name}</div>{r.description&&<div className="d-desc">{r.description}</div>}
          <div className="d-amounts">
            <div className="amt-block"><div className="amt-label">Total</div><div className="amt-val">{fmt(r.amount)}</div></div>
            <div className="amt-block"><div className="amt-label">Terbayar</div><div className="amt-val av-paid">{fmt(paid)}</div></div>
            <div className="amt-block"><div className="amt-label">Sisa</div><div className="amt-val av-sisa">{fmt(sisa)}</div></div>
          </div>
          <div className="d-prog-bg"><div className="d-prog-fill dpf-red" style={{width:`${pct}%`}}/></div>
          <div className="d-prog-label"><span>{pct.toFixed(0)}% terbayar · {(r.payments||[]).length}x</span><span>{sisa>0?`Sisa ${fmt(sisa)}`:"✓ Lunas!"}</span></div>
          <div className="d-meta">
            {r.status==="lunas"?<span className="badge lunas">✓ Lunas</span>:<span className="badge belum">Belum Lunas</span>}
            {isOverdue(r)&&<span className="badge overdue">⚠ Lewat JT</span>}
            <span className="badge muted">📅 {fmtDate(r.date)}</span>
            {r.dueDate&&<span className="badge muted">⏰ JT {fmtDate(r.dueDate)}</span>}
          </div>
        </div>
        <div className="detail-actions">
          <button className="action-btn" onClick={()=>openEdit(r)}>✎ Edit</button>
          <button className="action-btn" onClick={()=>toggleStatus(r.id)}>{r.status==="lunas"?"↩ Batal Lunas":"✓ Tandai Lunas"}</button>
          {r.dueDate&&r.status!=="lunas"&&<button className="action-btn cal" onClick={()=>{const ok=exportOneToCalendar(r,"hutang");showToast(ok?"📅 Ditambahkan ke kalender!":"Tidak ada jatuh tempo.");}}>📅 Simpan ke Kalender</button>}
          <button className="action-btn danger" style={{gridColumn:"1/-1"}} onClick={()=>deleteRecord(r.id)}>✕ Hapus Catatan</button>
        </div>
        <div className="section-title">Riwayat Angsuran ({(r.payments||[]).length})</div>
        <div className="pay-list">
          {(r.payments||[]).length===0?<div className="empty-state"><div className="emo">💸</div><p>Belum ada angsuran.<br/>Tekan <strong>+ Bayar</strong>.</p></div>
          :[...(r.payments||[])].reverse().map(p=>(
            <div key={p.id} className="pay-item">
              <div className="pay-icon">💳</div>
              <div className="pay-info">{p.note&&<div className="pay-note">{p.note}</div>}<div className="pay-date">{fmtDate(p.date)}</div></div>
              <div className="pay-amount">+{fmt(p.amount)}</div>
              <button className="pay-del" onClick={()=>deletePayment(r.id,p.id)}>✕</button>
            </div>
          ))}
        </div>
      </div>
      {showPayForm&&<div className="overlay" onClick={e=>{if(e.target===e.currentTarget)setShowPayForm(false);}}>
        <div className="modal">
          <div className="modal-header"><div className="modal-title">Catat Angsuran</div><button className="close-btn" onClick={()=>setShowPayForm(false)}>×</button></div>
          <div className="pay-info-box">
            <div className="pib-row"><span className="pib-label">Total Hutang</span><span className="pib-val">{fmt(r.amount)}</span></div>
            <div className="pib-row"><span className="pib-label">Terbayar</span><span className="pib-val" style={{color:"var(--blue)"}}>{fmt(paid)}</span></div>
            <div className="pib-row"><span className="pib-label">Sisa</span><span className="pib-val" style={{color:"var(--red)"}}>{fmt(sisa)}</span></div>
          </div>
          <div className="form-group"><label className="form-label">Jumlah Bayar (Rp) *</label><input className="form-input" type="number" value={payForm.amount} onChange={e=>setPayForm({...payForm,amount:e.target.value})} /></div>
          <div className="form-group"><label className="form-label">Tanggal Bayar</label><input className="form-input" type="date" value={payForm.date} onChange={e=>setPayForm({...payForm,date:e.target.value})} /></div>
          <div className="form-group"><label className="form-label">Keterangan</label><input className="form-input" placeholder="cth: Transfer BCA, Cash..." value={payForm.note} onChange={e=>setPayForm({...payForm,note:e.target.value})} /></div>
          <button className="submit-btn sb-blue" onClick={handleAddPayment}>Simpan Angsuran</button>
        </div>
      </div>}
      {showForm&&<div className="overlay" onClick={e=>{if(e.target===e.currentTarget)setShowForm(false);}}>
        <div className="modal">
          <div className="modal-header"><div className="modal-title">Edit Hutang</div><button className="close-btn" onClick={()=>setShowForm(false)}>×</button></div>
          <div className="form-group"><label className="form-label">Nama *</label><input className="form-input" value={form.name} onChange={e=>setForm({...form,name:e.target.value})} /></div>
          <div className="form-group"><label className="form-label">Jumlah (Rp) *</label><input className="form-input" type="number" value={form.amount} onChange={e=>setForm({...form,amount:e.target.value})} /></div>
          <div className="form-group"><label className="form-label">Keterangan</label><input className="form-input" value={form.description} onChange={e=>setForm({...form,description:e.target.value})} /></div>
          <div className="form-row">
            <div className="form-group"><label className="form-label">Tanggal</label><input className="form-input" type="date" value={form.date} onChange={e=>setForm({...form,date:e.target.value})} /></div>
            <div className="form-group"><label className="form-label">Jatuh Tempo</label><input className="form-input" type="date" value={form.dueDate} onChange={e=>setForm({...form,dueDate:e.target.value})} /></div>
          </div>
          <button className="submit-btn sb-red" onClick={handleSubmit}>Simpan Perubahan</button>
        </div>
      </div>}
      {toast&&<div className={`toast ${toast.type==="err"?"err":""}`}>{toast.msg}</div>}
      </>
    );
  }

  /* ─── Detail Cicilan ─── */
  if (view==="detail-cicilan" && activeCicilan) {
    const c=activeCicilan;
    const sisa=c.totalInstallments-c.paidInstallments;
    const pct=Math.min(100,(c.paidInstallments/c.totalInstallments)*100);
    const nextDue=c.status!=="done"?getNextDueDate(c):null;
    const days=nextDue?daysUntil(nextDue):null;
    const tInfo=CICILAN_TYPES.find(t=>t.value===c.type)||CICILAN_TYPES[4];
    return (
      <><style>{css}</style>
      <div className="app">
        <div className="header">
          <div className="h-left"><button className="back-btn" onClick={()=>setView("main")}>←</button>
            <div><div className="h-label">Detail Cicilan</div><div className="h-title sm purple">{c.name}</div></div></div>
          <button className="pay-btn" disabled={c.status==="done"} onClick={()=>{setCPayForm({amount:String(c.installmentAmount),date:new Date().toISOString().slice(0,10),note:""});setShowCicilanPay(true);}}>+ Bayar</button>
        </div>
        <div className="detail-hero dh-purple">
          <div className="d-name">{tInfo.icon} {c.name}</div>{c.notes&&<div className="d-desc">{c.notes}</div>}
          <div className="d-amounts">
            <div className="amt-block"><div className="amt-label">Per Bulan</div><div className="amt-val av-purple">{fmt(c.installmentAmount)}</div></div>
            <div className="amt-block"><div className="amt-label">Terbayar</div><div className="amt-val av-paid">{c.paidInstallments}x</div></div>
            <div className="amt-block"><div className="amt-label">Sisa</div><div className="amt-val av-sisa">{sisa}x</div></div>
          </div>
          <div className="d-prog-bg"><div className="d-prog-fill dpf-purple" style={{width:`${pct}%`}}/></div>
          <div className="d-prog-label"><span>{c.paidInstallments}/{c.totalInstallments} angsuran · {pct.toFixed(0)}%</span><span>{sisa>0?`Sisa ${sisa}x lagi`:"✓ Selesai!"}</span></div>
          <div className="d-meta">
            {c.status==="done"?<span className="badge lunas">✓ Selesai</span>:<span className="badge purple">{tInfo.label}</span>}
            <span className="badge muted">Tgl {c.dueDay} tiap bulan</span>
            {c.totalAmount>0&&<span className="badge muted">Total {fmt(c.totalAmount)}</span>}
          </div>
          {c.status!=="done"&&nextDue&&<div className="d-next-due">
            <div><div className="dnd-label">Jatuh Tempo Berikutnya</div>
              <div className="dnd-val">{fmtDate(nextDue.toISOString().slice(0,10))} · {days===0?"Hari ini!":days<0?`${Math.abs(days)} hari lalu`:`${days} hari lagi`}</div>
            </div>
            <span style={{fontSize:24}}>{days<=3&&days>=0?"⚠️":"📅"}</span>
          </div>}
        </div>
        <div className="detail-actions">
          <button className="action-btn" onClick={()=>openCicilanEdit(c)}>✎ Edit</button>
          <button className="action-btn cal" onClick={()=>{const ok=exportOneToCalendar(c,"cicilan");showToast(ok?"📅 Ditambahkan ke kalender!":"Tidak ada data.");}}>📅 Kalender</button>
          <button className="action-btn danger" style={{gridColumn:"1/-1"}} onClick={()=>deleteCicilan(c.id)}>✕ Hapus Cicilan</button>
        </div>
        <div className="section-title">Riwayat Pembayaran ({(c.payments||[]).length})</div>
        <div className="pay-list">
          {(c.payments||[]).length===0?<div className="empty-state"><div className="emo">🔄</div><p>Belum ada pembayaran.<br/>Tekan <strong>+ Bayar</strong>.</p></div>
          :[...(c.payments||[])].reverse().map((p,idx)=>(
            <div key={p.id} className="pay-item">
              <div className="pay-icon purple">🔄</div>
              <div className="pay-info"><div className="pay-note">Angsuran ke-{c.paidInstallments-idx}{p.note?` · ${p.note}`:""}</div><div className="pay-date">{fmtDate(p.date)}</div></div>
              <div className="pay-amount" style={{color:"var(--purple)"}}>+{fmt(p.amount)}</div>
              <button className="pay-del" onClick={()=>deleteCicilanPayment(c.id,p.id)}>✕</button>
            </div>
          ))}
        </div>
      </div>
      {showCicilanPay&&<div className="overlay" onClick={e=>{if(e.target===e.currentTarget)setShowCicilanPay(false);}}>
        <div className="modal">
          <div className="modal-header"><div className="modal-title">Bayar Cicilan</div><button className="close-btn" onClick={()=>setShowCicilanPay(false)}>×</button></div>
          <div className="pay-info-box">
            <div className="pib-row"><span className="pib-label">{tInfo.label}</span><span className="pib-val" style={{color:"var(--purple)"}}>{c.name}</span></div>
            <div className="pib-row"><span className="pib-label">Angsuran ke-</span><span className="pib-val">{c.paidInstallments+1} / {c.totalInstallments}</span></div>
            <div className="pib-row"><span className="pib-label">Nominal</span><span className="pib-val" style={{color:"var(--purple)"}}>{fmt(c.installmentAmount)}</span></div>
          </div>
          <div className="form-group"><label className="form-label">Jumlah Bayar (Rp) *</label><input className="form-input" type="number" value={cPayForm.amount} onChange={e=>setCPayForm({...cPayForm,amount:e.target.value})} /></div>
          <div className="form-group"><label className="form-label">Tanggal Bayar</label><input className="form-input" type="date" value={cPayForm.date} onChange={e=>setCPayForm({...cPayForm,date:e.target.value})} /></div>
          <div className="form-group"><label className="form-label">Keterangan</label><input className="form-input" placeholder="cth: Auto debit, Transfer..." value={cPayForm.note} onChange={e=>setCPayForm({...cPayForm,note:e.target.value})} /></div>
          <button className="submit-btn sb-purple" onClick={handleCicilanPay}>Simpan Pembayaran</button>
        </div>
      </div>}
      {showCicilanForm&&<div className="overlay" onClick={e=>{if(e.target===e.currentTarget)setShowCicilanForm(false);}}>
        <div className="modal">
          <div className="modal-header"><div className="modal-title">Edit Cicilan</div><button className="close-btn" onClick={()=>setShowCicilanForm(false)}>×</button></div>
          <div className="type-tabs">{CICILAN_TYPES.map(t=><button key={t.value} className={`type-tab ${cForm.type===t.value?"active":""}`} onClick={()=>setCForm({...cForm,type:t.value})}>{t.icon} {t.label}</button>)}</div>
          <div className="form-group"><label className="form-label">Nama *</label><input className="form-input" value={cForm.name} onChange={e=>setCForm({...cForm,name:e.target.value})} /></div>
          <div className="form-row">
            <div className="form-group"><label className="form-label">Angsuran/bulan *</label><input className="form-input" type="number" value={cForm.installmentAmount} onChange={e=>setCForm({...cForm,installmentAmount:e.target.value})} /></div>
            <div className="form-group"><label className="form-label">Tgl JT *</label><input className="form-input" type="number" min="1" max="31" value={cForm.dueDay} onChange={e=>setCForm({...cForm,dueDay:e.target.value})} /></div>
          </div>
          <div className="form-row">
            <div className="form-group"><label className="form-label">Total Angsuran *</label><input className="form-input" type="number" value={cForm.totalInstallments} onChange={e=>setCForm({...cForm,totalInstallments:e.target.value})} /></div>
            <div className="form-group"><label className="form-label">Sudah Bayar</label><input className="form-input" type="number" min="0" value={cForm.paidInstallments} onChange={e=>setCForm({...cForm,paidInstallments:e.target.value})} /></div>
          </div>
          <div className="form-group"><label className="form-label">Catatan</label><input className="form-input" value={cForm.notes} onChange={e=>setCForm({...cForm,notes:e.target.value})} /></div>
          <button className="submit-btn sb-purple" onClick={handleCicilanSubmit}>Simpan Perubahan</button>
        </div>
      </div>}
      {toast&&<div className={`toast ${toast.type==="err"?"err":""}`}>{toast.msg}</div>}
      </>
    );
  }

  /* ─── MAIN VIEW ─── */
  return (
    <><style>{css}</style>
    <div className="app">
      <div className="header">
        <div><div className="h-label">Catatan Keuangan</div>
          <div className={`h-title ${tab==="cicilan"?"purple":""}`}>{tab==="cicilan"?"Cicilan Berjalan":"HutangKu"}</div></div>
        <div className="hdr-actions">
          <button className="theme-btn" onClick={toggleTheme}>{D?"☀️":"🌙"}</button>
          <button className={`add-btn ${tab==="cicilan"?"purple":""}`} onClick={()=>tab==="cicilan"?openCicilanAdd():openAdd()}>+ Tambah</button>
        </div>
      </div>
      <div className="sync-row">
        <div className="sync-badge" onClick={()=>setShowSyncModal(true)}>
          <div className={`sync-dot ${syncCode?"":"off"}`}/>{syncCode?`Kode: ${syncCode}`:"Belum sinkron"}
        </div>
        <button className="cal-btn" onClick={handleExportAll}>📅 Export Kalender</button>
      </div>

      {/* REKAP */}
      {tab==="rekap"&&<div className="rekap">
        <div className="hero-card">
          <div className="hero-eyebrow">Total Sisa Hutang</div>
          <div className="hero-amount">{fmt(totalSisa)}</div>
          <div className="hero-sub">{allBelum.length} hutang aktif · {allLunas.length} lunas</div>
        </div>
        <div className="stat-row">
          <div className="stat-card"><div className="stat-label">Total Hutang</div><div className="stat-val sv-r">{fmtShort(totalHutang)}</div></div>
          <div className="stat-card"><div className="stat-label">Terbayar</div><div className="stat-val sv-b">{fmtShort(totalTerbayar)}</div></div>
          <div className="stat-card"><div className="stat-label">% Lunas</div><div className="stat-val sv-g">{totalHutang>0?((totalTerbayar/totalHutang)*100).toFixed(0):0}%</div></div>
        </div>
        {activeCicilans.length>0&&<div className="cicilan-summary">
          <div className="cs-row"><div className="cs-title">🔄 Cicilan Berjalan</div><div className="cs-val">{fmt(totalCicilanBulan)}<span style={{fontSize:12,fontWeight:400,color:"var(--muted)"}}>/bln</span></div></div>
          <div className="cs-sub">{activeCicilans.length} cicilan aktif</div>
        </div>}
        <div className="donut-card">
          <div className="donut-title">Progres Pelunasan Hutang</div><div className="donut-sub">Terbayar vs sisa hutang keseluruhan</div>
          {overallDonut.length===0?<div className="no-data">Belum ada data hutang</div>:<>
            <ResponsiveContainer width="100%" height={210}><PieChart><Pie data={overallDonut} cx="50%" cy="50%" innerRadius={58} outerRadius={88} paddingAngle={3} dataKey="value" strokeWidth={0}>{overallDonut.map((d,i)=><Cell key={i} fill={d.color}/>)}</Pie><Tooltip content={<CustomTip/>}/></PieChart></ResponsiveContainer>
            <div className="legend-list">{overallDonut.map((d,i)=>{const tot=overallDonut.reduce((a,b)=>a+b.value,0);return(<div key={i} className="legend-item"><div className="legend-dot" style={{background:d.color}}/><div className="legend-name">{d.name}</div><div className="legend-val">{fmt(d.value)}</div><div className="legend-pct">{((d.value/tot)*100).toFixed(0)}%</div></div>);})}</div>
          </>}
        </div>
        <div className="donut-card">
          <div className="donut-title">Distribusi Hutang Aktif</div><div className="donut-sub">Sisa hutang per orang / pihak</div>
          {donutPerOrang.length===0?<div className="no-data">🎉 Semua hutang sudah lunas!</div>:<>
            <ResponsiveContainer width="100%" height={210}><PieChart><Pie data={donutPerOrang} cx="50%" cy="50%" innerRadius={58} outerRadius={88} paddingAngle={3} dataKey="value" strokeWidth={0}>{donutPerOrang.map((d,i)=><Cell key={i} fill={d.color}/>)}</Pie><Tooltip content={<CustomTip/>}/></PieChart></ResponsiveContainer>
            <div className="legend-list">{donutPerOrang.map((d,i)=>{const tot=donutPerOrang.reduce((a,b)=>a+b.value,0);return(<div key={i} className="legend-item"><div className="legend-dot" style={{background:d.color}}/><div className="legend-name">{d.name}</div><div className="legend-val">{fmt(d.value)}</div><div className="legend-pct">{((d.value/tot)*100).toFixed(0)}%</div></div>);})}</div>
          </>}
        </div>
        <div className="stat-row" style={{marginBottom:8}}>
          <div className="stat-card"><div className="stat-label">Catatan</div><div className="stat-val">{data.records.length}</div><div className="stat-sub">total</div></div>
          <div className="stat-card"><div className="stat-label">Cicilan</div><div className="stat-val sv-p">{activeCicilans.length}</div><div className="stat-sub">aktif</div></div>
          <div className="stat-card"><div className="stat-label">Overdue</div><div className="stat-val sv-o">{data.records.filter(r=>isOverdue(r)).length}</div><div className="stat-sub">lewat JT</div></div>
        </div>
      </div>}

      {/* HUTANG LIST */}
      {tab==="hutang"&&<>
        <div className="filters">{["all","belum","lunas"].map(s=><button key={s} className={`filter-btn ${filterStatus===s?"active":""}`} onClick={()=>setFilterStatus(s)}>{s==="all"?"Semua":s==="belum"?"Belum Lunas":"Lunas"}</button>)}</div>
        <div className="records">
          {filtered.length===0?<div className="empty-state"><div className="emo">📭</div><p>Belum ada catatan hutang.<br/>Tekan <strong>+ Tambah</strong> untuk mulai.</p></div>
          :filtered.map((r,i)=>{
            const paid=getPaid(r),pct=getPct(r),hasP=(r.payments||[]).length>0;
            return(<div key={r.id} className={`record-card ${r.status==="lunas"?"lunas":""}`} onClick={()=>{setActiveId(r.id);setView("detail-hutang");}}>
              <div className="rc-top"><div className="rc-dot" style={{background:PALETTE[i%PALETTE.length]}}/><div className="rc-info"><div className="rc-name">{r.name}</div>{r.description&&<div className="rc-sub">{r.description}</div>}</div>
                <div className="rc-right"><div className={`rc-amount ${r.status==="lunas"?"done":""}`}>{fmt(r.amount)}</div>{hasP&&r.status!=="lunas"&&<div className="rc-sisa-txt">sisa {fmt(getSisa(r))}</div>}</div></div>
              {hasP&&<div className="prog-wrap"><div className="prog-bg"><div className="prog-fill" style={{width:`${pct}%`}}/></div><div className="prog-label"><span>{fmt(paid)} terbayar ({(r.payments||[]).length}x)</span><span>{pct.toFixed(0)}%</span></div></div>}
              <div className="rc-badges">{r.status==="lunas"?<span className="badge lunas">✓ Lunas</span>:<span className="badge belum">Belum</span>}{isOverdue(r)&&<span className="badge overdue">⚠ Lewat JT</span>}{r.dueDate&&r.status!=="lunas"&&<span className="badge muted">⏰ {fmtDate(r.dueDate)}</span>}<span className="badge muted" style={{marginLeft:"auto"}}>{fmtDate(r.date)}</span></div>
            </div>);
          })}
        </div>
      </>}

      {/* CICILAN */}
      {tab==="cicilan"&&<div className="records">
        {cicilans.length===0?<div className="empty-state" style={{paddingTop:60}}><div className="emo">🔄</div><p>Belum ada cicilan berjalan.<br/>Tambahkan <strong>PayLater, Pinjol,</strong><br/><strong>Angsuran</strong> atau sejenisnya.</p></div>
        :cicilans.map((c,i)=>{
          const sisa=c.totalInstallments-c.paidInstallments;
          const pct=Math.min(100,(c.paidInstallments/c.totalInstallments)*100);
          const tInfo=CICILAN_TYPES.find(t=>t.value===c.type)||CICILAN_TYPES[4];
          const nextDue=c.status!=="done"?getNextDueDate(c):null;
          const days=nextDue?daysUntil(nextDue):null;
          return(<div key={c.id} className={`record-card ${c.status==="done"?"lunas":""}`} onClick={()=>{setActiveCicilanId(c.id);setView("detail-cicilan");}}>
            <div className="rc-top"><div className="rc-dot" style={{background:PALETTE[(i+5)%PALETTE.length]}}/><div className="rc-info"><div className="rc-name">{tInfo.icon} {c.name}</div><div className="rc-sub">{tInfo.label} · Tgl {c.dueDay} tiap bulan</div></div>
              <div className="rc-right"><div className={`rc-amount purple ${c.status==="done"?"done":""}`}>{fmt(c.installmentAmount)}<span style={{fontSize:10,fontWeight:400}}>/bln</span></div><div className="rc-sisa-txt">sisa {sisa}x</div></div></div>
            <div className="prog-wrap"><div className="prog-bg"><div className="prog-fill purple" style={{width:`${pct}%`}}/></div><div className="prog-label"><span>{c.paidInstallments}/{c.totalInstallments} angsuran</span><span>{pct.toFixed(0)}%</span></div></div>
            <div className="rc-badges">{c.status==="done"?<span className="badge lunas">✓ Selesai</span>:<span className="badge purple">{tInfo.label}</span>}{days!==null&&days<=3&&days>=0&&<span className="badge soon">⚠ {days===0?"Hari ini!":days===1?"Besok!":days+" hari lagi"}</span>}{days!==null&&days<0&&<span className="badge overdue">⚠ Lewat JT</span>}{nextDue&&<span className="badge muted" style={{marginLeft:"auto"}}>📅 {fmtDate(nextDue.toISOString().slice(0,10))}</span>}</div>
          </div>);
        })}
      </div>}

      <div className="bottom-nav">
        <button className={`nav-btn ${tab==="rekap"?"act-red":""}`} onClick={()=>setTab("rekap")}><span className="ni">🍩</span>Rekap</button>
        <button className={`nav-btn ${tab==="hutang"?"act-blue":""}`} onClick={()=>setTab("hutang")}><span className="ni">📋</span>Hutang</button>
        <button className={`nav-btn ${tab==="cicilan"?"act-purple":""}`} onClick={()=>setTab("cicilan")}><span className="ni">🔄</span>Cicilan</button>
      </div>
    </div>

    {/* Form Hutang */}
    {showForm&&<div className="overlay" onClick={e=>{if(e.target===e.currentTarget)setShowForm(false);}}>
      <div className="modal">
        <div className="modal-header"><div className="modal-title">{editId?"Edit Hutang":"Tambah Hutang"}</div><button className="close-btn" onClick={()=>setShowForm(false)}>×</button></div>
        <div className="form-group"><label className="form-label">Nama / Pihak *</label><input className="form-input" placeholder="cth: Budi, Bank BRI..." value={form.name} onChange={e=>setForm({...form,name:e.target.value})} /></div>
        <div className="form-group"><label className="form-label">Jumlah Hutang (Rp) *</label><input className="form-input" type="number" placeholder="cth: 500000" value={form.amount} onChange={e=>setForm({...form,amount:e.target.value})} /></div>
        <div className="form-group"><label className="form-label">Keterangan</label><input className="form-input" placeholder="cth: Pinjam untuk bayar listrik..." value={form.description} onChange={e=>setForm({...form,description:e.target.value})} /></div>
        <div className="form-row">
          <div className="form-group"><label className="form-label">Tanggal</label><input className="form-input" type="date" value={form.date} onChange={e=>setForm({...form,date:e.target.value})} /></div>
          <div className="form-group"><label className="form-label">Jatuh Tempo</label><input className="form-input" type="date" value={form.dueDate} onChange={e=>setForm({...form,dueDate:e.target.value})} /></div>
        </div>
        <div className="form-group"><label className="form-label">Status</label><select className="form-input" value={form.status} onChange={e=>setForm({...form,status:e.target.value})}><option value="belum">Belum Lunas</option><option value="lunas">Sudah Lunas</option></select></div>
        <button className="submit-btn sb-red" onClick={handleSubmit}>{editId?"Simpan Perubahan":"Tambah Hutang"}</button>
      </div>
    </div>}

    {/* Form Cicilan */}
    {showCicilanForm&&<div className="overlay" onClick={e=>{if(e.target===e.currentTarget)setShowCicilanForm(false);}}>
      <div className="modal">
        <div className="modal-header"><div className="modal-title">{editCicilanId?"Edit Cicilan":"Tambah Cicilan"}</div><button className="close-btn" onClick={()=>setShowCicilanForm(false)}>×</button></div>
        <div className="type-tabs">{CICILAN_TYPES.map(t=><button key={t.value} className={`type-tab ${cForm.type===t.value?"active":""}`} onClick={()=>setCForm({...cForm,type:t.value})}>{t.icon} {t.label}</button>)}</div>
        <div className="form-group"><label className="form-label">Nama / Produk *</label><input className="form-input" placeholder="cth: Kredivo HP Samsung, GoPay Later..." value={cForm.name} onChange={e=>setCForm({...cForm,name:e.target.value})} /></div>
        <div className="form-row">
          <div className="form-group"><label className="form-label">Angsuran/bulan (Rp) *</label><input className="form-input" type="number" placeholder="cth: 300000" value={cForm.installmentAmount} onChange={e=>setCForm({...cForm,installmentAmount:e.target.value})} /></div>
          <div className="form-group"><label className="form-label">Tgl Jatuh Tempo *</label><input className="form-input" type="number" min="1" max="31" placeholder="25" value={cForm.dueDay} onChange={e=>setCForm({...cForm,dueDay:e.target.value})} /></div>
        </div>
        <div className="form-row">
          <div className="form-group"><label className="form-label">Total Angsuran *</label><input className="form-input" type="number" placeholder="cth: 12" value={cForm.totalInstallments} onChange={e=>setCForm({...cForm,totalInstallments:e.target.value})} /></div>
          <div className="form-group"><label className="form-label">Sudah Terbayar</label><input className="form-input" type="number" min="0" placeholder="0" value={cForm.paidInstallments} onChange={e=>setCForm({...cForm,paidInstallments:e.target.value})} /></div>
        </div>
        <div className="form-group"><label className="form-label">Total Pinjaman (Rp)</label><input className="form-input" type="number" placeholder="Opsional — dihitung otomatis jika kosong" value={cForm.totalAmount} onChange={e=>setCForm({...cForm,totalAmount:e.target.value})} /></div>
        <div className="form-group"><label className="form-label">Catatan</label><input className="form-input" placeholder="cth: Beli HP Samsung A55, tenor 12x" value={cForm.notes} onChange={e=>setCForm({...cForm,notes:e.target.value})} /></div>
        <button className="submit-btn sb-purple" onClick={handleCicilanSubmit}>{editCicilanId?"Simpan Perubahan":"Tambah Cicilan"}</button>
      </div>
    </div>}

    {/* Sync Modal */}
    {showSyncModal&&<div className="overlay" onClick={e=>{if(e.target===e.currentTarget)setShowSyncModal(false);}}>
      <div className="modal">
        <div className="modal-header"><div className="modal-title">⚙️ Kode Sinkron</div><button className="close-btn" onClick={()=>setShowSyncModal(false)}>×</button></div>
        <div className="pay-info-box"><div className="pib-row"><span className="pib-label">Kode Aktif</span><span className="pib-val" style={{color:"var(--green)"}}>{syncCode}</span></div></div>
        <p style={{fontSize:13,color:"var(--muted)",lineHeight:1.7,marginBottom:20}}>Gunakan kode ini di perangkat lain untuk sinkron data yang sama.</p>
        <div className="form-group"><label className="form-label">Ganti ke Kode Lain</label><input className="form-input" placeholder="Kode baru..." value={inputCode} onChange={e=>setInputCode(e.target.value)} /></div>
        <button className="submit-btn sb-blue" onClick={handleSetSyncCode} style={{marginBottom:10}}>Ganti Kode</button>
        <button className="submit-btn sb-muted" style={{marginTop:0}} onClick={handleLogout}>Keluar / Reset</button>
      </div>
    </div>}

    {toast&&<div className={`toast ${toast.type==="err"?"err":""}`}>{toast.msg}</div>}
    </>
  );
}
