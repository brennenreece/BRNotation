x# BRNotation User Guide

BRNotation renders music notation, guitar tablature, chord charts, chord diagrams, and fretboard scale maps inside Obsidian notes. You write a short text description inside a code block, and the plugin draws it as a score or diagram.

## Contents

1. [Quick start](#quick-start)
2. [Block basics](#block-basics)
3. [Standard notation](#standard-notation)
4. [Tablature](#tablature)
5. [Coupled notation and tablature](#coupled-notation-and-tablature)
6. [Chord charts](#chord-charts)
7. [Chord diagrams](#chord-diagrams)
8. [Fretboard scale maps](#fretboard-scale-maps)
9. [Barline reference](#barline-reference)
10. [Durations](#durations)
11. [Tunings and scales](#tunings-and-scales)
12. [Settings](#settings)
13. [Troubleshooting](#troubleshooting)

---

## Quick start

1. Place the cursor where you want the block.
2. Open the command palette (`Cmd/Ctrl + P`).
3. Run one of the insert commands:
   - **Insert standard notation block**
   - **Insert guitar tablature block**
   - **Insert coupled notation and tab block**
   - **Insert chord chart**
   - **Insert chord diagram**
   - **Insert fretboard scale diagram**
4. Edit the text inside the block. The rendered output updates when you leave the block or switch to reading view.

Each command inserts a block like this:

```brnotation
mode: notation
time: 4/4
key: C

| c4/q d4/q e4/q f4/q | g4/h g4/h |
```

---

## Block basics

A block is a fenced code block with the language set to `brnotation`:

````markdown
```brnotation
mode: notation
time: 4/4

| c4/q d4/q e4/q f4/q |
```
````

### Header lines

Header lines go at the top of the block. Each has the form `key: value`. Keys are not case-sensitive.

| Key | Used by | Meaning |
|---|---|---|
| `mode:` or `type:` | all | One of `notation`, `tab`, `coupled`, `chordchart`, `chord`, `fretboard`. `chordgrid` is accepted as an alias for `chordchart`. |
| `title:` | notation, tab, coupled, chordchart, fretboard | Title shown above the output. |
| `time:` | notation, tab, coupled, chordchart | Time signature, such as `4/4`, `3/4`, `6/8`. In chordchart blocks, add `visible = false` after it (`time: 4/4 visible = false`) to hide the signature. |
| `key:` | notation, coupled | Key signature, such as `C`, `G`, `Bb`, `F#m`. |
| `clef:` | notation, coupled | `treble`, `bass`, or `alto`. Defaults to the setting in Settings. |
| `glyphs:` | notation, coupled | `font` (default) draws the staff with the music font's glyphs (noteheads, clefs, flags, rests, accidentals). Coupled blocks also draw the tab in the same drawing. `vexflow` keeps VexFlow's built-in shapes. Tab-only blocks always use the font drawing, so their tab matches coupled tab. Beams in `font` mode group 8ths every two beats (every beat in compound meters like 6/8), triplets and 16ths and 32nds every beat. Rests and longer notes break a group, and groups never cross a barline. |
| `tuning:` | tab, coupled, chord, fretboard | A tuning name from [Tunings and scales](#tunings-and-scales). |
| `per-row:` or `perrow:` | chordchart | Measures per row. |
| `name:` or `chord:` | chord | Chord name shown above the diagram. |
| `frets:` | chord | Fret for each string, or `x` to mute. |
| `fingers:` | chord | Finger number for each string, or `-` for none. |
| `base-fret:` or `basefret:` | chord | Fret number of the top of the diagram. Defaults to 1. |
| `root:` | fretboard | Root note of the scale, such as `A` or `F#`. |
| `scale:` | fretboard | Scale name from [Tunings and scales](#tunings-and-scales). |
| `base-fret:` | fretboard | First fret shown. The map keeps a 12-fret span from there. Default starts at fret 0. |
| `show:` | fretboard | `degrees` (default) or `notes`. |
| `style:` | chord, fretboard | Dot style for the whole diagram. See [Diagram styles](#diagram-styles). |
| `color:` | chord, fretboard | Named colour for all dots: `accent`, `red`, `green`, `blue`, `orange`, `purple`, or `muted`. |
| `notes:` | fretboard | Notes to draw, one by one, as `fret/string`. A `-` between two notes draws a line joining them. See [Entering notes one by one](#entering-notes-one-by-one). |
| `line:` | fretboard | Width in pixels of the lines joining linked notes, from 1 to 10. Default 1. |

### Comments and titles

Lines that start with `//` are comments and are ignored:

```brnotation
// This line is ignored
mode: notation
```

A line that starts with `# ` (hash and a space) sets the title:

```brnotation
# Autumn Leaves Theme
mode: notation
time: 4/4

| c4/q d4/q e4/q f4/q |
```

### Mode detection

If you leave out `mode:` or `type:`, the plugin picks a mode:

- A `name:`, `chord:`, or `frets:` line makes the block a chord diagram.
- A `root:` or `scale:` line makes the block a fretboard scale.
- Lines that look like chord names separated by `|` make the block a chord grid.
- Otherwise the block is standard notation.

It is safer to set `mode:` explicitly.

---

## Standard notation

Use `mode: notation` for standard staff notation.

```brnotation
# Ode to Joy
mode: notation
time: 4/4
key: C
clef: treble

| e4/q e4/q f4/q g4/q | g4/q f4/q e4/q d4/q | c4/q c4/q d4/q e4/q | e4/q. d4/8 d4/h |
```

### Pitch syntax

Write each note as `letter`, optional accidental, octave, slash, and duration:

```
c4/q      C in octave 4, quarter note
f#4/h     F-sharp, half note
bb3/8     B-flat, eighth note
g4/q.     G, dotted quarter note
c4/8t     C, triplet eighth note (three in the time of two)
```

- Accidentals are `#` (sharp) and `b` (flat).
- Add `t` after the duration for a triplet note, such as `c4/8t` or `d4/16t`. Three triplet eighths fill one beat.
- Use `:8t` on its own to make every following note a triplet eighth until a plain duration directive such as `:8` or `:q`. For example, `| :8t g4 g4 g4 | :8 c4 d4 |`.
- Wrap notes in `< >` to beam them together as one group, such as `| :8t <g4 g4 g4> <g4 g4 g4> |`. Notes outside `< >` use the automatic beaming rules. A group should not cross a barline.
- Add `~` after a note to tie it to the next note of the same pitch, such as `| :8t <g4~ g4 g4> |` or `| c4/h~ c4/h |`. The tie is drawn as an arc on both the staff and the tab. A tie that reaches a barline is drawn as a short arc at the measure's right edge.
- Octave 4 is the octave that starts at middle C.

### Rests

```brnotation
mode: notation
time: 4/4

| c4/q r/q e4/h | r/h g4/h |
```

Use `r/` followed by a duration. `rest/` also works.

### Stacked notes (chords) in coupled mode

Wrap notes that sound together in square brackets with one duration, for example `[c4,e4,g4]/q`. Coupled mode draws them stacked on the staff and places the matching frets on the tab.

To choose the exact frets, give each note its own `(fret/string)` after the pitch:

```
| :q [c4(5/3),e4(5/2),g4(3/1)] [a3,c4,e4] |
```

The first chord uses frets 5, 5, 3 on strings 3, 2, 1. Chords without positions are placed automatically. A chord uses explicit positions only when every note has one; otherwise all of its notes are placed automatically.

### Chord symbols above the staff

Put a chord name in double quotes. The symbol sits above the next note or rest, so it can appear before any note in a bar, not just the first. A chord symbol takes no beat of its own:

```brnotation
mode: notation
time: 4/4
key: G

| "G" g4/q b4/q d5/q g5/q | "C" c4/h e4/h |
```

```brnotation
mode: notation
time: 4/4
key: C

| c4/q "Am7" d4/q e4/q "G7alt" f4/q | g4/h "Cm7b5" r/q |
```

Chord names are shown exactly as you type them, so any jazz quality works, for example `Cmaj7`, `Dm7`, `G7`, `C7alt`, `Cm7b5`, `C7#9`, `G7sus4`, or `C/E`. In `coupled` blocks the chord symbol sits above the notation staff, not the tab. The chord symbol starts at the left edge of its notehead. When the note sits above the staff, the chord symbol is raised to clear it, and the space between systems makes room for it. The default height is set by **Chord symbol distance** in the plugin settings. A chord symbol with no note or rest after it is reported as an error.

### Lyrics

Add a `w:` line directly under a notation line to set words under the notes, the same way as ABC notation. Each whitespace-separated syllable goes under one note, in order:

| Syntax | Meaning |
|--------|---------|
| `Ma-` | A syllable. A trailing `-` joins it to the next syllable of the same word. |
| `_` | Melisma: the previous syllable continues over this note, drawn as a line. |
| `*` | Skip: this note gets no text. |

```brnotation
mode: notation
time: 4/4
key: C

| c4/q d4/q e4/q f4/q | g4/q a4/q b4/q c5/q |
w: Ma- ry had a lit- tle lamb
```

```brnotation
mode: notation
time: 4/4
key: C

| c4/q d4/q e4/q f4/q | g4/h c5/h |
w: Hal- le- lu _ jah
```

Lyrics also work in `coupled` blocks, under the notation staff. A `w:` line that has more syllables than the block has notes is reported as an error.

### Note text and circles

Put a `{...}` block directly after a note to annotate that note. Use it for scale degrees or short performance notes. Text uses the system sans-serif font, and is smaller than chord symbols. Chord symbols and lyrics are separate features.

| Item | Meaning |
|------|---------|
| `above:text` | Text centered above the notehead |
| `below:text` | Text centered below the notehead |
| `circle` | A ring around the notehead |

Separate items with spaces. Quote text that contains spaces.

```brnotation
mode: notation
time: 4/4
key: C

| c4/q{above:1} d4/q{above:2} e4/q{above:3 below:"sweet"} f4/q{circle} |
```

Annotations draw on notes in `notation` and `coupled` blocks. In a coupled block, `circle` also rings the fret number on the tab. Tab-only blocks don't draw annotations yet. A `{...}` block with an unknown item is reported as an error.

### Multiple measures per line

Lines break by width. The plugin fits as many measures on each line as the minimum note spacing allows, up to 4 (see [Settings](#settings)). Use `per-row:` in chord grids to change this for those blocks.

To start a new line at a specific measure, put `\` immediately before that measure. The break is forced, and the lines around it still follow the width rules:

```brnotation
mode: notation
time: 4/4
key: C
clef: treble

| c4/q d4/q e4/q f4/q | g4/h c5/h | \ c5/q b4/q a4/q g4/q | f4/h e4/h |
```

---

## Tablature

Use `mode: tab` for guitar tablature.

```brnotation
# Riff in A minor pentatonic
mode: tab
tuning: standard

| :q 1/1 2/1 3/1 5/1 | :h 2/1 0/2 |
```

### Tab syntax

Write each note as `fret/string`, the same order VexTab uses. The fret comes first, then a slash, then the string number.

```
1/1       fret 1 on string 1
5/3       fret 5 on string 3
0/6       fret 0 (open) on string 6
```

Durations are set with a directive written as its own token, for example `:q`. The directive applies to every following note until the next directive:

```
:q 1/1 2/1     two quarter notes
:8 5/3 7/3     two eighth notes
:h 0/6         half note
```

Duration values: `:w` whole, `:h` half, `:q` quarter, `:8` eighth, `:16` sixteenth, `:32` thirty-second. A dot after the value is not supported yet.

- **Strings are numbered 1 to 6.** String 1 is the highest string (high E, E4 in standard tuning) and string 6 is the lowest (low E, E2). The order from string 6 to string 1 is low E, A, D, G, B, high E. A 4-string bass uses strings 1 to 4.
- A rest is `r`. It uses the current duration, like a note.

```brnotation
mode: tab
tuning: drop-d

| :q 1/1 r 3/2 5/2 | :h 0/0 r |
```

### Tuning

Set `tuning:` to one of the names in [Tunings and scales](#tunings-and-scales). If you leave it out, the plugin uses `standard`.

```brnotation
mode: tab
tuning: bass-4

| :q 1/1 3/2 5/3 | :h 0/1 |
```

---

## Coupled notation and tablature

Use `mode: coupled` to show standard notation with tablature below it. Each note is written as `pitch(fret/string)`, and durations use the same `:q` directives as tab. The notation and tab digits are drawn from the same entry, so they line up.

```brnotation
# Autumn Leaves Theme
mode: coupled
time: 4/4
key: G

| :q e4(1/1) f#4(2/1) g4(3/1) a4(5/1) | :h f#4(2/1) d4(0/2) |
```

- The pitch inside the parentheses sets the note on the staff.
- The `fret/string` pair inside the parentheses sets the tab position.
- Keep the pitch and the tab position consistent with the tuning. The plugin does not check this for you.

---

## Chord charts

Use `type: chordchart` for a chord chart. Older blocks that use `type: chordchart` still render the same way. Chords sit above a staff with the same barlines as staff notation, and each beat gets a slash.

```brnotation
type: chordchart
title: 12-Bar Blues
time: 4/4
per-row: 4

[Blues]
|: C7 | F7 | C7 | C7 :|
| F7 | F7 | C7 | A7 |
| Dm7 | G7 | C7 A7 | Dm7 G7 |
```

### Syntax

- `[Name]` on its own line starts a section, such as `[Verse]` or `[Chorus]`.
- Each line holds measures separated by `|`.
- Write the chords for each measure separated by spaces. Two chords in one measure share it equally: `C7 A7`.
- Barlines use the same tokens as staff notation: `|`, `||`, `|.`, `|:`, and `:|` (see [Barline reference](#barline-reference)).
- Each measure shows one slash per beat of the time signature, so 4/4 gets four slashes and 3/4 gets three.
- `per-row:` sets how many measures go on each line.
- `time:` shows a stacked time signature (for example 4 over 4) at the start of each line. There is no clef.
- `time: 4/4 visible = false` hides the time signature. The grid still uses 4/4 for the beat slashes.

```brnotation
type: chordchart
time: 3/4 visible = false
per-row: 3

| Am | Dm | E7 |
```

```brnotation
type: chordchart
title: Simple Verse
time: 3/4
per-row: 2

[Verse]
| Am | Dm | E7 | Am |
| C | G | Am | E7 |
```

### Roman-numeral functions

Add `chord function = true` to show a roman-numeral label under each chord. Set `key:` so the numerals are relative to the right tonic. Without `chord function = true`, no labels appear.

To write the functional harmony directly, type roman numerals as the chords. Use uppercase for major, lowercase for minor, and `b` or `#` for chromatic degrees (`bVII` shows as ♭VII):

```brnotation
type: chordchart
time: 4/4
per-row: 4

|: I7 | I7 | I7 | I7 |
| IV7 | IV7 | I7 | I7 |
| V7 | V7 | I7 | I7 :|
```

```brnotation
type: chordchart
title: Simple Verse
time: 4/4
key: C
chord function = true
per-row: 4

[Verse]
| C | Am | F | G7 |
| C | Am | Dm | G7 |
```

Numerals use uppercase for major chords and lowercase for minor and diminished chords. A chord outside the key gets a sharp prefix, such as `♯iv`.

### Measure numbers

Measure numbers are hidden by default. Add `measure numbers = true` to show a small number in the top-left corner of each measure.

```brnotation
type: chordchart
title: Simple Verse
time: 4/4
measure numbers = true

| C | Am | F | G7 |
| C | Am | Dm | G7 |
```

The time signature appears only on the first line of the chart.

---

## Chord diagrams

Use `type: chord` for a guitar chord box.

```brnotation
type: chord
name: Am7
frets: x 0 2 0 1 0
fingers: - - 2 - 1 -
base-fret: 1
```

### Syntax

- `frets:` lists the fret for each string from low to high. Use `x` for a muted string and `0` for an open string.
- `fingers:` lists the finger number for each string. Use `-` for no finger.
- `base-fret:` sets the top fret shown. Use a higher number for chords higher up the neck:

```brnotation
type: chord
name: F barre
frets: 1 3 3 2 1 1
fingers: 1 3 4 2 1 1
base-fret: 1
```

```brnotation
type: chord
name: Bm barre at fret 7
frets: x 2 4 4 3 2
fingers: - 1 3 4 2 1
base-fret: 2
```

Chord boxes use the same look and dot styles as fretboard maps, so a `style:` line works here too. See [Diagram styles](#diagram-styles).

### Several chord boxes in one block

Write a new `name:` line to start the next box. Each box needs its own `name:` and `frets:` lines. Use `columns:` to set how many boxes sit in each row (default: all boxes in one row):

```brnotation
columns: 3
name: C
frets: x 3 2 0 1 0
name: Am
frets: x 0 2 2 1 0
name: F
frets: 1 3 3 2 1 1
name: G
frets: 3 2 0 0 0 3
name: Dm
frets: x x 0 2 3 1
name: E7
frets: 0 2 0 1 0 0
```

`fingers:` and `base-fret:` belong to the box above them. Put them after that box's `frets:` line.

Use `size:` to set how big each box is, as the number of boxes that would fit across the pane. `size: 5` is the size of a box in a row of five, and `size: 3` boxes are larger. `columns:` still sets how many boxes sit in each row, so boxes keep the same size when you change `columns:`. Without `size:`, boxes fill the row width.

```brnotation
columns: 3
size: 5
name: C
frets: x 3 2 0 1 0
name: Am
frets: x 0 2 2 1 0
name: F
frets: 1 3 3 2 1 1
```

Use `row:` on its own line to start a new row. The boxes after it go in that row, whatever `columns:` says, so you can choose which boxes share a row. Without `row:`, `columns:` wraps the boxes into rows.

```brnotation
align: center
name: C
frets: x 3 2 0 1 0
name: Am
frets: x 0 2 2 1 0
row:
name: F
frets: 1 3 3 2 1 1
name: G
frets: 3 2 0 0 0 3
```

Use `align:` to place the boxes left, center, or right. `align: center` centers each column in the block and centers the boxes inside their columns. `align: left` is the default.

```brnotation
columns: 3
align: center
name: C
frets: x 3 2 0 1 0
name: Am
frets: x 0 2 2 1 0
name: F
frets: 1 3 3 2 1 1
```

Use `chord-font:` to set the font for the chord names above the boxes in one block. Options: `system`, `julesjazz`, `musejazz`. Without it, the block uses the **Chord box font** setting. The `chord-font:` option changes only chord box names, not chord symbols in staff or chord grid blocks.

```brnotation
columns: 2
chord-font: julesjazz
name: Cmaj7
frets: x 3 2 0 0 0
name: A7
frets: x 0 2 0 2 0
```

Chord box strings are drawn in black. Fret lines and the nut are black too.

Use `fret-count:` to set how many fret spaces each box draws. The default is 5. Use a whole number from 3 to 7. Every fret space is the same height, so a box with fewer frets is shorter and a box with more frets is taller. It applies to every box in the block:

```brnotation
fret-count: 4
name: Am
frets: x 0 2 2 1 0
name: C
frets: x 3 2 0 1 0
```

A `size:` value outside 1 to 8, a `columns:` value that is not a whole number, an `align:` value that is not left, center, or right, a `chord-font:` value that is not one of the options above, or a `fret-count:` value outside 3 to 7 shows an error above the box.

Use `tuning:` to draw a chord for another tuning:

```brnotation
type: chord
name: D5 power chord
tuning: drop-d
frets: 0 0 x x x x
base-fret: 1
```

---

## Fretboard scale maps

Use `type: fretboard` to show where a scale's notes sit on the fretboard.

```brnotation
type: fretboard
title: A Minor Pentatonic
root: A
scale: minor-pentatonic
show: degrees
```

### Syntax

- `root:` sets the root note, such as `A`, `C#`, or `Eb`.
- `scale:` sets the scale name (see [Tunings and scales](#tunings-and-scales)).
- `show:` is `degrees` to label notes by scale degree (1, b3, 5), or `notes` to label them by note name.
- `tuning:` sets the instrument tuning. The default is `standard`.
- `base-fret:` sets the first fret shown. `base-fret: 5` shows frets 5 to 17. Leave it out to start at the open strings.

```brnotation
type: fretboard
title: D Dorian, note names
root: D
scale: dorian
tuning: standard
show: notes
```

```brnotation
type: fretboard
title: Drop D bass pentatonic
root: D
scale: major-pentatonic
tuning: drop-d
show: degrees
```

### Diagram styles

Chord boxes and fretboard maps share one dot style. Set it per block with `style:`, or leave it out to use the default from Settings.

| Style | Look |
|---|---|
| `classic` | Root filled in the accent colour, other notes outlined. This is the default. |
| `filled` | All dots filled in the root colour. |
| `outlined` | All dots outlined, with a light fill. |
| `ghost` | White fill with a dashed outline, for optional or passing notes. |
| `accent-outline` | Accent-coloured ring on a background-coloured dot. |
| `tone-ring` | Thick outline, for emphasis without a fill. |
| `muted` | Low-contrast dot, for background or avoid notes. |
| `square` | Square dot instead of a circle. |
| `diamond` | Diamond dot instead of a circle. |
| `numbered-role` | Dot looks like `classic`. Pair it with `display: degrees` to show scale degrees as labels. |
| `inverted` | Dark dot with a white label. |

Use `color:` to set one named colour for every dot in a block. Use `{style,color}` on a single note to set both for that note. Colours come from your Obsidian theme, so they change with it. Solid dots (`filled`, `inverted`, and any named colour) get white labels.

```brnotation
type: fretboard
root: A
scale: minor-pentatonic
style: outlined
```

### Entering notes one by one

Use `notes:` on a fretboard block to draw exactly the notes you list, in place of the scale. Each note is written as `fret/string`, using the same string numbers as tab (1 = high E). Each note may add two options directly after it:

- `{style}` sets the dot style for that note only, such as `{root}`, `{square}`, or `{diamond}`. Any style from the table above works.
- `{style,color}` also sets a colour for that note. Leave the style empty to change only the colour: `{,red}`.
- `=label` replaces the note name with your own text, such as `=R` or `=b3`.

```brnotation
type: fretboard
title: A minor pentatonic, hand-placed
root: A
tuning: standard
style: outlined
notes: 5/6{root} 8/6 5/5{square,red} 7/5=R 5/4{ghost}
```

Notes can be listed in any order, and they can go anywhere on the neck. Dots are plain by default. The `root:` setting does not accent any dot, so use `{root}` on a note to accent it. Lines that fail to read appear as errors under the block.

To connect two notes with a line, put a `-` between them. The line joins the centres of the two dots and is drawn underneath the dots, so it never covers the labels. Use `line:` to change its thickness in pixels (default 1):

```brnotation
type: fretboard
title: Shape with connections
root: A
line: 2
notes: 3/4=1 - 2/3=3 - 1/2=5 - 1/1=1
```

A `-` only links the note before it to the note after it, so a chain of `-` draws a connected path. Lines between notes are drawn only where you write `-`.

---

## Barline reference

Barlines separate measures. Use these tokens in notation, tab, coupled, and chord grid blocks:

| Token | Meaning |
|---|---|
| `\|` | Single barline |
| `\|\|` | Double barline |
| `\|.` | End barline (thicker) |
| `\|:` | Repeat start |
| `:\|` | Repeat end |
| `:\|:` | Repeat end and repeat start |

Example:

```brnotation
mode: notation
time: 4/4

|: c4/q d4/q e4/q f4/q :| g4/h g4/h |.
```

In a markdown note, escape each `|` as `\|` only inside table cells. In a code block, use `|` as-is.

---

## Durations

| Code | Duration |
|---|---|
| `w` | Whole |
| `h` | Half |
| `q` | Quarter |
| `8` | Eighth |
| `16` | Sixteenth |
| `32` | Thirty-second |

Add a `.` after the duration for a dotted note: `c4/q.` is a dotted quarter.

---

## Tunings and scales

### Tuning names

Use these names with `tuning:`:

| Name | Strings (lowest to highest) |
|---|---|
| `standard` | E2 A2 D3 G3 B3 E4 (default) |
| `drop-d` | D2 A2 D3 G3 B3 E4 |
| `dadgad` | D2 A2 D3 G3 A3 D4 |
| `open-d` | D2 A2 D3 F#3 A3 D4 |
| `open-g` | D2 G2 D3 G3 B3 D4 |
| `bass-4` | E1 A1 D2 G2 |
| `bass-5` | B0 E1 A1 D2 G2 |
| `ukulele` | G4 C4 E4 A4 |

### Scale names

Use these names with `scale:`:

| Name | Notes |
|---|---|
| `major` | Major scale |
| `minor` | Natural minor |
| `minor-pentatonic` | Minor pentatonic |
| `major-pentatonic` | Major pentatonic |
| `blues` | Blues scale |
| `dorian` | Dorian mode |
| `mixolydian` | Mixolydian mode |
| `harmonic-minor` | Harmonic minor |
| `melodic-minor` | Melodic minor |
| `chromatic` | All 12 notes |

---

## Settings

Open **Settings → BRNotation** to change these options.

| Setting | Default | Effect |
|---|---|---|
| Default instrument tuning | Standard | Tuning used when a block does not set `tuning:`. |
| Audio auditioning and playback | On | Plays a note when you click a key, fret, or note in the editor. |
| Default clef | Treble | Clef used when a notation block does not set `clef:`. |
| Maximum measures per line | 4 | Upper limit on measures per staff line (slider range 1 to 8). Lines also break when the next measure would not fit at its minimum width. |
| Spacing after barlines and time signature | 1 | Scales the space after barlines and the time signature in staff notation (slider range 0.5 to 3). Raise it for more room. |
| Space between systems | 20 | Vertical space in pixels between staff systems in staff notation (slider range 0 to 120). Raise it to separate lines more after breaks. |
| Chord symbol distance | 8 | Default height in pixels of chord symbols above the top staff line (slider range 0 to 40). A chord over a note above the staff is raised further so it does not overlap the notehead. |
| Chord symbol font | System default | Font for chord names. Options: System default, JulesJazz (jazz), or MuseJazz (jazz). |
| Chord box font | System default | Font for chord names above chord boxes. Options: System default, JulesJazz (jazz), or MuseJazz (jazz). A block's `chord-font:` overrides it. |
| Chord symbol font size | 16 | Base size in pixels for chord names. Jazz fonts are scaled up from this value automatically. |
| Diagram dot style | Inverted | Default dot style for chord boxes and fretboard maps. A block's `style:` overrides it. |
| Staff notation font | Bravura | Music font for staff and tab notation. Options: Bravura, Petaluma (handwritten), Leland, JulesJazz (jazz), Gootville (engraved), MuseJazz (jazz). |
| Tab number font | System default | Font for fret numbers on tablature. Options: System default, Monospace, Serif, JulesJazz (jazz), MuseJazz (jazz). |
| Tab number font size | 13 | Size in points for fret numbers on tablature (8–24). Tab lines widen automatically when the numbers are large enough to overlap in chords. |

### Font options

The music fonts are open source (SIL Open Font License 1.1) and are bundled with the plugin:

- **Bravura** is the standard SMuFL music font and the default.
- **Petaluma** has a handwritten look.
- **Leland** is the font used by MuseScore.
- **Gootville** is an engraved-style font based on Bravura.
- **MuseJazz** is a handwritten jazz-style font.
- **JulesJazz** is a jazz-style font.

For **Tab number font**, the fret numbers use the font you choose. JulesJazz and MuseJazz give jazz-style digits. The **Tab number font size** setting controls their size. Tab string lines start at the staff spacing and widen only when the numbers need more room, so stacked chord numbers stay readable.

For **Chord symbol font**, JulesJazz and MuseJazz give jazz-style chord names. Both include letters, digits, and the usual chord symbols (#, b, +, -, °, ø).

Changes to the staff font apply to blocks rendered after the change. Reopen or re-render a note to see the new font.

Example chord chart. With **Chord symbol font** set to JulesJazz, the chord names use the jazz font:

```brnotation
type: chordchart
time: 4/4

| Bbmaj7 | Gm7 C7 | Fmaj7 | Fmaj7 |
```

Example, a block that overrides the default clef:

```brnotation
mode: notation
clef: bass
time: 4/4
key: Bb

| bb2/h d3/h | f2/h. g2/8 |
```

---

## Troubleshooting

- **A line of red text under a block** means the parser could not read that token. It names the token and measure. The rest of the block still renders.

**The block shows raw text instead of a score.**
The block probably has no `brnotation` language tag. Check that the opening fence reads ` ```brnotation `.

**A note is in the wrong place.**
Check the octave (`c4` is middle C). For tab, check the string number. String 1 is the high E string and string 6 is the low E string.

**A measure is cut off or spills onto the next line.**
Each measure must be enclosed by barlines. Check for a missing `|`. Use `per-row:` in chord grids to change the number of measures per line.

**A tuning or scale name is not recognized.**
Use one of the names in [Tunings and scales](#tunings-and-scales). Names are case-insensitive but must match exactly (for example, `minor-pentatonic`, not `minor pentatonic`).

**The fretboard or tab does not match the notation.**
Check that the `tuning:` value matches what you intend. The tab digits are drawn from the string and fret you write, so they only match the staff if the pitch in the parentheses is correct for that string and fret.

**The chord diagram looks wrong.**
`frets:` must list one value per string, and the count must match the tuning (usually six). Use `x` for muted strings.

**The output did not update after I edited a block.**
Click outside the block, or switch to reading view, to re-render.
