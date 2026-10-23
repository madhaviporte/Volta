import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Bell,
  CheckCheck,
  Clock,
  AlertTriangle,
  Check,
  Layers,
  UserPlus,
  Repeat,
  PlayCircle,
  CheckCircle2,
  MessageSquare,
} from "lucide-react";
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
  task_assigned: "Task assigned",
  task_reassigned: "Task reassigned",
  task_status_changed: "Status changed",
  task_completed: "Task completed",
  task_commented: "New comment",
};

// One icon per notification type; deadline reminders keep the original
// clock / warning icons, task activity uses the same lucide set as the
// rest of the app.
const typeIcon = (type) => {
  const props = { size: 12, style: { display: "inline", marginRight: "4px" } };

  switch (type) {
    case "overdue":
      return <AlertTriangle {...props} />;
    case "task_assigned":
      return <UserPlus {...props} />;
    case "task_reassigned":
      return <Repeat {...props} />;
    case "task_status_changed":
      return <PlayCircle {...props} />;
    case "task_completed":
      return <CheckCircle2 {...props} />;
    case "task_commented":
      return <MessageSquare {...props} />;
    default:
      return <Clock {...props} />;
  }
};

// Notification bell + dropdown for the logged-in user (manager or
// employee; the backend only ever returns rows addressed to them).
// Uses the existing backend endpoints only:
//   GET  /api/notifications            (list + unreadCount)
//   PUT  /api/notifications/:id/read   (mark one as read)
//   PUT  /api/notifications/read-all   (mark all as read)
const NotificationBell = () => {
  const navigate = useNavigate();

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  // A task-related notification opens the task it refers to. Read state
  // stays explicit (the "Mark as read" button), matching the employee
  // notification conventions this component already follows.
  const openTask = (notification) => {
    if (notification.task && notification.task._id) {
      setOpen(false);
      navigate(`/tasks/${notification.task._id}`);
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
        <Bell size={18} />

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
                <CheckCheck size={14} style={{ display: "inline", marginRight: "4px", verticalAlign: "middle" }} />
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
                  className={`notif-item${notification.isRead ? " read" : " unread"}${
                    notification.task ? " clickable" : ""
                  }`}
                  onClick={() => openTask(notification)}
                  role={notification.task ? "button" : undefined}
                  tabIndex={notification.task ? 0 : undefined}
                  onKeyDown={(event) => {
                    if (notification.task && (event.key === "Enter" || event.key === " ")) {
                      event.preventDefault();
                      openTask(notification);
                    }
                  }}
                >
                  <div className="notif-item-top">
                    <span className={`notif-type ${notification.type}`}>
                      {typeIcon(notification.type)}
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
                      <Layers size={11} style={{ display: "inline", marginRight: "4px" }} />
                      {notification.task.title}
                      {notification.task.dueDate && (
                        <span> · due {formatDate(notification.task.dueDate)}</span>
                      )}
                    </p>
                  )}

                  {!notification.isRead && (
                    <button
                      type="button"
                      className="notif-link"
                      onClick={(event) => {
                        // The item itself opens the task; this button only
                        // marks the row as read.
                        event.stopPropagation();
                        markAsRead(notification._id);
                      }}
                      style={{ marginTop: "4px", display: "block" }}
                    >
                      <Check size={12} style={{ display: "inline", marginRight: "3px" }} />
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
