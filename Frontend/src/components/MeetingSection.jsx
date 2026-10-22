import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { CalendarDays, ChevronRight } from "lucide-react";
import api from "../services/api";

// Compact "Meeting Updates" preview shown on both dashboards.
// The full functionality (scheduling, editing, summaries) lives on
// /meetings, which this section links to.
const MeetingSection = () => {
  const [meetings, setMeetings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  // "Now" is sampled when the data arrives (render stays pure), which is
  // exactly the moment the upcoming/past split matters
  const [cutoff, setCutoff] = useState(0);

  useEffect(() => {
    api
      .get("/meetings")
      .then((response) => {
        setCutoff(Date.now());
        setMeetings(response.data.data);
      })
      .catch((apiError) => {
        setError(apiError.response?.data?.message || "Could not load meetings");
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  // Same calendar-day convention as the Meetings page
  const fmtDate = (value) => {
    if (!value) return "-";
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? "-" : d.toISOString().slice(0, 10);
  };

  const moment = (meeting) => {
    const day = fmtDate(meeting.date);
    if (day === "-") return NaN;
    return new Date(`${day}T${meeting.time}`).getTime();
  };

  const upcoming = meetings
    .filter(
      (m) =>
        m.status !== "Cancelled" &&
        !Number.isNaN(moment(m)) &&
        moment(m) >= cutoff
    )
    .sort((a, b) => moment(a) - moment(b))
    .slice(0, 3);

  return (
    <div className="card-section">
      <div className="card-header">
        <div className="card-title-group">
          <CalendarDays size={18} className="text-muted" />
          <h2>Meeting Updates</h2>
        </div>

        <Link
          to="/meetings"
          className="btn btn-secondary btn-sm"
          title="Open Meeting Updates"
        >
          <span>View all</span>
          <ChevronRight size={12} />
        </Link>
      </div>

      {error && (
        <div className="alert-banner error">
          <span>{error}</span>
        </div>
      )}

      {loading ? (
        <div className="empty-state">Loading meetings...</div>
      ) : !error && upcoming.length === 0 ? (
        <div className="empty-state">No upcoming meetings scheduled</div>
      ) : (
        upcoming.length > 0 && (
          <div className="table-responsive">
            <table className="modern-table">
              <thead>
                <tr>
                  <th>Meeting</th>
                  <th>Date</th>
                  <th>Time</th>
                  <th>Participants</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {upcoming.map((meeting) => (
                  <tr key={meeting._id}>
                    <td style={{ fontWeight: 600 }}>
                      <Link to="/meetings">{meeting.title}</Link>
                    </td>
                    <td>{fmtDate(meeting.date)}</td>
                    <td>{meeting.time}</td>
                    <td>
                      {(meeting.participants || [])
                        .map((p) => p.name)
                        .join(", ") || "-"}
                    </td>
                    <td>
                      <span className="badge badge-status-pending">Scheduled</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}
    </div>
  );
};

export default MeetingSection;
