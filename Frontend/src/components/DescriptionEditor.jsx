import { useRef } from "react";
import { Type, List, ListOrdered } from "lucide-react";
import { stripMarker } from "../utils/description";

// Rewrites every line touched by the current selection into `style`:
//   "paragraph" removes list markers, "bullets" writes "- item",
//   "numbered" writes "1. item", "2. item"... for each non-blank line.
// Blank lines are left alone so paragraph breaks inside the selection
// survive. Returns the new value plus the selection that should cover
// the same lines afterwards.
const applyBlockStyle = (value, selectionStart, selectionEnd, style) => {
  const start = value.lastIndexOf("\n", Math.max(selectionStart - 1, 0)) + 1;
  const nextBreak = value.indexOf("\n", selectionEnd);
  const end = nextBreak === -1 ? value.length : nextBreak;

  let counter = 0;
  const lines = value
    .slice(start, end)
    .split("\n")
    .map((line) => {
      const text = stripMarker(line);

      if (style === "paragraph" || !text.trim()) {
        return text;
      }

      counter += 1;
      return style === "bullets" ? `- ${text}` : `${counter}. ${text}`;
    });

  const replacement = lines.join("\n");

  return {
    value: value.slice(0, start) + replacement + value.slice(end),
    selectionStart: start,
    selectionEnd: start + replacement.length,
  };
};

// The description field used by BOTH the Create Task and the Edit Task
// forms: a plain textarea with a small toolbar that turns the current
// line(s) into a normal paragraph, a bullet list or a numbered list.
//
// There is no rich-text dependency here — the toolbar only writes the
// marker syntax read by utils/description.js, so form state keeps holding
// exactly the same string the API has always accepted, and the field is
// still an ordinary textarea (keyboard input, screen readers, autofill
// and mobile keyboards all behave normally).
const DescriptionEditor = ({
  value,
  onChange,
  name = "description",
  placeholder = "",
  rows = 5,
  fieldId,
}) => {
  const fieldRef = useRef(null);

  const applyStyle = (style) => {
    const field = fieldRef.current;

    if (!field) return;

    const next = applyBlockStyle(value, field.selectionStart, field.selectionEnd, style);

    onChange(next.value);

    // React re-renders the textarea with the new value; put the caret
    // back over the lines that were just rewritten so the next toolbar
    // click (or a keystroke) continues in the same place.
    requestAnimationFrame(() => {
      const updated = fieldRef.current;

      if (!updated) return;

      updated.focus();
      updated.setSelectionRange(next.selectionStart, next.selectionEnd);
    });
  };

  const tools = [
    { style: "paragraph", Icon: Type, label: "Normal paragraph", hint: "Turn the current line(s) back into normal paragraph text" },
    { style: "bullets", Icon: List, label: "Bullet list", hint: "Turn the current line(s) into a bullet list" },
    { style: "numbered", Icon: ListOrdered, label: "Numbered list", hint: "Turn the current line(s) into a numbered list" },
  ];

  return (
    <div className="description-editor">
      <div className="description-toolbar" role="toolbar" aria-label="Description formatting">
        {tools.map(({ style, Icon, label, hint }) => (
          <button
            key={style}
            type="button"
            className="btn btn-secondary btn-sm description-tool"
            title={hint}
            aria-label={label}
            onClick={() => applyStyle(style)}
          >
            <Icon size={14} aria-hidden="true" />
          </button>
        ))}
      </div>

      <textarea
        id={fieldId}
        ref={fieldRef}
        name={name}
        className="form-control description-textarea"
        rows={rows}
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />

      <p className="description-hint">
        Blank line starts a new paragraph — use the buttons to add a bullet or numbered list.
      </p>
    </div>
  );
};

export default DescriptionEditor;
