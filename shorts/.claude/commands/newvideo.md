Build a reel from the current reviews.json.

Music: $ARGUMENTS (path, optionally followed by a bpm)

1. Run fetch_art.py. If any cover fails to resolve, stop and tell me which —
   don't invent a cover_url.
2. Run compose.py --all, then compose.py --preview on the LONGEST review and
   view the PNG. Report anything that overflows, truncates, or looks cramped.
3. Run beats.py with the given music. Show me the per-card durations and cut
   times before rendering.
4. Run render.py --preset veryfast --out /tmp/preview.mp4.
5. Extract and view three frames: mid-first-card, the exact first cut time from
   timeline.json, and mid-last-card. Confirm no card ghosting at the cut.
6. Report the output path, duration, and file size.

Do not report success on any step you have not actually viewed.
