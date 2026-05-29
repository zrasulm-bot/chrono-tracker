import { useState, useEffect, useRef, useCallback } from "react";
import { supabase, getUserId } from "./supabase.js";

const CATEGORIES = [
  { id: "work",    label: "Работа",             emoji: "💼", color: "#E8C547" },
  { id: "games",   label: "Игры",               emoji: "🎮", color: "#7C6AF7" },
  { id: "family",  label: "Семья",              emoji: "🏠", color: "#F97B5C" },
  { id: "friends", label: "Друзья",             emoji: "👥", color: "#5CE8A4" },
  { id: "idle",    label: "Безделье",           emoji: "☁️", color: "#A0AEC0" },
  { id: "home",    label: "Дом",               emoji: "🔧", color: "#F7A35C" },
  { id: "self",    label: "Саморазвитие",       emoji: "📚", color: "#F06292" },
  { id: "useful",  label: "Прочее полезное",    emoji: "✅", color: "#4DD0E1" },
];

function formatDuration(ms, short = false) {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (short) {
    if (h > 0) return `${h}ч ${m}м`;
    if (m > 0) return `${m}м ${s}с`;
    return `${s}с`;
  }
  return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;
}

function formatPercent(val, total) {
  if (!total) return "0";
  return ((val / total) * 100).toFixed(1);
}

function getPeriodRange(period, customFrom, customTo) {
  const now = Date.now();
  const today = new Date(); today.setHours(0,0,0,0);
  if (period === "day")   return [today.getTime(), now];
  if (period === "week")  { const w = new Date(today); w.setDate(w.getDate()-w.getDay()+1); return [w.getTime(), now]; }
  if (period === "month") { const m = new Date(today.getFullYear(), today.getMonth(), 1); return [m.getTime(), now]; }
  if (period === "custom" && customFrom && customTo) {
    const f = new Date(customFrom); f.setHours(0,0,0,0);
    const t = new Date(customTo);   t.setHours(23,59,59,999);
    return [f.getTime(), t.getTime()];
  }
  return [today.getTime(), now];
}

function aggregateSessions(sessions, from, to) {
  const totals = {};
  CATEGORIES.forEach(c => { totals[c.id] = 0; });
  for (const s of sessions) {
    if (s.end_time && s.start_time >= from && s.start_time <= to)
      totals[s.category] = (totals[s.category] || 0) + (s.end_time - s.start_time);
  }
  return totals;
}

function DonutChart({ data, total }) {
  const size=120,cx=60,cy=60,r=44,stroke=14,circ=2*Math.PI*r;
  let offset=0;
  const slices = CATEGORIES.map(cat => {
    const pct = total ? (data[cat.id]||0)/total : 0;
    const dash = pct*circ, gap = circ-dash;
    const s = {cat,pct,dash,gap,offset}; offset+=dash; return s;
  }).filter(s=>s.pct>0);
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="#1a1a2e" strokeWidth={stroke}/>
      {slices.map(({cat,dash,gap,offset:off})=>(
        <circle key={cat.id} cx={cx} cy={cy} r={r} fill="none"
          stroke={cat.color} strokeWidth={stroke}
          strokeDasharray={`${dash} ${gap}`}
          strokeDashoffset={-off+circ/4}
          style={{transform:"rotate(-90deg)",transformOrigin:"50% 50%",transition:"all 0.5s"}}/>
      ))}
      {!total && <circle cx={cx} cy={cy} r={r} fill="none" stroke="#2a2a3e" strokeWidth={stroke}/>}
    </svg>
  );
}

export default function App() {
  const userId = getUserId();
  const [sessions, setSessions]     = useState([]);
  const [active, setActive]         = useState(null);
  const [elapsed, setElapsed]       = useState(0);
  const [view, setView]             = useState("tracker");
  const [period, setPeriod]         = useState("day");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo]     = useState("");
  const [analyticsText, setAnalyticsText]     = useState("");
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [loaded, setLoaded]         = useState(false);
  const [loadError, setLoadError]   = useState(false);
  const intervalRef = useRef(null);
  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;

  useEffect(() => {
    const timeout = setTimeout(() => {
      setLoadError(true);
      setLoaded(true);
    }, 8000);

    (async () => {
      try {
        const [{ data: sess, error: e1 }, { data: act, error: e2 }] = await Promise.all([
          supabase.from("sessions").select("*").eq("user_id", userId).order("start_time", { ascending: true }),
          supabase.from("active_session").select("*").eq("user_id", userId).single()
        ]);

        if (e1) console.error("sessions error:", e1);
        if (e2 && e2.code !== "PGRST116") console.error("active error:", e2);

        setSessions(sess || []);
        if (act) {
          setActive({ category: act.category, start: act.start_time });
          setElapsed(Date.now() - act.start_time);
        }
      } catch (err) {
        console.error("Load failed:", err);
        setLoadError(true);
      } finally {
        clearTimeout(timeout);
        setLoaded(true);
      }
    })();
  }, []);

  useEffect(() => {
    clearInterval(intervalRef.current);
    if (active) {
      const tick = () => setElapsed(Date.now() - active.start);
      tick();
      intervalRef.current = setInterval(tick, 1000);
    } else {
      setElapsed(0);
    }
    return () => clearInterval(intervalRef.current);
  }, [active]);

  const handleCategory = useCallback(async (catId) => {
    const now = Date.now();
    const prev = active;

    if (prev) {
      const newSession = { user_id: userId, category: prev.category, start_time: prev.start, end_time: now };
      await supabase.from("sessions").insert(newSession);
      setSessions(s => [...s, newSession]);
      await supabase.from("active_session").delete().eq("user_id", userId);
    }

    if (prev?.category === catId) {
      setActive(null);
    } else {
      const newActive = { category: catId, start: now };
      setActive(newActive);
      await supabase.from("active_session").upsert({ user_id: userId, category: catId, start_time: now });
    }
  }, [active, userId]);

  const stopTracking = useCallback(async () => {
    if (!active) return;
    const now = Date.now();
    const newSession = { user_id: userId, category: active.category, start_time: active.start, end_time: now };
    await supabase.from("sessions").insert(newSession);
    setSessions(s => [...s, newSession]);
    await supabase.from("active_session").delete().eq("user_id", userId);
    setActive(null);
  }, [active, userId]);

  const [from, to] = getPeriodRange(period, customFrom, customTo);
  const totals     = aggregateSessions(sessions, from, to);
  const grandTotal = Object.values(totals).reduce((a,b)=>a+b,0);
  const liveTotals = {...totals};
  if (active) liveTotals[active.category] = (liveTotals[active.category]||0) + elapsed;
  const liveTotal = grandTotal + elapsed;

  async function runAnalytics() {
    setAnalyticsLoading(true); setAnalyticsText("");
    const todayRange = getPeriodRange("day");
    const weekRange  = getPeriodRange("week");
    const todayT = aggregateSessions(sessions, todayRange[0], todayRange[1]);
    const weekT  = aggregateSessions(sessions, weekRange[0],  weekRange[1]);
    const todaySummary = CATEGORIES.map(c=>`${c.label}: ${formatDuration(todayT[c.id]||0,true)}`).join(", ");
    const weekSummary  = CATEGORIES.map(c=>`${c.label}: ${formatDuration(weekT[c.id]||0,true)}`).join(", ");
    const prompt = `Ты аналитик тайм-менеджмента. Пользователь отслеживает время по категориям.\n\nДанные за сегодня: ${todaySummary}\nДанные за неделю: ${weekSummary}\n\nНапиши 3-4 коротких, конкретных инсайта на русском языке. Каждый инсайт — одно предложение. Используй цифры и проценты. Не используй markdown, только текст с переносами строк между инсайтами.`;
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 1000, messages: [{ role: "user", content: prompt }] })
      });
      const data = await res.json();
      setAnalyticsText(data.content?.map(b=>b.text||"").join("")||"Не удалось получить аналитику.");
    } catch { setAnalyticsText("Ошибка. Попробуйте снова."); }
    setAnalyticsLoading(false);
  }

  async function clearAllData() {
    if (!confirm("Удалить все данные?")) return;
    await supabase.from("sessions").delete().eq("user_id", userId);
    await supabase.from("active_session").delete().eq("user_id", userId);
    setSessions([]); setActive(null);
  }

  if (!loaded) return (
    <div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"100vh",background:"#0d0d1a",color:"#E8C547",fontFamily:"monospace",fontSize:18}}>
      Загрузка...
    </div>
  );

  if (loadError) return (
    <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",height:"100vh",background:"#0d0d1a",color:"#F97B5C",fontFamily:"monospace",fontSize:14,gap:16,padding:24,textAlign:"center"}}>
      <div style={{fontSize:32}}>⚠️</div>
      <div>Не удалось подключиться к базе данных</div>
      <div style={{color:"#606080",fontSize:12}}>Проверьте интернет и попробуйте снова</div>
      <button onClick={()=>window.location.reload()} style={{background:"none",border:"1px solid #F97B5C",color:"#F97B5C",padding:"10px 24px",borderRadius:8,cursor:"pointer",fontFamily:"monospace",fontSize:13,marginTop:8}}>
        Обновить
      </button>
    </div>
  );

  const activeCat = active ? CATEGORIES.find(c=>c.id===active.category) : null;

  return (
    <div style={{minHeight:"100vh",background:"#0d0d1a",fontFamily:"'DM Mono','Courier New',monospace",color:"#e8e8f0",userSelect:"none"}}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&family=Syne:wght@700;800&display=swap');
        *{box-sizing:border-box;margin:0;padding:0}
        .cat-btn{border:1.5px solid #2a2a4a;background:#12122a;color:#e8e8f0;cursor:pointer;padding:18px 12px;border-radius:12px;transition:all 0.2s;display:flex;flex-direction:column;align-items:center;gap:8px;font-family:'DM Mono',monospace;font-size:11px;letter-spacing:.05em;text-transform:uppercase}
        .cat-btn:hover{transform:translateY(-2px);border-color:#4a4a6a}
        .cat-btn.active{border-width:2px}
        .cat-btn .cat-emoji{font-size:26px;transition:transform 0.2s}
        .cat-btn.active .cat-emoji{transform:scale(1.15)}
        .nav-btn{background:none;border:none;cursor:pointer;padding:8px 16px;font-family:'DM Mono',monospace;font-size:11px;letter-spacing:.1em;text-transform:uppercase;transition:all 0.2s;border-radius:6px}
        .nav-btn:hover{background:#1e1e3a}
        .nav-btn.active{color:#E8C547;border-bottom:2px solid #E8C547;border-radius:0}
        .period-btn{background:#12122a;border:1.5px solid #2a2a4a;color:#a0a0c0;cursor:pointer;padding:6px 14px;border-radius:20px;font-family:'DM Mono',monospace;font-size:10px;letter-spacing:.08em;text-transform:uppercase;transition:all .15s}
        .period-btn.active{border-color:#E8C547;color:#E8C547;background:#1e1e0a}
        .period-btn:hover{border-color:#4a4a6a;color:#e8e8f0}
        input[type=date]{background:#12122a;border:1.5px solid #2a2a4a;color:#e8e8f0;padding:6px 10px;border-radius:8px;font-family:'DM Mono',monospace;font-size:11px}
        .stop-btn{background:none;border:1.5px solid #F97B5C;color:#F97B5C;cursor:pointer;padding:8px 20px;border-radius:8px;font-family:'DM Mono',monospace;font-size:11px;letter-spacing:.1em;text-transform:uppercase;transition:all .2s}
        .stop-btn:hover{background:#F97B5C22}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
        .pulse-dot{width:8px;height:8px;border-radius:50%;animation:pulse 1.5s infinite}
      `}</style>

      <div style={{borderBottom:"1px solid #1e1e3a",padding:"16px 24px",display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:12}}>
        <div>
          <div style={{fontFamily:"'Syne',sans-serif",fontWeight:800,fontSize:20,letterSpacing:"-.02em",color:"#E8C547"}}>ХРОНО</div>
          <div style={{fontSize:10,color:"#4a4a6a",letterSpacing:".15em",marginTop:1}}>ТРЕКЕР ВРЕМЕНИ</div>
        </div>
        <div style={{display:"flex",gap:4}}>
          {[["tracker","⏱ Трекер"],["stats","📊 Статистика"],["analytics","✨ Аналитика"]].map(([v,l])=>(
            <button key={v} className={`nav-btn ${view===v?"active":""}`} style={{color:view===v?"#E8C547":"#606080"}} onClick={()=>setView(v)}>{l}</button>
          ))}
        </div>
      </div>

      <div style={{maxWidth:560,margin:"0 auto",padding:"24px 16px"}}>
        {view==="tracker" && (
          <div>
            <div style={{textAlign:"center",marginBottom:32}}>
              {active ? (
                <>
                  <div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:8,marginBottom:8}}>
                    <div className="pulse-dot" style={{background:activeCat?.color}}/>
                    <span style={{fontSize:11,color:"#606080",letterSpacing:".12em"}}>{activeCat?.label?.toUpperCase()}</span>
                  </div>
                  <div style={{fontFamily:"'Syne',sans-serif",fontWeight:800,fontSize:52,letterSpacing:"-.03em",color:activeCat?.color}}>
                    {formatDuration(elapsed)}
                  </div>
                  <div style={{marginTop:14}}><button className="stop-btn" onClick={stopTracking}>■ Остановить</button></div>
                </>
              ) : (
                <>
                  <div style={{fontFamily:"'Syne',sans-serif",fontWeight:800,fontSize:52,color:"#2a2a4a",letterSpacing:"-.03em"}}>00:00:00</div>
                  <div style={{fontSize:11,color:"#3a3a5a",letterSpacing:".12em",marginTop:6}}>ВЫБЕРИТЕ КАТЕГОРИЮ</div>
                </>
              )}
            </div>

            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10}}>
              {CATEGORIES.map(cat=>{
                const isActive=active?.category===cat.id;
                return (
                  <button key={cat.id} className={`cat-btn ${isActive?"active":""}`}
                    style={isActive?{borderColor:cat.color,background:`${cat.color}15`,color:cat.color,boxShadow:`0 0 24px ${cat.color}30`}:{}}
                    onClick={()=>handleCategory(cat.id)}>
                    <span className="cat-emoji">{cat.emoji}</span>
                    <span>{cat.label}</span>
                    <span style={{fontSize:10,color:isActive?cat.color:"#404060",marginTop:2}}>
                      {formatDuration(liveTotals[cat.id]||0,true)||"—"}
                    </span>
                  </button>
                );
              })}
            </div>

            {liveTotal>0 && (
              <div style={{marginTop:28,background:"#12122a",border:"1px solid #1e1e3a",borderRadius:14,padding:18}}>
                <div style={{fontSize:10,color:"#404060",letterSpacing:".15em",marginBottom:14}}>СЕГОДНЯ</div>
                <div style={{display:"flex",alignItems:"center",gap:20}}>
                  <DonutChart data={liveTotals} total={liveTotal}/>
                  <div style={{flex:1,display:"flex",flexDirection:"column",gap:8}}>
                    {CATEGORIES.filter(c=>(liveTotals[c.id]||0)>0).map(cat=>(
                      <div key={cat.id} style={{display:"flex",alignItems:"center",gap:8}}>
                        <div style={{width:8,height:8,borderRadius:2,background:cat.color,flexShrink:0}}/>
                        <span style={{fontSize:11,color:"#8080a0",flex:1}}>{cat.label}</span>
                        <span style={{fontSize:11,color:"#c0c0e0"}}>{formatDuration(liveTotals[cat.id]||0,true)}</span>
                        <span style={{fontSize:10,color:"#4a4a6a",minWidth:38,textAlign:"right"}}>{formatPercent(liveTotals[cat.id]||0,liveTotal)}%</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {view==="stats" && (
          <div>
            <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:20}}>
              {[["day","Сегодня"],["week","Неделя"],["month","Месяц"],["custom","Период"]].map(([k,l])=>(
                <button key={k} className={`period-btn ${period===k?"active":""}`} onClick={()=>setPeriod(k)}>{l}</button>
              ))}
            </div>
            {period==="custom" && (
              <div style={{display:"flex",gap:10,alignItems:"center",marginBottom:20,flexWrap:"wrap"}}>
                <input type="date" value={customFrom} onChange={e=>setCustomFrom(e.target.value)}/>
                <span style={{color:"#404060",fontSize:12}}>—</span>
                <input type="date" value={customTo} onChange={e=>setCustomTo(e.target.value)}/>
              </div>
            )}
            <div style={{background:"#12122a",border:"1px solid #1e1e3a",borderRadius:14,padding:20,marginBottom:16}}>
              {grandTotal===0 ? (
                <div style={{textAlign:"center",color:"#303050",padding:"30px 0",fontSize:13}}>Нет данных за выбранный период</div>
              ) : (
                <>
                  <div style={{display:"flex",justifyContent:"center",marginBottom:20}}>
                    <DonutChart data={totals} total={grandTotal}/>
                  </div>
                  <div style={{display:"flex",flexDirection:"column",gap:12}}>
                    {CATEGORIES.map(cat=>{
                      const val=totals[cat.id]||0;
                      const pct=parseFloat(formatPercent(val,grandTotal));
                      return (
                        <div key={cat.id}>
                          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:5}}>
                            <span style={{fontSize:14}}>{cat.emoji}</span>
                            <span style={{fontSize:12,color:"#a0a0c0",flex:1}}>{cat.label}</span>
                            <span style={{fontSize:12,color:"#e0e0f0"}}>{formatDuration(val,true)||"—"}</span>
                            <span style={{fontSize:11,color:"#505070",minWidth:42,textAlign:"right"}}>{pct||0}%</span>
                          </div>
                          <div style={{height:4,background:"#1a1a3a",borderRadius:2,overflow:"hidden"}}>
                            <div style={{height:"100%",borderRadius:2,background:cat.color,width:`${pct}%`,transition:"width .6s cubic-bezier(.4,0,.2,1)"}}/>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <div style={{borderTop:"1px solid #1e1e3a",marginTop:16,paddingTop:12,display:"flex",justifyContent:"space-between",fontSize:11,color:"#606080"}}>
                    <span>ИТОГО</span>
                    <span style={{color:"#E8C547"}}>{formatDuration(grandTotal,true)}</span>
                  </div>
                </>
              )}
            </div>
            <button onClick={clearAllData} style={{background:"none",border:"1px solid #3a1a1a",color:"#804040",cursor:"pointer",padding:"8px 16px",borderRadius:8,fontSize:10,letterSpacing:".1em",fontFamily:"'DM Mono',monospace"}}>
              УДАЛИТЬ ВСЕ ДАННЫЕ
            </button>
          </div>
        )}

        {view==="analytics" && (
          <div>
            <div style={{marginBottom:20}}>
              <div style={{fontFamily:"'Syne',sans-serif",fontWeight:700,fontSize:22,marginBottom:6}}>AI Аналитика</div>
              <div style={{fontSize:12,color:"#606080",lineHeight:1.6}}>Персональные инсайты на основе ваших данных.</div>
            </div>
            <button onClick={runAnalytics} disabled={analyticsLoading}
              style={{width:"100%",padding:"14px",background:analyticsLoading?"#1a1a2a":"#E8C547",border:"none",borderRadius:10,cursor:analyticsLoading?"not-allowed":"pointer",fontFamily:"'DM Mono',monospace",fontWeight:500,fontSize:12,color:analyticsLoading?"#404060":"#0d0d1a",letterSpacing:".08em",transition:"all .2s",marginBottom:16}}>
              {analyticsLoading?"⏳ Анализируем данные...":"✨ ПОЛУЧИТЬ АНАЛИТИКУ"}
            </button>
            {analyticsText && (
              <div style={{background:"#12122a",border:"1.5px solid #2a2a4a",borderRadius:14,padding:20,lineHeight:1.8,fontSize:13,color:"#c8c8e0"}}>
                <div style={{fontSize:10,color:"#404060",letterSpacing:".15em",marginBottom:12}}>ИНСАЙТЫ</div>
                {analyticsText.split("\n").filter(Boolean).map((line,i,arr)=>(
                  <div key={i} style={{display:"flex",gap:10,marginBottom:i<arr.length-1?12:0}}>
                    <span style={{color:"#E8C547",flexShrink:0}}>→</span>
                    <span>{line}</span>
                  </div>
                ))}
              </div>
            )}
            {!analyticsText && !analyticsLoading && (
              <div style={{textAlign:"center",padding:"40px 0",color:"#2a2a4a",fontSize:13}}>Нажмите кнопку для получения инсайтов</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
