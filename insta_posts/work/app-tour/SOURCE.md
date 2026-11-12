# app-tour — rendered elsewhere

**There is no `post.json` here and `node render.mjs app-tour` will not work.** This post is a product
carousel, not an editorial topic post, so it does not come from `themes/b-label.mjs`. It is rendered by
the App Store screenshot generator, which already owns the phone frame, the mock app screens and the
shared design system — rebuilding any of that in this repo would mean maintaining it twice.

Source of truth:

```
music_rating/apps/ios/AppStoreScreenshots/ig/slides.config.js
```

Re-render (from that directory) straight into the upload folder:

```bash
node export.mjs --lang=ig --no-showcase \
  --out=../../../../insta_posts/posts/app-tour
```

`ig/slides.config.js` sets `output: { naming: 'index' }`, which is why the files land as `01.png … 06.png`
the way the other `posts/` folders expect, rather than the generator's own `01-home.png`.

## Editing

- **Copy** (headlines, subheads, eyebrows) lives in `ig/slides.config.js`, not in `caption.txt`. Change it
  there and re-render; `caption.txt` holds the Instagram text only.
- **Layout** — the canvas is 1080 x 1350 and the phone deliberately bleeds off the bottom edge. See the
  Formats section of that generator's README for why scaling the App Store layout alone does not work.
- `caption.txt` here is a **draft** in the account's voice, not approved copy.

## Credits

No photo credits: every slide is rendered, with mock app content and fictional album art. Nothing here is
a Commons photo, so unlike the topic posts there is nothing to attribute.
