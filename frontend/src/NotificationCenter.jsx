import React, { useCallback, useEffect, useRef, useState } from "react";
import "./notifications.css";

const API = "http://localhost:8000";

function relativeDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("ca-ES", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit"
  });
}

function notificationIcon(type) {
  return ({
    projecte_compartit: "👥",
    projecte: "👥",
    tasca_assignada: "👤",
    assignacio: "👤",
    canvi_estat: "🔄",
    venciment: "📅",
    data_limit: "📅"
  })[type] || "🔔";
}

export default function NotificationCenter({ token }) {
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const rootRef = useRef(null);

  const api = useCallback(async (path, options = {}) => {
    const response = await fetch(`${API}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        ...(options.headers || {})
      }
    });
    if (!response.ok) {
      let detail = `Error HTTP ${response.status}`;
      try {
        const payload = await response.json();
        if (typeof payload.detail === "string") detail = payload.detail;
      } catch { /* La resposta no és JSON. */ }
      throw new Error(detail);
    }
    return response.json();
  }, [token]);

  const loadCount = useCallback(async () => {
    const data = await api("/notifications/unread-count");
    setUnread(data.unread ?? 0);
  }, [api]);

  const loadNotifications = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [items, count] = await Promise.all([
        api("/notifications?limit=50"),
        api("/notifications/unread-count")
      ]);
      setNotifications(items);
      setUnread(count.unread ?? 0);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [api]);

  // Comprova les notificacions cada minut mentre l'usuari està connectat.
  useEffect(() => {
    if (!token) return;
    loadCount().catch(() => {});
    const interval = setInterval(() => {
      loadCount().catch(() => {});
    }, 60000);
    return () => clearInterval(interval);
  }, [token, loadCount]);

  useEffect(() => {
    if (!open) return;
    loadNotifications();
  }, [open, loadNotifications]);

  // Tanca el panell fent clic fora o prement Esc.
  useEffect(() => {
    if (!open) return;
    function handleClick(event) {
      if (rootRef.current && !rootRef.current.contains(event.target)) {
        setOpen(false);
      }
    }
    function handleKey(event) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  async function markRead(id) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await api(`/notifications/${id}/read`, { method: "PATCH" });
      await loadNotifications();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function markAllRead() {
    if (busy || unread === 0) return;
    setBusy(true);
    setError("");
    try {
      await api("/notifications/read-all", { method: "PATCH" });
      await loadNotifications();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="tf-notification-root" ref={rootRef}>
      <button
        type="button"
        className="tf-bell-button"
        aria-label={`Notificacions: ${unread} sense llegir`}
        aria-expanded={open}
        aria-controls="tf-notification-panel"
        onClick={() => setOpen(current => !current)}
      >
        <span aria-hidden="true">🔔</span>
        {unread > 0 && <span className="tf-bell-count">{unread > 99 ? "99+" : unread}</span>}
      </button>

      {open && (
        <section id="tf-notification-panel" className="tf-notification-panel" aria-label="Notificacions">
          <div className="tf-notification-header">
            <div>
              <h2>Notificacions</h2>
              <p>{unread} sense llegir</p>
            </div>
            <button type="button" className="tf-notification-close"
              aria-label="Tancar notificacions" onClick={() => setOpen(false)}>✕</button>
          </div>

          <div className="tf-notification-tools">
            <button type="button" onClick={loadNotifications} disabled={loading || busy}>↻ Actualitzar</button>
            <button type="button" onClick={markAllRead} disabled={loading || busy || unread === 0}>
              ✓ Marcar totes com a llegides
            </button>
          </div>

          {error && <div className="tf-notification-error" role="alert">{error}</div>}
          {loading && <p className="tf-notification-empty">Carregant notificacions...</p>}
          {!loading && notifications.length === 0 && (
            <p className="tf-notification-empty">Encara no tens notificacions.</p>
          )}
          {!loading && notifications.length > 0 && (
            <div className="tf-notification-list">
              {notifications.map(item => (
                <article key={item.id}
                  className={`tf-notification-item ${item.is_read ? "tf-notification-read" : "tf-notification-unread"}`}>
                  <span className="tf-notification-icon" aria-hidden="true">{notificationIcon(item.type)}</span>
                  <div className="tf-notification-content">
                    <strong>{item.title}</strong>
                    <p>{item.message}</p>
                    <small>{relativeDate(item.created_at)}</small>
                  </div>
                  {!item.is_read && (
                    <button type="button" className="tf-notification-mark"
                      onClick={() => markRead(item.id)} disabled={busy}
                      title="Marcar com a llegida" aria-label={`Marcar com a llegida: ${item.title}`}>
                      ✓
                    </button>
                  )}
                </article>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
