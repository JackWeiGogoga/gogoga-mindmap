# Changelog

All notable changes to gogoga Mind Map are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/). 中文版见 [CHANGELOG.zh-CN.md](CHANGELOG.zh-CN.md).

## [Unreleased]

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

[Unreleased]: https://github.com/JackWeiGogoga/gogoga-mindmap/compare/0.25.1...HEAD
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
