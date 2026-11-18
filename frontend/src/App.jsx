import React, { useEffect, useState } from "react";
import CalendarView from "./CalendarView";
import NotificationCenter from "./NotificationCenter";
import TaskComments from "./TaskComments";
import TaskAttachments from "./TaskAttachments";
import ProjectStats from "./ProjectStats";
import {SubtaskPanel,GanttView,ActivityView,AutomationsView,GlobalSearch,AIView} from "./Features30";
import "./taskflow26.css";

const API = "http://localhost:8000";
const COLUMNS = [
  { id: "pendent", title: "Pendent", icon: "📋" },
  { id: "progres", title: "En progrés", icon: "⚡" },
  { id: "completada", title: "Completada", icon: "✅" },
];
const EMPTY_FORM = {
  title: "", description: "", priority: "mitjana", due_date: "", start_date: "",
  status: "pendent", assignee_id: "",
};
const EMPTY_FILTERS = { search: "", priority: "totes", status: "tots", date: "totes" };

function todayString() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function isOverdue(t) {
  return !!(t.due_date && t.due_date < todayString() && t.status !== "completada");
}
function formatDate(d) {
  return d ? d.split("-").reverse().join("/") : "";
}
function priorityLabel(s) {
  return ({ baixa: "Baixa", mitjana: "Mitjana", alta: "Alta" })[s] || "Mitjana";
}

export default function App() {
  const [token, setToken] = useState(() => localStorage.getItem("taskflow_token") || "");
  const [user, setUser] = useState(null);
  const [authMode, setAuthMode] = useState("login");
  const [authForm, setAuthForm] = useState({ name: "", email: "", password: "" });
  const [authLoading, setAuthLoading] = useState(false);
  const [projects, setProjects] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [selectedProject, setSelectedProject] = useState(null);
  const [members, setMembers] = useState([]);
  const [projectName, setProjectName] = useState("");
  const [view, setView] = useState("kanban");
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [modalMode, setModalMode] = useState(null);
  const [editingTaskId, setEditingTaskId] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [shareEmail, setShareEmail] = useState("");
  const [shareRole, setShareRole] = useState("editor");
  const [shareLoading, setShareLoading] = useState(false);
  const [selectedTasks, setSelectedTasks] = useState([]);
  const [bulkStatus, setBulkStatus] = useState("completada");
  const [bulkLoading, setBulkLoading] = useState(false);
  const [commentsTask, setCommentsTask] = useState(null);
  const [attachmentsTask, setAttachmentsTask] = useState(null);
  const [subtaskTask, setSubtaskTask] = useState(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [draggedTask, setDraggedTask] = useState(null);
  const [dragOverColumn, setDragOverColumn] = useState(null);

  async function request(path, options = {}, activeToken = token) {
    const response = await fetch(API + path, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(activeToken ? { Authorization: `Bearer ${activeToken}` } : {}),
        ...(options.headers || {}),
      },
    });
    if (!response.ok) {
      let detail = `Error HTTP ${response.status}`;
      try {
        const data = await response.json();
        if (typeof data.detail === "string") detail = data.detail;
      } catch { /* resposta sense JSON */ }
      const e = new Error(detail);
      e.status = response.status;
      throw e;
    }
    return response.json();
  }

  function logout() {
    localStorage.removeItem("taskflow_token");
    setToken(""); setUser(null); setProjects([]); setTasks([]);
    setMembers([]); setSelectedProject(null); setSelectedTasks([]);
    setShareOpen(false); setModalMode(null); setCommentsTask(null); setSubtaskTask(null); setSearchOpen(false); setAttachmentsTask(null); setError(""); setNotice("");
  }

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    async function init() {
      try {
        const [u, p, t] = await Promise.all([
          request("/auth/me", {}, token),
          request("/projects", {}, token),
          request("/tasks", {}, token),
        ]);
        if (cancelled) return;
        setUser(u); setProjects(p); setTasks(t);
        setSelectedProject(current => p.some(x => x.id === current) ? current : p[0]?.id ?? null);
      } catch (e) {
        if (cancelled) return;
        if (e.status === 401) logout();
        else setError(e.message);
      }
    }
    init();
    return () => { cancelled = true; };
  }, [token]);

  useEffect(() => {
    if (!token || selectedProject == null) { setMembers([]); return; }
    let cancelled = false;
    request(`/projects/${selectedProject}/members`).then(data => {
      if (!cancelled) setMembers(data);
    }).catch(e => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [token, selectedProject]);

  async function submitAuth(e) {
    e.preventDefault();
    setAuthLoading(true); setError("");
    try {
      const path = authMode === "register" ? "/auth/register" : "/auth/login";
      const payload = authMode === "register" ? authForm : {
        email: authForm.email, password: authForm.password,
      };
      const result = await request(path, { method: "POST", body: JSON.stringify(payload) }, "");
      localStorage.setItem("taskflow_token", result.access_token);
      setUser(result.user); setToken(result.access_token);
      setAuthForm({ name: "", email: "", password: "" });
    } catch (e) { setError(e.message); }
    finally { setAuthLoading(false); }
  }

  async function reloadProjects() {
    const p = await request("/projects");
    setProjects(p);
    setSelectedProject(current => p.some(x => x.id === current) ? current : p[0]?.id ?? null);
  }
  async function reloadTasks() { setTasks(await request("/tasks")); }
  async function reloadMembers() {
    if (selectedProject != null) setMembers(await request(`/projects/${selectedProject}/members`));
  }

  function selectProject(id) {
    if (bulkLoading || saving || shareLoading) return;
    setSelectedProject(id); setSelectedTasks([]); setCommentsTask(null); setSubtaskTask(null); setAttachmentsTask(null); setFilters({ ...EMPTY_FILTERS });
    setView("kanban"); setShareOpen(false); setError(""); setNotice("");
  }
  async function createProject(e) {
    e.preventDefault();
    if (!projectName.trim() || bulkLoading) return;
    try {
      const project = await request("/projects", {
        method: "POST", body: JSON.stringify({ name: projectName.trim() }),
      });
      setProjectName(""); await reloadProjects(); selectProject(project.id); setError("");
    } catch (e) { setError(e.message); }
  }
  async function deleteProject() {
    if (!activeProject || activeProject.role !== "owner") return;
    if (!window.confirm("Eliminar el projecte i totes les seves tasques? Aquesta acció no es pot desfer.")) return;
    try {
      await request(`/projects/${selectedProject}`, { method: "DELETE" });
      setSelectedTasks([]); setShareOpen(false);
      await Promise.all([reloadProjects(), reloadTasks()]);
      setError("");
    } catch (e) { setError(e.message); }
  }

  function openCreateTask() {
    if (!canEdit) return;
    setModalMode("create"); setEditingTaskId(null); setForm({ ...EMPTY_FORM }); setError("");
  }
  function openEditTask(task) {
    if (bulkLoading || !canEdit) return;
    setModalMode("edit"); setEditingTaskId(task.id); setError("");
    setForm({
      title: task.title, description: task.description || "",
      priority: task.priority || "mitjana", due_date: task.due_date || "", start_date: task.start_date || "",
      status: task.status, assignee_id: task.assignee_id == null ? "" : String(task.assignee_id),
    });
  }
  function closeModal() {
    if (saving) return;
    setModalMode(null); setEditingTaskId(null); setForm({ ...EMPTY_FORM }); setError("");
  }
  function updateForm(field, value) { setForm(current => ({ ...current, [field]: value })); }
  async function saveTask(e) {
    e.preventDefault();
    if (!canEdit || !modalMode || saving || !form.title.trim()) return;
    setSaving(true); setError("");
    const payload = {
      title: form.title.trim(), description: form.description, priority: form.priority,
      due_date: form.due_date || null, start_date: form.start_date || null, status: form.status,
      assignee_id: form.assignee_id === "" ? null : Number(form.assignee_id),
    };
    try {
      if (modalMode === "create") {
        await request("/tasks", {
          method: "POST", body: JSON.stringify({ ...payload, project_id: selectedProject }),
        });
      } else {
        await request(`/tasks/${editingTaskId}`, { method: "PATCH", body: JSON.stringify(payload) });
      }
      await reloadTasks();
      setModalMode(null); setEditingTaskId(null); setForm({ ...EMPTY_FORM });
      setNotice("Tasca guardada correctament.");
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  }
  async function deleteTask(id) {
    if (!canEdit) return;
    if (!window.confirm("Vols eliminar aquesta tasca?")) return;
    try {
      await request(`/tasks/${id}`, { method: "DELETE" });
      setSelectedTasks(current => current.filter(x => x !== id));
      await reloadTasks(); setError("");
    } catch (e) { setError(e.message); }
  }
  async function changeStatus(id, status) {
    if (!canEdit) return;
    try {
      await request(`/tasks/${id}`, { method: "PATCH", body: JSON.stringify({ status }) });
      await reloadTasks(); setError("");
    } catch (e) { setError(e.message); }
  }

  async function addMember(e) {
    e.preventDefault();
    if (!shareEmail.trim() || !activeProject || activeProject.role !== "owner") return;
    setShareLoading(true); setError(""); setNotice("");
    try {
      await request(`/projects/${selectedProject}/members`, {
        method: "POST", body: JSON.stringify({ email: shareEmail.trim(), role: shareRole }),
      });
      setShareEmail(""); await reloadMembers();
      setNotice("Persona afegida al projecte. Ja podrà veure'l quan entri al seu compte.");
    } catch (e) { setError(e.message); }
    finally { setShareLoading(false); }
  }
  async function changeMemberRole(memberId, role) {
    if (!activeProject || activeProject.role !== "owner" || shareLoading) return;
    setShareLoading(true); setError(""); setNotice("");
    try {
      await request(`/projects/${selectedProject}/members/${memberId}`, {
        method: "PATCH", body: JSON.stringify({ role }),
      });
      await reloadMembers();
      setNotice("Rol del membre actualitzat.");
    } catch (e) { setError(e.message); }
    finally { setShareLoading(false); }
  }

  async function removeMember(memberId, memberName) {
    if (!window.confirm(`Revocar l'accés a ${memberName}? Les seves tasques quedaran sense assignar.`)) return;
    setShareLoading(true); setError("");
    try {
      await request(`/projects/${selectedProject}/members/${memberId}`, { method: "DELETE" });
      await Promise.all([reloadMembers(), reloadTasks()]);
      setNotice("Accés revocat.");
    } catch (e) { setError(e.message); }
    finally { setShareLoading(false); }
  }

  const activeProject = projects.find(p => p.id === selectedProject);
  const canEdit = activeProject?.role === "owner" || activeProject?.role === "editor";
  const projectTasks = tasks.filter(t => t.project_id === selectedProject);
  const totalTasks = projectTasks.length;
  const pendingTasks = projectTasks.filter(t => t.status === "pendent").length;
  const progressTasks = projectTasks.filter(t => t.status === "progres").length;
  const completedTasks = projectTasks.filter(t => t.status === "completada").length;
  const overdueTasks = projectTasks.filter(isOverdue).length;
  const percentage = totalTasks ? Math.round(completedTasks * 100 / totalTasks) : 0;

  const filteredTasks = projectTasks.filter(task => {
    const search = filters.search.trim().toLocaleLowerCase();
    const content = `${task.title} ${task.description || ""} ${task.assignee_name || ""}`.toLocaleLowerCase();
    const searchOK = !search || content.includes(search);
    const priorityOK = filters.priority === "totes" || task.priority === filters.priority;
    const statusOK = filters.status === "tots" || task.status === filters.status;
    const today = todayString();
    let dateOK = true;
    if (filters.date === "vençudes") dateOK = isOverdue(task);
    if (filters.date === "avui") dateOK = task.due_date === today;
    if (filters.date === "futures") dateOK = !!(task.due_date && task.due_date > today);
    if (filters.date === "sense-data") dateOK = !task.due_date;
    return searchOK && priorityOK && statusOK && dateOK;
  });
  const visibleIds = filteredTasks.map(t => t.id);
  const selectedVisibleIds = visibleIds.filter(id => selectedTasks.includes(id));
  const selectedCount = selectedVisibleIds.length;
  const allSelected = visibleIds.length > 0 && selectedCount === visibleIds.length;
  function updateFilter(field, value) {
    if (bulkLoading) return;
    setFilters(current => ({ ...current, [field]: value })); setSelectedTasks([]);
  }
  function toggleTaskSelection(id) {
    setSelectedTasks(current => current.includes(id) ? current.filter(x => x !== id) : [...current, id]);
  }
  async function runBulk(method, statusValue = null) {
    if (!canEdit || !selectedCount || bulkLoading) return;
    const ids = [...selectedVisibleIds];
    if (method === "DELETE" && !window.confirm(`Eliminar definitivament ${ids.length} tasques?`)) return;
    setBulkLoading(true); setError("");
    try {
      const results = await Promise.allSettled(ids.map(id => request(`/tasks/${id}`, {
        method, ...(statusValue ? { body: JSON.stringify({ status: statusValue }) } : {}),
      })));
      const failed = ids.filter((_, i) => results[i].status === "rejected");
      await reloadTasks(); setSelectedTasks(failed);
      if (failed.length) setError(`${failed.length} tasques no s'han pogut processar.`);
      else setNotice("Acció massiva completada.");
    } catch (e) { setError(e.message); }
    finally { setBulkLoading(false); }
  }
  function handleDragStart(e, task) {
    if (bulkLoading || !canEdit) { e.preventDefault(); return; }
    setDraggedTask(task.id); e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(task.id));
  }
  function handleDragOver(e, col) {
    if (bulkLoading || !canEdit) return;
    e.preventDefault(); e.dataTransfer.dropEffect = "move"; setDragOverColumn(col);
  }
  async function handleDrop(e, col) {
    e.preventDefault();
    const id = Number(e.dataTransfer.getData("text/plain"));
    setDraggedTask(null); setDragOverColumn(null);
    if (bulkLoading || !canEdit || !Number.isInteger(id)) return;
    const task = projectTasks.find(t => t.id === id);
    if (task && task.status !== col) await changeStatus(id, col);
  }

  if (!token || !user) {
    return (
      <div className="tf-auth-page">
        <form className="tf-auth-card" onSubmit={submitAuth}>
          <h1>🐳 TaskFlow</h1>
          <p>{authMode === "register" ? "Crea el teu compte" : "Inicia sessió per continuar"}</p>
          {error && <div className="error" role="alert">{error}</div>}
          {authMode === "register" && (
            <label>Nom complet<input required maxLength={120} value={authForm.name}
              onChange={e => setAuthForm(f => ({ ...f, name: e.target.value }))} /></label>
          )}
          <label>Correu electrònic<input type="email" required value={authForm.email}
            onChange={e => setAuthForm(f => ({ ...f, email: e.target.value }))} /></label>
          <label>Contrasenya<input type="password" required minLength={authMode === "register" ? 8 : undefined}
            value={authForm.password} onChange={e => setAuthForm(f => ({ ...f, password: e.target.value }))} /></label>
          <button className="tf-primary" type="submit" disabled={authLoading}>
            {authLoading ? "Processant..." : authMode === "register" ? "Crear compte" : "Entrar"}
          </button>
          <button type="button" className="tf-text-button" onClick={() => {
            setAuthMode(m => m === "login" ? "register" : "login"); setError("");
          }}>
            {authMode === "register" ? "Ja tens compte? Inicia sessió" : "No tens compte? Registra't"}
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="logo">🐳 TaskFlow</div>
        <div className="tf-profile"><strong>{user.name}</strong><small>{user.email}</small>
          <button type="button" onClick={logout}>Tancar sessió</button>
        </div>
        <p className="sidebar-label">ELS MEUS PROJECTES</p>
        <form className="project-form" onSubmit={createProject}>
          <input placeholder="Nom del projecte" maxLength={150} value={projectName}
            onChange={e => setProjectName(e.target.value)} disabled={bulkLoading} />
          <button type="submit" disabled={bulkLoading}>+ Crear projecte</button>
        </form>
        <div className="project-list">
          {projects.map(p => (
            <button type="button" key={p.id}
              className={`project-item ${selectedProject === p.id ? "active" : ""}`}
              onClick={() => selectProject(p.id)} disabled={bulkLoading}>
              📁 {p.name} {p.role !== "owner" ? "👥" : ""}
            </button>
          ))}
        </div>
        <div className="sidebar-footer">TaskFlow 3.0<br />Multiusuari · FastAPI · React</div>
      </aside>

      <main className="main">
        <header className="header">
          <div><p className="eyebrow">TASKFLOW 3.0 · PROJECTES COMPARTITS</p>
            <h1>{activeProject?.name || "TaskFlow"}</h1>
            <p className="subtitle">Organitza, comparteix i assigna tasques al teu equip.</p>
          </div>
          <div className="tf-header-actions">
            <NotificationCenter token={token} />
            <button type="button" className="tf-share-button" onClick={()=>setSearchOpen(true)}>🔎 Cerca global</button>
            {activeProject && <>
              <button className="tf-share-button" type="button" onClick={() => {
                setShareOpen(true); setError(""); setNotice("");
              }}>👥 Membres i compartir</button>
              {activeProject.role === "owner" &&
                <button className="danger-outline" type="button" onClick={deleteProject}>Eliminar projecte</button>}
            </>}
          </div>
        </header>
        {error && !modalMode && !shareOpen && <div className="error" role="alert">{error}</div>}
        {notice && !modalMode && !shareOpen && <div className="tf-notice">{notice}</div>}

        {activeProject ? <>
          <section className="dashboard">
            <div className="dashboard-heading"><h2>📊 Resum del projecte</h2>
              <p>{activeProject.role === "owner" ? "Ets propietari" : activeProject.role === "lector" ? "Ets lector · només consulta" : "Ets membre editor"} · {members.length} membre(s)</p></div>
            <div className="stats">
              {[["📊", "Total tasques", totalTasks, "stat-blue"],
                ["📋", "Pendents", pendingTasks, "stat-yellow"],
                ["⚡", "En progrés", progressTasks, "stat-purple"],
                ["✅", "Completades", completedTasks, "stat-green"]].map(([ic, label, value, color]) => (
                <div className="stat-card" key={label}><div className={`stat-icon ${color}`}>{ic}</div>
                  <span>{label}</span><strong>{value}</strong></div>
              ))}
            </div>
            <div className="progress-card"><div className="progress-header">
              <div><h3>Progrés del projecte</h3><p>{completedTasks} de {totalTasks} tasques completades</p></div>
              <strong className="progress-percentage">{percentage}%</strong></div>
              <div className="progress-track" role="progressbar" aria-label="Progrés del projecte"
                aria-valuenow={percentage} aria-valuemin={0} aria-valuemax={100}>
                <div className="progress-fill" style={{ width: `${percentage}%` }} /></div>
              <div className="progress-footer"><span>0%</span><span>100%</span></div>
            </div>
            {overdueTasks > 0 && <div className="overdue-alert">⚠️ {overdueTasks} tasques fora de termini</div>}
            {totalTasks > 0 && completedTasks === totalTasks &&
              <div className="success-alert">🎉 Has completat totes les tasques!</div>}
          </section>

          {canEdit && <section className="task-create-bar"><div><h3>Gestió de tasques</h3>
            <p>Crea tasques, assigna responsables i estableix dates límit.</p></div>
            <button type="button" className="create-task-button" onClick={openCreateTask}>+ Nova tasca</button></section>}

          <section className="filters-panel"><div className="filters-header">
            <div><h2>🔎 Cercador i filtres</h2><p>Busca per títol, descripció o responsable.</p></div>
            <button type="button" className="reset-filters" onClick={() => {
              setFilters({ ...EMPTY_FILTERS }); setSelectedTasks([]);
            }}>Netejar filtres</button></div>
            <div className="filters-grid">
              <div className="filter-group"><label htmlFor="tf-search">Buscar tasques</label>
                <input id="tf-search" type="search" placeholder="Nom, text o persona..." value={filters.search}
                  onChange={e => updateFilter("search", e.target.value)} /></div>
              <div className="filter-group"><label htmlFor="tf-priority">Prioritat</label>
                <select id="tf-priority" value={filters.priority} onChange={e => updateFilter("priority", e.target.value)}>
                  <option value="totes">Totes</option><option value="alta">🔴 Alta</option>
                  <option value="mitjana">🟡 Mitjana</option><option value="baixa">🟢 Baixa</option></select></div>
              <div className="filter-group"><label htmlFor="tf-status">Estat</label>
                <select id="tf-status" value={filters.status} onChange={e => updateFilter("status", e.target.value)}>
                  <option value="tots">Tots</option><option value="pendent">📋 Pendent</option>
                  <option value="progres">⚡ En progrés</option><option value="completada">✅ Completada</option></select></div>
              <div className="filter-group"><label htmlFor="tf-date">Data límit</label>
                <select id="tf-date" value={filters.date} onChange={e => updateFilter("date", e.target.value)}>
                  <option value="totes">Totes les dates</option><option value="vençudes">⚠️ Vençudes</option>
                  <option value="avui">📅 Avui</option><option value="futures">Properes dates</option>
                  <option value="sense-data">Sense data</option></select></div>
            </div><div className="filters-results">Mostrant <strong>{filteredTasks.length}</strong> de <strong>{totalTasks}</strong> tasques</div>
          </section>

          <div className="view-switcher"><button type="button" className={view === "kanban" ? "view-active" : ""}
            onClick={() => { setView("kanban"); setSelectedTasks([]); }}>📋 Kanban</button>
            <button type="button" className={view === "calendar" ? "view-active" : ""}
              onClick={() => { setView("calendar"); setSelectedTasks([]); }}>📅 Calendari</button>
            <button type="button" className={view === "stats" ? "view-active" : ""}
              onClick={() => { setView("stats"); setSelectedTasks([]); }}>📊 Estadístiques</button>
            {[ ["gantt","📅 Gantt"],["activity","🕘 Historial"],["automations","⚡ Automatitzacions"],["ai","🤖 IA"] ].map(([key,label])=><button key={key} type="button" className={view===key?"view-active":""} onClick={()=>{setView(key);setSelectedTasks([]);}}>{label}</button>)}</div>

          {view === "stats" && <ProjectStats projectId={selectedProject} token={token} />}
          {view === "gantt" && <GanttView projectId={selectedProject} token={token} canEdit={canEdit} onTasksChanged={reloadTasks}/>}
          {view === "activity" && <ActivityView projectId={selectedProject} token={token}/>}
          {view === "automations" && <AutomationsView projectId={selectedProject} token={token} canEdit={canEdit} members={members} onTasksChanged={reloadTasks}/>}
          {view === "ai" && <AIView projectId={selectedProject} token={token}/>}
          {view === "calendar" && <CalendarView tasks={filteredTasks} onEdit={canEdit ? openEditTask : () => {}} />}
          {view === "kanban" && <>
            {!canEdit && <p className="tf-readonly-note">👁️ Rol Lector: pots consultar les tasques, però no modificar-les.</p>}
            {canEdit && <section className="bulk-toolbar"><div className="bulk-top">
              <label className="select-all-label"><input type="checkbox" checked={allSelected}
                disabled={!visibleIds.length || bulkLoading}
                onChange={e => setSelectedTasks(e.target.checked ? [...visibleIds] : [])} />
                Seleccionar totes les visibles</label>
              <span className="selected-counter">{selectedCount} de {filteredTasks.length} seleccionades</span>
              <button type="button" className="clear-selection" disabled={!selectedCount || bulkLoading}
                onClick={() => setSelectedTasks([])}>Desmarcar</button></div>
              {selectedCount > 0 && <div className="bulk-actions"><div className="bulk-status-group">
                <label htmlFor="tf-bulk-status">Acció massiva</label>
                <select id="tf-bulk-status" value={bulkStatus} disabled={bulkLoading}
                  onChange={e => setBulkStatus(e.target.value)}>
                  <option value="pendent">📋 Pendent</option><option value="progres">⚡ En progrés</option>
                  <option value="completada">✅ Completada</option></select>
                <button type="button" className="bulk-apply" disabled={bulkLoading}
                  onClick={() => runBulk("PATCH", bulkStatus)}>Aplicar</button></div>
                <button type="button" className="bulk-delete" disabled={bulkLoading}
                  onClick={() => runBulk("DELETE")}>🗑️ Eliminar seleccionades</button></div>}
            </section>}
            {canEdit && <p className="drag-hint">✋ Arrossega tasques entre columnes o selecciona-les per modificar-les en massa.</p>}
            <div className="kanban">{COLUMNS.map(col => {
              const columnTasks = filteredTasks.filter(t => t.status === col.id);
              return <section key={col.id} className={`kanban-column ${dragOverColumn === col.id ? "drag-over" : ""}`}
                onDragOver={e => handleDragOver(e, col.id)}
                onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget)) setDragOverColumn(null); }}
                onDrop={e => handleDrop(e, col.id)}>
                <div className="column-header"><h2>{col.icon} {col.title}</h2><span className="count">{columnTasks.length}</span></div>
                <div className="task-list">{columnTasks.map(task => {
                  const checked = selectedTasks.includes(task.id);
                  return <article key={task.id} draggable={canEdit && !bulkLoading}
                    className={`task-card ${draggedTask === task.id ? "dragging" : ""} ${checked ? "task-selected" : ""}`}
                    onDragStart={e => handleDragStart(e, task)} onDragEnd={() => {
                      setDraggedTask(null); setDragOverColumn(null);
                    }}>
                    {canEdit && <div className="task-selection"><label className="task-checkbox-label">
                      <input type="checkbox" checked={checked} disabled={bulkLoading}
                        onChange={() => toggleTaskSelection(task.id)} />Seleccionar</label></div>}
                    <div className="task-content"><span className="drag-handle">⠿</span><p>{task.title}</p></div>
                    <div className="task-details">
                      <span className={`priority-badge priority-${task.priority || "mitjana"}`}>{priorityLabel(task.priority)}</span>
                      {task.due_date && <span className={`task-date ${isOverdue(task) ? "date-overdue" : ""}`}>
                        📅 {formatDate(task.due_date)}</span>}
                    </div>
                    {task.assignee_name && <div className="tf-assignee">👤 {task.assignee_name}</div>}
                    {task.description && <p className="task-description">{task.description}</p>}
                    <div className="task-actions">
                      <button type="button" className="edit-task"
                        onClick={() => setSubtaskTask(task)} disabled={bulkLoading}>✅ Subtasques</button>
                      <button type="button" className="edit-task"
                        onClick={() => setCommentsTask(task)} disabled={bulkLoading}>💬 Comentaris</button>
                      <button type="button" className="edit-task"
                        onClick={() => setAttachmentsTask(task)} disabled={bulkLoading}>📎 Adjunts</button>
                      {canEdit && <>
                        <button type="button" className="edit-task"
                          onClick={() => openEditTask(task)} disabled={bulkLoading}>✏️ Editar</button>
                        <button type="button" className="delete-task" onClick={() => deleteTask(task.id)}
                          disabled={bulkLoading} title="Eliminar tasca">🗑️ Eliminar</button>
                      </>}
                    </div>
                  </article>;
                })}
                {!columnTasks.length && <p className="empty-column">No hi ha tasques visibles</p>}</div>
              </section>;
            })}</div>
          </>}
        </> : <div className="welcome"><h2>Benvingut a TaskFlow! 🚀</h2>
          <p>Crea un projecte o demana que et comparteixin un projecte existent.</p></div>}
      </main>

      {searchOpen && <GlobalSearch token={token} projects={projects} onSelectProject={selectProject} onClose={()=>setSearchOpen(false)}/>}
      {subtaskTask && <SubtaskPanel task={subtaskTask} tasks={projectTasks} members={members} token={token} canEdit={canEdit} onClose={()=>setSubtaskTask(null)} onTasksChanged={reloadTasks}/>}
      {attachmentsTask && <TaskAttachments
        task={attachmentsTask}
        token={token}
        currentUser={user}
        role={projects.find(p => p.id === attachmentsTask.project_id)?.role || "lector"}
        onClose={() => setAttachmentsTask(null)}
      />}

      {commentsTask && <TaskComments
        task={commentsTask}
        token={token}
        currentUser={user}
        role={projects.find(p => p.id === commentsTask.project_id)?.role || "lector"}
        onClose={() => setCommentsTask(null)}
      />}

      {/* CREAR O EDITAR TASCA */}
      {modalMode && <div className="modal-overlay" onMouseDown={e => {
        if (e.target === e.currentTarget && !saving) closeModal();
      }}><div className="modal" role="dialog" aria-modal="true" aria-labelledby="tf-modal-title">
        <div className="modal-header"><div><p className="eyebrow">TASKFLOW 3.0</p>
          <h2 id="tf-modal-title">{modalMode === "create" ? "Crear nova tasca" : "Editar tasca"}</h2></div>
          <button type="button" className="modal-close" aria-label="Tancar" disabled={saving} onClick={closeModal}>✕</button></div>
        {error && <div className="error" role="alert">{error}</div>}
        <form onSubmit={saveTask}>
          <div className="form-group"><label htmlFor="task-title">Títol *</label>
            <input id="task-title" autoFocus required maxLength={200} value={form.title}
              onChange={e => updateForm("title", e.target.value)} placeholder="Què s'ha de fer?" /></div>
          <div className="form-group"><label htmlFor="task-description">Descripció</label>
            <textarea id="task-description" rows={4} value={form.description}
              onChange={e => updateForm("description", e.target.value)} /></div>
          <div className="form-row">
            <div className="form-group"><label htmlFor="task-priority">Prioritat</label>
              <select id="task-priority" value={form.priority} onChange={e => updateForm("priority", e.target.value)}>
                <option value="baixa">🟢 Baixa</option><option value="mitjana">🟡 Mitjana</option>
                <option value="alta">🔴 Alta</option></select></div>
            <div className="form-group"><label htmlFor="task-date">Data límit</label>
              <input id="task-date" type="date" value={form.due_date}
                onChange={e => updateForm("due_date", e.target.value)} /></div>
          </div>
          <div className="form-row"><div className="form-group"><label htmlFor="task-start">Data inici</label>
            <input id="task-start" type="date" value={form.start_date} onChange={e=>updateForm("start_date",e.target.value)}/></div></div>
          <div className="form-row">
            <div className="form-group"><label htmlFor="task-status">Estat</label>
              <select id="task-status" value={form.status} onChange={e => updateForm("status", e.target.value)}>
                <option value="pendent">📋 Pendent</option><option value="progres">⚡ En progrés</option>
                <option value="completada">✅ Completada</option></select></div>
            <div className="form-group"><label htmlFor="task-assignee">Persona assignada</label>
              <select id="task-assignee" value={form.assignee_id}
                onChange={e => updateForm("assignee_id", e.target.value)}>
                <option value="">Sense assignar</option>
                {members.map(m => <option key={m.user_id} value={String(m.user_id)}>
                  {m.name} ({m.email})</option>)}
              </select></div>
          </div>
          <div className="modal-actions"><button type="button" className="cancel-button"
            disabled={saving} onClick={closeModal}>Cancel·lar</button>
            <button type="submit" className="save-button" disabled={saving}>
              {saving ? "Guardant..." : modalMode === "create" ? "+ Crear tasca" : "Guardar canvis"}</button></div>
        </form>
      </div></div>}

      {/* COMPARTIR PROJECTE */}
      {shareOpen && activeProject && <div className="modal-overlay" onMouseDown={e => {
        if (e.target === e.currentTarget && !shareLoading) setShareOpen(false);
      }}><div className="modal" role="dialog" aria-modal="true" aria-labelledby="tf-share-title">
        <div className="modal-header"><div><p className="eyebrow">PROJECTE COMPARTIT</p>
          <h2 id="tf-share-title">👥 Membres del projecte</h2></div>
          <button type="button" className="modal-close" aria-label="Tancar" disabled={shareLoading}
            onClick={() => { setShareOpen(false); setError(""); }}>✕</button></div>
        {error && <div className="error" role="alert">{error}</div>}
        {notice && <div className="tf-notice">{notice}</div>}
        <p className="tf-help">El propietari pot compartir el projecte amb un Editor o un Lector.
          Només es poden afegir usuaris registrats; no s'envien correus automàtics.</p>
        {activeProject.role === "owner" && <form className="tf-share-form" onSubmit={addMember}>
          <label htmlFor="tf-share-email">Correu de la persona</label>
          <input id="tf-share-email" type="email" required placeholder="persona@exemple.com"
            value={shareEmail} onChange={e => setShareEmail(e.target.value)} disabled={shareLoading} />
          <label htmlFor="tf-share-role">Permís inicial</label>
          <select id="tf-share-role" value={shareRole} disabled={shareLoading}
            onChange={e => setShareRole(e.target.value)}>
            <option value="editor">Editor — pot gestionar tasques</option>
            <option value="lector">Lector — només consulta</option>
          </select>
          <button type="submit" className="save-button" disabled={shareLoading}>+ Compartir projecte</button>
        </form>}
        <div className="tf-member-list">{members.map(m => <div className="tf-member" key={m.user_id}>
          <div><strong>{m.name}</strong><small>{m.email}</small></div>
          {activeProject.role === "owner" && m.role !== "owner" ? (
            <div className="tf-member-actions">
              <label htmlFor={`role-${m.user_id}`}>Rol</label>
              <select id={`role-${m.user_id}`} value={m.role} disabled={shareLoading}
                onChange={e => changeMemberRole(m.user_id, e.target.value)}>
                <option value="editor">Editor</option>
                <option value="lector">Lector</option>
              </select>
              <button type="button" disabled={shareLoading} onClick={() => removeMember(m.user_id, m.name)}>
                Revocar accés</button>
            </div>
          ) : <span className="tf-role">{m.role === "owner" ? "Propietari" : m.role === "lector" ? "Lector" : "Editor"}</span>}
        </div>)}</div>
      </div></div>}
    </div>
  );
}
