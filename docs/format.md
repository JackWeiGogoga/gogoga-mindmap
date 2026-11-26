# gogoga Mind Map file format

**English** | [简体中文](format.zh-CN.md)

gogoga Mind Map has passed 10,000 downloads in the Obsidian community plugin directory. People keep reading notes, courses and work plans in it, and the question we hear most is: **if I stop using this plugin one day, are my mind maps still there?**

Yes. The plugin has no file format of its own. A mind map is a plain Markdown note: headings and list items are the nodes, and styling such as colors and folding lives in Obsidian comments (`%%…%%`). Uninstall the plugin and the note still reads and edits as usual; open it in any other Markdown editor and you get a clean outline.

This page lists every rule: which lines become nodes, what each comment marker means, what the plugin touches when it writes a file, and what is kept outside the note. Write by hand, generate with a script or have an AI write it: follow this page and the plugin reads it correctly.

## Contents

- [Compatibility promise](#compatibility-promise)
- [Where a mind map lives](#where-a-mind-map-lives)
- [Which lines are nodes](#which-lines-are-nodes)
- [Notes](#notes)
- [Frontmatter](#frontmatter)
- [Markers `%%…%%`](#markers-)
- [Tables in nodes](#tables-in-nodes)
- [Node text](#node-text)
- [What the plugin changes when it writes](#what-the-plugin-changes-when-it-writes)
- [Data kept outside the note](#data-kept-outside-the-note)
- [Without the plugin](#without-the-plugin)
- [Full example](#full-example)

## Compatibility promise

From 1.0.0 on, every 1.x release guarantees:

- **Existing syntax keeps its meaning.** The frontmatter keys, markers and node rules on this page are read the same way in later versions. New features only add new keys or markers; they don't change old ones.
- **Old syntax is always read.** Formats written by early versions (markers at the end of a heading line, hex colors with `#`) still work. They're switched to the current form only when you edit that node in the map.
- **What we don't know, we don't touch.** If a `%%…%%` comment contains a single word the plugin doesn't know, the whole comment is an ordinary comment and stays as it is. Other plugins' frontmatter keys and content the plugin doesn't handle are kept too.
- **No migrations.** Updating the plugin never rewrites your notes in bulk.

If the meaning of some syntax ever has to change, that goes into 2.0 and is announced in the changelog first.

## Where a mind map lives

| Form | How to write it | What it does |
|---|---|---|
| Mind map note | A `.md` note with `mindmap: true` in its frontmatter | Opens in the mind map view by default; you can switch back to Markdown at any time |
| Map inside a note | A fenced code block named `mindmap` (or `gogoga-mindmap`, same thing) in an ordinary note, holding the same Markdown | Drawn as a map in Reading view and Live Preview, and editable there |
| Existing map shown elsewhere | Embed it like a note: `![[Product launch]]` | Read-only preview that follows the original |

A code block can start with its own frontmatter (between `---` lines) using the same keys; it doesn't need `mindmap: true`.

An embed can show only one branch, or set the zoom or size: `![[Product launch#Timeline]]`, `![[Product launch#^abc123]]`, `![[Product launch|80%]]`; inside a node, `![[Product launch|480x300]]` sets the preview's width and height. These are Obsidian link syntax and don't change the embedded note.

## Which lines are nodes

```markdown
# Central topic

## Main topic
### Subtopic
- Deeper
	- Deeper still
```

- **The central topic** is the single level-1 heading `#`. Without one, the file name is used. With the setting "Use the file name as the central topic" on, the file name is always used and the level-1 heading becomes a first-level branch.
- **`##` to `######`** are the levels below it, in order. Don't skip levels.
- **List items** (`-`, `*`, `+` or `1.`) below headings are deeper levels; each extra indent is one level deeper. The plugin writes tabs and also reads space indentation.
- **Ordered lists** (`1.` `2.` `3.`) mean the children are numbered, and the map shows the numbers. Heading children can't be an ordered list, so they use the `num` marker instead (see below).
- Headings stop at H6; deeper levels become list items. When you add nodes in the map, the level at which lists start is a setting (level 4 by default). It only affects newly written nodes: any mix of headings and lists is read.
- Two settings change how notes are read, without changing the files: with "Only headings as nodes" on, only headings are nodes in mind map notes, and lists and paragraphs under a heading become its note (code-block maps are not affected); "Use the file name as the central topic" is described above.
- Each node can carry an Obsidian block id at the end of its line: `- Launch date ^abc123`. The plugin keeps it, so links like `[[Note#^abc123]]` don't break.

## Notes

Anything under a node that isn't a node is that node's **note**, shown behind a ≡ icon on the map.

```markdown
## Risks

Payment provider review can take up to three weeks.

- Server capacity
	Load test is in week 2.
```

- Paragraphs, code blocks, images and quotes under a heading are that heading's note.
- A list item's note is indented to the item's child level.
- **A note that contains list items or headings** must be wrapped in a `> [!note]` callout, every line prefixed with `> `; otherwise those lines become nodes. Leave a blank line after the last `>` line, or Obsidian's Live Preview pulls the following list items into the callout.

```markdown
- Server capacity
	> [!note]
	> - Load test in week 2
	> - Autoscaling as a fallback

- Next item
```

- With the setting "Write notes under list items as blockquotes" on, the plugin writes a list item's note with `>` before every line and strips one `>` when reading. Both forms are read either way.
- A paragraph between two lists, or after a list, belongs to no node. It isn't shown on the map, but the plugin keeps it in place when writing.

## Frontmatter

| Key | Values | Meaning |
|---|---|---|
| `mindmap` | `true` | This note is a mind map. Not needed in a code block |
| `mindmap-structure` | `logic-right` (default), `mindmap`, `org-down`, `tree-right`, `timeline-h`, `timeline-h-alt`, `timeline-v-right`, `timeline-v-left`, `timeline-v-alt`, `fishbone-right`, `fishbone-left` | Structure of the whole map: logic chart, left and right, org chart, tree, five timelines, two fishbones |
| `mindmap-theme` | `snow` (default), `rainbow`, `business`, `warm`, `mono`, `line`, `forest`, or the id of a custom theme (written by the plugin when you pick it in the toolbar) | Theme. Custom themes live in the settings; on a device without that theme the default theme is used |
| `mindmap-edge` | `curve`, `elbow`, `straight` | Line shape; leave out to follow the theme |
| `mindmap-edge-dash` | `true`, `false` | Dashed / solid; leave out to follow the theme |
| `mindmap-edge-corner` | `sharp`, `round` | Corners of elbow lines; leave out to follow the theme |
| `mindmap-height` | Pixels, e.g. `300` | Code blocks only: fixes the block's height |
| `mindmap-review` | An id (generated by the plugin); a hand-written `true` works too | The whole map is in spaced review; the id names the deck that holds its progress |
| `icon` | e.g. `lucide:mindmap-tree` | Not a mind map setting: the plugin writes this property (per the settings) so Notebook Navigator, Iconize and others show an icon in the file list. Leave the setting empty to skip it |

Apart from `mindmap: true`, everything is optional and falls back to the default or the theme. The plugin only changes these keys and keeps every other property as it is.

## Markers `%%…%%`

A node's style and relations live in an Obsidian comment, invisible in Reading view. **One comment per node**, with its markers separated by spaces: `%%blue fold w=240%%`.

- On a **heading**, put the comment on its own line right below the heading. That keeps the heading text clean, so `[[Note#Heading]]` links don't break. A blank line in between is tolerated. Early versions put it at the end of the heading line; that is still read.
- On a **list item**, put it at the end of the line: `- Item %%red%%`.
- If any word in a comment isn't in the tables below, the whole comment is an ordinary comment that the plugin neither reads nor changes. Spell markers exactly as listed.
- Text inside a marker (box title, summary, callout) can't contain straight double quotes `"` or `%%`.

### Style

| Marker | Meaning |
|---|---|
| `red` `orange` `yellow` `green` `teal` `blue` `purple` `pink` `gray` | Node color, follows the theme and dark mode |
| `a3e5a2` (6- or 3-digit hex, no `#`) | Fixed color. No `#`, because Obsidian indexes `#a3e5a2` inside a comment as a tag; `#` is still accepted when reading |
| `fold` | Collapsed: children are hidden until opened |
| `w=240` | Fixed width in pixels (60–4000); text wraps |
| `num` | Number the children. Not needed when the children are list items: write them as an ordered list |
| `hide` | Kept in the note, not shown in the map |
| `table` | The node shows a table (see [Tables in nodes](#tables-in-nodes)) |

### Structure and position

| Marker | Meaning |
|---|---|
| `left` / `right` | In the left-and-right structure, pin this main topic to that side |
| `layout=org-down` | This branch uses its own structure: `logic-right`, `org-down`, `tree-right`, `timeline-h`, `timeline-h-alt`, `timeline-v-right`, `timeline-v-left`, `timeline-v-alt`, `fishbone` |
| `float x=320 y=-80` | Floating topic: a child of the central topic drawn unconnected, offset by that many pixels from the central topic |

### Boundaries, summaries, callouts

| Marker | Meaning |
|---|---|
| `box` | Dashed frame around this node and its whole branch |
| `box=3` | Also takes in the next two siblings |
| `box "Phase 1"` | Frame with a title; combines with `=3`: `box=3 "Phase 1"` |
| `summary "Weekly sync on Mondays"` | Curly brace on the outer side of this branch, with the summary text after it |
| `summary=2 "Text"` | Stretches over the next sibling too. To summarize several siblings, put it on the first one |
| `sw=240` | After `summary`: width of the summary text |
| `summary-topic=2` | A summary with its own subtopics: put it on the item **right after** the siblings it covers. That item becomes the summary (drawn past the brace) and its children hang off it. The number is how many preceding siblings it covers |
| `callout "Text"` | Small always-visible bubble next to the node. `<br>` for a line break; colored text is `<span style='color:#e03e3e'>text</span>` with **single** quotes |
| `cc=yellow` | After `callout`: the bubble's fill, a color name or hex without `#` |

### Relationships

| Marker | Meaning |
|---|---|
| `id=r1` | Names this node so relationships can point to it. Letters, digits, `-`, `_`, up to 32 characters; one per node |
| `rel=r1` / `rel=r1 "depends on"` | Dashed arrow from this node to the node with `id=r1`, optionally labeled. A node can have several |
| `c=40,-60` | After a `rel=`: a curve dragged by hand (one control point) |
| `c1=…,… c2=…,…` | After a `rel=`: two control-point handles dragged by hand (relative to the centers of the start and end nodes) |
| `line=curve` / `straight` / `elbow` | After a `rel=`: shape of that line |

The plugin writes `c=`, `c1=` and `c2=` after you drag a line; you don't write them by hand.

### Spaced review

| Marker | Meaning |
|---|---|
| `review` | Only this branch is in review (a whole map in review uses the `mindmap-review` frontmatter key instead) |
| `rv=k3j9x2` | A review card's id, generated by the plugin. Review progress follows it when you edit the text or move the node; remove it and the card starts over |

## Tables in nodes

A node with the `table` marker draws the first Markdown table in its note inside the node box. It's a standard GFM table; under a list item, indent it to the child level and leave a blank line between the item and the table. A node with only a table can have no text: `- %%table%%`.

```markdown
- Pricing %%table%%

	| Plan | Price |
	| --- | ---: |
	| Basic | 10 |
	| Pro | 30 |
	<!-- gogoga-table: {"w":[120,null]} -->
```

The `<!-- gogoga-table: {...} -->` line right under the table is [gogoga Table](https://github.com/JackWeiGogoga/gogoga-table)'s format. It stores what a GFM table can't hold: column widths, colors, merged cells and so on. It's an HTML comment, invisible elsewhere. Leave it out when writing by hand; deleting it only loses those styles, not the table's content.

## Node text

Obsidian's inline syntax works in node text:

- `**bold**`, `*italic*`, `~~strikethrough~~`, `<u>underline</u>`, `==highlight==`
- `[[Note]]` links, `[text](https://…)`, `#tags`, `$E=mc^2$` math
- `![[image.png|160]]` images (the number is the width), `![[clip.mp4|400]]` and `![[clip.mp3]]` players
- Colored text `<span style="color:#e03e3e">text</span>`, colored highlight `<mark style="background:#ffd43b99">text</mark>`, and Obsidian's `==🔴text==` (🔴🟠🟡🟢🔵🟣 or 🟥🟧🟨🟩🟦🟪)
- `<br>` for a line break inside a node; `&nbsp;` for leading or trailing spaces (Markdown drops them)

A few things at the start of the text get special display, but they're just characters:

- **Task box**: `[ ]` / `[x]` first shows a checkbox. `- [ ] Item` is a task in Obsidian too.
- **Icon markers**: emoji at the start (✅ ⏳ ❗ 1️⃣ and so on, plus custom symbols added in the settings) show as icons on the node. With a task box, the task box goes first: `[ ] ⭐ Item`.
- **Answer marker**: 🙈 by default. It can be changed in the settings to another emoji or 2–3 ASCII symbols (such as `::`, followed by a space). Nodes with it are hidden in recite mode. After a change, nodes already marked with 🙈 still count.

## What the plugin changes when it writes

- **Only the lines you changed.** Edit a node in the map and only that line (with its marker) changes in the file. Blank lines, indentation, list bullets, trailing spaces, line endings and your own comments stay byte for byte.
- **Renaming.** When the central topic is a level-1 heading that matches the file name, editing it in the map renames the note, and Obsidian updates links in other notes. If they already differ, nothing is linked; this can be turned off in the settings.
- **If an exact merge isn't possible**, the plugin falls back to writing the whole note in its own format: structure and content are the same, layout (blank lines, indentation) follows the plugin's style. This is rare.
- **Diagnostics (desktop).** If a save empties a note, removes more than 30% of it, or leaves signs of a broken merge, the plugin warns you and keeps a copy of the text before and after outside the vault (in `gogoga-diagnostics/` under Obsidian's app data folder). It stays on this computer: not uploaded, not synced.

## Data kept outside the note

None of this is written into notes. Deleting it doesn't affect a map's content or style, only the related state.

| Data | Where | If lost |
|---|---|---|
| Plugin settings | `data.json` in the plugin folder | Settings go back to defaults |
| View state: lock, expanded notes, hidden callouts | `state.json` in the plugin folder | Those toggles go back to defaults |
| Viewport (pan, zoom, selected node) | This device only, in the vault's browser storage; not synced | The map opens centered |
| Spaced review schedule | `review/` in the plugin folder, one `.json` per deck | Review progress starts over; the cards are still in the notes |

The plugin folder is `<vault>/.obsidian/plugins/gogoga-mindmap/` (or under your renamed config folder).

## Without the plugin

- **Obsidian Reading view**: a note with headings and lists; markers are invisible. A map in a code block shows as plain code.
- **GitHub, Typora and other Markdown editors**: the same outline. `%%…%%` isn't standard Markdown, so some editors show it as text.
- **XMind**: Markdown exported from XMind uses the same heading levels and opens directly; such a note also imports into XMind (markers like colors and boundaries don't carry over). The plugin can also open `.xmind` files directly; that's XMind's own format and outside this page.

## Full example

````markdown
---
mindmap: true
mindmap-structure: mindmap
mindmap-theme: rainbow
---

# Product launch

The launch plan for Q3.

## Goals
%%blue%%

- 10k sign-ups in the first month
- Press coverage in two outlets

## Timeline
%%green callout "Dates are tentative"%%

- Beta %%box "Phase 1"%%
	- Invite 200 users
	- Collect feedback
- Public release
	- Blog post
	- Newsletter

## Risks
%%red fold id=risk%%

- ❗ Payment provider review
	Approval can take up to three weeks.
- Server capacity
	> [!note]
	> - Load test in week 2
	> - Autoscaling as a fallback

## Owners
%%summary "Weekly sync on Mondays" rel=risk "watch risks"%%

- Alice: product
- Bob: engineering

## Next steps

1. Sign the contract
2. Hire a designer
3. Book the venue
````

To have an AI write mind maps for you, give it [`skills/gogoga-mindmap/SKILL.md`](../skills/gogoga-mindmap/SKILL.md), a condensed version of this page.
