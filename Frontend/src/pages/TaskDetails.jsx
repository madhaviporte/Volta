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

const renderPriorityBadge = (priority) => {
  const p = (priority || "Medium").toLowerCase();
  return <span className={`badge badge-priority-${p}`}>{priority || "Medium"}</span>;
};

const TaskDetails = () => {
  const { taskId } = useParams();

  const user = JSON.parse(localStorage.getItem("user") || "null");

  const [task, setTask] = useState(null);
  const [comments, setComments] = useState([]);
  const [history, setHistory] = useState([]);
  const [commentMessage, setCommentMessage] = useState("");
  const [message, setMessage] = useState("");

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
    try {
      await api.put(`/tasks/${taskId}/status`, { status: e.target.value });
      loadTask();
    } catch (error) {
      setMessage(error.response?.data?.message || "Could not update status");
    }
  };

  const handleAddComment = async (e) => {
    e.preventDefault();

    try {
      await api.post(`/tasks/${taskId}/comments`, { message: commentMessage });

      setCommentMessage("");
      loadComments();
    } catch (error) {
      setMessage(error.response?.data?.message || "Could not add comment");
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
                    value={task.status}
                    onChange={handleStatusChange}
                    style={{ fontWeight: 600 }}
                  >
                    <option>Pending</option>
                    <option>In Progress</option>
                    <option>Completed</option>
                    <option>On Hold</option>
                  </select>
                </div>
              </div>

              <div style={{ margin: "16px 0", color: "var(--text-main)", fontSize: "14px" }}>
                <strong>Description:</strong>
                <p style={{ marginTop: "4px", color: "var(--text-muted)", whiteSpace: "pre-line" }}>
                  {task.description || "No description provided."}
                </p>
              </div>

              <div className="meta-list">
                <div className="meta-item">
                  <span className="meta-label">Assigned To</span>
                  <span className="meta-value">{task.assignedTo?.name || "Unassigned"}</span>
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
                          <strong>{entry.action}</strong> by{" "}
                          <span>{entry.performedBy?.name || "User"}</span>
                          {entry.action === "STATUS_CHANGED" && (
                            <span style={{ color: "var(--text-muted)" }}>
                              {" "}
                              ({entry.oldValue} → {entry.newValue})
                            </span>
                          )}
                          {entry.action === "REASSIGNED" && (
                            <span style={{ color: "var(--text-muted)" }}>
                              {" "}
                              ({entry.oldValue || "none"} → {entry.newValue})
                            </span>
                          )}
                          {entry.action === "ASSIGNED" && (
                            <span style={{ color: "var(--text-muted)" }}>
                              {" "}
                              to {entry.newValue}
                            </span>
                          )}
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
                <button type="submit" className="btn btn-primary" style={{ width: "100%" }}>
                  <Send size={14} />
                  <span>Post Comment</span>
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
