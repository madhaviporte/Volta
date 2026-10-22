const mongoose = require("mongoose");

const meetingSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
    },

    // Calendar day of the meeting (controllers validate the value first)
    date: {
      type: Date,
      required: true,
    },

    // Start time in 24-hour "HH:MM" form, matching <input type="time">
    time: {
      type: String,
      required: true,
      match: /^([01][0-9]|2[0-3]):[0-5][0-9]$/,
    },

    // Agenda / description shown to every participant
    agenda: {
      type: String,
      trim: true,
      default: "",
    },

    // Employees the meeting is relevant to. Employees can only see and
    // read meetings they appear in; only managers can change any of this.
    participants: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],

    // "Scheduled" until a manager cancels it. Cancelled meetings stay
    // visible in the history so everyone can see what happened.
    status: {
      type: String,
      enum: ["Scheduled", "Cancelled"],
      default: "Scheduled",
    },

    // Manager-written notes published after the meeting happened.
    // An empty summary simply means nothing has been published yet.
    summary: {
      type: String,
      trim: true,
      default: "",
    },

    // Follow-up notes / action items published with the summary
    actionItems: [
      {
        type: String,
        trim: true,
      },
    ],

    // The manager who scheduled the meeting
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("Meeting", meetingSchema);
