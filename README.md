# Bside

A minimal music album rating and cataloging app for Korean music fans, built with Next.js, Supabase Auth, Tailwind CSS, and MusicBrainz.

## What’s included

- Next.js 14 app router structure
- Tailwind CSS styling
- Supabase auth and database scaffolding
- MusicBrainz album search integration

## Getting started

1. Install dependencies:
   ```bash
   npm install
   ```
2. Create a `.env.local` file from `.env.example`.
3. Run the dev server:
   ```bash
   npm run dev
   ```

## Architecture

- `app/` — main pages and layout
- `components/` — UI building blocks
- `lib/` — API helpers for Supabase and MusicBrainz
- `types/` — shared TypeScript models

## V1 focus

- Signup/login
- Search for a release
- One rating per release per user
- Listening status taxonomy
- Profile page with user ratings
