import React, { useEffect, useRef, useState } from "react";
import "./task-attachments.css";

const API = "http://localhost:8000";
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const ALLOWED = ["pdf", "png", "jpg", "jpeg", "webp", "txt", "docx", "xlsx"];

function niceSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
function niceDate(value) {
  if (!value) return "";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString("ca-ES", { dateStyle: "short", timeStyle: "short" });
}

export default function TaskAttachments({ task, token, currentUser, role, onClose }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const fileRef = useRef(null);
  const canWrite = role === "owner" || role === "editor";

  async function api(path, options = {}) {
    const response = await fetch(API + path, {
      ...options,
      headers: { Authorization: `Bearer ${token}`, ...(options.headers || {}) },
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(typeof data.detail === "string" ? data.detail : `Error HTTP ${response.status}`);
    }
    return response;
  }

  async function reload() {
    const response = await api(`/tasks/${task.id}/attachments`);
    setItems(await response.json());
  }

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    fetch(`${API}/tasks/${task.id}/attachments`, {
      headers: { Authorization: `Bearer ${token}` },
    }).then(async response => {
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(typeof data.detail === "string" ? data.detail : `Error HTTP ${response.status}`);
      }
      return response.json();
    }).then(data => { if (!cancelled) setItems(data); })
      .catch(err => { if (!cancelled) setError(err.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [task.id, token]);

  async function upload(e) {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!canWrite || !file || busy) return;
    setError(""); setSuccess("");
    const ext = file.name.split(".").pop()?.toLowerCase();
    if (!ALLOWED.includes(ext)) { setError("Format no admès. Formats: PDF, PNG, JPG, WEBP, TXT, DOCX i XLSX."); return; }
    if (file.size === 0 || file.size > MAX_FILE_BYTES) { setError("El fitxer ha de tenir una mida superior a 0 i fins a 10 MB."); return; }
    setBusy(true);
    try {
      const form = new FormData();
      form.append("file", file);
      await api(`/tasks/${task.id}/attachments`, { method: "POST", body: form });
      if (fileRef.current) fileRef.current.value = "";
      await reload();
      setSuccess("Fitxer adjuntat correctament.");
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  async function download(item) {
    if (busy) return;
    setBusy(true); setError(""); setSuccess("");
    try {
      const response = await api(`/tasks/${task.id}/attachments/${item.id}/download`);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = item.original_filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  async function remove(item) {
    if (!canWrite || busy || !window.confirm(`Eliminar l'adjunt «${item.original_filename}»?`)) return;
    setBusy(true); setError(""); setSuccess("");
    try {
      await api(`/tasks/${task.id}/attachments/${item.id}`, { method: "DELETE" });
      await reload();
      setSuccess("Adjunt eliminat.");
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  return <div className="modal-overlay tf-attachments-overlay" onMouseDown={e => {
    if (e.target === e.currentTarget && !busy) onClose();
  }}>
    <div className="modal tf-attachments-modal" role="dialog" aria-modal="true" aria-labelledby="tf-attachments-title">
      <div className="modal-header">
        <div><p className="eyebrow">TASKFLOW 2.9 · FITXERS</p>
          <h2 id="tf-attachments-title">📎 Fitxers adjunts</h2>
          <p className="tf-attachments-subtitle">{task.title}</p></div>
        <button type="button" className="modal-close" aria-label="Tancar" onClick={onClose} disabled={busy}>✕</button>
      </div>
      {error && <div className="error" role="alert">{error}</div>}
      {success && <div className="tf-notice" role="status">{success}</div>}
      <section className="tf-attachments-list" aria-label="Llista d'adjunts">
        {loading ? <p>Carregant fitxers...</p> : items.length === 0 ?
          <p className="tf-attachments-empty">Aquesta tasca encara no té fitxers adjunts.</p> :
          items.map(item => <article key={item.id} className="tf-attachment-item">
            <div className="tf-attachment-details">
              <strong title={item.original_filename}>📄 {item.original_filename}</strong>
              <small>{niceSize(item.file_size)} · {item.uploader_name} · {niceDate(item.created_at)}</small>
            </div>
            <div className="tf-attachment-actions">
              <button type="button" onClick={() => download(item)} disabled={busy}>⬇️ Descarregar</button>
              {canWrite && (role === "owner" || item.uploaded_by === currentUser?.id) &&
                <button type="button" className="tf-attachment-delete" onClick={() => remove(item)} disabled={busy}>🗑️ Eliminar</button>}
            </div>
          </article>)}
      </section>
      {canWrite ? <form className="tf-attachments-upload" onSubmit={upload}>
        <label htmlFor="tf-attachment-file">Adjuntar un fitxer (màxim 10 MB)</label>
        <input ref={fileRef} id="tf-attachment-file" type="file" required disabled={busy}
          accept=".pdf,.png,.jpg,.jpeg,.webp,.txt,.docx,.xlsx" />
        <button type="submit" className="save-button" disabled={busy}>{busy ? "Processant..." : "+ Pujar fitxer"}</button>
      </form> : <p className="tf-attachments-readonly">👁️ Rol Lector: pots consultar i descarregar adjunts, però no pujar-ne ni eliminar-ne.</p>}
    </div>
  </div>;
}
