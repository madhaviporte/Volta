import { useCallback, useEffect, useState } from "react";
import {
  CalendarDays,
  PlusCircle,
  Edit,
  XCircle,
  CheckCircle2,
  AlertCircle,
  ClipboardList,
  Video,
} from "lucide-react";
import api from "../services/api";
import Navbar from "../components/Navbar";

// The stored date is midnight UTC of the day the manager picked, so the
// calendar day is read back in UTC (same convention as the task tables).
const fmtDate = (value) => {
  if (!value) return "-";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "-" : d.toISOString().slice(0, 10);
};

// Wall-clock moment of a meeting, used to split upcoming vs past.
const meetingMoment = (meeting) => {
  const day = fmtDate(meeting.date);
  if (day === "-") return new Date(NaN);
  return new Date(`${day}T${meeting.time}`);
};

const isPastMeeting = (meeting) => {
  const when = meetingMoment(meeting).getTime();
  return Number.isNaN(when) || when < Date.now();
};

const renderStatusBadge = (meeting) => {
  if (meeting.status === "Cancelled") {
    return <span className="badge badge-overdue">Cancelled</span>;
  }

  if (isPastMeeting(meeting)) {
    return meeting.summary ? (
      <span className="badge badge-status-completed">Completed</span>
    ) : (
      <span className="badge badge-inactive">Past</span>
    );
  }

  return <span className="badge badge-status-pending">Scheduled</span>;
};

const emptyMeetingForm = () => ({
  title: "",
  date: "",
  time: "",
  agenda: "",
  meetingLink: "",
  participants: [],
});

// Only absolute http(s) links are ever rendered as a Join Meeting
// button. The backend already validates this on save; the check here
// guards any old or hand-edited data from producing an unsafe anchor.
const isSafeMeetingLink = (value) => {
  if (typeof value !== "string" || !value.trim()) {
    return false;
  }

  try {
    const url = new URL(value.trim());
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
};

const MeetingUpdates = () => {
  const user = JSON.parse(localStorage.getItem("user") || "null");
  const isManager = Boolean(user && user.role === "manager");

  const [meetings, setMeetings] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  // In-flight guards so a double click never fires the same request twice
  const [saving, setSaving] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
  const [savingSummary, setSavingSummary] = useState(false);
  const [cancellingId, setCancellingId] = useState(null);

  const [formData, setFormData] = useState(emptyMeetingForm());
  const [editingId, setEditingId] = useState(null);
  const [editData, setEditData] = useState(emptyMeetingForm());
  const [summarizingId, setSummarizingId] = useState(null);
  const [summaryData, setSummaryData] = useState({ summary: "", actionItems: "" });

  const loadMeetings = useCallback(() => {
    return api
      .get("/meetings")
      .then((response) => {
        setMeetings(response.data.data);
      })
      .catch((error) => {
        setMessage(error.response?.data?.message || "Could not load meetings");
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    loadMeetings();

    // Only managers need the employee picker for participants
    if (isManager) {
      api
        .get("/users?role=employee")
        .then((response) => {
          setEmployees(response.data.data);
        })
        .catch(() => {
          setMessage("Could not load employees");
        });
    }
  }, [loadMeetings, isManager]);

  const toggleParticipant = (id, form, setForm) => {
    setForm({
      ...form,
      participants: form.participants.includes(id)
        ? form.participants.filter((p) => p !== id)
        : [...form.participants, id],
    });
  };

  const handleCreate = async (e) => {
    e.preventDefault();

    if (saving) return;

    setMessage("");

    if (formData.participants.length === 0) {
      setMessage("Select at least one participant");
      return;
    }

    setSaving(true);

    try {
      await api.post("/meetings", formData);

      setMessage("Meeting scheduled successfully");
      setFormData(emptyMeetingForm());
      loadMeetings();
    } catch (error) {
      setMessage(error.response?.data?.message || "Could not schedule meeting");
    } finally {
      setSaving(false);
    }
  };

  const handleStartEdit = (meeting) => {
    setMessage("");
    setSummarizingId(null);
    setEditingId(meeting._id);
    setEditData({
      title: meeting.title,
      date: fmtDate(meeting.date),
      time: meeting.time,
      agenda: meeting.agenda || "",
      meetingLink: meeting.meetingLink || "",
      participants: (meeting.participants || []).map((p) => p._id),
    });
  };

  const handleUpdate = async (e) => {
    e.preventDefault();

    if (savingEdit) return;

    setMessage("");

    if (editData.participants.length === 0) {
      setMessage("Select at least one participant");
      return;
    }

    setSavingEdit(true);

    try {
      await api.put(`/meetings/${editingId}`, editData);

      setMessage("Meeting updated successfully");
      setEditingId(null);
      loadMeetings();
    } catch (error) {
      setMessage(error.response?.data?.message || "Could not update meeting");
    } finally {
      setSavingEdit(false);
    }
  };

  const handleCancelMeeting = async (meeting) => {
    if (cancellingId) return;

    const confirmed = window.confirm(
      `Cancel "${meeting.title}"?\n\nParticipants will see this meeting marked as cancelled.`
    );

    if (!confirmed) return;

    setMessage("");
    setCancellingId(meeting._id);

    try {
      await api.put(`/meetings/${meeting._id}/cancel`);

      setMessage("Meeting cancelled");
      setEditingId(null);
      loadMeetings();
    } catch (error) {
      setMessage(error.response?.data?.message || "Could not cancel meeting");
    } finally {
      setCancellingId(null);
    }
  };

  const handleStartSummary = (meeting) => {
    setMessage("");
    setEditingId(null);
    setSummarizingId(meeting._id);
    setSummaryData({
      summary: meeting.summary || "",
      actionItems: (meeting.actionItems || []).join("\n"),
    });
  };

  const handleSaveSummary = async (e) => {
    e.preventDefault();

    if (savingSummary) return;

    setMessage("");

    setSavingSummary(true);

    try {
      await api.put(`/meetings/${summarizingId}/summary`, {
        summary: summaryData.summary,
        actionItems: summaryData.actionItems
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean),
      });

      setMessage("Meeting summary saved");
      setSummarizingId(null);
      loadMeetings();
    } catch (error) {
      setMessage(error.response?.data?.message || "Could not save summary");
    } finally {
      setSavingSummary(false);
    }
  };

  if (loading) {
    return (
      <div className="app-layout">
        <Navbar />
        <main className="main-content">
          <div className="empty-state">
            <p>Loading meetings...</p>
          </div>
        </main>
      </div>
    );
  }

  const upcoming = meetings.filter(
    (m) => m.status !== "Cancelled" && !isPastMeeting(m)
  );
  const past = meetings
    .filter((m) => m.status === "Cancelled" || isPastMeeting(m))
    .slice()
    .reverse();

  const isSuccess = /success|scheduled|updated|cancelled|saved/i.test(message);

  const participantNames = (meeting) => {
    const names = (meeting.participants || []).map((p) => p.name);
    return names.length > 0 ? names.join(", ") : "No participants";
  };

  const renderMeeting = (meeting) => {
    const items = (meeting.actionItems || []).filter(Boolean);
    const hasSummary = Boolean(meeting.summary) || items.length > 0;

    return (
      <div
        key={meeting._id}
        style={{
          border: "1px solid var(--border-color)",
          borderRadius: "var(--radius-md)",
          padding: "16px",
          marginBottom: "12px",
          opacity: meeting.status === "Cancelled" ? 0.75 : 1,
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: "12px",
            flexWrap: "wrap",
            alignItems: "flex-start",
          }}
        >
          <div style={{ flex: 1, minWidth: "240px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
              <strong style={{ fontSize: "15px", color: "var(--text-main)" }}>{meeting.title}</strong>
              {renderStatusBadge(meeting)}
            </div>

            <div style={{ color: "var(--text-muted)", fontSize: "13px", marginTop: "6px" }}>
              <CalendarDays size={13} style={{ display: "inline", verticalAlign: "-2px" }} />{" "}
              {fmtDate(meeting.date)} at {meeting.time}
            </div>

            {meeting.agenda && (
              <p style={{ marginTop: "8px", fontSize: "13px", color: "var(--text-main)" }}>
                <strong>Agenda:</strong> {meeting.agenda}
              </p>
            )}

            {isSafeMeetingLink(meeting.meetingLink) && (
              <div style={{ marginTop: "10px" }}>
                <a
                  href={meeting.meetingLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-primary btn-sm"
                  title="Open the meeting link in a new tab"
                >
                  <Video size={12} />
                  <span>Join Meeting</span>
                </a>
              </div>
            )}

            <div style={{ fontSize: "13px", color: "var(--text-muted)", marginTop: "6px" }}>
              <strong style={{ color: "var(--text-main)" }}>Participants:</strong>{" "}
              {participantNames(meeting)}
            </div>

            {hasSummary && (
              <div
                style={{
                  marginTop: "10px",
                  background: "var(--subtle-bg)",
                  border: "1px solid var(--border-color)",
                  borderRadius: "var(--radius-md)",
                  padding: "10px 12px",
                }}
              >
                <strong style={{ fontSize: "13px", display: "block", marginBottom: "4px" }}>
                  Meeting summary
                </strong>
                <p style={{ fontSize: "13px", color: "var(--text-muted)", whiteSpace: "pre-line" }}>
                  {meeting.summary || "No written summary."}
                </p>

                {items.length > 0 && (
                  <ul style={{ fontSize: "13px", color: "var(--text-main)", marginTop: "8px", paddingLeft: "18px" }}>
                    {items.map((item, index) => (
                      <li key={index} style={{ marginBottom: "2px" }}>
                        {item}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>

          {isManager && (
            <div className="btn-group" style={{ flexWrap: "wrap" }}>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => handleStartEdit(meeting)}
                title="Edit Meeting"
              >
                <Edit size={12} />
                <span>Edit</span>
              </button>

              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => handleStartSummary(meeting)}
                title="Meeting Summary"
                disabled={savingSummary}
              >
                <ClipboardList size={12} />
                <span>{meeting.summary || items.length > 0 ? "Edit Summary" : "Add Summary"}</span>
              </button>

              <button
                type="button"
                className="btn btn-danger btn-sm"
                onClick={() => handleCancelMeeting(meeting)}
                disabled={meeting.status === "Cancelled" || cancellingId !== null}
                title="Cancel Meeting"
              >
                <XCircle size={12} />
                <span>
                  {cancellingId === meeting._id
                    ? "Cancelling..."
                    : meeting.status === "Cancelled"
                      ? "Cancelled"
                      : "Cancel"}
                </span>
              </button>
            </div>
          )}
        </div>

        {/* Summary form, opened by "Add / Edit Summary" */}
        {isManager && summarizingId === meeting._id && (
          <form onSubmit={handleSaveSummary} style={{ marginTop: "14px", borderTop: "1px dashed var(--border-color)", paddingTop: "14px" }}>
            <div className="form-group">
              <label>Summary</label>
              <textarea
                className="form-control"
                rows="3"
                placeholder="What was decided or discussed? Participants will see this."
                value={summaryData.summary}
                onChange={(e) => setSummaryData({ ...summaryData, summary: e.target.value })}
                required
              ></textarea>
            </div>

            <div className="form-group">
              <label>Action items (one per line)</label>
              <textarea
                className="form-control"
                rows="3"
                placeholder={"Follow up with the client\nSend the report by Friday"}
                value={summaryData.actionItems}
                onChange={(e) => setSummaryData({ ...summaryData, actionItems: e.target.value })}
              ></textarea>
            </div>

            <div className="form-actions">
              <button type="submit" className="btn btn-primary" disabled={savingSummary}>
                <CheckCircle2 size={16} />
                <span>{savingSummary ? "Saving..." : "Save Summary"}</span>
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setSummarizingId(null)}
                disabled={savingSummary}
              >
                <XCircle size={16} />
                <span>Close</span>
              </button>
            </div>
          </form>
        )}
      </div>
    );
  };

  return (
    <div className="app-layout">
      <Navbar />

      <main className="main-content">
        <div className="page-header">
          <div className="page-title-group">
            <h1>Meeting Updates</h1>
            <p>
              {isManager
                ? "Schedule meetings, keep the team aligned, and publish summaries afterwards."
                : "See the meetings you take part in, along with agendas, summaries and follow-ups."}
            </p>
          </div>
        </div>

        {message && (
          <div className={`alert-banner ${isSuccess ? "success" : "error"}`}>
            <AlertCircle size={16} />
            <span>{message}</span>
          </div>
        )}

        {/* Schedule New Meeting (manager only) */}
        {isManager && (
          <div className="form-card">
            <div className="form-title">
              <PlusCircle size={18} className="text-muted" />
              <span>Schedule New Meeting</span>
            </div>

            <form onSubmit={handleCreate}>
              <div className="form-grid">
                <div className="form-group" style={{ gridColumn: "span 2" }}>
                  <label>Meeting Title *</label>
                  <input
                    name="title"
                    className="form-control"
                    placeholder="e.g. Weekly sync"
                    value={formData.title}
                    onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                    required
                  />
                </div>

                <div className="form-group">
                  <label>Date *</label>
                  <input
                    type="date"
                    name="date"
                    className="form-control"
                    value={formData.date}
                    onChange={(e) => setFormData({ ...formData, date: e.target.value })}
                    required
                  />
                </div>

                <div className="form-group">
                  <label>Time *</label>
                  <input
                    type="time"
                    name="time"
                    className="form-control"
                    value={formData.time}
                    onChange={(e) => setFormData({ ...formData, time: e.target.value })}
                    required
                  />
                </div>

                <div className="form-group" style={{ gridColumn: "span 2" }}>
                  <label>Agenda / Description</label>
                  <textarea
                    name="agenda"
                    className="form-control"
                    rows="2"
                    placeholder="What is this meeting about?"
                    value={formData.agenda}
                    onChange={(e) => setFormData({ ...formData, agenda: e.target.value })}
                  ></textarea>
                </div>

                <div className="form-group" style={{ gridColumn: "span 2" }}>
                  <label>Meeting Link</label>
                  <input
                    type="url"
                    name="meetingLink"
                    className="form-control"
                    placeholder="https://meet.google.com/abc-defg-hij (Google Meet, Zoom, Teams...)"
                    value={formData.meetingLink}
                    onChange={(e) => setFormData({ ...formData, meetingLink: e.target.value })}
                  />
                </div>

                <div className="form-group" style={{ gridColumn: "span 2" }}>
                  <label>Participants *</label>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "12px" }}>
                    {employees.map((employee) => (
                      <label
                        key={employee._id}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "6px",
                          fontSize: "13px",
                          cursor: "pointer",
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={formData.participants.includes(employee._id)}
                          onChange={() => toggleParticipant(employee._id, formData, setFormData)}
                        />
                        {employee.name}
                      </label>
                    ))}

                    {employees.length === 0 && (
                      <span style={{ fontSize: "13px", color: "var(--text-muted)" }}>
                        No employees yet — add employees first.
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <div className="form-actions">
                <button type="submit" className="btn btn-primary" disabled={saving}>
                  <PlusCircle size={16} />
                  <span>{saving ? "Scheduling..." : "Schedule Meeting"}</span>
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Edit Meeting form, shown only while editing */}
        {isManager && editingId && (
          <div className="form-card" style={{ border: "2px solid var(--primary)" }}>
            <div className="form-title" style={{ color: "var(--primary)" }}>
              <Edit size={18} />
              <span>Edit Meeting</span>
            </div>

            <form onSubmit={handleUpdate}>
              <div className="form-grid">
                <div className="form-group" style={{ gridColumn: "span 2" }}>
                  <label>Meeting Title *</label>
                  <input
                    name="title"
                    className="form-control"
                    value={editData.title}
                    onChange={(e) => setEditData({ ...editData, title: e.target.value })}
                    required
                  />
                </div>

                <div className="form-group">
                  <label>Date *</label>
                  <input
                    type="date"
                    name="date"
                    className="form-control"
                    value={editData.date}
                    onChange={(e) => setEditData({ ...editData, date: e.target.value })}
                    required
                  />
                </div>

                <div className="form-group">
                  <label>Time *</label>
                  <input
                    type="time"
                    name="time"
                    className="form-control"
                    value={editData.time}
                    onChange={(e) => setEditData({ ...editData, time: e.target.value })}
                    required
                  />
                </div>

                <div className="form-group" style={{ gridColumn: "span 2" }}>
                  <label>Agenda / Description</label>
                  <textarea
                    name="agenda"
                    className="form-control"
                    rows="2"
                    value={editData.agenda}
                    onChange={(e) => setEditData({ ...editData, agenda: e.target.value })}
                  ></textarea>
                </div>

                <div className="form-group" style={{ gridColumn: "span 2" }}>
                  <label>Meeting Link</label>
                  <input
                    type="url"
                    name="meetingLink"
                    className="form-control"
                    placeholder="https://meet.google.com/abc-defg-hij (Google Meet, Zoom, Teams...)"
                    value={editData.meetingLink}
                    onChange={(e) => setEditData({ ...editData, meetingLink: e.target.value })}
                  />
                </div>

                <div className="form-group" style={{ gridColumn: "span 2" }}>
                  <label>Participants *</label>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "12px" }}>
                    {employees.map((employee) => (
                      <label
                        key={employee._id}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "6px",
                          fontSize: "13px",
                          cursor: "pointer",
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={editData.participants.includes(employee._id)}
                          onChange={() => toggleParticipant(employee._id, editData, setEditData)}
                        />
                        {employee.name}
                      </label>
                    ))}
                  </div>
                </div>
              </div>

              <div className="form-actions">
                <button type="submit" className="btn btn-primary" disabled={savingEdit}>
                  <CheckCircle2 size={16} />
                  <span>{savingEdit ? "Saving..." : "Save Changes"}</span>
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setEditingId(null)}
                  disabled={savingEdit}
                >
                  <XCircle size={16} />
                  <span>Cancel</span>
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Upcoming Meetings */}
        <div className="card-section">
          <div className="card-header">
            <div className="card-title-group">
              <CalendarDays size={18} className="text-muted" />
              <h2>Upcoming Meetings ({upcoming.length})</h2>
            </div>
          </div>

          {upcoming.length === 0 ? (
            <div className="empty-state">No upcoming meetings scheduled</div>
          ) : (
            upcoming.map(renderMeeting)
          )}
        </div>

        {/* Past & Cancelled */}
        <div className="card-section">
          <div className="card-header">
            <div className="card-title-group">
              <ClipboardList size={18} className="text-muted" />
              <h2>Past &amp; Cancelled Meetings ({past.length})</h2>
            </div>
          </div>

          {past.length === 0 ? (
            <div className="empty-state">No past meetings yet</div>
          ) : (
            past.map(renderMeeting)
          )}
        </div>
      </main>
    </div>
  );
};

export default MeetingUpdates;
