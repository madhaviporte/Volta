import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  ArrowLeft,
  Clock,
  History,
  MessageSquare,
  Send,
  AlertCircle,
} from "lucide-react";
import api from "../services/api";
import Navbar from "../components/Navbar";
import { parseDescription } from "../utils/description";

const renderPriorityBadge = (priority) => {
  const p = (priority || "Medium").toLowerCase();
  return <span className={`badge badge-priority-${p}`}>{priority || "Medium"}</span>;
};

// Human-readable labels for every history action the backend records.
// Anything not listed here still renders (its raw action name), so an
// unknown event type can never crash the timeline.
const HISTORY_LABELS = {
  TASK_CREATED: "Task created",
  ASSIGNED: "Assigned",
  REASSIGNED: "Reassigned",
  UNASSIGNED: "Unassigned",
  UPDATED: "Task updated",
  STATUS_CHANGED: "Status changed",
  DELETED: "Task deleted",
};

const historyLabel = (action) => {
  if (typeof action === "string" && Object.prototype.hasOwnProperty.call(HISTORY_LABELS, action)) {
    return HISTORY_LABELS[action];
  }

  return typeof action === "string" && action ? action : "Activity";
};

const isRecord = (value) => value !== null && typeof value === "object";

const formatDateValue = (value) => {
  if (value === null || value === undefined || value === "") return "-";

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString();
};

// Builds the detail shown after the actor's name, using only the values
// the backend stored on that entry. Nothing is invented for old or unknown
// events, and object payloads are summarised instead of printing
// "[object Object]".
const historyDetail = (entry) => {
  const action = entry ? entry.action : undefined;
  const oldValue = entry ? entry.oldValue : undefined;
  const newValue = entry ? entry.newValue : undefined;

  if (action === "STATUS_CHANGED") {
    // On a shared task the entry names the person it belongs to
    const who =
      isRecord(entry) && isRecord(entry.assignee) && entry.assignee.name
        ? ` (${entry.assignee.name})`
        : "";
    return ` (${oldValue || "-"} → ${newValue || "-"})${who}`;
  }

  if (action === "REASSIGNED") {
    return ` (${oldValue || "none"} → ${newValue || "-"})`;
  }

  if (action === "ASSIGNED") {
    return newValue ? ` to ${newValue}` : "";
  }

  if (action === "UNASSIGNED") {
    return oldValue ? ` ${oldValue}` : "";
  }

  if (action === "TASK_CREATED") {
    if (!isRecord(newValue)) return "";

    const parts = [];
    if (newValue.title) parts.push(`"${newValue.title}"`);
    if (newValue.assignedTo) parts.push(`assigned to ${newValue.assignedTo}`);
    if (newValue.priority) parts.push(`priority ${newValue.priority}`);
    if (newValue.status) parts.push(`status ${newValue.status}`);
    if (newValue.dueDate) parts.push(`due ${formatDateValue(newValue.dueDate)}`);
    return parts.length ? ` (${parts.join(", ")})` : "";
  }

  if (action === "UPDATED") {
    const before = isRecord(oldValue) ? oldValue : {};
    const after = isRecord(newValue) ? newValue : {};
    const parts = [];

    // Only the fields the backend actually records are compared, so the
    // line lists exactly what changed and nothing else.
    if (before.title !== after.title && (before.title || after.title)) {
      parts.push(`title: "${before.title || "-"}" → "${after.title || "-"}"`);
    }
    if (before.priority !== after.priority && (before.priority || after.priority)) {
      parts.push(`priority: ${before.priority || "-"} → ${after.priority || "-"}`);
    }
    if (before.dueDate !== after.dueDate) {
      parts.push(`due date: ${formatDateValue(before.dueDate)} → ${formatDateValue(after.dueDate)}`);
    }
    if (before.description !== after.description) {
      parts.push("description updated");
    }

    return parts.length ? ` (${parts.join(", ")})` : "";
  }

  if (action === "DELETED") {
    // Legacy rows store the removed task's title on oldValue
    if (isRecord(oldValue) && oldValue.title) return ` ("${oldValue.title}")`;
    return "";
  }

  // Unknown action: show scalar values only — never "[object Object]"
  const parts = [];
  if (oldValue !== null && oldValue !== undefined && !isRecord(oldValue)) {
    parts.push(`from ${oldValue}`);
  }
  if (newValue !== null && newValue !== undefined && !isRecord(newValue)) {
    parts.push(`to ${newValue}`);
  }
  return parts.length ? ` (${parts.join(", ")})` : "";
};

const TaskDetails = () => {
  const { taskId } = useParams();

  const user = JSON.parse(localStorage.getItem("user") || "null");

  const [task, setTask] = useState(null);
  const [comments, setComments] = useState([]);
  const [history, setHistory] = useState([]);
  const [commentMessage, setCommentMessage] = useState("");
  const [message, setMessage] = useState("");

  // In-flight guards so repeated clicks can't fire duplicate requests
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [postingComment, setPostingComment] = useState(false);

  const loadTask = useCallback(() => {
    return api
      .get(`/tasks/${taskId}`)
      .then((response) => {
        setTask(response.data.data);
      })
      .catch((error) => {
        setMessage(error.response?.data?.message || "Could not load task");
      });
  }, [taskId]);

  const loadComments = useCallback(() => {
    return api
      .get(`/tasks/${taskId}/comments`)
      .then((response) => {
        setComments(response.data.data);
      })
      .catch(() => {
        setMessage("Could not load comments");
      });
  }, [taskId]);

  // Loads the recorded actions for this task
  // (creation, assignment, reassignment, status changes, edits)
  const loadHistory = useCallback(() => {
    return api
      .get(`/tasks/${taskId}/history`)
      .then((response) => {
        setHistory(response.data.data);
      })
      .catch(() => {
        setMessage("Could not load history");
      });
  }, [taskId]);

  // The loaders are memoized, so this runs once per task id
  // and never re-fires on unrelated re-renders.
  useEffect(() => {
    loadTask();
    loadComments();
    loadHistory();
  }, [loadTask, loadComments, loadHistory]);

  const handleStatusChange = async (e) => {
    const newStatus = e.target.value;

    if (updatingStatus) return;

    // A new attempt starts with a clean slate: an error from an earlier
    // failed attempt must not stay visible while (or after) this one runs.
    setMessage("");
    setUpdatingStatus(true);

    try {
      await api.put(`/tasks/${taskId}/status`, { status: newStatus });
      loadTask();
      // The backend records a STATUS_CHANGED history entry for this update,
      // so re-fetch the history too — otherwise the new entry only shows
      // up after a manual page reload.
      loadHistory();
    } catch (error) {
      setMessage(error.response?.data?.message || "Could not update status");
    } finally {
      // Success or failure, the select is usable again
      setUpdatingStatus(false);
    }
  };

  const handleAddComment = async (e) => {
    e.preventDefault();

    if (postingComment) return;

    // Clear any stale error before retrying the action
    setMessage("");
    setPostingComment(true);

    try {
      await api.post(`/tasks/${taskId}/comments`, { message: commentMessage });

      setCommentMessage("");
      loadComments();
    } catch (error) {
      setMessage(error.response?.data?.message || "Could not add comment");
    } finally {
      setPostingComment(false);
    }
  };

  if (!task) {
    return (
      <div className="app-layout">
        <Navbar />
        <main className="main-content">
          <div className="empty-state">
            <p>{message || "Loading task details..."}</p>
          </div>
        </main>
      </div>
    );
  }

  const backLink =
    user && user.role === "manager" ? "/manager/tasks" : "/employee/dashboard";
  const backText =
    user && user.role === "manager" ? "Back to Tasks" : "Back to My Tasks";

  // Every assignee of this task with their own status, as returned by the
  // backend. Legacy tasks carry only the primary assignee, which the
  // fallback below keeps working (the same value as before).
  const assigneeRows = (task.progress || [])
    .map((entry) => ({
      id: entry.user?._id || entry.user,
      name: entry.user?.name || "Unknown",
      status: entry.status,
    }))
    .filter((entry) => entry.id);

  const assigneeNames =
    (task.assignees || []).map((person) => person.name).filter(Boolean).join(", ") ||
    (task.assignedTo ? task.assignedTo.name : "");

  // Paragraphs and lists stored in the description (see
  // utils/description.js). Old plain-text descriptions parse into a
  // single paragraph, so they render exactly as they always have.
  const descriptionBlocks = parseDescription(task.description);

  return (
    <div className="app-layout">
      <Navbar />

      <main className="main-content">
        <div style={{ marginBottom: "20px" }}>
          <Link to={backLink} className="btn btn-secondary btn-sm">
            <ArrowLeft size={14} />
            <span>{backText}</span>
          </Link>
        </div>

        {message && (
          <div className="alert-banner error">
            <AlertCircle size={16} />
            <span>{message}</span>
          </div>
        )}

        <div className="task-detail-grid">
          {/* Main Task Info & History */}
          <div>
            <div className="card-section">
              <div className="card-header" style={{ alignItems: "flex-start" }}>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "8px" }}>
                    {renderPriorityBadge(task.priority)}
                    {task.isOverdue && (
                      <span className="badge badge-overdue">Overdue</span>
                    )}
                  </div>
                  <h1 style={{ fontSize: "22px", fontWeight: 700, color: "var(--text-main)" }}>
                    {task.title}
                  </h1>
                </div>

                <div className="form-group" style={{ margin: 0, minWidth: "160px" }}>
                  <label style={{ fontSize: "11px", textTransform: "uppercase", color: "var(--text-muted)" }}>
                    Update Status
                  </label>
                  <select
                    className="form-control"
                    // On a shared task this is the viewer's OWN status
                    // (each assignee updates their own share)
                    value={task.myStatus || task.status}
                    onChange={handleStatusChange}
                    disabled={updatingStatus}
                    style={{ fontWeight: 600 }}
                  >
                    <option>Pending</option>
                    <option>In Progress</option>
                    <option>Completed</option>
                    <option>On Hold</option>
                  </select>
                </div>
              </div>

              {/* Description: paragraphs and lists come straight from
                  the plain-text markers (utils/description.js). An empty
                  description keeps the same message it always had. */}
              <div className="task-description">
                <strong className="task-description-label">Description:</strong>

                <div className="description-body">
                  {descriptionBlocks.length === 0 ? (
                    <p className="description-empty">No description provided.</p>
                  ) : (
                    descriptionBlocks.map((block, blockIndex) => {
                      if (block.type === "p") {
                        return (
                          <p key={blockIndex}>{block.items.join("\n")}</p>
                        );
                      }

                      const ListTag = block.type === "ul" ? "ul" : "ol";

                      return (
                        <ListTag key={blockIndex}>
                          {block.items.map((item, itemIndex) => (
                            <li key={itemIndex}>{item}</li>
                          ))}
                        </ListTag>
                      );
                    })
                  )}
                </div>
              </div>

              <div className="meta-list">
                <div className="meta-item">
                  <span className="meta-label">Assigned To</span>
                  <span className="meta-value">
                    {assigneeNames || "Unassigned"}
                  </span>
                </div>

                <div className="meta-item">
                  <span className="meta-label">Created By</span>
                  <span className="meta-value">{task.createdBy?.name || "System"}</span>
                </div>

                <div className="meta-item">
                  <span className="meta-label">Due Date</span>
                  <span className="meta-value">
                    {task.dueDate ? task.dueDate.slice(0, 10) : "-"}
                  </span>
                </div>

                {task.completedAt && (
                  <div className="meta-item">
                    <span className="meta-label">Completed On</span>
                    <span className="meta-value">
                      {task.completedAt.slice(0, 10)}
                    </span>
                  </div>
                )}
              </div>

              {/* One row per assignee, shown only for a shared task so a
                  single-assignee task looks exactly as it always did. Each
                  person's own status comes straight from the backend. */}
              {assigneeRows.length > 1 && (
                <div className="assignee-progress">
                  <span className="assignee-progress-label">Assignee progress</span>
                  {assigneeRows.map((entry) => {
                    const entryStatus = entry.status || "Pending";
                    const badgeClass = entryStatus.toLowerCase().replace(/\s+/g, "-");

                    return (
                      <div className="assignee-progress-row" key={entry.id}>
                        <span className="assignee-progress-name">{entry.name}</span>
                        <span className={`badge badge-status-${badgeClass}`}>
                          {entryStatus}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Task History Timeline */}
            <div className="card-section">
              <div className="card-header">
                <div className="card-title-group">
                  <History size={18} className="text-muted" />
                  <h2>Activity Audit History</h2>
                </div>
              </div>

              {history.length === 0 ? (
                <div className="empty-state">No history recorded for this task</div>
              ) : (
                <div className="timeline">
                  {history.map((entry) => (
                    <div className="timeline-entry" key={entry._id}>
                      <div className="timeline-icon">
                        <Clock size={12} />
                      </div>
                      <div className="timeline-content">
                        <span className="timeline-time">
                          {new Date(entry.createdAt).toLocaleString()}
                        </span>
                        <div className="timeline-text">
                          <strong>{historyLabel(entry.action)}</strong> by{" "}
                          <span>{entry.performedBy?.name || "User"}</span>
                          <span style={{ color: "var(--text-muted)" }}>
                            {historyDetail(entry)}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Comments Section */}
          <div>
            <div className="card-section">
              <div className="card-header">
                <div className="card-title-group">
                  <MessageSquare size={18} className="text-muted" />
                  <h2>Comments ({comments.length})</h2>
                </div>
              </div>

              <div className="comments-feed">
                {comments.length === 0 ? (
                  <div className="empty-state" style={{ padding: "16px 0" }}>
                    No comments yet. Start the conversation!
                  </div>
                ) : (
                  comments.map((comment) => (
                    <div className="comment-bubble" key={comment._id}>
                      <div className="comment-author">
                        {comment.user?.name || "User"}
                      </div>
                      <div className="comment-text">{comment.message}</div>
                    </div>
                  ))
                )}
              </div>

              <form onSubmit={handleAddComment}>
                <div className="form-group">
                  <label>Add a comment</label>
                  <textarea
                    name="message"
                    className="form-control"
                    rows="3"
                    placeholder="Type your comment or update..."
                    value={commentMessage}
                    onChange={(e) => setCommentMessage(e.target.value)}
                    required
                  ></textarea>
                </div>
                <button
                  type="submit"
                  className="btn btn-primary"
                  style={{ width: "100%" }}
                  disabled={postingComment}
                >
                  <Send size={14} />
                  <span>{postingComment ? "Posting..." : "Post Comment"}</span>
                </button>
              </form>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};

export default TaskDetails;
