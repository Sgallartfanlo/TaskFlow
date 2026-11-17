import React, { useEffect, useState } from "react";
import "./task-comments.css";

const API = "http://localhost:8000";

function dateLabel(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString("ca-ES", { dateStyle: "short", timeStyle: "short" });
}

export default function TaskComments({ task, token, currentUser, role, onClose }) {
  const [comments, setComments] = useState([]);
  const [content, setContent] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [editText, setEditText] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const canWrite = role === "owner" || role === "editor";

  async function api(path, options = {}) {
    const response = await fetch(`${API}${path}`, {
      ...options,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...options.headers },
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(typeof data.detail === "string" ? data.detail : `Error HTTP ${response.status}`);
    }
    return response.json();
  }

  async function load() {
    const data = await api(`/tasks/${task.id}/comments`);
    setComments(data);
  }

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    api(`/tasks/${task.id}/comments`)
      .then(data => { if (!cancelled) setComments(data); })
      .catch(err => { if (!cancelled) setError(err.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [task.id, token]);

  async function addComment(e) {
    e.preventDefault();
    if (!canWrite || !content.trim() || saving) return;
    setSaving(true); setError("");
    try {
      await api(`/tasks/${task.id}/comments`, { method: "POST", body: JSON.stringify({ content: content.trim() }) });
      setContent("");
      await load();
    } catch (err) { setError(err.message); }
    finally { setSaving(false); }
  }

  async function saveEdit(commentId) {
    if (!canWrite || !editText.trim() || saving) return;
    setSaving(true); setError("");
    try {
      await api(`/tasks/${task.id}/comments/${commentId}`, {
        method: "PATCH", body: JSON.stringify({ content: editText.trim() }),
      });
      setEditingId(null); setEditText("");
      await load();
    } catch (err) { setError(err.message); }
    finally { setSaving(false); }
  }

  async function remove(commentId) {
    if (saving || !window.confirm("Vols eliminar aquest comentari?")) return;
    setSaving(true); setError("");
    try {
      await api(`/tasks/${task.id}/comments/${commentId}`, { method: "DELETE" });
      await load();
    } catch (err) { setError(err.message); }
    finally { setSaving(false); }
  }

  return <div className="modal-overlay tf-comments-overlay" onMouseDown={e => {
    if (e.target === e.currentTarget && !saving) onClose();
  }}>
    <div className="modal tf-comments-modal" role="dialog" aria-modal="true" aria-labelledby="tf-comments-heading">
      <div className="modal-header">
        <div><p className="eyebrow">TASKFLOW 2.9 · COL·LABORACIÓ</p>
          <h2 id="tf-comments-heading">💬 Comentaris</h2>
          <p className="tf-comments-task-title">{task.title}</p></div>
        <button type="button" className="modal-close" aria-label="Tancar" disabled={saving} onClick={onClose}>✕</button>
      </div>

      {error && <div className="error" role="alert">{error}</div>}
      <div className="tf-comments-list" aria-live="polite">
        {loading ? <p>Carregant comentaris...</p> : comments.length === 0 ?
          <p className="tf-comments-empty">Encara no hi ha comentaris en aquesta tasca.</p> :
          comments.map(comment => {
            const own = currentUser?.id === comment.user_id;
            const canDelete = canWrite && (own || role === "owner");
            return <article className="tf-comment" key={comment.id}>
              <div className="tf-comment-head"><strong>{comment.author_name}</strong>
                <time dateTime={comment.created_at}>{dateLabel(comment.created_at)}{comment.updated_at ? " · Editat" : ""}</time></div>
              {editingId === comment.id ? <div className="tf-comment-edit">
                <textarea rows={3} maxLength={5000} value={editText} onChange={e => setEditText(e.target.value)} />
                <div className="tf-comment-actions">
                  <button type="button" disabled={saving || !editText.trim()} onClick={() => saveEdit(comment.id)}>Guardar</button>
                  <button type="button" disabled={saving} onClick={() => setEditingId(null)}>Cancel·lar</button>
                </div>
              </div> : <p className="tf-comment-body">{comment.content}</p>}
              {editingId !== comment.id && (canWrite && own || canDelete) && <div className="tf-comment-actions">
                {canWrite && own && <button type="button" disabled={saving} onClick={() => {
                  setEditingId(comment.id); setEditText(comment.content);
                }}>✏️ Editar</button>}
                {canDelete && <button type="button" disabled={saving} onClick={() => remove(comment.id)}>🗑️ Eliminar</button>}
              </div>}
            </article>;
          })}
      </div>
      {canWrite ? <form className="tf-comment-form" onSubmit={addComment}>
        <label htmlFor="tf-new-comment">Nou comentari</label>
        <textarea id="tf-new-comment" rows={3} maxLength={5000} placeholder="Escriu un comentari..."
          value={content} onChange={e => setContent(e.target.value)} disabled={saving}/>
        <div className="tf-comment-form-footer"><small>{content.length}/5000</small>
          <button type="submit" className="save-button" disabled={saving || !content.trim()}>
            {saving ? "Publicant..." : "Publicar comentari"}</button></div>
      </form> : <p className="tf-comments-readonly">👁️ Rol Lector: pots llegir els comentaris, però no escriure'n.</p>}
    </div>
  </div>;
}
