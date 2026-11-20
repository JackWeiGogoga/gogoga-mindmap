# Changelog

All notable changes to gogoga Mind Map are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/). 中文版见 [CHANGELOG.zh-CN.md](CHANGELOG.zh-CN.md).

## [Unreleased]

## [0.90.1] - 2026-11-20

### Fixed
- On phones and tablets, relationship lines couldn't be deleted (reported on Xiaohongshu): Delete needs a keyboard and long-pressing the thin line did nothing. Tapping a line now selects it with a small toolbar above it (Edit label, Delete); long-pressing a line opens its menu; and the line is easier to hit with a finger.
- On Android with a hardware keyboard, Shift+Enter while editing a node finished the edit instead of starting a new line (reported in the user group). It now inserts a line break, as on desktop.
- A colored span or highlight that spans lines (`<span style="color:…">a<br>b</span>`) showed its HTML tags while editing; in node tables too (from gogoga Table 0.23.1).
- Node tables: on phones, tapping a row or column handle no longer brings up the keyboard over the menu, and long menus stay below the status bar (from gogoga Table 0.23.1).
- With some themes, clicking into a node table cell to edit it changed the text size (reported in the user group): the theme's editor font size applied to the cell editor. Editing now uses the same size, font and line height as viewing.

## [0.90.0] - 2026-11-20

### Added
- Node tables support gogoga Table's encrypted columns and cells: they show ••••••, and with gogoga Table 0.23.0 or later installed you can unlock them with its master password to view, copy and edit them (the editor shows the plain text, which is encrypted when you press Enter). Both plugins share the master password and lock together. Without gogoga Table, encrypted cells only show •••••• and can't be unlocked, and Encrypted isn't offered as a column type.

## [0.89.3] - 2026-11-20

### Added
- When a node's note has a table and gogoga Table is older than 0.22.1, editing the note shows a reminder to update gogoga Table (once per launch). The format bar in note tables needs both plugins updated; with only the mind map updated, highlighting in note tables still seemed broken (reported by a user running gogoga Table 0.19.2).

### Fixed
- Removing a checkbox written the old way (`⭐ [ ] 🌟Example`, which 0.88 and earlier put after the markers) left a space between the marker and the emoji after it (`⭐ 🌟Example`). Both spaces were inserted back when the checkbox was added; now the marker joins an emoji or symbol directly again (`⭐🌟Example`) and keeps one space before text (#46, reported by Leolo1).

## [0.89.2] - 2026-11-19

### Fixed
- With gogoga Table installed, selecting text in a table cell while editing a note didn't show the format bar unless that plugin's "Format bar when selecting text in a cell" setting was on (reported by a user: highlighting worked in the note's text but not in its tables). It now always shows there, like for the rest of the note (needs gogoga Table 0.22.1 or later).
- "Task checkbox" on a node that starts with markers (⭐, 🙈 and the like) put the `[ ]` after the markers (`⭐ [ ] task`), which Obsidian doesn't treat as a task (#46, reported by Leolo1). It now goes in front of all markers (`[ ] ⭐ task`), and the node shows the checkbox first. Adding a marker to a task keeps the checkbox in front too (before, it moved behind the new marker). Notes already written the old way (`⭐ [ ] task`) still work as before: their checkbox shows, checks and unchecks in place.

## [0.89.1] - 2026-11-19

### Fixed
- In tables inside nodes, clicking a + button to add a row or column while you were still typing in a cell lost what you had just typed. The cell is now saved first.

## [0.89.0] - 2026-11-19

### Changed
- The eraser button on the format bar now clears all formatting, like "Clear formatting" in Obsidian's right-click menu (#45, requested by caomei2015): bold, italic, strikethrough, underline, highlight, text color and highlighter color on the selected text all go at once. Before, it only removed colors, so text that mixed bold and italic had to be cleared one format at a time. If you select only part of a formatted run, just that part loses its formatting and the text on either side keeps it. Inline code and links are left alone. This applies to the format bar in node editing, notes, and tables in nodes, and to the command, now called "Clear formatting" (it was "Clear text and highlighter colors").

### Fixed
- Dragging the mouse to select text in a node that included the `**` around bold text made the text flicker, and the selection could end up short of where you let go (#45). The `**` hid as soon as the whole bold run was selected, which shifted the text left, so the selection moved back, the `**` showed again, and so on. While you hold the mouse button and drag, the markers now stay as they were, and they update once you let go.

## [0.88.3] - 2026-11-19

### Fixed
- Selecting text inside a table cell while editing a note didn't show the format bar (reported by a user, who thought long cell text was hiding it; it didn't show for short cells either). Obsidian edits each table cell in a small editor of its own, which the note editor's format bar didn't reach. It now shows for table cells in the note editor too, next to the selected text even when the cell is taller than the note. In regular notes nothing changes: the format bar in table cells still follows the "Format bar in notes" setting.
- Tables in notes used Obsidian's global table text size, which is larger than note text (15px in a 13px note), and some themes set a different table size for Reading view and the editor, so the text size changed when you double-clicked a note to edit it (reported by the same user). Table text in notes now follows the note's font size (at the same ratio Obsidian uses for tables in notes), and stays the same when viewing and editing whatever the theme sets.
- In tables inside mind map nodes, the format bar for a cell taller than the window could end up off screen. It now sits next to the selected text, within the visible part of the cell.

## [0.88.2] - 2026-11-19

### Fixed
- Switching a note in Reading view to the mind map, after scrolling down a while, selected the item at the very top edge of the screen (often barely visible) instead of the one in the middle; switching back could then make Reading view jump. It now picks the item in the middle of the screen.
- Switching back from the mind map to Reading view sometimes didn't scroll to the node you selected in the mind map (or scrolled and then jumped back), depending on how fast the note was laid out. It now waits for Reading view to restore your previous position before checking whether the node is visible.

## [0.88.1] - 2026-11-18

### Fixed
- Tables in notes with a lot of text didn't fit the note (reported by a user, after 0.87.0): the table was as wide as its longest line, so long text ran off to the side and dragging the note narrower or wider didn't change it. Tables in the note popover, expanded note cards and the note editor (when gogoga Table is installed) now fit the note's width like Obsidian's own tables, wrapping long text and following the note as you resize it. A table with too many columns to fit still scrolls sideways.
- Double-clicking a note to edit it (in the note popover or an expanded note card) moved the text and lost your place (reported by the same user): the editor used a larger font and wider margins than the note you were reading, and put the cursor at the end, so in a long note you had to find your spot again. Now the cursor lands on the word you double-clicked, that line stays where it was on screen, and the editor uses the same font size, line spacing and margins as the note (it leaves extra room on the left only when the note has a table, for the table's controls). This applies to the plain text box too.

## [0.88.0] - 2026-11-18

### Added
- "Open the user guide" command: puts the plugin's user guide, and the code block example it links to, in a "Mind Map examples" folder at the vault root and opens the guide as a mind map (the notes are in Chinese). If the vault already has a note by that name (say you copied the `examples/` folder), that note opens instead; nothing is overwritten or created twice. Before, these examples were only in the GitHub repository, out of sight for anyone installing from Community plugins.

## [0.87.2] - 2026-11-18

### Changed
- Styles no longer use the CSS `:has()` selector, which the Obsidian plugin review flags for performance. The few places that used it (strikethrough on completed tasks, underline on colored link text, hiding the format bar and keeping the breadcrumb visible in Zen mode, the number box next to sliders in the custom theme editor, Reading view tables) now get class names from the plugin instead, and the review's warnings about a system font name and column gaps are gone too. Nothing looks or works differently.

## [0.87.1] - 2026-11-18

### Fixed
- Pasting a copied node while editing another node's text added a leading `- ` (reported by Alien). Now only the text of the copied node goes in, without the list marker, mind map markers or child nodes; several copied nodes go in one per line. A single list line copied from elsewhere (`- text`) loses its marker too, and other text pastes as before. Pasting while not editing still adds the nodes as children with their structure.

## [0.87.0] - 2026-11-18

### Added
- Edit notes as they look (requested by a user): notes are now edited in Obsidian's own Live Preview editor, the same as writing in a note, so lists, headings, images, links, highlights and colors show as formatted while you type. With gogoga Table installed, tables in notes show their merges and colors and can be edited cell by cell. Changes save as you type; Esc, Mod+Enter or clicking outside closes the editor. Dialogs such as the rows-and-columns picker from inserting a gogoga table with the / menu, or the command palette, no longer close the note, and you can keep writing after them. Pasted or dropped images are still saved as attachments. The setting "Edit notes as they look (WYSIWYG)" is on by default; turn it off to get the plain text box back ("Preview notes while editing" applies only to the plain text box). If a future Obsidian version changes its internals and the editor can't be created, the plain text box is used automatically.
- Format text in notes (requested by a user who keeps large notes for annotation and memorization instead of splitting them into child nodes): selecting text while editing a note shows the format bar (always in notes, regardless of the format bar settings), so you can make it bold, color it, highlight it or underline it. Mod+B, Mod+I, Mod+U, Mod+Shift+H (highlight) and Mod+Shift+X (strikethrough) work too, and Mod+Z undoes. Only the selected text changes; a selection across lines is wrapped line by line, leaving list, quote and heading markers out, and nothing happens without a selection. These shortcuts used to format the node text while you were editing a note; they now format the note.
- Recite mode covers notes too: `==highlights==` in expanded note cards and in the note popover are hidden, click to reveal and click again to hide.

### Fixed
- Tables in notes didn't show merged cells (reported by a user). Tables in the note popover and in expanded note cards are now drawn with the same component as node tables, so they look like node tables and show merges, colors and widths. Tables indented inside lists are still rendered by Obsidian, since taking them out would break the list.
- On Windows and Linux, the Exit Zen mode button in the top-right corner overlapped the window's minimize, maximize and close buttons (reported by 德米安). It now moves left of them.

## [0.86.0] - 2026-11-18

### Changed
- **Copy node link with alias** under More in the right-click menu (and as a command) copies `[[note#^id|node text]]`, so the pasted link shows the text (reported by zhiqiang).
- The setting **Jump to the note if it's already open** now also covers links clicked in Markdown notes: Markdown to mind map and Markdown to Markdown, block and heading links alike, instead of opening another copy in the current tab (reported by zhiqiang).
- The flash on the line you jump to in Markdown uses the accent color with a bar on the left; it used the highlight color and was invisible on highlighted lines (reported by zhiqiang).
- Switching from Reading view to the mind map selects the node of the text you selected, or else the line you last clicked (if it's still on screen), and only then the line in the middle of the screen; it used to always take the middle line (reported by zhiqiang).
- Nodes selected from elsewhere (split sync, following a link, switching from Markdown) no longer pop up the node toolbar; it appears once you click or move with the keyboard in the map, so a map you only read in a split isn't covered by it (reported by zhiqiang).

## [0.85.0] - 2026-11-18

### Added
- Zen mode: only the mind map stays on screen. The toolbar, node toolbar, format bar and outline panel are hidden, and Obsidian's sidebars, tab bar and status bar are collapsed too, restored on exit (a setting limits it to the mind map's own toolbars). Keyboard and right-click menus work as usual; while focused on a branch the breadcrumb appears on hover. Turn it on from the **Toggle zen mode** command (bind a hotkey if you like), the quick settings panel or the right-click menu on the blank canvas; moving the mouse shows **Exit zen mode** at the top right, and Esc exits too (after deselecting and leaving focus). It applies to the current tab only, isn't remembered, and turns off when you switch tabs (#43).

## [0.84.0] - 2026-11-18

### Added
- When focused on a branch, **‹ ›** buttons after the breadcrumb go to the previous or next sibling branch, like flipping slides; PageUp / PageDown work too (#43).

### Changed
- Switching branches while already focused (breadcrumb, ‹ ›, PageUp / PageDown) keeps the zoom and puts the new topic where the old one was; entering focus from the whole map still fits the view (#43).
- The sibling list in the breadcrumb shows a color dot for colored topics, like the outline panel (#43).
- New icons for **Add child** and **Add sibling** in the node toolbar: boxes are topics and the dashed one is the topic being added, to the right for a child and below for a sibling (#44).

### Fixed
- With many sibling topics, the breadcrumb's sibling list squeezed its rows and hid the ones at the bottom; rows now keep their height and the list scrolls (#42, #43).

## [0.83.0] - 2026-11-17

### Added
- Spaced review, part two: review right in the mind map (like MarginNote's "recall first, then reveal"). The **Review N** toolbar button and **More ▸ Spaced review ▸ Review this branch** now review in the map instead of switching to the review tab: due questions are selected one by one, moved to the middle and outlined, covered the same way as recite mode. **Show answer** appears under the node and turns into **Again / Hard / Good / Easy** with the next interval above each. Keys match the review tab: Space shows the answer and then means Good, 1–4 answer, ⌘Z undoes and Esc exits. A bar at the top shows the new, learning and due cards left, and **Review in tab** continues in the review tab. Questions inside folded branches are unfolded just for the review and folded back afterwards, without changing the file; schedules are shared with the review tab. Clicking the covered part of the current question (a highlight, the hidden answer or the choice tag) also shows the answer.

### Changed
- Choice questions in maps or branches added to spaced review no longer show task progress ("2/4"): their `[x]` marks are answers, not to-dos.

### Fixed
- Clicking a global search result now selects the matching node in the mind map (it often didn't before, reported by zhiqiang); nodes inside folded branches are unfolded in view.

## [0.82.0] - 2026-11-17

### Added
- Spaced review (suggested by 踏雪 in the user group: review your maps the Anki way): questions written for recite mode become flashcards, scheduled with FSRS, the algorithm Anki uses, with Anki's review screen, buttons and shortcuts.
  - Right-click the central topic or a branch → **More ▸ Spaced review ▸ Add the whole map to review / Add only this branch to review**. A whole map can also be added with the command **Add this mind map to review**, or by right-clicking the note in the file list → **Add to spaced review** (maps already in review offer **Review this map** and **Remove from spaced review** there). Each kind of question becomes a card: `==highlights==` in a node are cloze cards, a node whose children are `[x]` / `[ ]` is a multiple-choice card, and a 🙈 node is a question-and-answer card with its parent as the front. Adding writes a deck id to the note's frontmatter (`mindmap-review`) and a `%%rv=…%%` to each question's node; a branch added on its own gets `%%review%%`. Reviewing never changes the note again: schedules are kept in the plugin folder under `review/`, one file per map.
  - The review tab (ribbon icon, command **Open review**, or the status bar) lists decks by folder with new (blue), learning (red) and due (green) counts; click a deck for its overview and **Study now**. While reviewing, the card is centered with where the question sits in the map in small text above, and the three numbers at the bottom are the new, learning and due cards left (hover for an explanation). Space shows the answer; then four buttons, **Again / Hard / Good / Easy**, show when the card comes back. 1–4 answer and Space means Good; ⌘Z undoes, E jumps to the question in the map, `-` buries the card until tomorrow, `@` suspends it (resume it from the node's right-click menu), and I shows card info. On phones the buttons fill the bottom and tapping the card shows the answer.
  - Maps in review get a **Review N** toolbar button, the status bar shows how many cards are due across the vault today, and nodes with cards due today get a small green dot. **More ▸ Spaced review ▸ Review this branch** on a branch's right-click menu studies just that branch.
  - New **Spaced review** settings page: new cards per day (20), maximum reviews per day (200), learning steps (1m 10m), relearning steps (10m), desired retention (0.9) and when the next day starts (4 am), with Anki's defaults, plus switches for the green dots, the question's location and a timer.
  - Removing a map from review only removes the frontmatter key and `%%review%%`; the `%%rv%%` markers and schedules stay, so adding it back picks up where you left off.

### Fixed
- With the Outliner plugin, blank lines the mind map inserts inside a list split the list, so Outliner's move up/down shortcuts couldn't cross them (reported in the chat group). The mind map leaves a blank line after blockquote notes (with **Write notes under list items as blockquotes** on), after notes wrapped in `> [!note]`, and before node tables; that line is now written as whitespace with the same indent as the note. Markdown still treats it as a blank line, so nothing looks different, and Outliner no longer splits the list there. Blank lines already in your files stay as they are until you edit that note in the mind map.

## [0.81.0] - 2026-11-17

### Added
- Tables in nodes (synced from gogoga Table): the column menu's **Column type** offers Status (single select), Multi-select tags, Date, Number and Progress bar. Date cells open a calendar and can be written as `2026-11-17`, `2026/11/17` or a daily note link; number columns apply thousands separators, percent, currency and decimals, including calculated results and the total row; progress columns draw `60%` or `3/5` as a bar; multi-select columns draw comma-separated values as colored tags. Cells stay plain text.

## [0.80.0] - 2026-11-17

### Added
- Mixed structures, continued: opening an `.xmind` file now uses the structure set in XMind for the whole map and for each branch (logic chart, org chart, tree, timeline, fishbone). Converting it to a note writes the map's structure into the frontmatter and each branch's as `%%layout=…%%`. XMind directions the mind map doesn't have (logic chart to the left, org chart upward, tree to the left) use the closest one; a horizontal timeline without a side becomes the alternating one. Structures it doesn't have, such as spreadsheet, follow the parent.
- Floating topics can have their own structure too (right-click → **More ▸ Branch structure**), also when the central topic is a timeline or fishbone.

## [0.79.0] - 2026-11-17

### Added
- Mixed structures (suggested in a Bilibili message): a branch can have its own structure, so one map can hold, say, a timeline, a fishbone and an org chart under different topics. Right-click a topic → **More ▸ Branch structure** and pick Logic chart, Org chart, Tree, a horizontal or vertical Timeline, or Fishbone; **Same as parent** turns it off. The branch is laid out as a block in its own structure, joined to its parent with the parent's kind of line; a fishbone branch always faces its head toward the parent, and a logic chart branch on the left half of a balanced map grows to the left. Arrow keys follow the branch's own structure inside it and the parent's outside it, the fold button sits where the branch's children grow, and topics can be dragged onto a fishbone branch's spine. Boxes and summaries can wrap such branches. Saved as `%%layout=…%%` on the topic (hidden in Obsidian's reading view); notes without it are unchanged. Main topics of a timeline or fishbone, the central topic, summary topics and floating topics can't have their own structure yet; a horizontal timeline isn't offered on the left half of a balanced map.

### Fixed
- In the right-click menu's **More**, once a submenu such as **Split into children** was open, moving to another item with a submenu (**Branch structure**, **Text color**) kept showing the old one, as if the menu were stuck. This came from how Obsidian handles a submenu inside a submenu; the mind map's own menus now switch normally.

## [0.78.4] - 2026-11-17

### Changed
- Tables in topics (synced from Table 0.17.5): while editing a cell, once the cursor is at the edge of the cell, the arrow key saves it and moves to the next cell; in the middle of the text it still moves the cursor. A column you've dragged can now be as narrow as 40px (it used to stay at least 80px).

## [0.78.3] - 2026-11-17

### Changed
- Tables in topics: the shared table code is synced with gogoga Table 0.17.4 (its fixes for page-wide tables and the Live Preview wrapper). Tables in topics look and work the same as before.

## [0.78.2] - 2026-11-16

### Fixed
- Tables in topics: middle-click autoscroll is no longer blocked (synced from Table).

## [0.78.1] - 2026-11-16

### Changed
- Tables in topics: when total-row columns mix kinds, the row is called "Summary" and each number gets a small label (Sum, Max, Count…) (synced from Table).

## [0.78.0] - 2026-11-16

### Added
- Rename the note with the central topic: when the central topic is the level-1 heading and matches the file name (as in a new "Untitled mind map"), renaming the central topic renames the note too, and undo renames it back. If the new name can't be a file name or is taken, the heading still changes and a notice explains why the note kept its name. Once they differ, they're left alone. On by default; can be turned off in settings.
- Embed another mind map in a topic (suggested on Xiaohongshu): `![[Another map]]` or `![[File.xmind]]` in a topic used to show just the name; it now shows a small read-only preview that follows the map as it changes. 320×200 by default; select the topic and drag the corner handle to resize it (saved as `![[Map|480x300]]`, double-click the handle to reset), or write `![[Map|400]]` to set just the width. Clicking the preview is the same as clicking the topic (select, drag); double-click it or click **Activate** to pan, zoom and fold inside it (only in the preview, the map itself doesn't change), click outside or press Esc to leave, **Fit** to see the whole map again, and **Open** to open that map. Maps embedded inside the preview stay as text; exported images show a card with the map's name instead of the preview.

### Fixed
- Creating a new mind map while another map was open (panned or zoomed) in the same tab reused that map's position and zoom, so the new map could land out of sight and look blank. A map with no remembered viewport now opens fitted to the view.

## [0.77.0] - 2026-11-16

### Added
- While focusing on a branch, the › in the breadcrumb is clickable (#42): it lists every topic at that level with the current one checked, and picking one focuses on it right away, so you can jump to a sibling, a parent or a parent's sibling without going back to the whole map first. With the toolbar at the top (breadcrumb at the bottom) the list opens upward.
- Tables in topics can have calculated columns: column menu → **Make calculated column…** and write a formula with column names (e.g. `{Price} * {Qty}`); every row is calculated (synced from Table).

### Fixed
- Tables in topics: the + above and to the left of a table couldn't be clicked (crossing the small gap to it made it stop taking clicks); now it can (synced from Table).
- With glass-style themes such as OnePage, floating surfaces (topic menus, the note popover, the floating toolbar) were see-through and topic text showed behind them. They now sit on a solid layer, blurred like Obsidian's own menus; opaque themes look the same as before.
- Tables in topics: the header row can be deleted — right-click a header cell → **Delete header row (the next row becomes the header)** (synced from Table).

## [0.76.0] - 2026-11-16

### Added
- Fishbone diagrams: two new structures, **Fishbone (head on the right)** and **Fishbone (head on the left)**, in the structure menu. The central topic is the head; main topics sit at the ends of slanted bones along the spine, alternating above and below with the first one nearest the head; second-level topics branch off a bone horizontally (with underline themes the text sits on the bone), and deeper levels hang below them, indented. Arrow keys move along the spine, dragging a main topic onto the spine between two bones reorders it, and folding, notes, callouts, boxes and summaries inside a branch, and export all work. The note itself doesn't change; `mindmap-structure: fishbone-right` is written to its properties like other structures.

## [0.75.1] - 2026-11-16

### Fixed
- A highlighter color inside a callout broke the callout: its quotes were turned into curly quotes when saved. It's now saved like text colors and comes back intact.
- Frontmatter options with a `# comment` after the value (`mindmap-structure: mindmap   # …`, as in the README) were ignored. The comment is now dropped, as in YAML.

## [0.75.0] - 2026-11-16

### Added
- Task progress: turn on "Task progress" under Settings → Open and display (off by default) and the topic right above a checklist (not a task itself, with tasks as children) shows how many tasks below it are done, as a percentage (20%), done / total (1/5) or both. Every task connected below counts, sub-tasks included; tasks under a plain topic in between count toward that topic instead. It updates as you tick boxes, stays visible when the branch is folded and is included in image export. "Task progress position" puts it after the text or on its own line below. It's only displayed, nothing is written to your file, and it's hidden in recite mode, where those topics are multiple-choice questions.

### Changed
- Shift-click selects a range: click a topic, then Shift-click a sibling, and everything between them is selected; Shift-click another sibling to change the range. Shift-clicking a topic that isn't a sibling still adds it. To pick siblings one by one, use ⌘ / Ctrl-click (Shift-click used to add one at a time).

### Fixed
- Switching the same tab between Markdown and mind map no longer jumps around or loses your place. Markdown comes back the way you left it: reading view stays reading view, with the same scroll position and cursor. The map selects the topic you were looking at (the cursor line in editing view, or the middle of the screen when the cursor is scrolled away or you're in reading view), and going back to Markdown goes to the selected topic (or the one in the middle of the map). If that spot is already on screen nothing moves, and the zoom is left alone, so switching back and forth keeps both sides still.

## [0.74.0] - 2026-11-15

### Added
- "Edit in a large window" for mind maps in code blocks (#41): a button next to the pencil on the embedded map's toolbar opens the map in a dialog that fills the Obsidian window, with the full toolbar and the mouse wheel panning right away. Changes are written back to the code block as you go and share its undo history; close the dialog (× or click outside) and you're back in the note. Esc only leaves the topic you're typing in, it doesn't close the dialog, and F2, ⌘B / ⌘I stay inside the map instead of renaming the file or formatting the note behind it. If you chose a custom toolbar for embedded maps, the button is in its list, off by default.
- Quick settings (the last toolbar button) now have "Show floating toolbar when a topic is selected", so you can turn that row of tools off when it covers things on a small screen; on phones and tablets they also have "Fold buttons on touch screens".
- Topics with a callout have a "Callout" submenu in their right-click menu: edit, remove and the callout's color. The color used to be reachable only by right-clicking the bubble itself.

### Fixed
- Embedded maps no longer drift out of their frame (#41): panning keeps at least half of the map inside, so scrolling can't leave you looking at empty space.
- Mind maps in code blocks stay centered: until you pan or zoom one yourself, it fits itself again whenever its frame changes size (the frame growing to fit the map, reading view finishing its layout, the pane getting wider or narrower), so it no longer sits off to one side with the toolbar over it. Switching between reading view and live preview fits it again instead of reusing a position from the other view; positions you set by panning or zooming are kept, and "Fit" goes back to fitting automatically.
- Rainbow theme: in horizontal timelines, tree maps and org charts, the line under a topic ran through the middle of its text (or along its top edge). It now sits under the text, like in logic charts.
- Split panes: the bottom toolbar only moves up to clear the status bar in the pane the status bar actually covers; the other panes keep it at the bottom edge.

## [0.73.0] - 2026-11-15

### Added
- "Insert ▸ Insert image or video" in the topic menu (#40): pick images, videos or audio with the system file picker; they're saved where Obsidian's attachment settings say and embedded after the topic's text, shown right in the topic. On phones you can't paste or drop files into a topic, so a long press now gets you there; phones also show this button on the floating topic toolbar by default (off on desktop, turn it on under Settings → Toolbars and colors). When the central topic is the file name, the file goes in as a child topic so the note isn't renamed.
- Videos and audio in topics play inline (#40): `![[clip.mp4]]` used to show as plain text. Like web players, they're covered so a click selects or drags the topic; double-click the player or click Activate to use its controls. Drag a video's corner to resize it (saved as `![[clip.mp4|width]]`) without restarting playback. Videos and audio dragged in from the file list are embedded instead of linked. Image export shows a video's current frame and an audio file's name.
- Tables in topics can be folded: "Fold table (header only)" in the table's corner menu leaves just the header and a "▸ Show N rows" bar (synced from Table). "Header rows" in that menu is now one row of 1 / 2 / 3 buttons.

### Fixed
- Tables in topics: after right-clicking a link or image in a cell, clicking another cell didn't close the menu (synced from Table 0.15.2).

## [0.72.1] - 2026-11-15

### Fixed
- iPhone: after long-pressing a topic to open its menu, tapping empty space no longer cleared the selection, and tapping other topics did nothing. The long press had already started dragging the topic, and lifting the finger landed on the menu, so the map kept thinking that finger was down and treated every later tap as a pinch. A long press that opens the menu no longer drags or pans, and touches the map never saw end are cleared when the next finger goes down.

## [0.72.0] - 2026-11-15

### Added
- Export as PDF (desktop): in the map's ⋯ menu and the command palette — the whole map on one page sized to it, with vector text.
- Tables in nodes are exported in full: PNG, SVG and PDF export and Copy as image no longer cut a large table to the part visible in its node (with the scrollbar and fade); the node grows and the map makes room, and the canvas goes back to normal afterwards. Tables in nodes with a set width still follow the node's width.
- Setting "Keep spaces at the start and end of topics" (off by default): Markdown drops them from list items and headings, so with this on they're saved as `&nbsp;` and show as ordinary spaces while you edit the topic.

### Changed
- Jumping to a topic (a [[note#heading]] link, "Jump to the note if it's already open", coming back from a PDF, switching from Markdown) no longer always puts the topic dead center: the topic and its expanded branch are shown together — centered as a whole when they fit, otherwise with the topic pinned to the side the branch grows away from (left for branches growing right, right for left, top for down), so its content fills the rest of the view.

### Fixed
- `&nbsp;` in topic text showed up literally; it now shows as a space, like in Obsidian.
- Exported images added 2px between table cells, so a table came out taller than its node with the last row sticking out, and the table's menu button and + buttons were exported too.

## [0.71.1] - 2026-11-14

### Fixed
- Mind maps embedded in a note with a code block (#38): typing in a new node stacked the text one character per line until you pressed Enter. The node's editor picked up the note editor's own styles and was squeezed to its narrowest; it no longer is.
- Tables in nodes (as in gogoga Table 0.15.0): the cursor couldn't be moved while editing a cell in a Canvas card.

## [0.71.0] - 2026-11-14

### Added
- Setting "Jump to the note if it's already open" (off by default): when a clicked link's note is already open in another tab or split, go there instead of opening it again; in a mind map the linked heading or block is selected. Handy with two maps side by side. ⌘-click (Ctrl-click) still opens a new tab.
- "Markdown and mind map side by side" now keeps the current side as it is and opens the other one opposite: if the window is already split (left/right or top/bottom), it opens in the pane next to it instead of adding a third; otherwise the new setting "Mind map side in side by side" puts the map on the right (default) or left.
- Command "Swap Markdown and mind map sides", also a button at the top right of the map while side by side: swaps the two, and the focus follows the view you were in.
- Callouts can be formatted: while editing a callout, text color, highlight (commands, hotkeys, floating format bar) and ⌘B / ⌘I / ⌘U apply to the selected text.
- Tables in nodes (as in gogoga Table 0.14.0): Space on a selected cell starts editing instead of clearing it; a + on the left adds a column.

### Fixed
- Several spaces in a row in a node showed as one after editing, so the text was a different length while editing and after. They now show as typed, in exported images too.

## [0.70.0] - 2026-11-14

### Added
- Setting "Focus the note after opening it in a split" (off by default): after a link opens in the right split, the focus moves to the note, so shortcuts like close tab act on it. Off, the focus stays on the mind map as before.
- Setting "Folder for new notes from the map": Obsidian's new file location (default), the mind map's folder, a folder named after the mind map next to it, or a folder of your choice. Applies to new linked notes from nodes and to clicking links to notes that don't exist yet, so a map's linked notes can stay together.

### Fixed
- Clicking a link in a node on the right side of the map and opening it in a split to the right narrowed the map and pushed that node out of sight. After the split opens, the node is now moved to the middle of the map if it isn't visible; if it still is, the view stays put.
- On phones (#37): the map's bottom toolbar was half covered by Obsidian's floating navigation bar. The toolbar now sits above it.

## [0.69.0] - 2026-11-14

### Added
- Tables in nodes: "Table text size" in the table menu and "Text size" in the cell menu, five steps; table and cell sizes multiply (same as gogoga Table).

### Fixed
- Jumping back to a mind map from an annotation in a PDF (PDF++): the "second click opens another tab" bug fixed in 0.68.0 still happened in many cases. It recognized the jump by checking that the most recent tab was the PDF, but PDF++ creates the new tab before opening the note, so by then the most recent tab is that empty new tab. The plugin now remembers whether you were last in a PDF, so the open mind map jumps to the node whether the PDF is in the main area, a sidebar or a separate window.

## [0.68.0] - 2026-11-14

### Added
- Setting **Mouse wheel over embedded maps** (#35): by default (**Click the map first**) the wheel scrolls the note over an embedded map until you click the map (a hint says so), then it pans the map until you click outside; Ctrl / ⌘ + wheel zooms at any time. **Always pan the map** is the old behavior.
- Embedded maps remember their zoom (#36): zoom an embed and it opens at that zoom next time (per note and map). You can also set it in the link, e.g. ![[map|80%]].
- Setting **Note text size**: font size of the note window and expanded note cards, 13px by default.
- Setting **Keep blank lines in topics** (off by default): when a topic has several lines (Shift+Enter), empty lines between them are kept on save instead of removed, which helps space out longer text; empty lines at the start and end are still removed. Also in the Quick settings panel.
- Tables in nodes: a toolbar above the keyboard while editing a cell on phones and tablets, and a drag handle on the selected column's edge to resize columns on touch screens (same as gogoga Table).

### Fixed
- A very long formula in a topic stuck out of the topic. Formulas now stop at the topic width and scroll sideways inside.
- With themes whose page background is translucent (phycat with a wallpaper, for example), the toolbar, menus, note window and format bar were see-through. They now use Obsidian's menu background, like Obsidian's own menus.
- Tables in nodes: empty lines in a cell (Shift+Enter) disappeared once you left the cell (same as gogoga Table).
- Jumping back from an annotation in a PDF to the mind map that quotes it (PDF++): clicking another annotation in the same PDF opened the map again in a new tab instead of jumping within the open one. Now the open map selects the matching topic and no extra tab opens.

## [0.67.0] - 2026-11-13

### Added
- More ways to split a topic: right-click → **More → Split into subtopics ▸** and choose at commas, enumeration commas and semicolons (the old behavior), at periods, question and exclamation marks, at semicolons, at numbering (1. / 1、 / (1) / ① / 一、 / （一） / I. / ii), counting up 1, 2, 3), or a split you add under **Custom splits** in settings (one per line, "name: characters").
- While editing a topic, select some text and use **Split** in the format bar to split just that text into subtopics.
- Setting **Keep the original text when splitting** (on by default, as before): turn it off and splitting a whole topic replaces it with the pieces at the same level (the first piece keeps its subtopics, note and color); with text before the numbering ("Fruit: 1. apples 2. pears") the topic keeps "Fruit:" and the items become subtopics; splitting selected text removes that text from the topic.
- Setting **Keep separators when splitting** (off by default, as before): turn it on to keep punctuation at the end of each piece and numbering at the start; off removes them, along with the punctuation or space right after a number ("一、苹果" → "苹果").
- **Quick settings** toolbar button: a small panel with everyday options — editing a node, the format bar on selection, hover width handles and the two split settings — that apply right away. It can be turned off in the main toolbar button list in settings.
- In the note window opened from a node's note icon, double-click the text to start editing, like expanded note cards, instead of clicking Edit; the window stays put and the cursor goes to the end. Double-clicking an image doesn't count (a click on it opens the full-size view), and recite mode doesn't enter editing.

## [0.66.0] - 2026-11-13

### Added
- With several nodes selected, drag the width handle on the primary selected node to give all of them the same width (image and video nodes excepted), undone in one step; right-click one of them and choose Reset to automatic width to reset them all. With one node selected, or when dragging an unselected node's handle with hover width handles on, only that node changes, as before.
- Tables in nodes: vertical alignment (top / middle / bottom) from the cell right-click and column menus, same as gogoga Table.
- Tables in nodes: the format bar while editing a cell now has the same text color and highlighter split buttons and palette as the mind map's format bar, sharing its last and recent colors.

### Fixed
- In the format bar, No highlighter didn't remove a plain ==highlight== (only colored ones), and picking a highlighter color on ==highlighted== text stacked two highlights. Both now replace it.
- Tables in nodes: themes that force a background on table headers and cells no longer hide the colors set on cells (same as gogoga Table).
- After restarting Obsidian, a mind map sometimes showed nodes piled on top of each other (it was laid out before the plugin's styles or fonts were ready, measured the nodes too small, and never laid out again). Node sizes are now checked after a map opens, when a background tab comes to the front and when fonts finish loading, and the map is laid out again if they're off.
- Tables in nodes: inline code in cells had no background in Live Preview (same as gogoga Table).

## [0.65.0] - 2026-11-13

### Fixed
- A blank line between a heading and its marker line (`%%…%%`) made the markers count as note text, so relation lines broke and colors, folding and the like stopped working. Plugins such as Linter add that blank line after headings. Markers are now recognized anyway, and the blank line is kept when writing back.
- Double-clicking a node to edit selects its text but didn't show the format bar until you selected again. With **Format bar when selecting text** on, it now appears right away. New nodes don't show it.
- Tables in nodes: double-click an image in a cell to enlarge it; right-click an image for Copy image, the native file menu and Delete image; right-click a link for the native link menu (same as gogoga Table).
- Tables in nodes: typing 【【 with a Chinese input method in a cell opens link suggestions too (same as gogoga Table).
- Tables in nodes: the horizontal scroll bar could sit under the add-row button (same fix as gogoga Table).

## [0.64.0] - 2026-11-12

### Added
- New setting **Show in expanded notes** (#31, Notes page): Everything (default) / List items only / Ordered lists only / Bullet lists only. With **Only headings as nodes** on, long explanations and list conclusions under a heading all end up in its note; with a list-only choice the note box under the node keeps just the list items (with their indented sub-items and continuation lines), and two separate ordered lists keep their own numbering. Nodes with nothing left show only the note icon, which opens the full note. Only the display changes: the popover, editing and your file always have the full note.

### Fixed
- With **Only headings as nodes** on, editing a heading note that contains a list — even just opening and closing the editor — rewrote the whole note as a `> [!note]` callout. Notes are now stored by the same rule used when writing the file: lists in heading notes are kept as they are.

## [0.63.1] - 2026-11-12

### Added
- Tables in nodes: screenshots and copied images paste straight into a cell, saved as attachments like images pasted into nodes, with `![[image]]` inserted; images in cells are at most 320 px wide so the table doesn't blow up.

### Fixed
- With Mind Map (lynchjames), an XMind viewer plugin or Markmind installed, the plugin could fail to load (#34): those plugins use the same names — the `mindmap` view, `.xmind` files or the `mindmap` code block — and when they load first Obsidian refuses a second registration, so the whole plugin failed. Now the mind map steps aside on a clash: its view registers under another name and works as usual, `.xmind` files stay with the other plugin (with a one-time notice), and the `mindmap` code block is left to it while `gogoga-mindmap` blocks keep working.
- Tables in nodes: `[[links]]` in cells did nothing when clicked. They now open like links in nodes, following the **Open note links in** setting, with Ctrl/Cmd-click for a new tab and hover preview.
- Tables in nodes copied to Word: in a dark theme, colors no longer come along dark — they are always taken from the light theme; **Copy as Markdown table** now pastes into Word as a table instead of plain text.

## [0.63.0] - 2026-11-12

### Added
- Tables in nodes: copy at least two rows and two columns and paste into a note, and the new table keeps its colors, widths, merges and status columns; pasting into Excel or Feishu works as before. The table menu (top-left corner) gains **Copy table** and **Copy as Markdown table** (plain GFM, without colors or other settings).

### Fixed
- Tables in nodes: clicking an item in the suggestion list while editing a cell (status options, `[[` links, `#` tags) now fills the cell. Before, the click ended editing and nothing was filled in.

## [0.62.0] - 2026-11-12

### Added
- **Color palette.** Text color and highlighter are now a button with a dropdown, the same in the floating toolbar (whole node) and the format bar (selected text, in mind maps and in notes): click the left part to reuse the last color in one click, click ▾ for the palette — your frequent colors, a grid of 60 colors, recent colors, an opacity slider and a custom color picker. The floating toolbar gains a highlighter button, and a ··· after the node colors opens the same palette to pick any node color.
- Three commands to turn toolbars on and off from anywhere, so you can bind hotkeys: **Toggle the floating toolbar (selected nodes)**, **Toggle the format bar (text selected while editing a node)** and **Toggle the format bar in notes**. Each flips the matching setting (remembered) and takes effect right away.
- Setting **Write notes under list items as blockquotes (> before each line)** (off by default, Notes page). In Obsidian, indented lines right below a list item count as part of that item's text, so styles such as a first-line indent line up badly; with this on, a list item's note is written with > before every line, making it a separate blockquote inside the item. The mind map strips one > when reading, so notes look the same in the map. Only notes you change are rewritten, and a blank line follows each rewritten note so Live Preview doesn't pull the next item into the quote.

### Changed
- Settings: node colors, frequent text colors and frequent highlighter colors are edited as swatches — click one to change it in the palette, × to remove, drag to reorder, + to add. "Edit as text" still shows the old text box.
- The format bar's flat row of color buttons is folded into the two dropdowns; the frequent colors are the first row of each palette.

### Fixed
- With **Hide format tags in notes** on, Markdown inside a text color or highlighter tag now shows as formatting in Live Preview: `**bold**`, `==highlight==`, italics and links inside `<span style="color:…">` or `<mark …>` used to show their raw `**` markers, because Obsidian draws inline HTML as-is there. The plugin now draws these spans the way mind map nodes do; put the cursor in one to see and edit its source. Bold text inside colored text keeps that color. With the setting off, nothing changes.
- With **Hide format tags in notes** on, pressing Enter in colored or highlighted text no longer breaks its tag across two lines (the new line used to show a stray `>` or `</span>`). At the end of the text the new line starts plain; in the middle, both lines keep the formatting as complete tags.
- Nodes can be pasted or dragged onto a summary: select a summary (click its text) and paste, or use **Paste** in the summary's right-click menu (long-press on phones), or drag a node onto the summary text. A plain summary becomes a summary topic and the nodes go under it. Before, pasting with a summary selected put the nodes under the central topic, and dropping on the summary text did nothing.

## [0.61.8] - 2026-11-12

### Fixed
- Tables in nodes: with the first column frozen in the **Zebra** style, every other row of the frozen column was see-through, so columns scrolled underneath showed through and the text overlapped. The frozen column is now opaque in every row, and a selected range that doesn't include the first column draws its box under the frozen column.

## [0.61.7] - 2026-11-11

### Fixed
- No error when another plugin probes Obsidian's note embed handler without a file (for example to check embed support); such calls are passed on unchanged (#32).

## [0.61.6] - 2026-11-11

### Fixed
- Tables in nodes: with **Freeze header column** on, scrolling the table sideways no longer slides the header row cells over the frozen first column; header cells in that column now stay put like the rows below.

## [0.61.5] - 2026-11-11

### Fixed
- With **Follow the active note** and split-view sync on, switching back and forth between a vault note and a Markdown file outside the vault (opened with Obsidian) could overwrite the vault note with the other file's content: content that arrived late from a slow read went into a map that had already switched files, or text just typed in Markdown was pushed to a map that had switched, and the next save wrote it into the wrong note. A map now reloads the current file when a read finishes after a switch, and pushes are checked against the file first (#30).
- Switching quickly with **Follow the active note** no longer leaves the map on the previous note, out of step with the note beside it (#30).
- Markdown files outside the vault: changes made in the mind map now show up in the Markdown view beside it, which used to stay on the old content (#30).
- Split-view sync: clicking a node right after changing the map (moving a node, for example) now waits for Markdown to get the new content before jumping, instead of jumping to that line in the old content (#30).

## [0.61.4] - 2026-11-11

### Added
- New **Fold buttons on touch screens** setting under Settings → Opening and display. On phones and tablets the fold button after a node with children is always shown by default, as before; choose **Only when selected or folded** to show it like on desktop, on the selected node and on folded branches only, for a cleaner look on big maps. Folding an open branch then takes two taps: select the node, then tap the button.

## [0.61.3] - 2026-11-11

### Added
- New **Clean up unused images when deleting nodes** setting under Settings → Editing and interaction (off by default): two seconds after you delete a node, or an image inside a node, in the mind map, image attachments that no other note or canvas in the vault still uses are moved to the trash (following Obsidian's "Deleted files" setting). Undo brings the files back; deleting and undoing right away, or cutting and pasting right away, leaves images alone. Only images are touched.

### Fixed
- A broken saved position or zoom (empty values, text, huge numbers) no longer opens the mind map zoomed all the way out with the nodes squeezed together, or scrolled out of sight: the broken record is dropped and the map opens at its default position.
- If a file's saved view state (position, zoom, lock, note expansion and sizes, hidden callouts) stops the mind map from opening, that state is reset and the map opens again, with a notice; the note itself is unchanged. Before, a complex map could close right after opening, and only a copy of the file would open.
- Note cards can no longer be resized beyond 1600 × 1200; oversized sizes saved earlier are trimmed when the map opens. Before, resizing while zoomed far out could save sizes of tens of thousands of pixels, and the whole map then opened zoomed all the way out.

## [0.61.2] - 2026-11-10

### Fixed
- Double-clicking a node to edit it, split-view sync scrolling the Markdown (live preview and reading view), and jumping to a node's line in Markdown now only scroll the note and the map themselves, never Obsidian's outer containers. With card layouts such as the Border theme's, the outer container used to shift up and clip the top tab bar (#29).

## [0.61.1] - 2026-11-10

### Fixed
- Pasting a single web address onto a selected node now also fetches the page title when **Fetch page titles when pasting links** is on: the new child node first shows the address, then turns into `[title](address)`. Before, the title was only fetched when pasting while editing a node's text.
- Jumping back from PDF++ (clicking a highlight that a mind map note links to) now selects the node on that line in the mind map, unfolding its branch if needed, and centers it. Before, the map opened but didn't move to the node; this works for anything that opens a note at a line.

## [0.61.0] - 2026-11-10

### Added
- New **Toolbar of embedded maps** page under Settings → Toolbars and colors, for mind maps embedded in notes and canvas cards (`mindmap` code blocks and `![[note]]` embeds): **Full** (default, the same as an opened mind map), **Custom** or **Auto-hide**. Custom lists every button to turn on or off and reorder, like the main toolbar page; by default it keeps only the open / edit button (“Open this mind map” for embedded notes, “Edit / Done” for code blocks), for a clean embed. If every button is off, the toolbar isn't shown at all. Opened mind maps are not affected.

### Changed
- The **Hide the toolbar of embedded maps** switch under Markdown and embeds is now the **Auto-hide** option on the page above; if you had it on, it's switched over automatically.

## [0.60.1] - 2026-11-10

### Fixed
- Dragging toolbar buttons in settings now sets styles the way Obsidian's plugin review rules require (no direct `style` assignment).

## [0.60.0] - 2026-11-10

### Added
- New **Floating toolbar buttons** and **Main toolbar buttons** pages under Settings → Toolbars and colors: turn each button on or off and reorder them by dragging the handle or with the arrows (colors count as one item on the floating toolbar; the main toolbar's dividers can be moved or hidden too). Changes apply to open mind maps right away, and **Restore defaults** puts everything back. The floating toolbar also has five optional buttons, off by default: Add relationship, Insert table, Collapse / expand, Move up and Move down. The default toolbars look the same as before.
- New **Open note links in** setting under Settings → Editing: Current tab (default, as before), New tab or Right split. With Right split the mind map stays on the left and keeps focus, and the next link opens in the same split instead of adding more. ⌘⌥-click (Ctrl+Alt-click) on a link now always opens it in the right split; ⌘-click still opens a new tab.
- New **Text color** button on the floating toolbar (also under **More** in the context menu): gives the selected nodes' whole text one color, replacing any partial text colors, or removes it with **Default**. It uses the text colors from settings, and can be hidden under **Floating toolbar buttons**.
- While editing a node, select some text and press ⌘K (or the link button on the format bar) to link just that text to a note; the rest stays as is. With nothing selected it still links the whole node.

### Fixed
- Relationship line labels: while editing, the text no longer runs down one character per line; it's laid out horizontally and wraps past a set width. Long labels now show in full on several lines, centered both while editing and when shown, instead of being cut off with an ellipsis.
- **Link to note** no longer strips colors, bold and other formatting from the node. The formatting stays; colored parts are written as Markdown links, so they show as links in their own color (underlined) in the mind map and reading view, and keep their color in Live Preview. **Unlink** restores the original text.
- Colored text with a line break (Shift+Enter) no longer shows as `<span style=…>` source in the node, with the color value turned into a tag; a line break inside colored text now stores each line as its own complete colored text.
- Copying part of a colored text while editing a node no longer pastes as a half `<span …>` tag; the copied text is a complete piece of colored text.
- Tables in nodes: after a node's width was dragged, the table kept a faded right edge and scrolled sideways a little even when the node was wider than the table. It now shows in full when it fits and only scrolls when the node is narrower.
- Resizing a PDF++ crop image in a node no longer leaves the node frame stuck at 300 px wide with the image sticking out; the frame grows with the image.
- The mouse wheel sometimes seemed to stop working until you clicked a few times: if the mouse release was missed (for example after switching windows while holding the button), the canvas still thought it was being dragged and snapped back after every wheel scroll. A move with no button pressed now counts as a release.
- With the pointer on a scrollable table node that is already scrolled to the end, the wheel no longer does nothing: a new scroll gesture pans the canvas instead. Reaching the end in the middle of a gesture still stops there, so the map isn't flung away.
- Tables in nodes: copying part of a colored text while editing a cell no longer pastes as a half `<span …>` tag, and Shift+Enter inside colored text keeps each line complete.

## [0.59.1] - 2026-11-10

### Changed
- Tables in nodes: editing a cell now uses the same editor as node text — colors, highlights, bold and underline show while editing, with their tags hidden and kept paired.
- Tables in nodes: drag handles appear only on the first column (row handle) and header row (column handle), like native tables, and hide while scrolling.

### Fixed
- **Node colors in notes** also works in reading view when Obsidian passes an empty note text to plugins (the text is read from the open note instead).

## [0.59.0] - 2026-11-09

### Added
- Tables in nodes get the format bar too: with **Format bar when selecting text** on, selecting text while editing a cell shows the same bar with your text and highlighter colors; Mod+U underlines.

### Changed
- Tables in nodes: after selecting several cells, the right-click menu offers **Delete 2 rows** / **Delete 3 columns** and so on instead of greying out Delete row and Delete column.

### Fixed
- Tables in nodes: with crosshair highlight, the row highlight grows with a cell whose text wraps while editing.

## [0.58.0] - 2026-11-09

### Added
- **Node colors in notes** setting (off by default): when a mind map note is opened as Markdown, the text of colored headings and list items gets a light background in the node's color, in both Live Preview and reading view (so PDF export too). Named colors match the mind map's palette, including dark mode; custom `#hex` colors are shown semi-transparent. Child items aren't colored with their parent, the file isn't changed, and colors are still edited in the mind map. Find it in Settings → Markdown and embeds.

### Fixed
- **Node markers in notes** (dot / hide) now also works in a mind map note that was just created or just got `mindmap: true`, instead of waiting for Obsidian to finish indexing it.

## [0.57.0] - 2026-11-09

### Added
- **Format bar when selecting text in notes** setting (off by default, desktop only): in the Live Preview of any Markdown note, selecting text shows the same bar as in the mind map — bold, italic, strikethrough, underline, highlight, text colors, highlighter colors and clear. It writes the same formatting as the mind map, so what you mark in a note shows in the mind map and the other way round. A selection over several lines is formatted line by line, leaving list bullets, heading marks, task boxes, `%%…%%` node markers and block IDs alone. It doesn't appear in source mode, code blocks, math or frontmatter. Find it in Settings → Markdown and embeds.

## [0.56.0] - 2026-11-09

### Changed
- Typing "1. " or "1、" at the start of a node now numbers its sibling group by default, and the typed number is removed. Before, the number stayed as text and was saved as `- 1. text`, which Markdown reads as a list inside a bullet, so many themes showed every item as "1.". Existing settings are reset to the new default once; you can turn **Start numbering by typing 1.** off again in Settings → Editing and interaction.
- **Number siblings** moved from **More** to the first level of the node's right-click menu.
- Turning numbering on for a group where every node already starts with a typed number ("1. ", "2) ", "3、") removes those numbers, so notes numbered by hand can be fixed in one step instead of showing "1. 1. text". If the group is already numbered and shows "1. 1. text", clicking **Number siblings** removes the typed numbers and keeps the numbering.

### Fixed
- In Markdown notes with tables, clicking or selecting a paragraph just above a heading no longer selects the heading instead: the table's margins are now counted in the line positions.

## [0.55.0] - 2026-11-09

### Added
- Underline: press ⌘U (Ctrl+U) while editing a node or with nodes selected, click U in the format bar, or use the command "Underline the selected text". Saved as `<u>text</u>`, which nodes now display as underlined text.
- **Hide format tags in notes** setting (off by default): in a Markdown note's Live Preview, clicking into colored, highlighted or underlined text no longer reveals the whole `<span style=…>`, `<mark style=…>` or `<u>` tag; the formatting keeps showing, as in the node editor, and deleting or typing next to it keeps the tags paired. Source mode, code blocks, math and frontmatter are left alone.
- **Node markers in notes** setting: in mind map notes opened as Markdown, the `%%…%%` marker at the end of a line (colors, folding, relationships…) can show as is (default), shrink to a small gray dot (hover to see it, click to edit it) or be hidden completely in Live Preview; a heading's marker line takes no space and its dot goes at the end of the heading. While hidden, typing, Enter, Backspace and joining lines keep the marker in place, deleting a whole line deletes its marker, and moving a heading line takes its marker line along, so nothing is lost; ordinary comments are left alone.

## [0.54.0] - 2026-11-08

### Added
- When the central topic is the note's only top-level heading, you can now add a sibling to it from the right-click menu or the toolbar's **Add sibling** button: a second top-level heading is added, the note's file name becomes the central topic, and both headings become its branches (#27). Pressing Enter on the central topic still adds a child.
- Relationship lines get two control handles (#28): select a line and a handle appears near each end, linked to it by a thin guide; drag them to shape the start and end of the curve separately. The label stays in the middle, so it no longer covers the handle, and each handle moves with its node. Lines you haven't touched keep their current shape and file text; once a handle is dragged the line is stored as `c1=… c2=…` instead of `c=…`. Older versions of the plugin don't understand that and show the marker as text on the node.

### Fixed
- In a code-block mind map without a single top-level heading (only a list, or several top-level headings), a name given to the central topic wasn't saved and turned back into "Central topic" after editing another node (#26). Naming it now adds a top-level heading at the top of the block to hold it, moving the existing headings one level down; if the headings are already six levels deep, a notice says it can't be saved.
- When the central topic is the note's file name (the note has several top-level headings or none), renaming it was silently undone (#27). Renaming it now renames the note, and links to it update as usual; names with characters a file name can't contain, or that clash with an existing file, show a notice instead. Renaming the note elsewhere also updates the central topic right away.
- After dragging a relationship's label, ⌘Z and Delete didn't act on the map until you clicked it: clicking or dragging a line, its label or its handles now gives the map keyboard focus.

## [0.53.1] - 2026-11-08

### Changed
- Big tables in nodes render faster (plain-text and number cells skip Markdown rendering, and selection only updates the cells that changed), same as the gogoga Table plugin.

## [0.53.0] - 2026-11-08

### Added
- Tables in nodes can also have multi-row headers (top-left menu → **Header rows**) and a frozen header column (shown once **First column as header** is on), matching the gogoga Table plugin.

### Changed
- Tables in nodes that scroll sideways now fade out on the cut-off side (same as the gogoga Table plugin).

## [0.52.0] - 2026-11-07

### Added
- Hold the right mouse button and drag to move the map (from a Bilibili comment): now also in the default Pan mode, and even when you press on a node, so dense maps don't need empty space to grab; a right-click without dragging still opens the menu.

### Changed
- On vertical timelines, a main topic's expanded note is now centered right below it, so the axis runs through the middle of the note instead of being cut off off-center.
- The arrow at the end of a timeline now reaches past the farthest part of the map, so the axis no longer stops short when an earlier branch reaches farther than the last main topic.

## [0.51.0] - 2026-11-07

### Added
- Five timeline structures (#24), in the toolbar's structure menu: horizontal timeline (one side / alternating up and down) and vertical timeline (rightward / leftward / alternating). Main topics are strung in order along an arrowed axis with their content hanging beside it: as an indented list on horizontal timelines and as a logic chart on vertical ones. When alternating, neighboring branches go on opposite sides and tuck in, so more fits on screen. Arrow keys move along the axis and into a branch toward the side it grows; drag main topics to reorder them along the axis. The structure is stored only in the frontmatter's `mindmap-structure`; the note's body is unchanged.

### Fixed
- With **Fold Markdown along with the map** on and the Markdown beside the map, expanding or collapsing a branch in the map made the Markdown jump dozens of lines away, losing the spot you had just located (most visible in long notes with many folded sections above). The Markdown now stays where it was.

## [0.50.0] - 2026-11-07

### Added
- A **Markdown and mind map side by side** button at the top right of the map (next to the document icon): one click opens this note's Markdown on the left with the map on the right, no need to look in the right-click menu or command palette. It hides while the two are already side by side.

## [0.49.0] - 2026-11-07

### Added
- A sync toggle on the toolbar: when the same note is also open as Markdown, the toolbar shows a split-view button that turns syncing with the Markdown on or off in one click (struck through when off), without going to settings. It is the same switch as the "Sync with Markdown side by side" setting.

### Changed
- Smoother with big notes: when you type in the Markdown beside the map, undo, or the file changes elsewhere, the map redraws only the nodes that changed instead of rebuilding every node. For a 3000-line note with over a thousand nodes, each sync drops from about 80 ms to about 25 ms.

### Fixed
- After moving a node in the map, its old spot in the Markdown could be left with a long run of blank lines (most visible when the note already had several blank lines in a row; the longer the moved content, the more blank lines). The old spot is now left clean, and the seam never has more blank lines in a row than the note already did.
- In a split or narrow pane, toolbar buttons that didn't fit at the bottom (or top) were cut off and couldn't be clicked. The toolbar now wraps onto a second row when needed, so every button stays visible.

## [0.48.0] - 2026-11-07

### Added
- **Default image size** and **Maximum image width** settings (Opening and display page): how wide images without a set width appear (was fixed at 240), and how far you can drag an image's corner (was fixed at 800, now up to 2000). Images whose width in the note is larger show at the maximum; the note isn't changed.

## [0.47.0] - 2026-11-07

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

[Unreleased]: https://github.com/JackWeiGogoga/gogoga-mindmap/compare/0.90.1...HEAD
[0.90.1]: https://github.com/JackWeiGogoga/gogoga-mindmap/compare/0.90.0...0.90.1
[0.90.0]: https://github.com/JackWeiGogoga/gogoga-mindmap/compare/0.89.3...0.90.0
[0.89.3]: https://github.com/JackWeiGogoga/gogoga-mindmap/compare/0.89.2...0.89.3
[0.89.2]: https://github.com/JackWeiGogoga/gogoga-mindmap/compare/0.89.1...0.89.2
[0.89.1]: https://github.com/JackWeiGogoga/gogoga-mindmap/compare/0.89.0...0.89.1
[0.89.0]: https://github.com/JackWeiGogoga/gogoga-mindmap/compare/0.88.3...0.89.0
[0.88.3]: https://github.com/JackWeiGogoga/gogoga-mindmap/compare/0.88.2...0.88.3
[0.88.2]: https://github.com/JackWeiGogoga/gogoga-mindmap/compare/0.88.1...0.88.2
[0.88.1]: https://github.com/JackWeiGogoga/gogoga-mindmap/compare/0.88.0...0.88.1
[0.88.0]: https://github.com/JackWeiGogoga/gogoga-mindmap/compare/0.87.2...0.88.0
[0.87.2]: https://github.com/JackWeiGogoga/gogoga-mindmap/compare/0.87.1...0.87.2
[0.87.1]: https://github.com/JackWeiGogoga/gogoga-mindmap/compare/0.87.0...0.87.1
[0.87.0]: https://github.com/JackWeiGogoga/gogoga-mindmap/compare/0.86.0...0.87.0
[0.86.0]: https://github.com/JackWeiGogoga/gogoga-mindmap/compare/0.85.0...0.86.0
[0.85.0]: https://github.com/JackWeiGogoga/gogoga-mindmap/compare/0.84.0...0.85.0
[0.84.0]: https://github.com/JackWeiGogoga/gogoga-mindmap/compare/0.83.0...0.84.0
[0.83.0]: https://github.com/JackWeiGogoga/gogoga-mindmap/compare/0.82.0...0.83.0
[0.82.0]: https://github.com/JackWeiGogoga/gogoga-mindmap/compare/0.81.0...0.82.0
[0.81.0]: https://github.com/JackWeiGogoga/gogoga-mindmap/compare/0.80.0...0.81.0
[0.80.0]: https://github.com/JackWeiGogoga/gogoga-mindmap/compare/0.79.0...0.80.0
[0.79.0]: https://github.com/JackWeiGogoga/gogoga-mindmap/compare/0.78.4...0.79.0
[0.78.4]: https://github.com/JackWeiGogoga/gogoga-mindmap/compare/0.78.3...0.78.4
[0.78.3]: https://github.com/JackWeiGogoga/gogoga-mindmap/compare/0.78.2...0.78.3
[0.78.2]: https://github.com/JackWeiGogoga/gogoga-mindmap/compare/0.78.1...0.78.2
[0.78.1]: https://github.com/JackWeiGogoga/gogoga-mindmap/compare/0.78.0...0.78.1
[0.78.0]: https://github.com/JackWeiGogoga/gogoga-mindmap/compare/0.77.0...0.78.0
[0.77.0]: https://github.com/JackWeiGogoga/gogoga-mindmap/compare/0.76.0...0.77.0
[0.76.0]: https://github.com/JackWeiGogoga/gogoga-mindmap/compare/0.75.1...0.76.0
[0.75.1]: https://github.com/JackWeiGogoga/gogoga-mindmap/compare/0.75.0...0.75.1
[0.75.0]: https://github.com/JackWeiGogoga/gogoga-mindmap/compare/0.74.0...0.75.0
[0.74.0]: https://github.com/JackWeiGogoga/gogoga-mindmap/compare/0.73.0...0.74.0
[0.73.0]: https://github.com/JackWeiGogoga/gogoga-mindmap/compare/0.72.1...0.73.0
[0.72.1]: https://github.com/JackWeiGogoga/gogoga-mindmap/compare/0.72.0...0.72.1
[0.72.0]: https://github.com/JackWeiGogoga/gogoga-mindmap/compare/0.71.1...0.72.0
[0.71.1]: https://github.com/JackWeiGogoga/gogoga-mindmap/compare/0.71.0...0.71.1
[0.71.0]: https://github.com/JackWeiGogoga/gogoga-mindmap/compare/0.70.0...0.71.0
[0.70.0]: https://github.com/JackWeiGogoga/gogoga-mindmap/compare/0.69.0...0.70.0
[0.69.0]: https://github.com/JackWeiGogoga/gogoga-mindmap/compare/0.68.0...0.69.0
[0.68.0]: https://github.com/JackWeiGogoga/gogoga-mindmap/compare/0.67.0...0.68.0
[0.67.0]: https://github.com/JackWeiGogoga/gogoga-mindmap/compare/0.66.0...0.67.0
[0.66.0]: https://github.com/JackWeiGogoga/gogoga-mindmap/compare/0.65.0...0.66.0
[0.65.0]: https://github.com/JackWeiGogoga/gogoga-mindmap/compare/0.64.0...0.65.0
[0.64.0]: https://github.com/JackWeiGogoga/gogoga-mindmap/compare/0.63.1...0.64.0
[0.63.1]: https://github.com/JackWeiGogoga/gogoga-mindmap/compare/0.63.0...0.63.1
[0.63.0]: https://github.com/JackWeiGogoga/gogoga-mindmap/compare/0.62.0...0.63.0
[0.62.0]: https://github.com/JackWeiGogoga/gogoga-mindmap/compare/0.61.8...0.62.0
[0.61.8]: https://github.com/JackWeiGogoga/gogoga-mindmap/compare/0.61.7...0.61.8
[0.61.7]: https://github.com/JackWeiGogoga/gogoga-mindmap/compare/0.61.6...0.61.7
[0.61.6]: https://github.com/JackWeiGogoga/gogoga-mindmap/compare/0.61.5...0.61.6
[0.61.5]: https://github.com/JackWeiGogoga/gogoga-mindmap/compare/0.61.4...0.61.5
[0.61.4]: https://github.com/JackWeiGogoga/gogoga-mindmap/compare/0.61.3...0.61.4
[0.61.3]: https://github.com/JackWeiGogoga/gogoga-mindmap/compare/0.61.2...0.61.3
[0.61.2]: https://github.com/JackWeiGogoga/gogoga-mindmap/compare/0.61.1...0.61.2
[0.61.1]: https://github.com/JackWeiGogoga/gogoga-mindmap/compare/0.61.0...0.61.1
[0.61.0]: https://github.com/JackWeiGogoga/gogoga-mindmap/compare/0.60.1...0.61.0
[0.60.1]: https://github.com/JackWeiGogoga/gogoga-mindmap/compare/0.60.0...0.60.1
[0.60.0]: https://github.com/JackWeiGogoga/gogoga-mindmap/compare/0.59.1...0.60.0
[0.59.1]: https://github.com/JackWeiGogoga/gogoga-mindmap/compare/0.59.0...0.59.1
[0.59.0]: https://github.com/JackWeiGogoga/gogoga-mindmap/compare/0.58.0...0.59.0
[0.58.0]: https://github.com/JackWeiGogoga/gogoga-mindmap/compare/0.57.0...0.58.0
[0.57.0]: https://github.com/JackWeiGogoga/gogoga-mindmap/compare/0.56.0...0.57.0
[0.56.0]: https://github.com/JackWeiGogoga/gogoga-mindmap/compare/0.55.0...0.56.0
[0.55.0]: https://github.com/JackWeiGogoga/gogoga-mindmap/compare/0.54.0...0.55.0
[0.54.0]: https://github.com/JackWeiGogoga/gogoga-mindmap/compare/0.53.1...0.54.0
[0.53.1]: https://github.com/JackWeiGogoga/gogoga-mindmap/compare/0.53.0...0.53.1
[0.53.0]: https://github.com/JackWeiGogoga/gogoga-mindmap/compare/0.52.0...0.53.0
[0.52.0]: https://github.com/JackWeiGogoga/gogoga-mindmap/compare/0.51.0...0.52.0
[0.51.0]: https://github.com/JackWeiGogoga/gogoga-mindmap/compare/0.50.0...0.51.0
[0.50.0]: https://github.com/JackWeiGogoga/gogoga-mindmap/compare/0.49.0...0.50.0
[0.49.0]: https://github.com/JackWeiGogoga/gogoga-mindmap/compare/0.48.0...0.49.0
[0.48.0]: https://github.com/JackWeiGogoga/gogoga-mindmap/compare/0.47.0...0.48.0
[0.47.0]: https://github.com/JackWeiGogoga/gogoga-mindmap/compare/0.46.0...0.47.0
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
