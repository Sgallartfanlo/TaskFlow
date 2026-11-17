import React, { useCallback, useEffect, useState } from "react";
import "./project-stats.css";

const API = "http://localhost:8000";
const STATUS = [
  ["pendent", "Pendents", "#f59e0b"],
  ["progres", "En progrés", "#6366f1"],
  ["completada", "Completades", "#16a34a"],
];
const PRIORITY = [
  ["alta", "Alta", "#dc2626"],
  ["mitjana", "Mitjana", "#f59e0b"],
  ["baixa", "Baixa", "#16a34a"],
];
const DUE = [
  ["overdue", "Vençudes", "#dc2626"],
  ["due_today", "Vencen avui", "#d97706"],
  ["next_7_days", "Pròxims 7 dies", "#6366f1"],
  ["future", "Més endavant", "#0284c7"],
  ["no_due_date", "Sense data límit", "#64748b"],
  ["completed", "Completades", "#16a34a"],
];
function formatMonth(value) {
  const [year, month] = String(value).split("-");
  if (!year || !month) return value;
  return `${month}/${year}`;
}
function Bars({ items, total }) {
  const denominator = Math.max(total || 0, 1);
  return <div className="tf-stats-bars">
    {items.map(([key, label, color, count]) => (
      <div className="tf-stats-bar-row" key={key}>
        <div className="tf-stats-bar-label"><span>{label}</span><strong>{count || 0}</strong></div>
        <div className="tf-stats-bar-track" role="progressbar" aria-label={label}
          aria-valuenow={count || 0} aria-valuemin={0} aria-valuemax={Math.max(total || 0, 1)}>
          <div className="tf-stats-bar-fill" style={{ width: `${Math.min((count || 0) / denominator * 100, 100)}%`, background: color }} />
        </div>
      </div>
    ))}
  </div>;
}
export default function ProjectStats({ projectId, token }) {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const reload = useCallback(() => setRefresh(v => v + 1), []);

  useEffect(() => {
    if (projectId == null || !token) { setStats(null); setLoading(false); return; }
    const controller = new AbortController();
    setLoading(true); setError(""); setStats(null);
    fetch(`${API}/projects/${projectId}/stats`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    }).then(async response => {
      if (!response.ok) {
        let message = `Error HTTP ${response.status}`;
        try { const body = await response.json(); if (typeof body.detail === "string") message = body.detail; }
        catch { /* Resposta sense JSON */ }
        throw new Error(message);
      }
      return response.json();
    }).then(data => { if (!controller.signal.aborted) setStats(data); })
      .catch(err => { if (!controller.signal.aborted) setError(err.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [projectId, token, refresh]);

  return <section className="tf-stats-view" aria-label="Estadístiques del projecte">
    <div className="tf-stats-heading">
      <div><h2>📊 Estadístiques avançades</h2><p>Radiografia de les tasques del projecte seleccionat</p></div>
      <button type="button" onClick={reload} disabled={loading}>↻ Actualitzar</button>
    </div>
    {loading && <p className="tf-stats-message" role="status">Carregant les estadístiques...</p>}
    {error && <div className="error" role="alert">No s'han pogut carregar les estadístiques: {error}</div>}
    {!loading && !error && stats && <>
      <div className="tf-stats-kpis">
        <div className="tf-stats-kpi"><span>Total tasques</span><strong>{stats.summary?.total ?? 0}</strong></div>
        <div className="tf-stats-kpi"><span>Completades</span><strong>{stats.summary?.completed ?? 0}</strong></div>
        <div className="tf-stats-kpi"><span>Percentatge completat</span><strong>{stats.summary?.completion_percentage ?? 0}%</strong></div>
        <div className="tf-stats-kpi"><span>Tasques vençudes</span><strong>{stats.due_dates?.overdue ?? 0}</strong></div>
      </div>
      <div className="tf-stats-grid">
        <div className="tf-stats-panel"><h3>Estats de les tasques</h3>
          <Bars total={stats.summary?.total} items={STATUS.map(([k,l,c]) => [k,l,c,stats.by_status?.[k] || 0])} />
        </div>
        <div className="tf-stats-panel"><h3>Distribució per prioritat</h3>
          <Bars total={stats.summary?.total} items={PRIORITY.map(([k,l,c]) => [k,l,c,stats.by_priority?.[k] || 0])} />
        </div>
        <div className="tf-stats-panel"><h3>Situació dels venciments</h3>
          <Bars total={stats.summary?.total} items={DUE.map(([k,l,c]) => [k,l,c,stats.due_dates?.[k] || 0])} />
          <p className="tf-stats-muted">Les tasques completades es comptabilitzen per separat, encara que tinguin data límit.</p>
        </div>
        <div className="tf-stats-panel"><h3>Tasques per responsable</h3>
          {stats.by_assignee?.length ? <div className="tf-stats-table-wrap"><table className="tf-stats-table">
            <thead><tr><th>Persona</th><th>Total</th><th>Pendents</th><th>En progrés</th><th>Fetes</th></tr></thead>
            <tbody>{stats.by_assignee.map((p, i) => <tr key={p.user_id ?? `none-${i}`}>
              <td>{p.name}</td><td>{p.total}</td><td>{p.pendent}</td><td>{p.progres}</td><td>{p.completada}</td>
            </tr>)}</tbody>
          </table></div> : <p className="tf-stats-muted">Encara no hi ha membres amb tasques assignades.</p>}
          <p className="tf-stats-muted">Mostra les tasques actualment assignades, no una classificació històrica de rendiment.</p>
        </div>
        <div className="tf-stats-panel tf-stats-panel-wide"><h3>Dates límit per mes</h3>
          {stats.due_by_month?.length ? <Bars total={Math.max(...stats.due_by_month.map(row => row.total), 1)}
            items={stats.due_by_month.map(row => [row.month, formatMonth(row.month), "#0ea5e9", row.total])} />
            : <p className="tf-stats-muted">No hi ha tasques amb data límit.</p>}
          <p className="tf-stats-muted">Les barres representen el nombre de tasques amb venciment cada mes, no quan es van completar.</p>
        </div>
      </div>
      <p className="tf-stats-footer">Dades a data {stats.as_of?.split("-").reverse().join("/") || "—"}. {stats.note}</p>
    </>}
  </section>;
}
