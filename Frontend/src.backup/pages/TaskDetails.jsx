import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import api from "../services/api";

const TaskDetails = () => {
  const navigate = useNavigate();
  const { taskId } = useParams();

  const user = JSON.parse(localStorage.getItem("user") || "null");

  const [task, setTask] = useState(null);
  const [comments, setComments] = useState([]);
  const [history, setHistory] = useState([]);
  const [commentMessage, setCommentMessage] = useState("");
  const [message, setMessage] = useState("");

  const handleLogout = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    navigate("/login");
  };

  const loadTask = async () => {
    try {
      const response = await api.get(`/tasks/${taskId}`);
      setTask(response.data.data);
    } catch (error) {
      setMessage(error.response?.data?.message || "Could not load task");
    }
  };

  const loadComments = async () => {
    try {
      const response = await api.get(`/tasks/${taskId}/comments`);
      setComments(response.data.data);
    } catch (error) {
      setMessage("Could not load comments");
    }
  };

  // Loads the recorded actions for this task
  // (creation, assignment, reassignment, status changes, edits)
  const loadHistory = async () => {
    try {
      const response = await api.get(`/tasks/${taskId}/history`);
      setHistory(response.data.data);
    } catch (error) {
      setMessage("Could not load history");
    }
  };

  useEffect(() => {
    loadTask();
    loadComments();
    loadHistory();
  }, [taskId]);

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
      <div className="page">
        <p>{message || "Loading task..."}</p>
      </div>
    );
  }

  return (
    <div className="page">
      <h1>Task Details</h1>

      {user && user.role === "manager" ? (
        <p>
          <Link to="/manager/tasks">Back to Tasks</Link>
        </p>
      ) : (
        <p>
          <Link to="/employee/dashboard">Back to My Tasks</Link>
        </p>
      )}

      {message && <p>{message}</p>}

      <div className="card">
        <h2>{task.title}</h2>
        <p>
          <strong>Description:</strong> {task.description || "-"}
        </p>
        <p>
          <strong>Priority:</strong> {task.priority}
        </p>
        <p>
          <strong>Status:</strong> {task.status}
        </p>
        <p>
          <strong>Due Date:</strong> {task.dueDate ? task.dueDate.slice(0, 10) : "-"}
          {task.isOverdue ? " (Overdue)" : ""}
        </p>
        <p>
          <strong>Assigned To:</strong> {task.assignedTo?.name}
        </p>
        <p>
          <strong>Created By:</strong> {task.createdBy?.name}
        </p>
        {task.completedAt && (
          <p>
            <strong>Completed At:</strong> {task.completedAt.slice(0, 10)}
          </p>
        )}

        <div>
          <label>Change Status</label>
          <select value={task.status} onChange={handleStatusChange}>
            <option>Pending</option>
            <option>In Progress</option>
            <option>Completed</option>
            <option>On Hold</option>
          </select>
        </div>
      </div>

      <div className="card">
        <h2>Task History</h2>

        {history.length === 0 && <p>No history recorded</p>}

        {history.map((entry) => (
          <p key={entry._id}>
            {new Date(entry.createdAt).toLocaleString()} —{" "}
            <strong>{entry.action}</strong> by {entry.performedBy?.name}
            {entry.action === "STATUS_CHANGED" &&
              ` (${entry.oldValue} → ${entry.newValue})`}
            {entry.action === "REASSIGNED" &&
              ` (${entry.oldValue || "none"} → ${entry.newValue})`}
            {entry.action === "ASSIGNED" && ` to ${entry.newValue}`}
          </p>
        ))}
      </div>

      <div className="card">
        <h2>Comments</h2>

        {comments.length === 0 && <p>No comments yet</p>}

        {comments.map((comment) => (
          <p key={comment._id}>
            <strong>{comment.user?.name}:</strong> {comment.message}
          </p>
        ))}

        <form onSubmit={handleAddComment}>
          <div>
            <label>Add Comment</label>
            <input
              name="message"
              value={commentMessage}
              onChange={(e) => setCommentMessage(e.target.value)}
              required
            />
          </div>
          <button type="submit">Add Comment</button>
        </form>
      </div>

      <button onClick={handleLogout}>Logout</button>
    </div>
  );
};

export default TaskDetails;
