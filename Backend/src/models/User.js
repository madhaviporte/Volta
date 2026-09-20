const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },

    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },

    password: {
      type: String,
      required: true,
    },

    role: {
      type: String,
      enum: ["manager", "employee"],
      default: "employee",
    },

    department: {
      type: String,
      trim: true,
    },

    designation: {
      type: String,
      trim: true,
    },

    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

// Password must never appear in an API response,
// so it is removed whenever a user is converted to JSON
userSchema.set("toJSON", {
  transform: function (doc, userObject) {
    delete userObject.password;
    return userObject;
  },
});

module.exports = mongoose.model("User", userSchema);