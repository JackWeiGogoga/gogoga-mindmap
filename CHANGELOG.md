# Changelog

All notable changes to gogoga Mind Map are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/). 中文版见 [CHANGELOG.zh-CN.md](CHANGELOG.zh-CN.md).

## [Unreleased]

### Added
- Right-click → **Insert ▸ Child node with a table** creates a child that holds just a table, without typing a title first; the cursor lands in the first cell, and a node without a title shows only the table.
- **Delete table** in the menu of a node table's top-left button: removes the table and keeps the node.
- Numbered siblings: right-click a node → **More ▸ Number siblings (1. 2. 3.)** to show 1. 2. 3. in front of that group; numbers update when you add, delete or reorder. The numbers aren't written into the text: list items are stored as a Markdown ordered list, so Obsidian shows them numbered too, and headings get a `%%num%%` after their parent heading. Ordered lists already in your notes show their numbers in the map as well. There's also a command, **Number the selected nodes and their siblings (on / off)**, to bind a hotkey to; the outline panel shows the numbers too.
- **Start numbering by typing 1.** setting (Editing and interaction page, off by default): typing "1. " or "1、" at the start of a node numbers its group, and the typed number is removed.
- A strikethrough button (S) in the formatting toolbar while editing a node: select text and click to add `~~`, click again to remove it.
- **Strike through completed tasks** setting (Editing and interaction page, off by default): nodes whose task box is checked show struck-through, dimmed text; not in recite mode.
- **Name new nodes Topic 1, Topic 2…** setting (Editing and interaction page, off by default): a new node starts as "Topic 1", "Topic 2"… selected, so typing replaces it; pressing Enter or Esc without typing keeps it, so you can add several nodes in a row.

### Changed
- A node table under a list item is now written after a blank line, so Obsidian's Reading view shows it as a table even without the table plugin. Tables written earlier get the blank line the next time the map is saved.
- Node tables have the same margin on every side, so the table sits centered in the node.

## [0.46.0] - 2026-11-07

### Added
- Tables inside nodes: right-click a node → **Insert ▸ Insert table** to put a table in the node box, under its title, and edit cells right there with the same editor as the gogoga Table plugin: Enter / Tab to move, drag column widths, cell colors, merged cells, row and column handles, copy and paste with Excel or Feishu, ⌘Z to undo. No need to install the table plugin. The table is stored in the node's note as a plain Markdown table, with `%%table%%` added after the node; for a node whose note already has a table, right-click → **Insert ▸ Show table in node** moves it into the node, and **More ▸ Move table back to note** puts it back. Nodes without the marker and existing notes don't change. Big tables don't blow up the node: columns you haven't resized are at most 240 wide and wrap their text, and a table larger than the maximum width or height in settings (640 and 480 by default, on the Notes page) scrolls inside the node with its header kept at the top; scrolling anywhere on such a node scrolls only the table, and the node stays put even at the end. One swipe (trackpad momentum included) goes to one thing: panning that starts on the canvas isn't caught by a table it passes over, and an expanded note that hits its end no longer flings the canvas.

### Changed
- With **Resize width from the right edge on hover** on, the selected node behaves the same way: its right-edge bar stays hidden until you point at the edge.
- Adding a boundary after selecting a whole branch adds just one around the outermost node instead of one around every child.

## [0.45.0] - 2026-11-06

### Added
- **Resize width from the right edge on hover** setting (on the Editing and interaction page, off by default): hovering over any node shows the width handle on its right edge, so you can drag or double-click it without selecting the node first; the current selection stays as it is.
- Double-clicking the width handle of an automatic-width node whose text wraps now stretches it to one line (up to 1200); a node with a set width still goes back to automatic width.
- **Keep format marks hidden while editing** setting (on the Editing and interaction page, off by default): while editing a node, `**` and `==` stay hidden even when the cursor is next to bold or highlighted text, so the line width doesn't jump.
- Right-clicking a relationship line (or its label) now offers **Go to start** and **Go to end**, which select that node and glide it to the middle of the canvas.

### Changed
- The width handle covers the node's whole right edge, so you can grab it anywhere from top to bottom instead of aiming for the small bar in the middle.

### Fixed
- While editing, bold or highlighted text right next to CJK punctuation (such as `**换行）**：`) was a few pixels wider than when displayed, so a node near its width limit wrapped an extra line as soon as you started editing. Editing and display now have the same width.
- Pressing Backspace right after colored text deleted the whole hidden `</span>`, leaving an unclosed color tag; deleting a selection that ran from inside colored text to outside it did the same. Now only the visible characters are deleted, and the tags go once the text inside is gone.

## [0.44.0] - 2026-11-05

### Added
- Summary topics: a summary can now have its own subtopics, like XMind's summary topic. Click the summary text and press Tab, or right-click the summary → **Add subtopic**: the summary text becomes a node with a subtopic under it, and from then on it edits, takes children, folds and accepts dropped nodes like any node. When it's taller than the nodes it covers, the siblings above and below make room instead of overlapping; all four structures are supported, and on the left side of a mind map it grows leftward. In Markdown it's the item right after the last node it covers, `- Notes %%summary-topic=2%%`, with its subtopics under it as usual; the outline panel lists it in that spot too. A summary topic follows the range it covers and can't be dragged or moved on its own; deleting the first covered node hands the summary to the next one, and deleting them all leaves it behind as an ordinary node with its subtree. Plain one-line summaries are stored exactly as before, and existing notes don't change at all.
- Opening or converting .xmind files now brings over topics hanging off a summary (as summary topics) instead of counting them as left out.

## [0.43.0] - 2026-11-05

### Added
- **Center the selected node** setting (on the Editing and interaction page, off by default): clicking a node, moving with the arrow keys, or adding a node with Tab / Enter glides the selection to the middle of the canvas in about 0.2 s. After a click it waits out the double-click interval, so double-click to edit still works; Shift/⌘ multi-select, box-select and dragging leave the view alone, and panning or zooming mid-glide stops it where you put it.

## [0.42.0] - 2026-11-05

### Added
- Select text while editing a node and paste a web address to get a `[text](address)` link, as in the Obsidian editor. Local file and folder paths (`/Users/…`, `C:\…`) work the same way and become `file://` links that open in the default app. With nothing selected, pasting works as before. Turn on **Fetch page titles for pasted links** (off by default) to have a pasted address with nothing selected become `[page title](address)`. Renaming in the outline panel works the same way.
- PDF auto-excerpt: run **Toggle PDF auto-excerpt into this mind map** in a map, and every link PDF++ copies (selected text, a rectangle, an annotation) is added under the selected node straight away, with no ⌘V. The selection stays on that node, so excerpts in a row land under it; click another node to send the next ones there. Turn on Auto-copy in PDF++ to add a selection as soon as you make it. While it's on, a highlighted button in the view header stops it. Needs PDF++.

## [0.41.0] - 2026-11-05

### Added
- Obsidian 1.15's colored highlights, `==🔴text==`, now show in nodes in the theme's highlight colors instead of plain yellow with the emoji visible; while editing, the emoji is hidden like `==`. Add 🔴🟠🟡🟢🔵🟣 to "Highlighter colors" to write them from the format bar and the "Highlighter color" commands; "Clear text and highlighter colors" turns them back into plain highlights.

### Improved
- Recite mode keeps a highlight's own color when covering it (yellow for plain highlights, their own color for highlighter and colored highlights) instead of turning every blank gray, so blanks stand out and you can still tell them apart.

## [0.40.0] - 2026-11-05

### Added
- The node context menu now has "Expand all sub-branches" and "Collapse all sub-branches" as a pair on the first level, and the submenu, renamed **Fold & view ▸**, adds "Expand one level" and "Collapse one level" and now also holds "Focus on this branch" and "Zoom to this branch", so the first level doesn't get longer. Keys: ⇧0 collapses the whole branch (the pair of 0), = / - expand or collapse one level; all of them are commands too.
- "Node colors" setting: choose which colors the floating toolbar and the callout color menu offer. Remove the ones you don't use or add hex values like `#ff8800`; built-in names follow the theme and dark mode, hex values stay the same everywhere.

### Improved
- Settings now use sub-pages: the first page lists Opening and display, Editing and interaction, Toolbars and colors, Notes, Markdown and embeds, New maps and Custom themes, each with a one-line summary and, for some, the current value (such as how many node colors), and the settings themselves are one click in. On Obsidian 1.13 and later, the plugin's settings show up in the "Search settings" box of the settings window, including common synonyms (searching "palette" finds "Node colors"); older versions show the same page without search.

### Fixed
- After the plugin was updated (or reloaded, or re-enabled), mind map notes you had open as Markdown were switched back to the map view. Open tabs are now only converted when Obsidian starts, so updating the plugin leaves them as they are.
- When a note was changed elsewhere (a sync service, another device, another plugin or editor) within the couple of seconds before the map auto-saved, one side's changes could be lost: a node being edited overwrote the outside change, and edits to the same line got spliced together. Changes are now merged line by line, so edits to different places are both kept; when both sides changed the same place, the map's version is kept and a notice says so.
- In code blocks and embedded maps, the toolbar (at the bottom and always shown by default) covered the nodes nearest that edge, so they couldn't be clicked. Fit to view now leaves room for the toolbar and the preview grows to match; when the toolbar is set to auto-hide no room is reserved. Fit to view in the main view also keeps clear of the toolbar.

## [0.39.0] - 2026-11-04

### Added
- "Floating toolbar on selected nodes" setting (on by default): turn it off if the small toolbar above the selected node gets in the way of clicking nearby nodes; everything on it is also in the node's context menu. ([#22](https://github.com/JackWeiGogoga/gogoga-mindmap/issues/22))

### Improved
- Toolbar button tooltips show up right away instead of after a second or two. ([#22](https://github.com/JackWeiGogoga/gogoga-mindmap/issues/22))

### Fixed
- With side-by-side sync on and the cursor in Markdown, the first click on a map node didn't jump, and clicking the node the cursor was already on never jumped until you clicked another node. Clicking any node now jumps straight there. ([#22](https://github.com/JackWeiGogoga/gogoga-mindmap/issues/22))

## [0.38.0] - 2026-11-04

### Improved
- Editing a node's text now shows formatting as it will look, like Obsidian's Live Preview: bold, italic, highlights, strikethrough, inline code, text colors and highlighter colors render in place with their markers hidden; Markdown markers like `**` and `==` show when the cursor is on them, while color tags always stay hidden so clicking into or selecting colored text doesn't reflow the node. The editor is now CodeMirror, the same one Obsidian uses, so input methods, undo and cursor movement behave as in Obsidian's editor; callouts, summaries, relationship labels, boundary titles and renaming in the outline panel use the same editor.

### Fixed
- In notes whose headings sit on consecutive lines (no blank line between them), every node added from the map got a blank line in front of it in Markdown. New headings now follow the note's own style: if most headings sit right after the previous node, new ones do too; a blank line is still kept after the central topic and after notes and paragraphs. Maps created by the plugin, which put a blank line between headings, are unaffected.
- Adding a node to a note that doesn't end with a newline no longer adds one at the end.
- Notes that use \r\n line endings throughout no longer get switched to \n by some write-backs.

## [0.37.0] - 2026-11-04

### Added
- "Fold Markdown along with the map" setting (off by default): branches collapsed in the map are folded in the Markdown editor and reading view of the same note too, and unfolded when you expand them in the map; folds you make yourself in Markdown are left alone.
- "Expand collapsed nodes when syncing" setting (off by default): with side-by-side sync, moving the Markdown cursor into a branch collapsed in the map expands the map down to that node instead of selecting the collapsed ancestor.
- `<mark>text</mark>` in a node shows as a highlight, the same as `==text==`, and is covered in recite mode.

### Fixed
- Opening a map in the right sidebar (or another narrow pane) restored the position remembered from a wide pane, leaving the central topic off screen. The pane size is now remembered too, and the view keeps its center when restored in a pane of a different size.
- In a narrow pane the bottom toolbar didn't fit and its right end was cut off. It now wraps onto two rows.

## [0.36.0] - 2026-11-03

### Added
- "Sync with Markdown side by side" now works with reading view: selecting a node scrolls reading view to that block or list item and flashes it, expanding collapsed headings; clicking a block or list item in reading view selects the matching node.
- "Copy nodes without map markers" setting (off by default): copied nodes go to the clipboard as plain Markdown, without markers like `%%w=…%%`, so they paste cleanly elsewhere; pasting back into a map still restores width, callouts and the like.

## [0.35.0] - 2026-11-03

### Added
- Color part of a node's text: while editing a node, select some text and use the commands "Text color 1–5", "Highlighter color 1–5", "Highlight the selected text" or "Clear text and highlighter colors", all bindable in Settings → Hotkeys; outside editing they apply to the whole text of the selected nodes. Saved as `<span style="color:…">` and `<mark style="background:…">` (the same as the Highlightr plugin), so Markdown shows the colors too; recite mode covers highlighter colors like `==highlights==`.
- "Format bar when selecting text" setting (off by default): selecting text while editing a node shows bold, italic, highlight, text color, highlighter and clear buttons above it.
- "Text colors" and "Highlighter colors" settings: choose your own colors, separated by commas (three of each by default).
- Bold and italic are now commands too, so you can rebind them.

### Fixed
- A node with both text and an image ignored the maximum width, so the text never wrapped. Text now wraps as usual, and a node only grows wider than the maximum when an image needs it. A custom theme's maximum width now applies to these nodes too.
- ⌘B / ⌘I (Ctrl+B / Ctrl+I on Windows) did nothing in the map (Obsidian's editor bold/italic hotkeys took them). They now bold or italicize the selected nodes, or only the selected text while editing a node.

## [0.34.0] - 2026-11-01

### Added
- Opening a .xmind file now shows topic images: image-only topics become image nodes, and topics with text get the image before or after the text as placed in XMind, at the XMind width. Works for XMind Zen / 2020+ and XMind 8 files, and in `![[file.xmind]]` embeds.
- "Convert to Markdown note" saves the images as attachments (following Obsidian's attachment location setting) and writes them as `![[attachment|width]]` in the nodes. Images used to be dropped silently.
- Topics whose image file is missing from the .xmind are counted in the "not supported yet" notice at the top.

## [0.33.2] - 2026-11-01

### Fixed
- Clicking the task checkbox on a node a second time removed the checkbox (the item became a plain list item). It now toggles between open and done; use the context menu "Task checkbox" to remove it.
- Edits to a mind map code block inside a Canvas text card failed with "Failed to write back to the code block: File not found" and were lost. They are now written back to the card text.
- Pressing F2 on a selected node of a mind map embedded in a note triggered Obsidian's "Rename file". F2 now edits the node as usual.

### Changed
- Clicking outside an embedded mind map (note text, empty canvas) clears the selection, so the floating node toolbar goes away. With "Hide the toolbar of embedded maps" on, the bottom toolbar also hides once the mouse and focus leave the map, including while you are editing it and on canvas cards.

## [0.33.1] - 2026-11-01

### Fixed
- Pasting with Ctrl/⌘+V into a selected node did nothing while text was still selected in a PDF or another note (for example right after PDF++ copied a selection); you had to double-click a node first. It now pastes as subtopics straight away.

## [0.33.0] - 2026-10-31

### Added
- Relationships: right-click a node → "Add relationship" (also a command), then click the node to connect to. A dashed, curved arrow joins the two; double-click it to add a label, drag the label (or the dot on a selected line) to change the curve, and right-click it to edit, reverse, reset the curve or delete. Stored as `%%rel=r1 "Text"%%` on the start node and `%%id=r1%%` on the end node, so renaming or moving nodes never breaks a line. Lines are included in PNG/SVG exports, and relationships in .xmind files are now imported. ([#3](https://github.com/JackWeiGogoga/gogoga-mindmap/issues/3))
- "Preview notes while editing" setting (off by default): when you edit a note, the rendered note appears next to the text box (below it when the window is narrow) and updates as you type. ([#6](https://github.com/JackWeiGogoga/gogoga-mindmap/issues/6))

## [0.32.0] - 2026-10-31

### Added
- "Delete note" in the node's context menu (and in the context menu of an expanded note); with several nodes selected, it removes all their notes.
- More → "Split into subtopics at commas": turns "apples, pears; plums" into three subtopics. Commas inside links, math and code, and in numbers like 1,000, are left alone.
- PDF crops show a ↗ button in the corner on hover or when selected; clicking it jumps back to that spot in the PDF.

### Fixed
- Clicking a link to a node (`[[note#^id]]` or `[[note#Heading]]`) in a mind map did nothing. It now selects and centers that node, unfolding its parents; following such a link from another note opens the map at that node.
- Dragging the corner of an expanded note to resize it made the box flicker between the old and new size.
- Shift + mouse wheel now pans sideways even where the system doesn't turn it into horizontal scrolling.

## [0.31.1] - 2026-10-31

### Fixed
- In Live Preview, the first child (or the next sibling) under a node whose note is stored as a `> [!note]` block (notes containing lists or headings) was shown inside that note. A blank line is now written after such notes. Reading view and the mind map were not affected, and existing notes stay as they are until you add the blank line yourself.

## [0.31.0] - 2026-10-31

### Added
- Hide nodes from the mind map: right-click a node and choose More → Hide in mind map, or write `%%hide%%` after it in the note. The node and its branch stay in the note but leave the map; press Mod+Z to undo. When a map has hidden nodes, the toolbar shows "Show hidden nodes" (also a command): they appear faded with a dashed outline, and More → Unhide brings them back. Saving puts hidden nodes back exactly where they were, even when you move or delete the nodes around them, and boxes and summaries spanning them keep their original range.
- "Only headings as nodes" setting (off by default): mind maps of notes show only headings as nodes, and the lists and paragraphs under a heading become its note, kept exactly as written. New nodes are written as headings one level down, up to level 6; deeper ones are saved as part of the heading's note, with a notice. Code-block mind maps are not affected. ([#14](https://github.com/JackWeiGogoga/gogoga-mindmap/issues/14))

## [0.30.0] - 2026-10-31

### Added
- Expanded notes: a "Maximum width of expanded notes" setting (320 by default; wider boxes show images in notes larger), and drag the bottom-right corner of a note box to give that note its own size (double-click the corner to reset). Notes you collapse one by one and the sizes you drag are remembered per file in `state.json`, and follow a node when you rename or move it in the map.
- Outline panel: formulas in titles render as formulas, and the "Show full titles in the outline" setting (off by default) wraps long titles instead of cutting them off.

### Fixed
- Moving a heading before list items at the same level no longer turns it into a list item. Headings have to come after list items at the same level in Markdown, so the list items after it become headings of the same level instead (block IDs and paragraphs before them are kept), with a notice; press Mod+Z to undo. Moving a list item after a heading likewise makes it a heading, so saving no longer reorders them. Dragging a heading onto a node keeps it a heading. ([#10](https://github.com/JackWeiGogoga/gogoga-mindmap/issues/10))

## [0.29.0] - 2026-10-30

### Changed
- Per-file view state no longer lives in `data.json` next to the plugin settings, so syncing several devices can't clobber your settings over a panned canvas. Where you left off in each map (position, zoom, selection) is kept on this device only and not synced; whether a file is locked, has notes expanded or callouts hidden goes to a separate `state.json` in the plugin folder, and changes made on another device are merged instead of overwritten. Existing state moves over automatically the first time the plugin loads. Colors, folds, boxes and other styling stay in your notes as before.

### Fixed
- Maps and notes in pop-out windows: with "Sync with Markdown side by side" on, moving the cursor in Markdown selects the matching node and selecting a node scrolls Markdown to its line and flashes it, whichever window each is in. Editing nodes and outline renames place the cursor correctly, and menus close when you click elsewhere in a pop-out window.

## [0.28.2] - 2026-10-30

### Fixed
- Typing with a Chinese input method: pressing Enter to commit the Latin letters you typed (for example `cc`) no longer saves the pinyin separators too (`c c` with the macOS input method, `c'c` with Sogou). Enter, Esc and Tab now go to the input method while it is composing, in node editing, outline renames, callouts, summaries, box titles and the search box. Esc during composition only cancels the composition instead of closing the editor. ([#18](https://github.com/JackWeiGogoga/gogoga-mindmap/issues/18))

## [0.28.1] - 2026-10-30

### Changed
- Recite mode: every quiz question now shows a "Single" or "Multiple" tag, and only clicking the tag reveals or hides the answer. Clicking anywhere else on the question selects it like any other node, so answers no longer get revealed by accident.
- Recite mode: children of the options (the reasoning behind an answer, for example) stay covered until the answer is revealed, the same way 🙈 answers are covered.

## [0.28.0] - 2026-10-29

### Added
- PDF crops: `![[book.pdf#page=3&rect=…]]` in a node (what PDF++ copies for a rectangle selection) shows the cropped image itself. Like other images in nodes, drag the handle to resize it and double-click to view it full-size. Needs PDF++; without it the crop shows as a link to that page.
- Clicking a link to a PDF in a node or a note, while that PDF is already open in another tab, jumps there to the page and selection (the selection is highlighted) and keeps the mind map where it is, so reading a PDF on the right and taking notes on the left works smoothly.

### Fixed
- Pasting a block quote no longer turns every line into its own node (it used to leave a few nodes with nothing but `>`). A selection copied from PDF++ (`> [!PDF|] [[book.pdf#…|book, p.3]]` followed by the quoted text) pastes as one node: the quoted text, linked to that selection in the PDF. Other quotes become one node from the first line (or the callout title), with the rest as its note.
- Resizing an image that has a caption, like `![[image|caption|width]]`, replaces only the width instead of adding another segment each time.

## [0.27.0] - 2026-10-29

### Added
- Expanded notes: the note button in the toolbar (and the command "Expand / collapse notes") shows notes in a box right under their nodes. The nodes around make room, so notes never cover nodes or lines, and long notes scroll inside the box. Double-click a box to edit it in place; click ≡ on the node or the collapse button on the box to hide just that one. Remembered per file, with the "Expand notes" setting (off by default) as the default and "Maximum height of expanded notes" at 240. Nothing is written to your notes, and PNG/SVG exports include the expanded notes.

### Fixed
- Locking editing while a node was selected left the node's floating toolbar on screen; it now goes away.

## [0.26.0] - 2026-10-29

### Fixed
- `[[note#Heading]]` links to a heading that was folded, colored or given another marker in the map now work. The marker used to sit at the end of the heading line, which made it part of the heading name in Obsidian; it is now written on its own line below the heading. Old notes are still read as before and move over only when you change that node; links elsewhere that included the marker are updated at the same time.

## [0.25.1] - 2026-10-29

### Fixed
- Text between two lists under the same heading (or between sub-lists of a list item) stays where it was. Before, editing such a note moved it after the last list and merged the lists, which changed what the text referred to. Deleting or moving a list item leaves that text in place.
- A line that starts a new block right after a list item (an HTML comment such as `<!-- fav-sync:end -->`, a code fence, a quote, a horizontal rule) is no longer pulled into that list item when the item is edited.
- Two trailing spaces (a hard line break) at the end of a list item are kept.
- A numbered list that directly follows a paragraph keeps rendering as a list after its first item is deleted.
- A note line such as "2026. year end" right after text in a heading's note is no longer wrapped in a callout, which used to change how the note looked.

## [0.25.0] - 2026-10-29

### Changed
- The split preview is now **Markdown and mind map side by side** and is also available while a note shows as a mind map (command palette, file menu, ⋯ menu, and the right-click menu on empty canvas): the current tab switches to Markdown and the map opens on the right. Before, it only appeared for notes shown as Markdown.
- Editing in the map only rewrites the lines that changed. The rest of the note stays byte for byte as it was (blank lines, indentation, list markers, trailing spaces, line endings), in mind map notes and `mindmap` code blocks alike. Previously every edit rewrote the whole note in the plugin's format.

### Fixed
- Editing an existing note no longer moves lines that follow a list item into that item, drops trailing double spaces (hard line breaks), or adds blank lines elsewhere in the file.

## [0.24.0] - 2026-10-29

### Added
- Lock editing: a lock button in the toolbar (and the command **Lock / unlock editing**) makes a map view-only; zoom, pan, fold and search still work. Remembered per file in the plugin settings, not in the note.
- Settings **Node spacing** and **Node text size** scale the gaps and node text of every theme, custom themes included.
- Setting **Follow the active note** (off by default): a mind map shown beside the editor switches to the note you open; pinned tabs stay put.

## [0.23.0] - 2026-10-29

### Added
- Setting **Use the file name as the central topic** (off by default): the central topic is always the file name and a note's only H1 becomes a first-level branch. Only the display changes; the file stays the same.
- Setting **Hide the toolbar of embedded maps** (off by default): embedded maps (code blocks and `![[note]]` embeds) show no toolbar in reading view; in editing view it appears only while the mouse is over the map or while you edit it.
- Sync with Markdown side by side briefly highlights the line or node it jumps to.

### Changed
- Clicking **Edit** in the note popover keeps the popover where it is and at the same size; the editor fills it and can still be resized.

### Fixed
- `[[Links]]` in a node's note open when clicked (⌘/Ctrl-click for a new tab) and show a page preview on hover.

## [0.22.0] - 2026-10-28

### Added
- Setting **Template for new mind maps**: pick a note whose content starts every new mind map. `{{title}}`, `{{date}}` and `{{time}}` (also `{{date:YYYY-MM-DD}}`) are filled in like the core Templates plugin, and `mindmap: true` is added to the frontmatter.
- Answer marker 🙈 (new **Recite** group in the marker picker): in recite mode an answer node is covered together with its children, images, notes and callouts included, until you click it. Works for screenshot questions too.

### Fixed
- ⌘Z works right after picking a marker or choosing from a toolbar menu.

## [0.21.1] - 2026-10-28

### Added
- Paste images from the node context menu and the node toolbar's paste button, not only with ⌘V.

### Fixed
- ⌘Z works right after pasting an image.
- The "Open as Markdown" button icon now ships with the plugin, so it shows on Android too.

## [0.21.0] - 2026-10-28

### Added
- Callout fill color: right-click a callout → **Callout color**, stored as `cc=red` (or a hex color).

## [0.20.1] - 2026-10-27

### Fixed
- Ctrl/⌘ + mouse wheel zooms about 1.2× per notch instead of 2.7×; trackpad pinch is unchanged.

## [0.20.0] - 2026-10-27

### Added
- Setting **When opening a map**: with no remembered position, fit the whole map (default) or show the central topic at 100%.
- **Custom markers**: emoji or symbols from the settings form a Custom group in the marker picker, optionally one per node.
- **Sync with Markdown side by side** (off by default): selecting a node scrolls the Markdown to its line; moving the cursor in Markdown selects the matching node.

## [0.19.0] - 2026-10-26

### Added
- Callouts: a short bubble attached to a node, stored as `%%callout "text"%%`. The layout makes room for it, so it never covers nodes or lines. Callouts can be hidden per file, are searchable, exported, and imported from `.xmind`.

## [0.18.1] - 2026-10-26

### Added
- **Copy image** in the context menu of nodes that contain an image.

## [0.18.0] - 2026-10-26

### Added
- Floating topics: double-click or right-click empty space to add one, make a topic floating or attach it back, drag to move or drop onto a node. Stored as `%%float x=… y=…%%`; maps without them lay out exactly as before. XMind floating topics are imported.

### Changed
- The node context menu keeps everyday actions on the first level and groups the rest into Insert, Fold, Boundary, Summary and More submenus.

## [0.17.1] - 2026-10-26

### Added
- Multi-selection moves together: drag any selected node to move the group; Alt+arrows and move/indent commands act on the whole selection.
- Pasting an image while editing a node's text adds it to that node's note.

## [0.17.0] - 2026-10-26

### Added
- Paste or drop images into a note while editing it.
- **Show in Markdown** jumps to the node's line, and switching back selects the node at the cursor.
- Each file remembers its position, zoom and selection (last 50 files).
- Setting **When editing a node**: select all text (default) or put the cursor at the end.

## [0.16.3] - 2026-10-25

### Added
- **Insert parent node** (⌘↵ in the map view, context menu, command): selected siblings are wrapped in one new node.

### Changed
- Note popover: larger by default, resizable from the corner with the size remembered; click an image to view it full-screen.

### Fixed
- Dragging out of the note popover no longer drops into the map.

## [0.16.2] - 2026-10-25

### Added
- Code block name `gogoga-mindmap`, and a setting to leave ```` ```mindmap ```` blocks to other plugins such as Markmind.

### Fixed
- Coexists with Markmind: CSS classes no longer clash.
- No extra border inside Live Preview code blocks; range handles stay out of exports.

## [0.16.1] - 2026-10-25

### Added
- Resize summaries and boundaries: click one to select it and drag the handles at either end, or use extend/shrink in its menu.

## [0.16.0] - 2026-10-25

### Added
- XMind-style editing: delete only a node and keep its children (⌘⌫); setting for left-drag on empty space to select, with right/middle-drag to pan; context menu entries for insert before, expand sub-branches and show next level.
- Node operations are registered as commands, so they can have custom hotkeys. The canvas keeps its built-in keys unless you bind a key to one of this plugin's commands.

## [0.15.2] - 2026-10-24

### Added
- Embeds can point at a node (`![[map#heading]]`, heading paths, `![[map#^block]]`) to show just that branch.
- Mind maps fill their Canvas cards and refit when the card is resized.

## [0.15.1] - 2026-10-23

### Added
- Summary text renders inline Markdown (links with hover preview, bold, …), and the summary width can be dragged.

### Fixed
- Summary text may contain a single `%`, so encoded URLs survive.

## [0.15.0] - 2026-10-22

### Added
- Summaries: a curly brace beside adjacent siblings with a short text, stored as `%%summary=N "text"%%`. Works in every structure, editable in place, exported, and imported from XMind.

### Changed
- Boundary titles are one shade lighter than node text.

## [0.14.1] - 2026-10-22

### Changed
- Number keys fold from the selected node: N levels below it, other branches untouched. On the central topic they still apply to the whole map.

## [0.14.0] - 2026-10-22

### Added
- Recite mode: `==highlights==` become click-to-reveal blanks, and nodes whose children are `[x]` / `[ ]` become quiz questions revealed on click, with a "Multiple" tag. Display only; nothing is written to the file.

## [0.13.3] - 2026-10-22

### Changed
- Boundaries are easier to title: right-click or double-click empty space inside a boundary; the boundary button on a framed node opens a title/remove menu.

### Fixed
- Right-clicking a boundary no longer selects its members.
- The node toolbar hides while a context menu is open, and no longer flashes when a click closes the menu.

## [0.13.2] - 2026-10-22

### Fixed
- The mouse wheel scrolls link suggestions and other canvas menus instead of panning the map.

## [0.13.1] - 2026-10-22

### Changed
- Link suggestions: exact name first, then prefix and substring matches sorted by name (pinyin for Chinese); up to 50 in a scrollable list.

## [0.13.0] - 2026-10-22

### Added
- Embed existing mind maps with `![[note]]` or `![[file.xmind]]`: a read-only preview that follows the file; the open button or a double-click opens it.

## [0.12.2] - 2026-10-21

### Changed
- Code cleanups for the Obsidian plugin review. No visible changes.

## [0.12.1] - 2026-10-21

### Fixed
- Markdown backslash escapes in node text render correctly (`\<td\>` shows as `<td>`).

## [0.12.0] - 2026-10-21

### Changed
- Custom themes use a maximum width instead of a fixed width, so short text keeps its own width, plus an optional per-level width alignment. Old fixed widths are migrated.

### Fixed
- Double-clicking an image really opens the full-size view.
- Clicking inside a node being edited in a code block places the caret again.

## [0.11.1] - 2026-10-21

### Fixed
- Embedded maps keep keyboard focus, including after a write-back.

## [0.11.0] - 2026-10-21

### Added
- Custom themes: start from a built-in theme and style four levels (text, fill or underline, border, width, incoming line), overall lines and spacing, with a live preview and automatic dark colors.

## [0.10.6] - 2026-10-21

### Fixed
- Mobile: the bottom toolbar sits above Obsidian's floating navbar, toolbars scroll when they don't fit, and the node toolbar wraps into two rows.

## [0.10.5] - 2026-10-21

### Added
- Double-click an image to view it full size; double-click elsewhere still edits.

## [0.10.4] - 2026-10-21

### Fixed
- Typing 【【 converts to [[ without a stray 【 when using an input method; typing a bracket around a selection wraps it.

## [0.10.3] - 2026-10-21

### Fixed
- Dropping nodes in big maps lands where expected.
- The selected node stays in view when moving with the keyboard or adding nodes.

## [0.10.2] - 2026-10-21

### Added
- Drop behind a node to make it a child; the map auto-scrolls near the edge while dragging.

### Changed
- Up/down navigation goes to siblings first.

## [0.10.1] - 2026-10-20

### Added
- Rounded or sharp corners for right-angled lines (`mindmap-edge-corner`).

## [0.10.0] - 2026-10-20

### Added
- Line style menu: follow theme, curved, right-angled or straight, plus dashed; stored per note in the frontmatter.
- Link suggestions while editing a node: typing `[[` (or `【【`) lists vault files.
- Examples folder with a guide map, an embed example, sample maps and an `.xmind` file.

## [0.9.1] - 2026-10-19

### Fixed
- `$$…$$` in labels renders as display-style math instead of leaving stray dollar signs.

## [0.9.0] - 2026-10-19

### Added
- Digit keys fold the map to N levels; zoom to the selected branch (⌘⇧0).
- Pin main topics to the left or right side in the mind map structure.
- Commands for fold, show-to-level, zoom-to-branch and boundary, so they can have hotkeys.

## [0.8.1] - 2026-10-18

### Added
- Funding link.

## [0.8.0] - 2026-10-18

### Added
- Drag a node's edge to set its width (`%%w=N%%`); double-click the edge to reset.

## [0.7.1] - 2026-10-18

### Added
- A header button switches a mind map note back from Markdown, and the file menu follows the current view.

## [0.7.0] - 2026-10-18

### Added
- Split preview that follows the editor.
- Setting to switch views without writing `mindmap: true`.

## [0.6.1] - 2026-10-16

### Added
- Boundary button in the node toolbar, and ⌘⇧B to toggle a boundary.

## [0.6.0] - 2026-10-16

### Added
- Boundaries (`%%box%%`) around a node or adjacent siblings.
- XMind import keeps boundaries and reports content it can't bring over.

## [0.5.0] - 2026-10-16

### Added
- Setting: the mouse wheel zooms instead of panning (Shift + wheel pans).

## [0.4.1] - 2026-10-16

### Fixed
- Switching a mind map back to Markdown opens in editing mode and keeps the reading/editing toggle.

## [0.4.0] - 2026-10-15

### Added
- English and Simplified Chinese interface, following Obsidian's language.

## [0.3.2] - 2026-10-15

### Changed
- README demo GIF and screenshots.

## [0.3.1] - 2026-10-14

### Changed
- Adjustments for the Obsidian community plugin review.

## [0.3.0] - 2026-10-14

First public release.

### Added
- XMind-style mind map view for Markdown notes, with two-way sync between headings/lists and the map.
- Logic chart, mind map, org chart and tree structures; seven built-in themes.
- Editable ```` ```mindmap ```` code blocks inside ordinary notes.
- Search, subtree copy and paste, fold to level, multi-line text, touch support.
- Link nodes to notes (⌘K) with hover preview; bare URLs become links.
- LaTeX math and images in nodes, resizable by dragging; `<iframe>` embeds such as videos.
- Outline panel synced with the canvas.
- Context menu, focus on a branch, markers, task checkboxes, tags, drag-and-drop and paste.
- Export as PNG or SVG, with math and images embedded.
- Configurable toolbar position; file list icon with an icon picker; "New mind map" in the folder menu and Notebook Navigator.

[Unreleased]: https://github.com/JackWeiGogoga/gogoga-mindmap/compare/0.46.0...HEAD
[0.46.0]: https://github.com/JackWeiGogoga/gogoga-mindmap/compare/0.45.0...0.46.0
[0.45.0]: https://github.com/JackWeiGogoga/gogoga-mindmap/compare/0.44.0...0.45.0
[0.44.0]: https://github.com/JackWeiGogoga/gogoga-mindmap/compare/0.43.0...0.44.0
[0.43.0]: https://github.com/JackWeiGogoga/gogoga-mindmap/compare/0.42.0...0.43.0
[0.42.0]: https://github.com/JackWeiGogoga/gogoga-mindmap/compare/0.41.0...0.42.0
[0.41.0]: https://github.com/JackWeiGogoga/gogoga-mindmap/compare/0.40.0...0.41.0
[0.40.0]: https://github.com/JackWeiGogoga/gogoga-mindmap/compare/0.39.0...0.40.0
[0.39.0]: https://github.com/JackWeiGogoga/gogoga-mindmap/compare/0.38.0...0.39.0
[0.38.0]: https://github.com/JackWeiGogoga/gogoga-mindmap/compare/0.37.0...0.38.0
[0.37.0]: https://github.com/JackWeiGogoga/gogoga-mindmap/compare/0.36.0...0.37.0
[0.36.0]: https://github.com/JackWeiGogoga/gogoga-mindmap/compare/0.35.0...0.36.0
[0.35.0]: https://github.com/JackWeiGogoga/gogoga-mindmap/compare/0.34.0...0.35.0
[0.34.0]: https://github.com/JackWeiGogoga/gogoga-mindmap/compare/0.33.2...0.34.0
[0.33.2]: https://github.com/JackWeiGogoga/gogoga-mindmap/compare/0.33.1...0.33.2
[0.33.1]: https://github.com/JackWeiGogoga/gogoga-mindmap/compare/0.33.0...0.33.1
[0.33.0]: https://github.com/JackWeiGogoga/gogoga-mindmap/compare/0.32.0...0.33.0
[0.32.0]: https://github.com/JackWeiGogoga/gogoga-mindmap/compare/0.31.1...0.32.0
[0.31.1]: https://github.com/JackWeiGogoga/gogoga-mindmap/compare/0.31.0...0.31.1
[0.31.0]: https://github.com/JackWeiGogoga/gogoga-mindmap/compare/0.30.0...0.31.0
[0.30.0]: https://github.com/JackWeiGogoga/gogoga-mindmap/compare/0.29.0...0.30.0
[0.29.0]: https://github.com/JackWeiGogoga/gogoga-mindmap/compare/0.28.2...0.29.0
[0.28.2]: https://github.com/JackWeiGogoga/gogoga-mindmap/compare/0.28.1...0.28.2
[0.28.1]: https://github.com/JackWeiGogoga/gogoga-mindmap/compare/0.28.0...0.28.1
[0.28.0]: https://github.com/JackWeiGogoga/gogoga-mindmap/compare/0.27.0...0.28.0
[0.27.0]: https://github.com/JackWeiGogoga/gogoga-mindmap/compare/0.26.0...0.27.0
[0.26.0]: https://github.com/JackWeiGogoga/gogoga-mindmap/compare/0.25.1...0.26.0
[0.25.1]: https://github.com/JackWeiGogoga/gogoga-mindmap/compare/0.25.0...0.25.1
[0.25.0]: https://github.com/JackWeiGogoga/gogoga-mindmap/compare/0.24.0...0.25.0
[0.24.0]: https://github.com/JackWeiGogoga/gogoga-mindmap/compare/0.23.0...0.24.0
[0.23.0]: https://github.com/JackWeiGogoga/gogoga-mindmap/compare/0.22.0...0.23.0
[0.22.0]: https://github.com/JackWeiGogoga/gogoga-mindmap/compare/0.21.1...0.22.0
[0.21.1]: https://github.com/JackWeiGogoga/gogoga-mindmap/compare/0.21.0...0.21.1
[0.21.0]: https://github.com/JackWeiGogoga/gogoga-mindmap/compare/0.20.1...0.21.0
[0.20.1]: https://github.com/JackWeiGogoga/gogoga-mindmap/compare/0.20.0...0.20.1
[0.20.0]: https://github.com/JackWeiGogoga/gogoga-mindmap/compare/0.19.0...0.20.0
[0.19.0]: https://github.com/JackWeiGogoga/gogoga-mindmap/compare/0.18.1...0.19.0
[0.18.1]: https://github.com/JackWeiGogoga/gogoga-mindmap/compare/0.18.0...0.18.1
[0.18.0]: https://github.com/JackWeiGogoga/gogoga-mindmap/compare/0.17.1...0.18.0
[0.17.1]: https://github.com/JackWeiGogoga/gogoga-mindmap/compare/0.17.0...0.17.1
[0.17.0]: https://github.com/JackWeiGogoga/gogoga-mindmap/compare/0.16.3...0.17.0
[0.16.3]: https://github.com/JackWeiGogoga/gogoga-mindmap/compare/0.16.2...0.16.3
[0.16.2]: https://github.com/JackWeiGogoga/gogoga-mindmap/compare/0.16.1...0.16.2
[0.16.1]: https://github.com/JackWeiGogoga/gogoga-mindmap/compare/0.16.0...0.16.1
[0.16.0]: https://github.com/JackWeiGogoga/gogoga-mindmap/compare/0.15.2...0.16.0
[0.15.2]: https://github.com/JackWeiGogoga/gogoga-mindmap/compare/0.15.1...0.15.2
[0.15.1]: https://github.com/JackWeiGogoga/gogoga-mindmap/compare/0.15.0...0.15.1
[0.15.0]: https://github.com/JackWeiGogoga/gogoga-mindmap/compare/0.14.1...0.15.0
[0.14.1]: https://github.com/JackWeiGogoga/gogoga-mindmap/compare/0.14.0...0.14.1
[0.14.0]: https://github.com/JackWeiGogoga/gogoga-mindmap/compare/0.13.3...0.14.0
[0.13.3]: https://github.com/JackWeiGogoga/gogoga-mindmap/compare/0.13.2...0.13.3
[0.13.2]: https://github.com/JackWeiGogoga/gogoga-mindmap/compare/0.13.1...0.13.2
[0.13.1]: https://github.com/JackWeiGogoga/gogoga-mindmap/compare/0.13.0...0.13.1
[0.13.0]: https://github.com/JackWeiGogoga/gogoga-mindmap/compare/0.12.2...0.13.0
[0.12.2]: https://github.com/JackWeiGogoga/gogoga-mindmap/compare/0.12.1...0.12.2
[0.12.1]: https://github.com/JackWeiGogoga/gogoga-mindmap/compare/0.12.0...0.12.1
[0.12.0]: https://github.com/JackWeiGogoga/gogoga-mindmap/compare/0.11.1...0.12.0
[0.11.1]: https://github.com/JackWeiGogoga/gogoga-mindmap/compare/0.11.0...0.11.1
[0.11.0]: https://github.com/JackWeiGogoga/gogoga-mindmap/compare/0.10.6...0.11.0
[0.10.6]: https://github.com/JackWeiGogoga/gogoga-mindmap/compare/0.10.5...0.10.6
[0.10.5]: https://github.com/JackWeiGogoga/gogoga-mindmap/compare/0.10.4...0.10.5
[0.10.4]: https://github.com/JackWeiGogoga/gogoga-mindmap/compare/0.10.3...0.10.4
[0.10.3]: https://github.com/JackWeiGogoga/gogoga-mindmap/compare/0.10.2...0.10.3
[0.10.2]: https://github.com/JackWeiGogoga/gogoga-mindmap/compare/0.10.1...0.10.2
[0.10.1]: https://github.com/JackWeiGogoga/gogoga-mindmap/compare/0.10.0...0.10.1
[0.10.0]: https://github.com/JackWeiGogoga/gogoga-mindmap/compare/0.9.1...0.10.0
[0.9.1]: https://github.com/JackWeiGogoga/gogoga-mindmap/compare/0.9.0...0.9.1
[0.9.0]: https://github.com/JackWeiGogoga/gogoga-mindmap/compare/0.8.1...0.9.0
[0.8.1]: https://github.com/JackWeiGogoga/gogoga-mindmap/compare/0.8.0...0.8.1
[0.8.0]: https://github.com/JackWeiGogoga/gogoga-mindmap/compare/0.7.1...0.8.0
[0.7.1]: https://github.com/JackWeiGogoga/gogoga-mindmap/compare/0.7.0...0.7.1
[0.7.0]: https://github.com/JackWeiGogoga/gogoga-mindmap/compare/0.6.1...0.7.0
[0.6.1]: https://github.com/JackWeiGogoga/gogoga-mindmap/compare/0.6.0...0.6.1
[0.6.0]: https://github.com/JackWeiGogoga/gogoga-mindmap/compare/0.5.0...0.6.0
[0.5.0]: https://github.com/JackWeiGogoga/gogoga-mindmap/compare/0.4.1...0.5.0
[0.4.1]: https://github.com/JackWeiGogoga/gogoga-mindmap/compare/0.4.0...0.4.1
[0.4.0]: https://github.com/JackWeiGogoga/gogoga-mindmap/compare/0.3.2...0.4.0
[0.3.2]: https://github.com/JackWeiGogoga/gogoga-mindmap/compare/0.3.1...0.3.2
[0.3.1]: https://github.com/JackWeiGogoga/gogoga-mindmap/compare/0.3.0...0.3.1
[0.3.0]: https://github.com/JackWeiGogoga/gogoga-mindmap/releases/tag/0.3.0
