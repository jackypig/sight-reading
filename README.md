# Sight Reader

A sight-reading trainer for clarinet and piano. It makes up short pieces of music,
counts you in, clicks a metronome while you play, and then plays the music back so
you can check yourself. There is also a "Name It" drill for reading notes quickly,
and a progress page that remembers how practice is going.

Plain HTML, CSS and JavaScript — no build step, no install, no account, no network
calls. Everything it saves stays in the browser on that device.

![The reading screen: four bars in F major for clarinet](docs/screenshot.jpg)

## Running it

**On this computer** — double-click `index.html`. That is all.

**On a tablet on the same wifi** — serve the folder from the computer:

```powershell
powershell -ExecutionPolicy Bypass -File .\serve.ps1 -AllowLan
```

It prints an address like `http://192.168.1.20:8787` — open that in the tablet's
browser. `-AllowLan` needs an elevated PowerShell window the first time; without it
the server is reachable only as `http://localhost:8787` on this machine.

On an iPad, Safari's **Share → Add to Home Screen** gives it an icon and a full
screen. Tap something on the page once before expecting sound — browsers only allow
audio after a tap.

## The three screens

### Read

Generates a few bars of music and shows them in real notation.

- **Count in & play along** — one bar of clicks, then the metronome keeps time while
  he plays. A blue highlight slides along so he can see where the beat is.
- **Hear it** — plays the same music back (clarinet or piano sound) to check against.
- **New music** — a fresh exercise.
- After a play-along it asks how it went; either answer brings up the next exercise.

Clarinet exercises are **written pitch**: the key shown is the written key and the
playback sounds a major 2nd lower, exactly like the instrument. Piano can be treble,
bass, or grand staff with a left-hand part.

#### Made up, or a famous tune

The **Music** switch decides where the notes come from. *Made up* is fresh random
music every time. *Famous tune* pulls a real melody out of the library — and does
not say which one. The pill reads **Mystery tune** until he presses *What is this
tune?* (or `R`), so the fun is playing it, hearing it come out as something he
knows, and only then finding out he was right.

Tunes carry their own key, time signature and length, so those settings are
ignored while a tune is on screen. Each one is transposed into the right key for
the instrument — a tune in concert C becomes D major on the clarinet — and shifted
by octaves to sit on the staff. A tune only appears once its level is reached:

| Level | New tunes at this level |
|---|---|
| 1 | Ode to Joy · Twinkle, Twinkle · Mary Had a Little Lamb · Jingle Bells |
| 2 | Old MacDonald · Yankee Doodle · Ode to Joy (full theme) |
| 3 | Frère Jacques · Three Blind Mice |
| 4 | Happy Birthday · Beethoven's Fifth |

**Why these and not Star Wars.** Everything in the library is public domain —
traditional songs and classical themes old enough to be out of copyright. Current
pop and film music is still in copyright, so its notation cannot be reproduced
here. Adding more is one line of data in `js/tunes.js`; the format is documented at
the top of that file, and every bar is checked for the right number of beats when
the page loads, so a typo shows up immediately.

### Name It

Shows one note at a time for twenty questions. Answer by tapping a letter (with the
♭/♮/♯ switch) or by finding the note on an on-screen keyboard. Instant right/wrong,
timed, scored, with a streak. Wrong answers show the correct key in green.

### Progress

Day streak, minutes practiced today and all time, a seven-day bar chart, note-naming
accuracy, which notes are being missed most, and accuracy by key signature.

## Levels

Five steps rather than three, so a month of practice has somewhere to go. The
app prints what the current level means under the level buttons.

| | 1 · Start | 2 · Easy | 3 · Steady | 4 · Push | 5 · Challenge |
|---|---|---|---|---|---|
| Clarinet range (written) | C4–G5 | A3–A5 | G3–C6 | F3–C6 | E3–C6 |
| Piano, treble | C4–C5 | A3–E5 | G3–G5 | F3–C6 | E3–E6 |
| Piano, bass | C3–C4 | A2–E4 | F2–G4 | E2–A4 | C2–C5 |
| Keys | C, F | C, G, F | C, G, D, F | + B♭ | + A (or E♭ on piano) |
| Rhythms | whole, half, quarter | + dotted half | + eighths | + dotted quarter | + sixteenths |
| Famous tunes available | 4 | 7 | 9 | 11 | 11 |

Rests and accidentals are off by default — switch them on under **More settings**,
along with key, time signature (4/4, 3/4, 2/4), bar count, metronome behaviour and
volume. Clarinet keys are written keys, the ones that actually turn up in band music
for a B♭ instrument.

Tempo has a slider from 40 to 160 plus four preset buttons. Slow is the point: at
54 there is time to look ahead.

## Keyboard shortcuts

| Key | Does |
|---|---|
| `Space` | Count in and play along (starts a round in Name It) |
| `H` | Hear the exercise |
| `N` | New exercise |
| `R` | Reveal which famous tune this is |
| `1`–`5` | Level |
| `A`–`G` | Answer in Name It |
| `#` / `b` / `n` | Sharp / flat / natural for the next answer |

## How it is put together

```
index.html        markup for the three screens
css/styles.css    tablet-first styling, light and dark
js/theory.js      notes, keys, instrument ranges, transposition
js/generator.js   makes the exercises (rhythm first, then the melody)
js/tunes.js       the famous-tune library, and transposing one to fit
js/notation.js    draws with VexFlow, reports note positions for the highlight
js/audio.js       Web Audio metronome, synth and transport
js/storage.js     progress and settings in localStorage
vendor/vexflow.js VexFlow 4.2.2, vendored so the app works offline
serve.ps1         small static server for reaching the app from a tablet
```

Exercises are built rhythm-first: each bar is filled with beat-aligned groups
(eighths in pairs, dotted quarter plus eighth, and so on) so nothing unreadable comes
out, then a melody is walked over that rhythm — mostly steps, occasional leaps,
bouncing off the ends of the range, always landing on the tonic.

Progress lives under the `sightReading.v1` key in localStorage. It never leaves the
device, and **Clear all progress** on the Progress screen wipes it.

## Possible next steps

- **Listening through the microphone** — pitch detection so the app can tell whether
  what he played matched, instead of him judging it himself. Deliberately left out of
  this version: it is the biggest piece of work here and worth doing on its own.
- A clarinet fingering chart in the drill, so a wrong answer shows the fingering.
- Minor keys, 6/8, key signatures beyond the current set.
- Two-hand independence exercises for piano, and separate left/right-hand drilling.
- Exporting a week's practice as a summary for a teacher.
