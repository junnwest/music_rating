/**
 * One-off seed for App Store screenshot recapture (Guideline 5.2.1, 2026-08-04 rejection):
 * inserts a small, entirely fictional catalog (4 artists, 12 albums, ~6 tracks each) tagged
 * source='manual' so real screenshots can be captured without any real copyrighted cover art.
 * Cover art is original AI-generated imagery (apps/web/scratch-demo-covers or wherever the
 * 12 PNGs live), uploaded here to the 'demo-covers' Storage bucket.
 *
 * This is a screenshot-prep utility, not a pipeline tool -- safe to delete once the new
 * screenshots are captured and uploaded to App Store Connect. Everything it writes is tagged
 * source='manual' on artists/release_groups, so it's easy to find and delete later:
 *   delete from release_groups where source = 'manual';
 *   delete from artists where ingest_state = 'qc_passed' and source_status is null and id in (...);
 * (the artist rows don't carry a distinct tag beyond having no source_status/ingest history --
 * this script prints their ids at the end; keep that output if you want a clean deletion list.)
 *
 * Phase A only (this script): catalog content. No user account needed.
 * Phase B (separate step): once a real account exists on the capture device (one real OAuth
 * sign-in, any provider), attach ratings + spotify_recently_played/spotify_artists seed data to
 * it by username -- see seed-demo-profile-data.ts.
 *
 * Run:
 *   npx tsx --env-file=.env.local scripts/seed-demo-fictional-content.ts
 *   npx tsx --env-file=.env.local scripts/seed-demo-fictional-content.ts --dry-run
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const DRY_RUN = process.argv.includes('--dry-run');

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY'); process.exit(1); }
const db = createClient(url, key, { auth: { persistSession: false } });

const COVERS_DIR = '/private/tmp/claude-501/-Users-junnwest-Desktop-code-music-rating/b6a875e0-6036-492a-b9c5-6d0126d7c3f7/scratchpad/demo-covers';
const BUCKET = 'demo-covers';

interface AlbumSeed {
  title: string;
  coverFile: string;
  genres: string[];
  releaseDate: string;
  tracks: string[];
}
interface ArtistSeed {
  name: string;
  country: string | null;
  albums: AlbumSeed[];
}

const ARTISTS: ArtistSeed[] = [
  {
    name: 'Dawn Static',
    country: 'US',
    albums: [
      {
        title: 'Low Fidelity',
        coverFile: 'dawn-static-low-fidelity.png',
        genres: ['indie rock', 'alternative'],
        releaseDate: '2023-04-14',
        tracks: ['Streetlight', 'Static Bloom', 'Rented Room', 'Quiet Static', 'Half-Lit', 'Low Fidelity'],
      },
      {
        title: 'Roomtone',
        coverFile: 'dawn-static-roomtone.png',
        genres: ['indie rock', 'alternative'],
        releaseDate: '2024-02-09',
        tracks: ['Roomtone', 'Window Seat', 'Empty Frame', 'Warm Static', 'Afternoon', 'Slow Fade'],
      },
      {
        title: 'Nightbus',
        coverFile: 'dawn-static-nightbus.png',
        genres: ['indie rock', 'alternative'],
        releaseDate: '2025-01-17',
        tracks: ['Nightbus', 'Rearview', 'Wet Glass', 'Last Stop', 'Sleepless', 'Home Static'],
      },
    ],
  },
  {
    name: '느린 봄',
    country: 'KR',
    albums: [
      {
        title: '창밖',
        coverFile: 'neurin-bom-changbak.png',
        genres: ['k-indie', 'folk'],
        releaseDate: '2023-09-02',
        tracks: ['창밖', '빗소리', '오후 네시', '흐린 하늘', '작은 방', '봄이 오면'],
      },
      {
        title: '유리병',
        coverFile: 'neurin-bom-yuribyeong.png',
        genres: ['k-indie', 'folk'],
        releaseDate: '2024-06-20',
        tracks: ['유리병', '햇살', '창가에서', '조용한 오후', '먼지', '유리병 (Reprise)'],
      },
      {
        title: '한여름',
        coverFile: 'neurin-bom-hanyeoreum.png',
        genres: ['k-indie', 'folk'],
        releaseDate: '2025-07-11',
        tracks: ['한여름', '들판', '바람', '여름밤', '풀냄새', '한여름 (Outro)'],
      },
    ],
  },
  {
    name: 'VELVET ORBIT',
    country: 'KR',
    albums: [
      {
        title: 'AXIS',
        coverFile: 'velvet-orbit-axis.png',
        genres: ['k-pop'],
        releaseDate: '2024-03-11',
        tracks: ['AXIS', 'Chrome', 'Gravity', 'Blue Signal', 'Orbit', 'Reset'],
      },
      {
        title: 'Neon Halo',
        coverFile: 'velvet-orbit-neon-halo.png',
        genres: ['k-pop'],
        releaseDate: '2024-11-05',
        tracks: ['Neon Halo', 'Ring', 'Static Love', 'Afterglow', 'Halo (Interlude)', 'Echo'],
      },
      {
        title: 'Reverie',
        coverFile: 'velvet-orbit-reverie.png',
        genres: ['k-pop'],
        releaseDate: '2025-05-23',
        tracks: ['Reverie', 'Ribbon', 'Daydream', 'Coral', 'Reverie (Slow)', 'Wake'],
      },
    ],
  },
  {
    name: 'Wilhelm Cole',
    country: 'US',
    albums: [
      {
        title: 'Slow Static',
        coverFile: 'wilhelm-cole-slow-static.png',
        genres: ['soul', 'r&b'],
        releaseDate: '2022-10-07',
        tracks: ['Slow Static', 'Amber Light', 'Rewind', 'Warm Room', 'Static (Interlude)', 'Come Down'],
      },
      {
        title: 'Amber Room',
        coverFile: 'wilhelm-cole-amber-room.png',
        genres: ['soul', 'r&b'],
        releaseDate: '2023-12-01',
        tracks: ['Amber Room', 'Lamp Light', 'Old Tape', 'Slow Burn', 'Amber (Reprise)', 'Evening'],
      },
      {
        title: 'Paper Weather',
        coverFile: 'wilhelm-cole-paper-weather.png',
        genres: ['soul', 'r&b'],
        releaseDate: '2025-03-19',
        tracks: ['Paper Weather', 'Faded', 'Overcast', 'Grain', 'Paper Weather (Outro)', 'Clear'],
      },
    ],
  },
];

async function uploadCover(fileName: string): Promise<string> {
  const bytes = readFileSync(join(COVERS_DIR, fileName));
  const storagePath = `covers/${fileName}`;
  if (DRY_RUN) return `[dry-run] ${storagePath}`;
  const { error } = await db.storage.from(BUCKET).upload(storagePath, bytes, {
    contentType: 'image/png',
    upsert: true,
  });
  if (error) throw new Error(`upload ${fileName}: ${error.message}`);
  const { data } = db.storage.from(BUCKET).getPublicUrl(storagePath);
  return data.publicUrl;
}

async function main() {
  console.log(DRY_RUN ? '=== DRY RUN ===' : '=== WRITE ===');
  const artistIds: Record<string, string> = {};
  const releaseGroupIds: string[] = [];

  for (const artist of ARTISTS) {
    // Reuse if a prior run already created this fictional artist (idempotent re-run).
    const { data: existing } = await db
      .from('artists')
      .select('id')
      .eq('name', artist.name)
      .is('source_status', null)
      .maybeSingle();

    let artistId = existing?.id as string | undefined;
    if (!artistId) {
      artistId = crypto.randomUUID();
      console.log(`artist: ${artist.name} -> ${artistId}`);
      if (!DRY_RUN) {
        const { error } = await db.from('artists').insert({
          id: artistId,
          name: artist.name,
          country: artist.country,
          ingest_state: 'qc_passed', // terminal state -- no pipeline lane claims this artist
          source_status: null,
        });
        if (error) throw new Error(`insert artist ${artist.name}: ${error.message}`);
      }
    } else {
      console.log(`artist: ${artist.name} (existing) -> ${artistId}`);
    }
    artistIds[artist.name] = artistId;

    for (const album of artist.albums) {
      const { data: existingRg } = await db
        .from('release_groups')
        .select('id')
        .eq('title', album.title)
        .eq('primary_artist_id', artistId)
        .maybeSingle();
      if (existingRg?.id) {
        console.log(`  album: ${album.title} (existing) -> ${existingRg.id}`);
        releaseGroupIds.push(existingRg.id);
        continue;
      }

      const coverUrl = await uploadCover(album.coverFile);
      const rgId = crypto.randomUUID();
      console.log(`  album: ${album.title} -> ${rgId} (cover: ${coverUrl})`);

      if (!DRY_RUN) {
        const { error: rgErr } = await db.from('release_groups').insert({
          id: rgId,
          primary_artist_id: artistId,
          artist_display: artist.name,
          title: album.title,
          release_group_type: 'album',
          first_release_date: album.releaseDate,
          cover_url: coverUrl,
          genres: album.genres,
          source: 'manual',
        });
        if (rgErr) throw new Error(`insert release_group ${album.title}: ${rgErr.message}`);

        const releaseId = crypto.randomUUID();
        const tracklistJson = album.tracks.map((title, i) => ({
          title,
          artists: artist.name,
          position: i + 1,
          durationMs: 180000 + i * 8000,
        }));
        const { error: relErr } = await db.from('releases').insert({
          id: releaseId,
          release_group_id: rgId,
          is_canonical: true,
          region: artist.country,
          source: 'manual',
          title: album.title,
          artist: artist.name,
          release_date: album.releaseDate,
          release_type: 'Album',
          cover_url: coverUrl,
          total_tracks: album.tracks.length,
          tracklist: tracklistJson,
        });
        if (relErr) throw new Error(`insert release ${album.title}: ${relErr.message}`);

        for (let i = 0; i < album.tracks.length; i++) {
          const recordingId = crypto.randomUUID();
          const { error: recErr } = await db.from('recordings').insert({
            id: recordingId,
            primary_artist_id: artistId,
            artist_display: artist.name,
            title: album.tracks[i],
            duration_ms: 180000 + i * 8000,
          });
          if (recErr) throw new Error(`insert recording ${album.tracks[i]}: ${recErr.message}`);

          const { error: rtErr } = await db.from('release_tracks').insert({
            release_id: releaseId,
            recording_id: recordingId,
            position: i + 1,
            disc_number: 1,
          });
          if (rtErr) throw new Error(`insert release_track ${album.tracks[i]}: ${rtErr.message}`);
        }
      }
      releaseGroupIds.push(rgId);
    }
  }

  console.log('\n=== DONE ===');
  console.log('Artist ids:', artistIds);
  console.log('Release group ids:', releaseGroupIds);
  console.log(`\n${releaseGroupIds.length} fictional albums ready.`);
  console.log('Next: sign in once on the capture device (any provider), tell me the username,');
  console.log('and I\'ll attach ratings + spotify_recently_played seed data to that profile.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
