import { useCallback, useEffect, useRef, useState } from "react";
import api from "../services/api";

// Formats an ISO date string as DD/MM/YYYY (what the dashboards already use).
const formatDate = (value) => {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toLocaleDateString("en-GB"); // 23/09/2026
};

// Small relative label for the "created" time, e.g. "5m ago".
// Falls back to the absolute date for anything older than a week.
const formatCreatedTime = (value) => {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  const diffMinutes = Math.floor((Date.now() - date.getTime()) / 60000);

  if (diffMinutes < 1) return "just now";
  if (diffMinutes < 60) return `${diffMinutes}m ago`;

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;

  return formatDate(value);
};

const TYPE_LABELS = {
  deadline_soon: "Deadline approaching",
  overdue: "Overdue",
};

// Notification bell + dropdown for the logged-in employee.
// Uses the existing backend endpoints only:
//   GET  /api/notifications            (list + unreadCount)
//   PUT  /api/notifications/:id/read   (mark one as read)
//   PUT  /api/notifications/read-all   (mark all as read)
const NotificationBell = () => {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);

  const containerRef = useRef(null);

  // Fetches the real notifications of the logged-in user.
  // All state updates happen inside promise callbacks (never
  // synchronously), so this is safe to call from the mount
  // effect as well as the open click.
  const loadNotifications = useCallback(() => {
    return api
      .get("/notifications")
      .then((response) => {
        setNotifications(response.data.data || []);
        setUnreadCount(response.data.unreadCount || 0);
        setError("");
      })
      .catch(() => {
        // Never crash the dashboard: just show the error state.
        setError("Unable to load notifications");
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  // Load once when the bell is shown so the unread badge is current.
  useEffect(() => {
    loadNotifications();
  }, [loadNotifications]);

  // Close the panel on outside click (mousedown, so the toggling
  // button still works) or Escape.
  useEffect(() => {
    if (!open) {
      return undefined;
    }

    const handleClickOutside = (event) => {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        setOpen(false);
      }
    };

    const handleEscape = (event) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [open]);

  const markAsRead = async (notificationId) => {
    try {
      await api.put(`/notifications/${notificationId}/read`);

      // Update the UI immediately from the data we already have.
      setNotifications((prev) =>
        prev.map((n) => (n._id === notificationId ? { ...n, isRead: true } : n))
      );
      setUnreadCount((prev) => Math.max(0, prev - 1));
    } catch {
      setError("Could not mark notification as read");
    }
  };

  const markAllAsRead = async () => {
    try {
      await api.put("/notifications/read-all");

      setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
      setUnreadCount(0);
    } catch {
      setError("Could not mark notifications as read");
    }
  };

  return (
    <div className="notif-root" ref={containerRef}>
      <button
        type="button"
        className="notif-bell"
        onClick={() => {
          const next = !open;
          setOpen(next);

          if (next) {
            // Refresh every time the dropdown opens so it stays current.
            setLoading(true);
            loadNotifications();
          }
        }}
        aria-label={`Notifications (${unreadCount} unread)`}
      >
        <span aria-hidden="true">🔔</span>

        {unreadCount > 0 && (
          <span className="notif-badge">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="notif-panel" role="dialog" aria-label="Notifications">
          <div className="notif-panel-header">
            <strong>Notifications</strong>

            {unreadCount > 0 && (
              <button type="button" className="notif-link" onClick={markAllAsRead}>
                Mark all as read
              </button>
            )}
          </div>

          <div className="notif-list">
            {loading && <p className="notif-state">Loading notifications...</p>}

            {!loading && error && <p className="notif-state notif-error">{error}</p>}

            {!loading && !error && notifications.length === 0 && (
              <p className="notif-state">No notifications</p>
            )}

            {!loading &&
              !error &&
              notifications.map((notification) => (
                <div
                  key={notification._id}
                  className={`notif-item${notification.isRead ? " read" : " unread"}`}
                >
                  <div className="notif-item-top">
                    <span className={`notif-type ${notification.type}`}>
                      {TYPE_LABELS[notification.type] || notification.type}
                    </span>
                    <span className="notif-time">
                      {notification.createdAt
                        ? formatCreatedTime(notification.createdAt)
                        : ""}
                    </span>
                  </div>

                  <p className="notif-message">{notification.message}</p>

                  {notification.task && (
                    <p className="notif-task">
                      Task: {notification.task.title}
                      {notification.task.dueDate && (
                        <span> · due {formatDate(notification.task.dueDate)}</span>
                      )}
                    </p>
                  )}

                  {!notification.isRead && (
                    <button
                      type="button"
                      className="notif-link"
                      onClick={() => markAsRead(notification._id)}
                    >
                      Mark as read
                    </button>
                  )}
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default NotificationBell;
