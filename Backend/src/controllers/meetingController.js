const Meeting = require("../models/Meeting");
const User = require("../models/User");
const { isValidId, isText, parseDueDate } = require("../utils/validation");

// 24-hour start time, e.g. "09:30" or "14:05" (matches the model)
const TIME_PATTERN = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;

// Fields the manager can schedule or edit. Anything else in the body
// (status, summary, ...) is ignored here so a plain edit can never wipe
// a published summary or silently un-cancel a meeting.
const validateDetails = (body) => {
  const { title, date, time, agenda, participants } = body;

  if (title !== undefined) {
    if (!isText(title) || !title.trim()) {
      return "Title is required";
    }
  }

  if (date !== undefined) {
    if (!parseDueDate(date)) {
      return "date must be a valid date";
    }
  }

  if (time !== undefined) {
    if (!isText(time) || !TIME_PATTERN.test(time)) {
      return "time must be in 24-hour HH:MM format";
    }
  }

  if (agenda !== undefined && agenda !== null && !isText(agenda)) {
    return "agenda must be text";
  }

  if (participants !== undefined) {
    if (!Array.isArray(participants) || participants.length === 0) {
      return "At least one participant is required";
    }

    for (const id of participants) {
      if (!isValidId(id)) {
        return "participants must reference existing employees";
      }
    }
  }

  return null;
};

// Every referenced participant must be a real, active-by-existence employee.
// Returns the deduplicated id list, or an error message.
const resolveParticipants = async (participants) => {
  const unique = [...new Set(participants.map(String))];

  for (const id of unique) {
    const user = await User.findById(id);

    if (!user || user.role !== "employee") {
      return { error: "participants must reference existing employees" };
    }
  }

  return { ids: unique };
};

const meetingWithNames = async (id) =>
  Meeting.findById(id)
    .populate("participants", "name role")
    .populate("createdBy", "name role");

// POST /api/meetings  (manager only)
const createMeeting = async (req, res) => {
  try {
    const { title, date, time, agenda, participants } = req.body;

    // Creating requires the full set of details
    if (!isText(title) || !title.trim()) {
      return res.status(400).json({
        success: false,
        message: "Title is required",
      });
    }

    const dateValue = parseDueDate(date);

    if (!dateValue) {
      return res.status(400).json({
        success: false,
        message: "date must be a valid date",
      });
    }

    if (!isText(time) || !TIME_PATTERN.test(time)) {
      return res.status(400).json({
        success: false,
        message: "time must be in 24-hour HH:MM format",
      });
    }

    if (agenda !== undefined && agenda !== null && !isText(agenda)) {
      return res.status(400).json({
        success: false,
        message: "agenda must be text",
      });
    }

    if (!Array.isArray(participants) || participants.length === 0) {
      return res.status(400).json({
        success: false,
        message: "At least one participant is required",
      });
    }

    for (const id of participants) {
      if (!isValidId(id)) {
        return res.status(400).json({
          success: false,
          message: "participants must reference existing employees",
        });
      }
    }

    const resolved = await resolveParticipants(participants);

    if (resolved.error) {
      return res.status(400).json({
        success: false,
        message: resolved.error,
      });
    }

    const meeting = await Meeting.create({
      title: title.trim(),
      date: dateValue,
      time: time,
      agenda: agenda ? agenda.trim() : "",
      participants: resolved.ids,
      createdBy: req.user._id,
    });

    const data = await meetingWithNames(meeting._id);

    return res.status(201).json({
      success: true,
      message: "Meeting scheduled successfully",
      data,
    });
  } catch (error) {
    console.error("Create meeting error:", error);

    return res.status(500).json({
      success: false,
      message: "Something went wrong",
    });
  }
};

// GET /api/meetings  (both roles)
// Managers see every meeting; employees only the ones they take part in.
const getMeetings = async (req, res) => {
  try {
    const filter =
      req.user.role === "manager" ? {} : { participants: req.user._id };

    const meetings = await Meeting.find(filter)
      .populate("participants", "name role")
      .populate("createdBy", "name role")
      .sort({ date: 1, time: 1 });

    return res.status(200).json({
      success: true,
      count: meetings.length,
      data: meetings,
    });
  } catch (error) {
    console.error("Get meetings error:", error);

    return res.status(500).json({
      success: false,
      message: "Something went wrong",
    });
  }
};

// PUT /api/meetings/:id  (manager only)
// Edits the meeting details. Status/summary changes go through their own
// endpoints, so this can never publish, erase or restore anything else.
const updateMeeting = async (req, res) => {
  try {
    if (!isValidId(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid meeting id",
      });
    }

    const problem = validateDetails(req.body);

    if (problem) {
      return res.status(400).json({
        success: false,
        message: problem,
      });
    }

    const meeting = await Meeting.findById(req.params.id);

    if (!meeting) {
      return res.status(404).json({
        success: false,
        message: "Meeting not found",
      });
    }

    const { title, date, time, agenda, participants } = req.body;

    if (title !== undefined) meeting.title = title.trim();
    if (date !== undefined) meeting.date = parseDueDate(date);
    if (time !== undefined) meeting.time = time;
    if (agenda !== undefined && agenda !== null) meeting.agenda = agenda.trim();

    if (participants !== undefined) {
      const resolved = await resolveParticipants(participants);

      if (resolved.error) {
        return res.status(400).json({
          success: false,
          message: resolved.error,
        });
      }

      meeting.participants = resolved.ids;
    }

    await meeting.save();

    const data = await meetingWithNames(meeting._id);

    return res.status(200).json({
      success: true,
      message: "Meeting updated successfully",
      data,
    });
  } catch (error) {
    console.error("Update meeting error:", error);

    return res.status(500).json({
      success: false,
      message: "Something went wrong",
    });
  }
};

// PUT /api/meetings/:id/cancel  (manager only)
// Cancels a scheduled meeting. Cancelled meetings keep their record (and
// stay visible to participants) instead of disappearing.
const cancelMeeting = async (req, res) => {
  try {
    if (!isValidId(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid meeting id",
      });
    }

    const meeting = await Meeting.findById(req.params.id);

    if (!meeting) {
      return res.status(404).json({
        success: false,
        message: "Meeting not found",
      });
    }

    meeting.status = "Cancelled";
    await meeting.save();

    const data = await meetingWithNames(meeting._id);

    return res.status(200).json({
      success: true,
      message: "Meeting cancelled",
      data,
    });
  } catch (error) {
    console.error("Cancel meeting error:", error);

    return res.status(500).json({
      success: false,
      message: "Something went wrong",
    });
  }
};

// PUT /api/meetings/:id/summary  (manager only)
// Publishes the post-meeting summary plus optional action items, which are
// then visible to every participant of the meeting.
const addSummary = async (req, res) => {
  try {
    const { summary, actionItems } = req.body;

    if (!isValidId(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid meeting id",
      });
    }

    if (!isText(summary) || !summary.trim()) {
      return res.status(400).json({
        success: false,
        message: "Summary is required",
      });
    }

    let items = [];

    if (actionItems !== undefined && actionItems !== null) {
      if (!Array.isArray(actionItems)) {
        return res.status(400).json({
          success: false,
          message: "actionItems must be a list of text items",
        });
      }

      for (const item of actionItems) {
        if (!isText(item) || !item.trim()) {
          return res.status(400).json({
            success: false,
            message: "actionItems must be a list of text items",
          });
        }
      }

      items = actionItems.map((item) => item.trim());
    }

    const meeting = await Meeting.findById(req.params.id);

    if (!meeting) {
      return res.status(404).json({
        success: false,
        message: "Meeting not found",
      });
    }

    meeting.summary = summary.trim();
    meeting.actionItems = items;
    await meeting.save();

    const data = await meetingWithNames(meeting._id);

    return res.status(200).json({
      success: true,
      message: "Meeting summary saved",
      data,
    });
  } catch (error) {
    console.error("Add meeting summary error:", error);

    return res.status(500).json({
      success: false,
      message: "Something went wrong",
    });
  }
};

module.exports = {
  createMeeting,
  getMeetings,
  updateMeeting,
  cancelMeeting,
  addSummary,
};
