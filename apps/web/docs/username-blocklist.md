# Username blocklist

The existing username limit is **3–20** lowercase ASCII letters, digits, or underscores. The database constraint, web app, and iOS app already agree on this limit. This policy adds blocked names without changing the length.

The initial migration reserves `sillajuku`, `sillajukukr`, `rex`, `blk`, `linus`, `linuskim`, and `aaa`. It also includes English `general`, `sexual`, `shock`, and most `racial` entries from [dsojevic/profanity-list](https://github.com/dsojevic/profanity-list/blob/c27924319aa9bd6f917e3782b4f4b6604a50b652/en.json), pinned at commit `c27924319aa9bd6f917e3782b4f4b6604a50b652`. Clearly abusive slurs from the source's `lgbtq` category are included individually; ordinary identity words are excluded. The one-time generator is `scripts/generate-username-policy.py`. New blocklist changes require a new migration.

The policy strips underscores before checking full blocked names and also checks underscore-separated words. Only unambiguous profane, sexual, or abusive roots are checked inside longer names. Short strings such as `ass`, `sex`, and `cum` are full-name or full-word matches so ordinary names are less likely to be blocked. Existing usernames remain usable; the trigger applies when a username is newly set or changed.

## Source license

MIT License

Copyright (c) 2021 David Sojevic

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
