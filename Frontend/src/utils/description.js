// =====================================================================
// description.js — helpers for the task description's lightweight markup.
//
// The description stays a plain string in the API and in MongoDB: same
// field, same validation, no migration, no new dependency. Formatting is
// expressed with line markers that a human can also type by hand:
//
//   a blank line        -> starts a new paragraph
//   "- item" (or * / •) -> a bullet item
//   "1. item" (or 2) )  -> a numbered item
//   anything else       -> ordinary paragraph text
//
// Descriptions written before this existed are single lines without
// markers, so they parse into exactly one paragraph and render exactly
// as they did before.
// =====================================================================

// A bullet marker at the very start of a line.
const BULLET_MARKER = /^\s*[-*•]\s+/;
// A numbered marker such as "1. ", "12) " or "3." at the start of a line.
const NUMBERED_MARKER = /^\s*\d+[.)]\s*/;

// True when the line already carries a list marker.
const isBulletLine = (line) => BULLET_MARKER.test(line);
const isNumberedLine = (line) => NUMBERED_MARKER.test(line);

// The line without its list marker, so the editor can switch a line
// between paragraph, bullet and numbered style without stacking markers.
const stripMarker = (line) => line.replace(BULLET_MARKER, "").replace(NUMBERED_MARKER, "");

// Splits a stored description into blocks the UI can render:
//   { type: "p",  items }  paragraph lines (joined with \n on render)
//   { type: "ul", items }  consecutive bullet lines
//   { type: "ol", items }  consecutive numbered lines
// Blank lines close the current block, which is what separates
// paragraphs and ends one list before the next begins.
const parseDescription = (text) => {
  const blocks = [];
  let current = null;

  const closeBlock = () => {
    if (current) {
      blocks.push(current);
      current = null;
    }
  };

  for (const line of String(text || "").split("\n")) {
    if (!line.trim()) {
      closeBlock();
      continue;
    }

    const type = isBulletLine(line) ? "ul" : isNumberedLine(line) ? "ol" : "p";

    if (!current || current.type !== type) {
      closeBlock();
      current = { type, items: [] };
    }

    // Paragraph lines keep their text as-is (markers are not stripped
    // from plain text by mistake); list lines lose their marker.
    current.items.push(type === "p" ? line : stripMarker(line));
  }

  closeBlock();

  return blocks;
};

export { isBulletLine, isNumberedLine, stripMarker, parseDescription };
