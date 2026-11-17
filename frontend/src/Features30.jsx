import React, { useCallback, useEffect, useMemo, useState } from "react";
import "./features30.css";
const API = "http://localhost:8000";

async function api(path, token, options = {}) {
  const response = await fetch(API + path, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, ...(options.body ? {"Content-Type": "application/json"} : {}), ...(options.headers || {}) },
  });
  if (!response.ok) {
    let message = `Error HTTP ${response.status}`;
    try { const body = await response.json(); message = typeof body.detail === "string" ? body.detail : message; } catch {}
    throw new Error(message);
  }
  return response.status === 204 ? null : response.json();
}

function useRemote(path, token, refresh = 0) {
  const [state, setState] = useState({ data:null, loading:true, error:"" });
  useEffect(() => {
    if (!path || !token) { setState({data:null,loading:false,error:""}); return; }
    let active = true;
    setState({data:null,loading:true,error:""});
    api(path, token).then(data => active && setState({data,loading:false,error:""}))
      .catch(e => active && setState({data:null,loading:false,error:e.message}));
    return () => { active = false; };
  }, [path, token, refresh]);
  return state;
}
function Message({error}) { return error ? <div className="error" role="alert">{error}</div> : null; }

export function SubtaskPanel({ task, tasks, members, token, canEdit, onClose, onTasksChanged }) {
  const [tick, update] = useState(0), [title, setTitle] = useState("");
  const [assignee, setAssignee] = useState("");
  const [dependency, setDependency] = useState("");
  const [error, setError] = useState("");
  const {data,loading,error:loadError} = useRemote(`/tasks/${task.id}/subtasks`, token, tick);
  const gantt = useRemote(`/projects/${task.project_id}/gantt`, token, tick);
  const dependencies = (gantt.data?.dependencies || []).filter(x => x.task_id === task.id);
  const done = (data || []).filter(x => x.is_done).length;
  async function act(path, method, payload) {
    try { setError(""); await api(path, token, {method, ...(payload ? {body:JSON.stringify(payload)} : {})}); update(n=>n+1); }
    catch (e) {setError(e.message);}
  }
  async function add(e) {
    e.preventDefault(); if (!title.trim()) return;
    try {setError(""); await api(`/tasks/${task.id}/subtasks`,token,{method:"POST",body:JSON.stringify({title:title.trim(),assignee_id:assignee ? Number(assignee):null})});setTitle("");setAssignee("");update(n=>n+1);}
    catch(e){setError(e.message);}
  }
  return <div className="modal-overlay" onMouseDown={e=>e.target===e.currentTarget&&onClose()}>
    <div className="modal tf30-modal" role="dialog" aria-modal="true" aria-label="Subtasques i dependències">
      <div className="modal-header"><h2>✅ Subtasques · {task.title}</h2><button type="button" className="modal-close" onClick={onClose}>✕</button></div>
      <Message error={error || loadError || gantt.error}/>
      <p>{done} de {(data||[]).length} subtasques completades</p>
      {loading ? <p>Carregant...</p> : <div className="tf30-checklist">{(data||[]).map(s=><div className="tf30-check-row" key={s.id}>
        <label><input type="checkbox" checked={s.is_done} disabled={!canEdit} onChange={e=>act(`/tasks/${task.id}/subtasks/${s.id}`,"PATCH",{is_done:e.target.checked})}/>
        <span style={{textDecoration:s.is_done?"line-through":"none"}}>{s.title}</span></label>
        <span className="tf30-muted">{s.assignee_name||"Sense assignar"}</span>
        {canEdit&&<button type="button" onClick={()=>act(`/tasks/${task.id}/subtasks/${s.id}`,"DELETE")}>Eliminar</button>}
      </div>)}</div>}
      {canEdit&&<form onSubmit={add} className="tf30-inline-form"><input placeholder="Nova subtasca" maxLength={200} required value={title} onChange={e=>setTitle(e.target.value)}/>
        <select value={assignee} onChange={e=>setAssignee(e.target.value)}><option value="">Sense assignar</option>{members.map(m=><option value={m.user_id} key={m.user_id}>{m.name}</option>)}</select>
        <button type="submit">+ Afegir</button></form>}
      <h3>🔗 Dependències</h3><p className="tf30-muted">Aquesta tasca no s'hauria de començar abans d'acabar les tasques de què depèn. Són dependències informatives: no bloquegen automàticament el Kanban.</p>
      {dependencies.map(d=><div className="tf30-check-row" key={d.depends_on_id}><span>{tasks.find(t=>t.id===d.depends_on_id)?.title||`Tasca #${d.depends_on_id}`}</span>
        {canEdit&&<button type="button" onClick={()=>act(`/tasks/${task.id}/dependencies/${d.depends_on_id}`,"DELETE")}>Eliminar</button>}</div>)}
      {canEdit&&<div className="tf30-inline-form"><select value={dependency} onChange={e=>setDependency(e.target.value)}><option value="">Selecciona una tasca anterior...</option>
        {tasks.filter(t=>t.id!==task.id&&!dependencies.some(d=>d.depends_on_id===t.id)).map(t=><option key={t.id} value={t.id}>{t.title}</option>)}</select>
        <button type="button" disabled={!dependency} onClick={()=>{act(`/tasks/${task.id}/dependencies`,"POST",{depends_on_id:Number(dependency)});setDependency("");}}>Afegir dependència</button></div>}
    </div>
  </div>;
}

export function GanttView({projectId, token, canEdit, onTasksChanged}) {
  const [tick, setTick] = useState(0), [error,setError] = useState("");
  const {data,loading,error:loadError} = useRemote(`/projects/${projectId}/gantt`,token,tick);
  const tasks = data?.tasks||[], deps = data?.dependencies||[];
  const dated = tasks.filter(t=>t.start_date||t.due_date).sort((a,b)=>(a.start_date||a.due_date).localeCompare(b.start_date||b.due_date));
  const dates = dated.flatMap(t=>[t.start_date||t.due_date,t.due_date||t.start_date]).filter(Boolean).map(x=>new Date(x+"T12:00:00").getTime());
  const min = dates.length?Math.min(...dates):Date.now(), max=dates.length?Math.max(...dates):min+86400000;
  const range=Math.max(86400000,max-min+86400000);
  async function save(id,key,value) {
    try {setError("");await api(`/tasks/${id}`,token,{method:"PATCH",body:JSON.stringify({[key]:value||null})});setTick(x=>x+1);onTasksChanged?.();}
    catch(e){setError(e.message);}
  }
  return <section className="tf30-section"><h2>📅 Diagrama de Gantt</h2>
    <p className="tf30-muted">Planificació per data d'inici i venciment. Les dependències es gestionen des del botó Subtasques.</p>
    <Message error={error||loadError}/>{loading?<p>Carregant...</p>:<>
      <div className="tf30-table-scroll"><table className="tf30-table"><thead><tr><th>Tasca</th><th>Inici</th><th>Venciment</th><th>Planificació relativa</th><th>Depèn de</th></tr></thead><tbody>
        {tasks.map(t=>{const begin=t.start_date||t.due_date,end=t.due_date||t.start_date;
          const left=begin?Math.max(0,(new Date(begin+"T12:00:00").getTime()-min)/range*100):0;
          const width=begin&&end?Math.max(1,(new Date(end+"T12:00:00").getTime()-new Date(begin+"T12:00:00").getTime()+86400000)/range*100):0;
          const valid=begin&&end&&end>=begin;
          return <tr key={t.id}><td><strong>{t.title}</strong></td><td><input type="date" aria-label={`Inici de ${t.title}`} value={t.start_date||""} disabled={!canEdit} onChange={e=>save(t.id,"start_date",e.target.value)}/></td>
          <td><input type="date" aria-label={`Venciment de ${t.title}`} value={t.due_date||""} disabled={!canEdit} onChange={e=>save(t.id,"due_date",e.target.value)}/></td>
          <td><div className="tf30-timeline">{valid?<div className="tf30-timeline-bar" style={{left:`${left}%`,width:`${Math.min(width,100-left)}%`}} title={`${begin} → ${end}`}/>:<span className="tf30-muted">{begin?"Dates incorrectes":"Sense dates"}</span>}</div></td>
          <td>{deps.filter(x=>x.task_id===t.id).map(x=>tasks.find(y=>y.id===x.depends_on_id)?.title||`#${x.depends_on_id}`).join(", ")||"—"}</td></tr>;
        })}</tbody></table></div>{!tasks.length&&<p>Encara no hi ha tasques.</p>}</>}
  </section>;
}

export function ActivityView({projectId,token}) {
  const [tick,refresh] = useState(0);
  const {data,loading,error}=useRemote(`/projects/${projectId}/activity`,token,tick);
  return <section className="tf30-section"><div className="tf30-heading"><h2>🕘 Historial d'activitat</h2><button onClick={()=>refresh(n=>n+1)}>Actualitzar</button></div>
    <p className="tf30-muted">Els esdeveniments previs a la instal·lació de TaskFlow 3.0 no es poden reconstruir.</p><Message error={error}/>
    {loading?<p>Carregant...</p>:<div className="tf30-activity">{(data||[]).map(x=><div key={x.id} className="tf30-activity-row"><strong>{x.user_name}</strong> · {x.description}<small>{new Date(x.created_at).toLocaleString("ca-ES")}</small></div>)}
    {!data?.length&&<p>No hi ha activitat registrada.</p>}</div>}
  </section>;
}

export function AutomationsView({projectId,token,canEdit,members,onTasksChanged}) {
  const [tick,refresh]=useState(0),[error,setError]=useState(""),[title,setTitle]=useState(""),[freq,setFreq]=useState("weekly"),[date,setDate]=useState(""),[assignee,setAssignee]=useState("");
  const {data,loading,error:loadError}=useRemote(`/projects/${projectId}/automations`,token,tick);
  async function action(path,method,payload) {
    try {setError("");const result=await api(path,token,{method,...(payload?{body:JSON.stringify(payload)}:{})});refresh(n=>n+1);return result;}
    catch(e){setError(e.message);return null;}
  }
  async function create(e) {e.preventDefault();const res=await action(`/projects/${projectId}/automations`,"POST",{title,frequency:freq,next_run:date,assignee_id:assignee?Number(assignee):null});if(res){setTitle("");setDate("");}}
  async function runNow() {const result=await action('/automations/run-now','POST');if(result){onTasksChanged?.();alert(`${result.created} tasques recurrents creades als teus projectes.`);}}
  return <section className="tf30-section"><h2>⚡ Automatitzacions recurrents</h2>
    <p className="tf30-muted">Creació automàtica de tasques diàries, setmanals o mensuals. El backend revisa les regles mentre està actiu. Si ha estat apagat, recupera una ocurrència pendent per cicle de revisió.</p>
    <Message error={error||loadError}/>{canEdit&&<form className="tf30-form" onSubmit={create}><input value={title} maxLength={200} required placeholder="Títol de la tasca recurrent" onChange={e=>setTitle(e.target.value)}/>
      <select value={freq} onChange={e=>setFreq(e.target.value)}><option value="daily">Cada dia</option><option value="weekly">Cada setmana</option><option value="monthly">Cada mes</option></select>
      <label>Primera execució<input required type="date" value={date} onChange={e=>setDate(e.target.value)}/></label>
      <select value={assignee} onChange={e=>setAssignee(e.target.value)}><option value="">Sense assignar</option>{members.map(m=><option key={m.user_id} value={m.user_id}>{m.name}</option>)}</select>
      <button type="submit">Crear regla</button></form>}
    {loading?<p>Carregant...</p>:<div className="tf30-table-scroll"><table className="tf30-table"><thead><tr><th>Regla</th><th>Freqüència</th><th>Proper dia</th><th>Estat</th><th>Accions</th></tr></thead><tbody>
      {(data||[]).map(r=><tr key={r.id}><td>{r.title}</td><td>{r.frequency}</td><td>{r.next_run}</td><td>{r.enabled?"Activa":"Pausada"}</td><td>{canEdit&&<><button onClick={()=>action(`/projects/${projectId}/automations/${r.id}`,"PATCH",{enabled:!r.enabled})}>{r.enabled?"Pausar":"Activar"}</button> <button onClick={()=>{if(window.confirm("Eliminar aquesta regla?"))action(`/projects/${projectId}/automations/${r.id}`,"DELETE")}}>Eliminar</button></>}</td></tr>)}</tbody></table></div>}
    {canEdit&&<button type="button" onClick={runNow}>Executar regles pendents dels meus projectes (propietari)</button>}
  </section>;
}

export function GlobalSearch({token,projects,onSelectProject,onClose}) {
  const [query,setQuery]=useState(""), [submitted,setSubmitted]=useState("");
  const {data,loading,error}=useRemote(submitted?`/search/global?q=${encodeURIComponent(submitted)}`:null,token);
  return <div className="modal-overlay" onMouseDown={e=>e.target===e.currentTarget&&onClose()}><div className="modal tf30-modal" role="dialog" aria-modal="true" aria-label="Cercador global">
    <div className="modal-header"><h2>🔎 Cercador global</h2><button className="modal-close" onClick={onClose}>✕</button></div>
    <form onSubmit={e=>{e.preventDefault();if(query.trim().length>=2)setSubmitted(query.trim());}} className="tf30-inline-form"><input autoFocus value={query} minLength={2} onChange={e=>setQuery(e.target.value)} placeholder="Projectes, tasques i comentaris..."/><button type="submit">Cercar</button></form>
    <Message error={error}/>{submitted&&loading&&<p>Buscant...</p>}
    {data&&<div className="tf30-search-results"><h3>Projectes ({data.projects.length})</h3>{data.projects.map(x=><button key={x.id} onClick={()=>{onSelectProject(x.id);onClose();}}>{x.name}</button>)}
    <h3>Tasques ({data.tasks.length})</h3>{data.tasks.map(x=><button key={x.id} onClick={()=>{onSelectProject(x.project_id);onClose();}}>{x.title} · {projects.find(p=>p.id===x.project_id)?.name}</button>)}
    <h3>Comentaris ({data.comments.length})</h3>{data.comments.map(x=><button key={x.id} onClick={()=>{onSelectProject(x.project_id);onClose();}}>{x.preview}</button>)}</div>}
  </div></div>;
}

export function AIView({projectId,token}) {
  const [status,setStatus]=useState(null),[action,setAction]=useState("suggest_subtasks"),[prompt,setPrompt]=useState(""),[answer,setAnswer]=useState(""),[error,setError]=useState(""),[loading,setLoading]=useState(false);
  useEffect(()=>{let active=true;api('/ai/status',token).then(x=>active&&setStatus(x)).catch(e=>active&&setError(e.message));return()=>{active=false};},[token]);
  async function submit(e) {e.preventDefault();setLoading(true);setError("");setAnswer("");try{const r=await api(`/projects/${projectId}/ai`,token,{method:'POST',body:JSON.stringify({action,prompt})});setAnswer(r.answer);}catch(e){setError(e.message);}finally{setLoading(false);}}
  return <section className="tf30-section"><h2>🤖 Assistent IA</h2>
    <p className="tf30-muted">Les respostes són propostes: no modifiquen les tasques automàticament. En enviar una petició, es comparteixen amb el proveïdor configurat el nom del projecte, els títols, estats, prioritats i dates de fins a 100 tasques, més la teva petició. No s'envien fitxers ni comentaris.</p>
    <p><strong>Estat:</strong> {status===null?"Comprovant...":status.configured?`IA configurada: ${status.provider || "model"} (${status.model || ""})`:status.provider==="ollama"?"Ollama no disponible o model no instal·lat":"IA no configurada al backend (AI_API_KEY)"}</p>
    <Message error={error}/><form onSubmit={submit} className="tf30-form"><select value={action} onChange={e=>setAction(e.target.value)}><option value="suggest_subtasks">Proposar subtasques</option><option value="summarize_project">Resumir projecte</option><option value="risk_review">Revisar riscos</option></select>
    <textarea rows={4} required minLength={3} maxLength={1200} value={prompt} onChange={e=>setPrompt(e.target.value)} placeholder="Què vols que analitzi l'assistent?"/>
    <button type="submit" disabled={loading||!status?.configured}>{loading?"Generant...":"Consultar IA"}</button></form>
    {answer&&<div className="tf30-ai-answer"><h3>Resposta de l'assistent</h3><p>{answer}</p></div>}
  </section>;
}
