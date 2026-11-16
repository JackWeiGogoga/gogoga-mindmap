---
name: gogoga-mindmap
description: Write mind maps for the gogoga Mind Map plugin for Obsidian. Use when the user asks to create, draft, or restructure a mind map, 思维导图 or 脑图 as an Obsidian note or as a mindmap code block inside a note, or to turn notes, an article, a book, a meeting or a plan into one. Covers which Markdown becomes nodes, the frontmatter keys for structure, theme and lines, and the %%…%% markers for color, folding, numbering, width, tables, boundaries, summaries, callouts, floating topics and relationships.
---

# gogoga Mind Map

The plugin has no file format of its own: a mind map is a plain Markdown note. Headings and list items are the nodes, and styling lives in Obsidian comments (`%%…%%`) that don't show in Reading view. Write the note, and it opens as a mind map.

## Where to write it

- **A mind map note**: a `.md` file with `mindmap: true` in its frontmatter. It opens as a map.
- **A map inside an ordinary note**: a fenced code block named `mindmap` (or `gogoga-mindmap`, which works the same) holding the same Markdown. It can have its own frontmatter at the top of the block.
- **An existing map shown in another note**: embed it like any note. `![[Map]]` shows the whole map read-only, `![[Map|80%]]` opens it at 80% zoom, and `![[Map#Heading]]` or `![[Map#^blockid]]` shows only that branch.

## What becomes a node

- The single `#` heading is the central topic. Write exactly one. Without one, the file name is used.
- `##` to `######` headings are the levels below it, in order. Don't skip levels.
- Below headings, nested list items (`-`) are deeper levels. Indent with one tab per level.
- Numbered children: write list children as an ordered list (`1.` `2.` `3.`); the map shows the numbers. For heading children, put `num` in the parent's marker instead (see Markers).
- A plain paragraph right under a heading or list item is that node's **note** (shown behind a ≡ icon, not on the canvas). Under a list item, indent it to the item's child level.
- A note that itself contains list items or headings must be wrapped in a `> [!note]` callout, every line prefixed with `> `. Otherwise those lines turn into nodes. Always leave one blank line after the last `>` line, even when the next node follows right away: without it, Obsidian's Live Preview pulls the next list items into the callout.
- Keep node text short: a keyword or a short phrase. Put explanations in notes.

Good shape for most maps: `##` for main topics, `###` for subtopics, lists below that.

## Frontmatter

```yaml
---
mindmap: true
mindmap-structure: mindmap
mindmap-theme: rainbow
---
```

A `# comment` after a value is fine (as in YAML), but keep the values themselves plain: one word from the lists above, no quotes needed.

| Key | Values |
|---|---|
| `mindmap` | `true`. Only for a mind map note; not needed inside a code block |
| `mindmap-structure` | `logic-right` (default), `mindmap` (left and right), `org-down`, `tree-right`, `timeline-h`, `timeline-h-alt`, `timeline-v-right`, `timeline-v-left`, `timeline-v-alt`, `fishbone-right`, `fishbone-left` |
| `mindmap-theme` | `snow` (default), `rainbow`, `business`, `warm`, `mono`, `line`, `forest` |
| `mindmap-edge` | Line shape: `curve`, `elbow`, `straight`. Leave out to follow the theme |
| `mindmap-edge-dash` | `true` (dashed), `false` (solid). Leave out to follow the theme |
| `mindmap-edge-corner` | Corners of elbow lines: `sharp`, `round`. Leave out to follow the theme |

Leave structure, theme and the edge keys out unless the user asks or the content clearly calls for one (`org-down` for hierarchies and org charts, `mindmap` for a balanced overview with many main topics, a timeline for events in order, a fishbone for cause analysis). Timelines string the main topics along an arrowed axis in order: `timeline-h` is horizontal with every branch on one side, `timeline-h-alt` alternates above and below, `timeline-v-right` / `timeline-v-left` run vertically with branches to the right / left, and `timeline-v-alt` alternates left and right. A fishbone (`fishbone-right`: head on the right, the classic layout; `fishbone-left`: head on the left) puts the problem in the central topic and the cause categories (for example the 6M: people, machines, materials, methods, measurement, environment) as main topics; their children are the concrete causes, and anything deeper is a sub-cause. Keep it to three levels below the head.

## Markers

One `%%…%%` comment per node holds all its markers, separated by spaces, for example `%%blue fold%%`.

- On a **heading**, put the comment on its own line right below the heading (a blank line between them is tolerated, but write it directly below).
- On a **list item**, put it at the end of the line: `- Item %%red%%`.

| Marker | Meaning |
|---|---|
| `red` `orange` `yellow` `green` `teal` `blue` `purple` `pink` `gray`, or a hex color without `#` like `a3e5a2` | Node color |
| `fold` | Collapsed: children are hidden until clicked |
| `num` | Number this node's children (1. 2. 3.). Only needed when the children are headings; list children are numbered by writing them as an ordered list |
| `w=240` | Fixed node width in pixels (60–1200); the text wraps |
| `left` / `right` | In the `mindmap` structure, pin a main topic to that side |
| `table` | The node shows a table: the first Markdown table in its note (see below) |
| `box` / `box=3` / `box "Title"` | Dashed frame around this node and its whole branch; `=3` also takes in the next two siblings |
| `summary "Text"` / `summary=2 "Text"` | Curly brace on the outer side of this node and its whole branch, with the summary text after it; `=2` stretches it over the next sibling too. To summarize several siblings, put it on the first one. `sw=240` after it sets the summary's width |
| `summary-topic=2` | A summary that has its own subtopics: put it on an item written **right after** the siblings it sums up; the item becomes the summary (after the brace) and its children hang off it. `=2` is how many preceding siblings it covers. Use the plain `summary "Text"` when it's just a line |
| `callout "Text"` | Small always-visible bubble next to the node; `<br>` for a line break, add `cc=yellow` (a color name or hex) to fill it. Colored text inside is `<span style='color:#e03e3e'>text</span>` with **single** quotes |
| `hide` | Kept in the note but not shown in the map |
| `float x=320 y=-80` | Floating topic: a child of the central topic drawn unconnected, at that offset in pixels from the central topic |
| `id=r1` and `rel=r1 "Text"` | Relationship: a dashed arrow from the node with `rel=r1` to the node with `id=r1`. Pick any short id (letters, digits, `-`, `_`); one `id=` per node, several `rel=` allowed. The plugin may add `c=40,-60` or `c1=… c2=…` right after a `rel=` for a curve dragged by hand; keep them if present, don't write them yourself |

Text inside a marker can't contain straight double quotes `"` or `%%`. A comment with any word the plugin doesn't know is treated as an ordinary comment and none of it applies, so spell markers exactly as above.

### Tables in nodes

A node with the `table` marker draws the first Markdown table of its note inside the node box. The table is a standard GFM table, optionally followed on the next line by a `<!-- gogoga-table: {...} -->` comment the plugin writes for widths, colors and the like (leave it out when writing by hand). Leave a blank line between the item and the table; under a list item, indent the table to the item's child level. A node that holds only a table can have no text: `- %%table%%`.

```markdown
- Pricing %%table%%

	| Plan | Price |
	| --- | ---: |
	| Basic | 10 |
	| Pro | 30 |
```

Use markers sparingly: color the main topics to tell branches apart, fold branches that are details, and add a callout or a summary only where it says something the nodes don't.

## Inside node text

Inline Markdown works: `**bold**`, `*italic*`, `~~strike~~`, `<u>underline</u>`, `==highlight==`, `[[Note]]` links, `[text](https://…)`, `#tags`, `$E=mc^2$` math, `![[image.png|160]]` images (the number is the width), `![[clip.mp4|400]]` video or `![[clip.mp3]]` audio players (the number is the video's width). `[ ]` / `[x]` at the start renders as a checkbox. Colored text is `<span style="color:#e03e3e">text</span>` and a colored highlighter is `<mark style="background:#ffd43b99">text</mark>`; both can wrap other inline formatting. Obsidian's colored highlights also work: `==🔴text==`, with one of 🔴 🟠 🟡 🟢 🔵 🟣 (or 🟥 🟧 🟨 🟩 🟦 🟪) right after the opening `==`. Markdown drops spaces at the start and end of a heading or list item, so write those as `&nbsp;`. Use `<br>` for a line break inside a node. Markers (priority, progress and so on) are emoji at the start of the text, such as ✅ ⏳ ❗ 1️⃣.

## Example: a mind map note

```markdown
---
mindmap: true
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
%%red fold%%

- ❗ Payment provider review
	Approval can take up to three weeks.
- Server capacity
	> [!note]
	> - Load test in week 2
	> - Autoscaling as a fallback

## Owners
%%summary "Weekly sync on Mondays"%%

- Alice: product
- Bob: engineering

## Next steps

1. Sign the contract
2. Hire a designer
3. Book the venue
```

## Example: a map inside a note

````markdown
```mindmap
---
mindmap-structure: org-down
---

# Team

## Design
- Research
- UI

## Engineering
- Frontend
- Backend
```
````

## Checklist before handing it over

- Exactly one `#` heading, no skipped heading levels, tabs for list indentation.
- Markers under headings are on their own line; markers on list items are at the end of the line. Every word in a marker is one the table above lists.
- No `#` comments after frontmatter values.
- Notes containing lists or headings are wrapped in `> [!note]` and followed by a blank line.
- For a mind map note, `mindmap: true` is in the frontmatter.
