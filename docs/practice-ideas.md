# Ideas: what the session variables could do for a young player

Oct 12, 2026

The app's one aim is that the player wants to pick the instrument up again tomorrow. This page takes the 14 variables in
[Practice Session: Atomic Variables](practice-session-variables.md) and asks what each could give a child that they would
look forward to seeing. Every idea only ever adds: nothing here can be lost by skipping a day.

## Where the app stands against the 14 variables

The detector already sees most of the sound variables every frame, then throws them away. What a saved session keeps is
the `runs` timeline (playing, quiet, paused) and the figures made from it. The doc's variables, as the app has them now:

| Variable | Seen live | Kept after the session |
| --- | --- | --- |
| P1 start, P2 control actions | Yes (`Session`) | Yes (`start`, `end`, `runs`) |
| P3 capture gaps | Partly: time away counts like a pause (`Session.away`); the microphone asleep is noticed, not stored | Folded into paused time |
| P4 waveform | Only with the Record setting on, for playback on the summary | No, and it should stay that way by default |
| P5 noise floor | Yes (`floor` in `MusicDetector`) | No |
| P6 room | Not measured (the room tests only check detection copes) | No |
| P7 source class | Yes, as a guess: `instrument` (piano, clarinet, flute, cello, violin), `kind` (music, voice, percussive, noise) | No |
| P8 performer | No. Everything that sounds like an instrument is the student | No |
| P9 to P11 events | Yes, roughly: `OnsetTracker` gives a note start, the detector gives the pitch while it holds | Only as `runs` |
| P12 pitch | Yes, every frame (`pitch`, `midi`), and a 40 s note histogram (`hist`, `range`) | No |
| P13 amplitude | Yes, every frame (`levelDb`) | No |
| P14 spectral shape | Partly: inharmonicity, decay, vibrato, odd-harmonic ratio and brightness, for classifying the instrument | No |

So the first job for almost every idea below is the same, and it is small: keep a compact list of notes with each saved
session. That one change unlocks most of this page.

**The notes record.** For each note start: when (τ, to 0.05 s), pitch (key number), level (dB, to 1 dB) and how long it
held. Four small integers a note, packed into a string. A busy half hour is about 2,000 notes, around 8 KB; the log keeps
2,000 sessions, so keep the full notes for the last 60 sessions and a 128-bin note histogram plus the derived figures for
the rest. That stays well inside what Safari gives localStorage. No audio, and nothing from frames the detector called
talking or noise.

## The ideas

Ranked by how much they would make a child want to come back, then by how much work they are. S, M and L are rough
sizes. Each names the variables it draws on.

### 1. The songbook: the app learns their tunes (P10, P12)

Every piece a child practises comes back day after day. With onsets and pitches, the app can fingerprint what was played
(the sequence of pitch intervals, cut into short runs, like a shazam for one player) and notice when the same tune comes
back: in the same session (a passage worked on 14 times) and across sessions (the same piece on Tuesday and Friday).
The summary shows the two or three tunes it noticed as little pictures of their shape and asks, once, "What is this one
called?" The practice log grows a Songbook page: each tune with its name, the days it was played, the first day, and how
long it has been played all together. A tune never leaves the songbook. Nothing is graded; it is a collection.

Why they come back: children love to see a list of "their" pieces grow, and naming something makes it theirs. A parent
sees what was practised without asking. Size: L (the fingerprinting is the real work; a test with the synth clips can
check it finds a repeated phrase and tells two tunes apart).

### 2. Notes played: the big number (P10)

Count every note start. "You played 1,284 notes today" on the summary; "All together: 61,900 notes" on the Home Screen next
to the time. Milestones that are kept for good: a thousand notes, ten thousand, a hundred thousand, a million. A million
notes is around a year of practice for a keen beginner, which is exactly the horizon the app wants them to reach.

Why they come back: a child cannot resist a number that only goes up, and notes feel more like music than minutes do.
Size: S (the `OnsetTracker` count already exists as `onsetN`; it needs saving and adding up).

### 3. The keys collection (P12)

A keyboard on the practice log with every key they have ever played lit, from the lowest to the highest, and on the
summary the keys played today, with any key played for the first time ever marked "new". The summary gets one line:
"Highest note today: A5. New!" Over months the lit keys creep outward as the player's range grows. Keys never go dark.

Why they come back: it is a sticker album for notes, and a beginner on a new string or a new position sees the album grow
the day it happens. Size: S (the detector's `hist` already works out notes held; it needs keeping per session).

### 4. The sound drawing (P12, P13)

Each session leaves a picture: its pitch line over time, drawn as one continuous stroke, thicker where it was louder and
lighter where it was soft, in the theme's colours. It sits at the top of the summary and as a thumbnail on each row of the
practice log, so the log becomes a gallery, and it can be saved as an image to send to a grandparent. A session of scales
looks like a saw, a lullaby like waves, a hard piece like a scribble; all of them look like the child's own.

Why they come back: it turns practice into something they made that can be looked at and shown, with no score on it.
Size: M (the notes record holds enough; the drawing is a canvas function and a share button).

### 5. Your year in music (P1, P10, P12, P13 and the practice log)

Once a year, and on request from the log, a page of the player's year: minutes and notes, the day they played most, the
longest session, the highest and lowest note, the favourite note (the key they played most), the instruments heard,
the month they played most, the time of day they usually play ("You are an after-dinner player"), and the songbook's
most-played tune. Every figure counts what was played; there is no line about days without music. It can be saved as a
card to share.

Why they come back: it gives the whole year a shape to look forward to, and parents will keep the card. Size: M.

### 6. Hear yourself a month ago: the time capsule (P4, P13, P10)

With the player's say-so, keep ten seconds of each session: the best stretch (the loudest run of notes the detector was
surest was music, so never speech), stored as a small compressed clip. The practice log can then play today's ten seconds
next to the same tune a month ago, or the first time the app heard them. Off by default, on device only, one tap to
delete, and the summary says plainly what is kept.

Why they come back: nothing shows a child they are getting better like hearing it. The app already records with the
Record setting and plays it back once; this keeps the one bit worth keeping. Size: M (a clip a session, about 50 KB
compressed, so keep the last 100 and let the player pin favourites).

### 7. Race or fly with your past self (P2, the last minute, P10)

Grand Prix: one of the nine rivals becomes "You, last time", driving from the stored minute-by-minute playing of the
player's last session on that instrument. Rocket: the previous flight's path drawn as a faint ghost, so the player sees
the pad fall away at the moment it fell away yesterday. Fireworks: a "Replay" button on the summary that fires the
session's notes again, from the notes record, so the display can be watched back with the sound off. Only playing moves
the car or the rocket, as now; the ghost is only a picture.

Why they come back: the themes get a memory, and watching last Saturday's fireworks again is a reason to open the app on
a day with no practice at all. Size: M for the ghost car (the `RacePractiser` interface already takes a stream of
efficiency), M for the Fireworks replay, S for the Rocket ghost.

### 8. In tune: the tuning compass (P12)

Strings and winds live or die by intonation, and the pitch is already measured to a fraction of a semitone. A small
compass in the Classic theme shows where each held note sits against the nearest note, sharp or flat, with a calm green
when it is within ten cents. The summary says one friendly thing: "Your notes were mostly in tune" or "Your high notes
ran a little sharp". It could also serve as a tuner before Start, since the app is already listening.

Why they come back: a tuner they already have open removes a reason to put the instrument down, and a young string
player who sees the needle settle learns to hear it. Size: S for the compass and tuner, M for the summary line (which
needs the notes record to keep cents per note, one more small integer).

### 9. Your own beat: the scene plays in time (P10)

From the spacing of note starts the app can estimate the player's tempo and how steady it is, with no metronome. The
scenes answer it: the City's lights blink on the beat, the Ferris wheel in Fireworks turns at the player's tempo, the
Dash obstacles land on the beat so the run feels like a rhythm game. The summary shows "Your beat: about 92 a minute" and
a steadiness word (steady, swinging, free), never a mark.

Why they come back: the scene feels alive in a new way, and a steady tempo gets its own quiet reward without anyone
saying "use the metronome". Size: M (tempo estimation from inter-onset intervals, with a test on the synth scales;
each theme hook is small).

### 10. Loud and soft: the dynamics bar (P13, P5)

A bar from whisper to roar, filled by how far the level ran above the room's noise floor, so it works at any distance
from the phone. The summary says "You played from soft to loud today" with the two ends marked. In Fireworks the loud
notes already make bigger shells; in City a loud note could light a whole block and a soft one a single window; in Rocket
the flame could lengthen with the level, with the thrust staying as it is.

Why they come back: it rewards expression, which no timer has ever noticed, and it is easy to try on purpose. Size: S.

### 11. Smooth or bouncy: articulation (P10, P11, P13)

The gap or overlap between one note and the next says whether playing was legato or detached. A dial on the summary from
smooth to bouncy, and in Fireworks a slurred run could become a comet with a tail while short notes crackle.

Why they come back: a child practising a slur hears it and now sees it. Size: M (note offsets need a cleaner rule in
`OnsetTracker`, which is the open "event boundaries" decision in the variables doc).

### 12. The room report: honest listening (P5, P3)

A line on the summary about how well the app could hear: "The room was quiet and the microphone heard you clearly", or
"The room was noisy today, so some soft playing may not have counted", or "The microphone was asleep for 4 minutes".
Tap it for what to try (move the phone closer, close a window). This keeps trust when the clock seems slow.

Why they come back: a timer that explains itself is not blamed, and a child who sees "the microphone was asleep" does
not think they were cheated. Size: S (the noise floor and the away time already exist).

### 13. Lessons and duets: whose notes are these? (P8)

Sound cannot tell a teacher's violin from the student's, so let people say. A "Teacher's turn" button during a session
keeps the next stretch out of play time (it counts like a pause, drawn in its own colour on the summary), and a Duet
setting lets two instruments both count when a parent plays along. The app's own metronome (idea 9 could add one) is a
source it knows to ignore.

Why they come back: the app stops being wrong in a lesson, which is where a child is most likely to be told to use it.
Size: S for Teacher's turn, M for a built-in metronome the detector ignores.

### 14. Scales and keys: what was practised (P10, P12)

A run of seven or eight steps in one direction is a scale, and the pitch-class histogram of a session suggests its key.
The summary can say "Six scales today, up and down" and "Most of today was in G major"; in Fireworks the sky could take a
faint tint of the key's colour (the twelve notes are already twelve colours).

Why they come back: scales are the dull part of practice, and counting them makes them a thing done rather than a thing
endured. Size: M.

## Suggested order

1. The notes record (the storage change), with the notes count (idea 2) riding on it, since both are small and every
   later idea needs them.
2. The keys collection (3) and the room report (12): small, visible on the next summary, and both only add.
3. The sound drawing (4): the first thing a child can show someone.
4. The songbook (1): the big one, and the one most likely to change how the app feels over months.
5. Then the themes' memory (7), the compass (8) and the beat (9), each a theme at a time.

## Things to keep in mind

- Storage: Safari gives about 5 MB to localStorage, and the log already budgets 2.5 MB for 2,000 sessions. The notes
  record must be capped (last 60 sessions in full) and the clips of idea 6 must be opt-in and counted in Settings, Storage
  (pull request #68 adds the page).
- Privacy: keep notes only from frames the detector called music, never speech content; the variables doc says the same
  for P14. Clips are opt-in and stay on the device.
- Low pressure: every figure counts what was played. No idea above compares a day with the day before, and the ghost car
  and ghost rocket are pictures, not opponents that beat you.
- Tests: fingerprinting, tempo and scale counting can all be checked with the synth clips in `src/core.js` (`CLIPS`,
  `synthPlayed`), which already play known note sequences.
