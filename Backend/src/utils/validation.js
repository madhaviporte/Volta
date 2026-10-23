// Shared input-validation helpers.
// Controllers use these to reject malformed request data with a 400
// before it reaches mongoose, so bad input never surfaces as a 500.
const mongoose = require("mongoose");

// A request id must be a string that can become a real ObjectId.
// (Route params and JSON body ids are always strings when valid.)
const isValidId = (value) => {
  return typeof value === "string" && mongoose.isValidObjectId(value);
};

// Text fields must actually be strings before calling .trim() on them.
const isText = (value) => {
  return typeof value === "string";
};

// Parses a due date from the request body.
// Returns a real Date, or null when the value cannot become a valid date,
// so callers can answer 400 instead of saving an invalid date.
const parseDueDate = (value) => {
  if (!isText(value) || !value.trim()) {
    return null;
  }

  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed;
};

// Loose, practical email shape check (no dependency). This only rejects
// obviously malformed input; the authoritative rule stays the unique index
// on User.email, which is what guards against duplicates.
const isEmail = (value) => {
  if (!isText(value)) {
    return false;
  }

  const email = value.trim();

  // Must have something@domain with no spaces and a dot in the domain part
  if (/\s/.test(email)) {
    return false;
  }

  const at = email.indexOf("@");
  if (at <= 0 || at !== email.lastIndexOf("@")) {
    return false;
  }

  const domain = email.slice(at + 1);
  return domain.includes(".") && !domain.startsWith(".") && !domain.endsWith(".");
};

// A trimmed string of at least `min` characters (passwords, names, ...).
const hasMinLength = (value, min) => {
  return isText(value) && value.length >= min;
};

// A meeting link must be an absolute http(s) URL. Rejecting every other
// scheme keeps javascript:, data: and friends out of the database and out
// of the "Join Meeting" anchor the frontend renders.
const isSafeHttpUrl = (value) => {
  if (!isText(value)) {
    return false;
  }

  try {
    const url = new URL(value.trim());
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
};

module.exports = {
  isValidId,
  isText,
  parseDueDate,
  isEmail,
  hasMinLength,
  isSafeHttpUrl,
};
