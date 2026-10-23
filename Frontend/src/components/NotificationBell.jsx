import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Bell,
  CheckCheck,
  Clock,
  AlertTriangle,
  Layers,
  UserPlus,
  Repeat,
  PlayCircle,
  CheckCircle2,
  MessageSquare,
  CalendarDays,
  Edit,
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
  meeting_created: "Meeting scheduled",
  meeting_updated: "Meeting updated",
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
    case "meeting_created":
      return <CalendarDays {...props} />;
    case "meeting_updated":
      return <Edit {...props} />;
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

  // Ids whose read-request is still in flight, so a double click can
  // never send the same mark-as-read twice (and decrement twice).
  const openingRef = useRef(new Set());

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

  // Opening a notification marks it as read in the backend FIRST. The
  // row only updates locally once that request succeeds, so a failed
  // request never claims the notification was read. The list renders
  // unread rows only, so a successfully opened notification disappears
  // from the dropdown immediately, the badge decrements at the same
  // moment, and the read state persists server-side across refreshes.
  const openNotification = async (notification) => {
    // A request for this row is already running -> ignore the repeat click
    if (openingRef.current.has(notification._id)) {
      return;
    }
    openingRef.current.add(notification._id);

    try {
      await api.put(`/notifications/${notification._id}/read`);
    } catch {
      // Backend rejected/failed: keep the row visible and unread so the
      // user can simply try again.
      setError("Could not mark notification as read");
      return;
    } finally {
      openingRef.current.delete(notification._id);
    }

    // Accepted -> reflect it right away (no page refresh needed)
    setNotifications((prev) =>
      prev.map((n) => (n._id === notification._id ? { ...n, isRead: true } : n))
    );
    if (!notification.isRead) {
      setUnreadCount((prev) => Math.max(0, prev - 1));
    }

    setError("");
    setOpen(false);

    // Same navigation as before: task rows open their task, meeting rows
    // open the Meeting Updates page.
    if (notification.task && notification.task._id) {
      navigate(`/tasks/${notification.task._id}`);
    } else if (
      notification.type === "meeting_created" ||
      notification.type === "meeting_updated"
    ) {
      navigate("/meetings");
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


  // Only unread rows belong in the dropdown: opening one marks it read
  // (backend first) and it drops out of this list immediately, for both
  // Manager and Employee accounts.
  const visible = notifications.filter((notification) => !notification.isRead);

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

            {!loading && !error && visible.length === 0 && (
              <p className="notif-state">No notifications</p>
            )}

            {!loading &&
              !error &&
              visible.map((notification) => (
                <div
                  key={notification._id}
                  className="notif-item unread clickable"
                  onClick={() => openNotification(notification)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      openNotification(notification);
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

                  <p className="notif-message">{notification.message}</p>                    {notification.task && (
                      <p className="notif-task">
                        <Layers size={11} style={{ display: "inline", marginRight: "4px" }} />
                        {notification.task.title}
                        {notification.task.dueDate && (
                          <span> · due {formatDate(notification.task.dueDate)}</span>
                        )}
                      </p>
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
