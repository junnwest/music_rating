/**
 * Seed ranking_seed_entries from an external ranked list.
 *
 * Each album is treated as one "virtual" user vote:
 *   seed_votes = 1.0 / rank
 * so rank #1 contributes 1.0 to the Silla score, rank #500 contributes 0.002 —
 * exactly matching how a real user ranking would score.
 *
 * Albums not yet in `releases` are fetched from Spotify and upserted automatically.
 *
 * Run:
 *   npx ts-node scripts/seed-rankings.ts
 *   npx ts-node scripts/seed-rankings.ts --dry-run   # preview only
 *   npx ts-node scripts/seed-rankings.ts --category all-time
 *
 * On rate-limit or failure mid-run, re-run — progress is saved to
 *   scripts/seed-rankings-state-<slug>.json
 */

import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

const DRY_RUN = process.argv.includes('--dry-run');
const CATEGORY_SLUG = (() => {
  const idx = process.argv.indexOf('--category');
  return idx !== -1 ? process.argv[idx + 1] : 'all-time';
})();
const DELAY_MS = 1200;
const MATCH_THRESHOLD = 0.45;
const STATE_PATH = path.resolve(`scripts/seed-rankings-state-${CATEGORY_SLUG}.json`);

// ── String matching ───────────────────────────────────────────────────────────

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[''`]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stringSimilarity(a: string, b: string): number {
  const na = normalize(a);
  const nb = normalize(b);
  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) return 0.85;
  const wa = new Set(na.split(' ').filter(w => w.length > 1));
  const wb = new Set(nb.split(' ').filter(w => w.length > 1));
  if (wa.size === 0 || wb.size === 0) return 0;
  const intersection = [...wa].filter(w => wb.has(w)).length;
  const union = new Set([...wa, ...wb]).size;
  return union === 0 ? 0 : intersection / union;
}

function artistSimilarity(a: string, b: string): number {
  const na = normalize(a);
  const nb = normalize(b);
  if (na === nb) return 1;
  const wa = new Set(na.split(' ').filter(w => w.length > 1));
  const wb = new Set(nb.split(' ').filter(w => w.length > 1));
  if (wa.size === 0 || wb.size === 0) return 0;
  const intersection = [...wa].filter(w => wb.has(w)).length;
  const union = new Set([...wa, ...wb]).size;
  return union === 0 ? 0 : intersection / union;
}

function matchScore(
  expectedTitle: string, actualTitle: string,
  expectedArtist: string, actualArtist: string,
): number {
  const titleScore  = stringSimilarity(expectedTitle, actualTitle);
  const artistScore = artistSimilarity(expectedArtist, actualArtist);
  if (artistScore < 0.25) return 0;
  return titleScore * 0.75 + artistScore * 0.25;
}

// ── State persistence ─────────────────────────────────────────────────────────

function loadState(): Set<string> {
  try { return new Set(JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'))); }
  catch { return new Set(); }
}

function saveState(done: Set<string>) {
  fs.writeFileSync(STATE_PATH, JSON.stringify([...done]), 'utf8');
}

// ── Rolling Stone 500 Greatest Albums ────────────────────────────────────────
// Format: [rank, title, artist, spotifyId?]
// "Various artists" entries will fail the artist-match check and be skipped gracefully.

type Entry = { rank: number; title: string; artist: string; spotifyId?: string };

const RS500: Entry[] = [
  { rank: 1,   title: "What's Going On",                                             artist: 'Marvin Gaye' },
  { rank: 2,   title: 'Pet Sounds',                                                  artist: 'The Beach Boys' },
  { rank: 3,   title: 'Blue',                                                        artist: 'Joni Mitchell' },
  { rank: 4,   title: 'Songs in the Key of Life',                                    artist: 'Stevie Wonder' },
  { rank: 5,   title: 'Abbey Road',                                                  artist: 'The Beatles' },
  { rank: 6,   title: 'Nevermind',                                                   artist: 'Nirvana' },
  { rank: 7,   title: 'Rumours',                                                     artist: 'Fleetwood Mac' },
  { rank: 8,   title: 'Purple Rain',                                                 artist: 'Prince and the Revolution' },
  { rank: 9,   title: 'Blood on the Tracks',                                         artist: 'Bob Dylan' },
  { rank: 10,  title: 'The Miseducation of Lauryn Hill',                             artist: 'Lauryn Hill' },
  { rank: 11,  title: 'Revolver',                                                    artist: 'The Beatles' },
  { rank: 12,  title: 'Thriller',                                                    artist: 'Michael Jackson' },
  { rank: 13,  title: 'I Never Loved a Man the Way I Love You',                      artist: 'Aretha Franklin' },
  { rank: 14,  title: 'Exile on Main St.',                                           artist: 'The Rolling Stones' },
  { rank: 15,  title: 'It Takes a Nation of Millions to Hold Us Back',               artist: 'Public Enemy' },
  { rank: 16,  title: 'London Calling',                                              artist: 'The Clash' },
  { rank: 17,  title: 'My Beautiful Dark Twisted Fantasy',                           artist: 'Kanye West' },
  { rank: 18,  title: 'Highway 61 Revisited',                                        artist: 'Bob Dylan' },
  { rank: 19,  title: 'To Pimp a Butterfly',                                         artist: 'Kendrick Lamar' },
  { rank: 20,  title: 'Kid A',                                                       artist: 'Radiohead' },
  { rank: 21,  title: 'Born to Run',                                                 artist: 'Bruce Springsteen' },
  { rank: 22,  title: 'Ready to Die',                                                artist: 'The Notorious B.I.G.' },
  { rank: 23,  title: 'The Velvet Underground & Nico',                               artist: 'The Velvet Underground' },
  { rank: 24,  title: "Sgt. Pepper's Lonely Hearts Club Band",                       artist: 'The Beatles' },
  { rank: 25,  title: 'Tapestry',                                                    artist: 'Carole King' },
  { rank: 26,  title: 'Horses',                                                      artist: 'Patti Smith' },
  { rank: 27,  title: 'Enter the Wu-Tang (36 Chambers)',                             artist: 'Wu-Tang Clan' },
  { rank: 28,  title: 'Voodoo',                                                      artist: "D'Angelo" },
  { rank: 29,  title: 'The Beatles',                                                 artist: 'The Beatles' },
  { rank: 30,  title: 'Are You Experienced',                                         artist: 'The Jimi Hendrix Experience' },
  { rank: 31,  title: 'Kind of Blue',                                                artist: 'Miles Davis' },
  { rank: 32,  title: 'Lemonade',                                                    artist: 'Beyoncé' },
  { rank: 33,  title: 'Back to Black',                                               artist: 'Amy Winehouse' },
  { rank: 34,  title: 'Innervisions',                                                artist: 'Stevie Wonder' },
  { rank: 35,  title: 'Rubber Soul',                                                 artist: 'The Beatles' },
  { rank: 36,  title: 'Off the Wall',                                                artist: 'Michael Jackson' },
  { rank: 37,  title: 'The Chronic',                                                 artist: 'Dr. Dre' },
  { rank: 38,  title: 'Blonde on Blonde',                                            artist: 'Bob Dylan' },
  { rank: 39,  title: 'Remain in Light',                                             artist: 'Talking Heads' },
  { rank: 40,  title: 'The Rise and Fall of Ziggy Stardust and the Spiders from Mars', artist: 'David Bowie' },
  { rank: 41,  title: 'Let It Bleed',                                                artist: 'The Rolling Stones' },
  { rank: 42,  title: 'OK Computer',                                                 artist: 'Radiohead' },
  { rank: 43,  title: 'The Low End Theory',                                          artist: 'A Tribe Called Quest' },
  { rank: 44,  title: 'Illmatic',                                                    artist: 'Nas' },
  { rank: 45,  title: "Sign o' the Times",                                           artist: 'Prince' },
  { rank: 46,  title: 'Graceland',                                                   artist: 'Paul Simon' },
  { rank: 47,  title: 'Ramones',                                                     artist: 'Ramones' },
  { rank: 48,  title: 'Exodus',                                                      artist: 'Bob Marley and the Wailers' },
  { rank: 49,  title: 'Aquemini',                                                    artist: 'Outkast' },
  { rank: 50,  title: 'The Blueprint',                                               artist: 'Jay-Z' },
  { rank: 51,  title: 'The Great Twenty-Eight',                                      artist: 'Chuck Berry' },
  { rank: 52,  title: 'Station to Station',                                          artist: 'David Bowie' },
  { rank: 53,  title: 'Electric Ladyland',                                           artist: 'The Jimi Hendrix Experience' },
  { rank: 54,  title: 'Star Time',                                                   artist: 'James Brown' },
  { rank: 55,  title: 'The Dark Side of the Moon',                                   artist: 'Pink Floyd' },
  { rank: 56,  title: 'Exile in Guyville',                                           artist: 'Liz Phair' },
  { rank: 57,  title: 'The Band',                                                    artist: 'The Band' },
  { rank: 58,  title: 'Led Zeppelin IV',                                             artist: 'Led Zeppelin' },
  { rank: 59,  title: 'Talking Book',                                                artist: 'Stevie Wonder' },
  { rank: 60,  title: 'Astral Weeks',                                                artist: 'Van Morrison' },
  { rank: 61,  title: 'Paid in Full',                                                artist: 'Eric B. & Rakim' },
  { rank: 62,  title: 'Appetite for Destruction',                                    artist: "Guns N' Roses" },
  { rank: 63,  title: 'Aja',                                                         artist: 'Steely Dan' },
  { rank: 64,  title: 'Stankonia',                                                   artist: 'Outkast' },
  { rank: 65,  title: 'Live at the Apollo',                                          artist: 'James Brown' },
  { rank: 66,  title: 'A Love Supreme',                                              artist: 'John Coltrane' },
  { rank: 67,  title: 'Reasonable Doubt',                                            artist: 'Jay-Z' },
  { rank: 68,  title: 'Hounds of Love',                                              artist: 'Kate Bush' },
  { rank: 69,  title: 'Jagged Little Pill',                                          artist: 'Alanis Morissette' },
  { rank: 70,  title: 'Straight Outta Compton',                                      artist: 'N.W.A' },
  { rank: 71,  title: 'Renaissance',                                                 artist: 'Beyoncé' },
  { rank: 72,  title: 'Harvest',                                                     artist: 'Neil Young' },
  { rank: 73,  title: 'Loveless',                                                    artist: 'My Bloody Valentine' },
  { rank: 74,  title: 'The College Dropout',                                         artist: 'Kanye West' },
  { rank: 75,  title: 'Lady Soul',                                                   artist: 'Aretha Franklin' },
  { rank: 76,  title: 'Super Fly',                                                   artist: 'Curtis Mayfield' },
  { rank: 77,  title: "Who's Next",                                                  artist: 'The Who' },
  { rank: 78,  title: 'The Sun Sessions',                                            artist: 'Elvis Presley' },
  { rank: 79,  title: 'Blonde',                                                      artist: 'Frank Ocean' },
  { rank: 80,  title: "Never Mind the Bollocks, Here's the Sex Pistols",             artist: 'Sex Pistols' },
  { rank: 81,  title: 'Beyoncé',                                                     artist: 'Beyoncé' },
  { rank: 82,  title: "There's a Riot Goin' On",                                     artist: 'Sly and the Family Stone' },
  { rank: 83,  title: 'Dusty in Memphis',                                            artist: 'Dusty Springfield' },
  { rank: 84,  title: 'Back in Black',                                               artist: 'AC/DC' },
  { rank: 85,  title: 'John Lennon/Plastic Ono Band',                               artist: 'John Lennon' },
  { rank: 86,  title: 'The Doors',                                                   artist: 'The Doors' },
  { rank: 87,  title: 'Bitches Brew',                                                artist: 'Miles Davis' },
  { rank: 88,  title: 'Hunky Dory',                                                  artist: 'David Bowie' },
  { rank: 89,  title: 'Baduizm',                                                     artist: 'Erykah Badu' },
  { rank: 90,  title: 'After the Gold Rush',                                         artist: 'Neil Young' },
  { rank: 91,  title: 'Darkness on the Edge of Town',                               artist: 'Bruce Springsteen' },
  { rank: 92,  title: 'Axis: Bold as Love',                                          artist: 'The Jimi Hendrix Experience' },
  { rank: 93,  title: 'Supa Dupa Fly',                                               artist: 'Missy Elliott' },
  { rank: 94,  title: 'Fun House',                                                   artist: 'The Stooges' },
  { rank: 95,  title: 'Take Care',                                                   artist: 'Drake' },
  { rank: 96,  title: 'Automatic for the People',                                    artist: 'R.E.M.' },
  { rank: 97,  title: 'Master of Puppets',                                           artist: 'Metallica' },
  { rank: 98,  title: 'Car Wheels on a Gravel Road',                                 artist: 'Lucinda Williams' },
  { rank: 99,  title: 'Red',                                                         artist: 'Taylor Swift' },
  { rank: 100, title: 'Music from Big Pink',                                         artist: 'The Band' },
  { rank: 101, title: 'Led Zeppelin',                                                artist: 'Led Zeppelin' },
  { rank: 102, title: 'The Clash',                                                   artist: 'The Clash' },
  { rank: 103, title: '3 Feet High and Rising',                                      artist: 'De La Soul' },
  { rank: 104, title: 'Sticky Fingers',                                              artist: 'The Rolling Stones' },
  { rank: 105, title: 'At Fillmore East',                                            artist: 'The Allman Brothers Band' },
  { rank: 106, title: 'Live Through This',                                           artist: 'Hole' },
  { rank: 107, title: 'Marquee Moon',                                                artist: 'Television' },
  { rank: 108, title: 'When the Pawn...',                                            artist: 'Fiona Apple' },
  { rank: 109, title: 'Transformer',                                                 artist: 'Lou Reed' },
  { rank: 110, title: 'Court and Spark',                                             artist: 'Joni Mitchell' },
  { rank: 111, title: 'Control',                                                     artist: 'Janet Jackson' },
  { rank: 112, title: 'Goodbye Yellow Brick Road',                                   artist: 'Elton John' },
  { rank: 113, title: 'The Queen Is Dead',                                           artist: 'The Smiths' },
  { rank: 114, title: 'Is This It',                                                  artist: 'The Strokes' },
  { rank: 115, title: 'Good Kid, M.A.A.D City',                                     artist: 'Kendrick Lamar' },
  { rank: 116, title: 'Disintegration',                                              artist: 'The Cure' },
  { rank: 117, title: 'Late Registration',                                           artist: 'Kanye West' },
  { rank: 118, title: 'Hotel California',                                            artist: 'Eagles' },
  { rank: 119, title: 'Stand!',                                                      artist: 'Sly and the Family Stone' },
  { rank: 120, title: 'Moondance',                                                   artist: 'Van Morrison' },
  { rank: 121, title: "This Year's Model",                                           artist: 'Elvis Costello' },
  { rank: 122, title: 'The Downward Spiral',                                         artist: 'Nine Inch Nails' },
  { rank: 123, title: 'Led Zeppelin II',                                             artist: 'Led Zeppelin' },
  { rank: 124, title: 'Achtung Baby',                                                artist: 'U2' },
  { rank: 125, title: "Paul's Boutique",                                             artist: 'Beastie Boys' },
  { rank: 126, title: 'My Life',                                                     artist: 'Mary J. Blige' },
  { rank: 127, title: 'Modern Sounds in Country and Western Music',                  artist: 'Ray Charles' },
  { rank: 128, title: 'A Night at the Opera',                                        artist: 'Queen' },
  { rank: 129, title: 'The Wall',                                                    artist: 'Pink Floyd' },
  { rank: 130, title: '1999',                                                        artist: 'Prince' },
  { rank: 131, title: 'Dummy',                                                       artist: 'Portishead' },
  { rank: 132, title: '40 Greatest Hits',                                            artist: 'Hank Williams' },
  { rank: 133, title: 'Hejira',                                                      artist: 'Joni Mitchell' },
  { rank: 134, title: 'The Score',                                                   artist: 'Fugees' },
  { rank: 135, title: 'The Joshua Tree',                                             artist: 'U2' },
  { rank: 136, title: 'Maggot Brain',                                                artist: 'Funkadelic' },
  { rank: 137, title: '21',                                                          artist: 'Adele' },
  { rank: 138, title: 'The Immaculate Collection',                                   artist: 'Madonna' },
  { rank: 139, title: 'Paranoid',                                                    artist: 'Black Sabbath' },
  { rank: 140, title: 'Catch a Fire',                                                artist: 'Bob Marley and the Wailers' },
  { rank: 141, title: 'Doolittle',                                                   artist: 'Pixies' },
  { rank: 142, title: 'Born in the U.S.A.',                                          artist: 'Bruce Springsteen' },
  { rank: 143, title: 'The Velvet Underground',                                      artist: 'The Velvet Underground' },
  { rank: 144, title: 'Physical Graffiti',                                           artist: 'Led Zeppelin' },
  { rank: 145, title: 'The Marshall Mathers LP',                                     artist: 'Eminem' },
  { rank: 146, title: 'Parallel Lines',                                              artist: 'Blondie' },
  { rank: 147, title: 'Grace',                                                       artist: 'Jeff Buckley' },
  { rank: 148, title: 'Channel Orange',                                              artist: 'Frank Ocean' },
  { rank: 149, title: 'John Prine',                                                  artist: 'John Prine' },
  { rank: 150, title: 'Nebraska',                                                    artist: 'Bruce Springsteen' },
  { rank: 151, title: 'Faith',                                                       artist: 'George Michael' },
  { rank: 152, title: 'Pretenders',                                                  artist: 'The Pretenders' },
  { rank: 153, title: 'Rid of Me',                                                   artist: 'PJ Harvey' },
  { rank: 154, title: 'Amazing Grace',                                               artist: 'Aretha Franklin' },
  { rank: 155, title: 'The Black Album',                                             artist: 'Jay-Z' },
  { rank: 156, title: 'Let It Be',                                                   artist: 'The Replacements' },
  { rank: 157, title: "(What's the Story) Morning Glory?",                           artist: 'Oasis' },
  { rank: 158, title: "Mama's Gun",                                                  artist: 'Erykah Badu' },
  { rank: 159, title: 'Synchronicity',                                               artist: 'The Police' },
  { rank: 160, title: 'Ten',                                                         artist: 'Pearl Jam' },
  { rank: 161, title: 'Crosby, Stills & Nash',                                      artist: 'Crosby, Stills & Nash' },
  { rank: 162, title: 'Different Class',                                             artist: 'Pulp' },
  { rank: 163, title: 'Saturday Night Fever',                                        artist: 'Various artists' },
  { rank: 164, title: 'At Folsom Prison',                                            artist: 'Johnny Cash' },
  { rank: 165, title: 'Murmur',                                                      artist: 'R.E.M.' },
  { rank: 166, title: '20 Golden Greats',                                            artist: 'Buddy Holly' },
  { rank: 167, title: 'Violator',                                                    artist: 'Depeche Mode' },
  { rank: 168, title: "Can't Buy a Thrill",                                          artist: 'Steely Dan' },
  { rank: 169, title: 'The Stranger',                                                artist: 'Billy Joel' },
  { rank: 170, title: 'Folklore',                                                    artist: 'Taylor Swift' },
  { rank: 171, title: 'Daydream Nation',                                             artist: 'Sonic Youth' },
  { rank: 172, title: 'Bridge over Troubled Water',                                  artist: 'Simon & Garfunkel' },
  { rank: 173, title: 'In Utero',                                                    artist: 'Nirvana' },
  { rank: 174, title: 'The Harder They Come',                                        artist: 'Various artists' },
  { rank: 175, title: 'Damn',                                                        artist: 'Kendrick Lamar' },
  { rank: 176, title: 'Fear of a Black Planet',                                      artist: 'Public Enemy' },
  { rank: 177, title: 'Every Picture Tells a Story',                                 artist: 'Rod Stewart' },
  { rank: 178, title: 'Otis Blue/Otis Redding Sings Soul',                          artist: 'Otis Redding' },
  { rank: 179, title: 'Life After Death',                                            artist: 'The Notorious B.I.G.' },
  { rank: 180, title: 'Forever Changes',                                             artist: 'Love' },
  { rank: 181, title: 'Bringing It All Back Home',                                   artist: 'Bob Dylan' },
  { rank: 182, title: 'Sweet Baby James',                                            artist: 'James Taylor' },
  { rank: 183, title: 'Brown Sugar',                                                 artist: "D'Angelo" },
  { rank: 184, title: "She's So Unusual",                                            artist: 'Cyndi Lauper' },
  { rank: 185, title: 'Beggars Banquet',                                             artist: 'The Rolling Stones' },
  { rank: 186, title: 'Blood Sugar Sex Magik',                                       artist: 'Red Hot Chili Peppers' },
  { rank: 187, title: "AmeriKKKa's Most Wanted",                                     artist: 'Ice Cube' },
  { rank: 188, title: 'Electric Warrior',                                            artist: 'T. Rex' },
  { rank: 189, title: 'Dig Me Out',                                                  artist: 'Sleater-Kinney' },
  { rank: 190, title: 'Tommy',                                                       artist: 'The Who' },
  { rank: 191, title: 'At Last!',                                                    artist: 'Etta James' },
  { rank: 192, title: 'Licensed to Ill',                                             artist: 'Beastie Boys' },
  { rank: 193, title: 'Willy and the Poor Boys',                                     artist: 'Creedence Clearwater Revival' },
  { rank: 194, title: 'Bad',                                                         artist: 'Michael Jackson' },
  { rank: 195, title: 'Songs of Leonard Cohen',                                      artist: 'Leonard Cohen' },
  { rank: 196, title: 'Body Talk',                                                   artist: 'Robyn' },
  { rank: 197, title: 'Meet the Beatles!',                                           artist: 'The Beatles' },
  { rank: 198, title: "The B-52's",                                                  artist: "The B-52's" },
  { rank: 199, title: 'Slanted and Enchanted',                                       artist: 'Pavement' },
  { rank: 200, title: 'Diamond Life',                                                artist: 'Sade' },
  { rank: 201, title: 'Midnight Marauders',                                          artist: 'A Tribe Called Quest' },
  { rank: 202, title: 'Homogenic',                                                   artist: 'Björk' },
  { rank: 203, title: 'Pink Moon',                                                   artist: 'Nick Drake' },
  { rank: 204, title: 'Graduation',                                                  artist: 'Kanye West' },
  { rank: 205, title: 'Tea for the Tillerman',                                       artist: 'Cat Stevens' },
  { rank: 206, title: 'Low',                                                         artist: 'David Bowie' },
  { rank: 207, title: 'Eagles',                                                      artist: 'Eagles' },
  { rank: 208, title: 'Tha Carter III',                                              artist: 'Lil Wayne' },
  { rank: 209, title: 'Raising Hell',                                                artist: 'Run-DMC' },
  { rank: 210, title: 'The Birth of Soul',                                           artist: 'Ray Charles' },
  { rank: 211, title: 'Unknown Pleasures',                                           artist: 'Joy Division' },
  { rank: 212, title: 'Wild Is the Wind',                                            artist: 'Nina Simone' },
  { rank: 213, title: 'The Idler Wheel...',                                          artist: 'Fiona Apple' },
  { rank: 214, title: 'Wildflowers',                                                 artist: 'Tom Petty' },
  { rank: 215, title: 'American Beauty',                                             artist: 'Grateful Dead' },
  { rank: 216, title: 'Either/Or',                                                   artist: 'Elliott Smith' },
  { rank: 217, title: 'Definitely Maybe',                                            artist: 'Oasis' },
  { rank: 218, title: 'CrazySexyCool',                                               artist: 'TLC' },
  { rank: 219, title: 'Only Built 4 Cuban Linx...',                                  artist: 'Raekwon' },
  { rank: 220, title: 'Déjà Vu',                                                     artist: 'Crosby, Stills, Nash & Young' },
  { rank: 221, title: 'Rage Against the Machine',                                    artist: 'Rage Against the Machine' },
  { rank: 222, title: 'Ray of Light',                                                artist: 'Madonna' },
  { rank: 223, title: 'Imagine',                                                     artist: 'John Lennon' },
  { rank: 224, title: 'Fly',                                                         artist: 'Dixie Chicks' },
  { rank: 225, title: 'Yankee Hotel Foxtrot',                                        artist: 'Wilco' },
  { rank: 226, title: 'Layla and Other Assorted Love Songs',                         artist: 'Derek and the Dominos' },
  { rank: 227, title: "Here's Little Richard",                                       artist: 'Little Richard' },
  { rank: 228, title: 'De La Soul Is Dead',                                          artist: 'De La Soul' },
  { rank: 229, title: 'The Ultimate Collection',                                     artist: 'Patsy Cline' },
  { rank: 230, title: 'Anti',                                                        artist: 'Rihanna' },
  { rank: 231, title: 'Damn the Torpedoes',                                          artist: 'Tom Petty and the Heartbreakers' },
  { rank: 232, title: 'Giant Steps',                                                 artist: 'John Coltrane' },
  { rank: 233, title: 'Little Earthquakes',                                          artist: 'Tori Amos' },
  { rank: 234, title: 'Master of Reality',                                           artist: 'Black Sabbath' },
  { rank: 235, title: 'Metallica',                                                   artist: 'Metallica' },
  { rank: 236, title: 'Discovery',                                                   artist: 'Daft Punk' },
  { rank: 237, title: 'Red Headed Stranger',                                         artist: 'Willie Nelson' },
  { rank: 238, title: 'Trans-Europe Express',                                        artist: 'Kraftwerk' },
  { rank: 239, title: 'Criminal Minded',                                             artist: 'Boogie Down Productions' },
  { rank: 240, title: 'Live at the Harlem Square Club, 1963',                        artist: 'Sam Cooke' },
  { rank: 241, title: 'Blue Lines',                                                  artist: 'Massive Attack' },
  { rank: 242, title: 'Loaded',                                                      artist: 'The Velvet Underground' },
  { rank: 243, title: 'Odessey and Oracle',                                          artist: 'The Zombies' },
  { rank: 244, title: '808s & Heartbreak',                                           artist: 'Kanye West' },
  { rank: 245, title: 'Heaven or Las Vegas',                                         artist: 'Cocteau Twins' },
  { rank: 246, title: 'Mama Said Knock You Out',                                     artist: 'LL Cool J' },
  { rank: 247, title: 'Love Deluxe',                                                 artist: 'Sade' },
  { rank: 248, title: 'American Idiot',                                              artist: 'Green Day' },
  { rank: 249, title: 'Whitney Houston',                                             artist: 'Whitney Houston' },
  { rank: 250, title: 'Singles Going Steady',                                        artist: 'Buzzcocks' },
  { rank: 251, title: 'Honky Château',                                               artist: 'Elton John' },
  { rank: 252, title: 'Q: Are We Not Men? A: We Are Devo!',                         artist: 'Devo' },
  { rank: 253, title: 'The Piper at the Gates of Dawn',                              artist: 'Pink Floyd' },
  { rank: 254, title: 'Head Hunters',                                                artist: 'Herbie Hancock' },
  { rank: 255, title: "The Freewheelin' Bob Dylan",                                  artist: 'Bob Dylan' },
  { rank: 256, title: 'Tracy Chapman',                                               artist: 'Tracy Chapman' },
  { rank: 257, title: 'Coat of Many Colors',                                         artist: 'Dolly Parton' },
  { rank: 258, title: 'The Hissing of Summer Lawns',                                 artist: 'Joni Mitchell' },
  { rank: 259, title: 'Pearl',                                                       artist: 'Janis Joplin' },
  { rank: 260, title: 'Cut',                                                         artist: 'The Slits' },
  { rank: 261, title: 'Check Your Head',                                             artist: 'Beastie Boys' },
  { rank: 262, title: 'Power, Corruption & Lies',                                    artist: 'New Order' },
  { rank: 263, title: "A Hard Day's Night",                                          artist: 'The Beatles' },
  { rank: 264, title: 'Wish You Were Here',                                          artist: 'Pink Floyd' },
  { rank: 265, title: 'Wowee Zowee',                                                 artist: 'Pavement' },
  { rank: 266, title: 'Help!',                                                       artist: 'The Beatles' },
  { rank: 267, title: 'Double Nickels on the Dime',                                  artist: 'Minutemen' },
  { rank: 268, title: 'Sail Away',                                                   artist: 'Randy Newman' },
  { rank: 269, title: 'Yeezus',                                                      artist: 'Kanye West' },
  { rank: 270, title: 'Golden Hour',                                                 artist: 'Kacey Musgraves' },
  { rank: 271, title: "What's the 411?",                                             artist: 'Mary J. Blige' },
  { rank: 272, title: 'White Light/White Heat',                                      artist: 'The Velvet Underground' },
  { rank: 273, title: 'Entertainment!',                                              artist: 'Gang of Four' },
  { rank: 274, title: 'Sweetheart of the Rodeo',                                     artist: 'The Byrds' },
  { rank: 275, title: 'Curtis',                                                      artist: 'Curtis Mayfield' },
  { rank: 276, title: 'The Bends',                                                   artist: 'Radiohead' },
  { rank: 277, title: 'The Diary of Alicia Keys',                                    artist: 'Alicia Keys' },
  { rank: 278, title: 'Houses of the Holy',                                          artist: 'Led Zeppelin' },
  { rank: 279, title: 'MTV Unplugged in New York',                                   artist: 'Nirvana' },
  { rank: 280, title: 'Get Rich or Die Tryin\'',                                     artist: '50 Cent' },
  { rank: 281, title: 'Nilsson Schmilsson',                                          artist: 'Harry Nilsson' },
  { rank: 282, title: 'In the Wee Small Hours',                                      artist: 'Frank Sinatra' },
  { rank: 283, title: 'Bad Girls',                                                   artist: 'Donna Summer' },
  { rank: 284, title: 'Down Every Road 1962-1994',                                   artist: 'Merle Haggard' },
  { rank: 285, title: 'Third/Sister Lovers',                                         artist: 'Big Star' },
  { rank: 286, title: 'Californication',                                             artist: 'Red Hot Chili Peppers' },
  { rank: 287, title: 'Mr. Tambourine Man',                                          artist: 'The Byrds' },
  { rank: 288, title: 'The Modern Lovers',                                           artist: 'The Modern Lovers' },
  { rank: 289, title: 'Post',                                                        artist: 'Björk' },
  { rank: 290, title: 'Speakerboxxx/The Love Below',                                 artist: 'Outkast' },
  { rank: 291, title: "The Writing's on the Wall",                                   artist: "Destiny's Child" },
  { rank: 292, title: 'Van Halen',                                                   artist: 'Van Halen' },
  { rank: 293, title: 'Last Splash',                                                 artist: 'The Breeders' },
  { rank: 294, title: 'Weezer',                                                      artist: 'Weezer' },
  { rank: 295, title: 'Random Access Memories',                                      artist: 'Daft Punk' },
  { rank: 296, title: 'Rust Never Sleeps',                                           artist: 'Neil Young and Crazy Horse' },
  { rank: 297, title: 'So',                                                          artist: 'Peter Gabriel' },
  { rank: 298, title: 'Full Moon Fever',                                             artist: 'Tom Petty' },
  { rank: 299, title: 'Live at the Regal',                                           artist: 'B.B. King' },
  { rank: 300, title: 'Come On Over',                                                artist: 'Shania Twain' },
  { rank: 301, title: 'New York Dolls',                                              artist: 'New York Dolls' },
  { rank: 302, title: "Tonight's the Night",                                         artist: 'Neil Young' },
  { rank: 303, title: 'The Definitive Collection',                                   artist: 'ABBA' },
  { rank: 304, title: 'Just as I Am',                                                artist: 'Bill Withers' },
  { rank: 305, title: 'Alive!',                                                      artist: 'Kiss' },
  { rank: 306, title: "I'm Still in Love with You",                                  artist: 'Al Green' },
  { rank: 307, title: 'Portrait of a Legend: 1951-1964',                             artist: 'Sam Cooke' },
  { rank: 308, title: 'Here Come the Warm Jets',                                     artist: 'Brian Eno' },
  { rank: 309, title: 'Closer',                                                      artist: 'Joy Division' },
  { rank: 310, title: 'Pink Flag',                                                   artist: 'Wire' },
  { rank: 311, title: 'On the Beach',                                                artist: 'Neil Young' },
  { rank: 312, title: 'A Seat at the Table',                                         artist: 'Solange Knowles' },
  { rank: 313, title: 'Stories from the City, Stories from the Sea',                 artist: 'PJ Harvey' },
  { rank: 314, title: 'One in a Million',                                            artist: 'Aaliyah' },
  { rank: 315, title: 'El Mal Querer',                                               artist: 'Rosalía' },
  { rank: 316, title: 'The Who Sell Out',                                            artist: 'The Who' },
  { rank: 317, title: 'Lady in Satin',                                               artist: 'Billie Holiday' },
  { rank: 318, title: 'The Velvet Rope',                                             artist: 'Janet Jackson' },
  { rank: 319, title: 'The Stone Roses',                                             artist: 'The Stone Roses' },
  { rank: 320, title: 'Los Angeles',                                                 artist: 'X' },
  { rank: 321, title: 'Norman Fucking Rockwell!',                                    artist: 'Lana Del Rey' },
  { rank: 322, title: 'From Elvis in Memphis',                                       artist: 'Elvis Presley' },
  { rank: 323, title: 'Sandinista!',                                                 artist: 'The Clash' },
  { rank: 324, title: 'A Rush of Blood to the Head',                                 artist: 'Coldplay' },
  { rank: 325, title: 'All Killer, No Filler: The Anthology',                        artist: 'Jerry Lee Lewis' },
  { rank: 326, title: 'Dirty Mind',                                                  artist: 'Prince' },
  { rank: 327, title: 'Live at Leeds',                                               artist: 'The Who' },
  { rank: 328, title: 'Modern Vampires of the City',                                 artist: 'Vampire Weekend' },
  { rank: 329, title: 'Endtroducing.....',                                           artist: 'DJ Shadow' },
  { rank: 330, title: 'Aftermath',                                                   artist: 'The Rolling Stones' },
  { rank: 331, title: 'Like a Prayer',                                               artist: 'Madonna' },
  { rank: 332, title: 'Elvis Presley',                                               artist: 'Elvis Presley' },
  { rank: 333, title: 'Still Bill',                                                  artist: 'Bill Withers' },
  { rank: 334, title: 'Abraxas',                                                     artist: 'Santana' },
  { rank: 335, title: 'The Basement Tapes',                                          artist: 'Bob Dylan' },
  { rank: 336, title: 'Avalon',                                                      artist: 'Roxy Music' },
  { rank: 337, title: 'John Wesley Harding',                                         artist: 'Bob Dylan' },
  { rank: 338, title: 'Another Green World',                                         artist: 'Brian Eno' },
  { rank: 339, title: "Janet Jackson's Rhythm Nation 1814",                          artist: 'Janet Jackson' },
  { rank: 340, title: 'Doggystyle',                                                  artist: 'Snoop Dogg' },
  { rank: 341, title: 'Siamese Dream',                                               artist: 'The Smashing Pumpkins' },
  { rank: 342, title: 'Let It Be',                                                   artist: 'The Beatles' },
  { rank: 343, title: 'Greatest Hits',                                               artist: 'Sly and the Family Stone' },
  { rank: 344, title: 'Funky Kingston',                                              artist: 'Toots and the Maytals' },
  { rank: 345, title: 'The Wild, the Innocent & the E Street Shuffle',               artist: 'Bruce Springsteen' },
  { rank: 346, title: 'AM',                                                          artist: 'Arctic Monkeys' },
  { rank: 347, title: 'Liquid Swords',                                               artist: 'GZA' },
  { rank: 348, title: 'Time (The Revelator)',                                        artist: 'Gillian Welch' },
  { rank: 349, title: 'Kick Out the Jams',                                           artist: 'MC5' },
  { rank: 350, title: 'Music of My Mind',                                            artist: 'Stevie Wonder' },
  { rank: 351, title: 'SOS',                                                         artist: 'SZA' },
  { rank: 352, title: 'The Slim Shady LP',                                           artist: 'Eminem' },
  { rank: 353, title: 'The Cars',                                                    artist: 'The Cars' },
  { rank: 354, title: 'Germfree Adolescents',                                        artist: 'X-Ray Spex' },
  { rank: 355, title: 'Black Sabbath',                                               artist: 'Black Sabbath' },
  { rank: 356, title: 'Gris-Gris',                                                   artist: 'Dr. John' },
  { rank: 357, title: 'Rain Dogs',                                                   artist: 'Tom Waits' },
  { rank: 358, title: 'Sour',                                                        artist: 'Olivia Rodrigo' },
  { rank: 359, title: 'Radio City',                                                  artist: 'Big Star' },
  { rank: 360, title: 'One Nation Under a Groove',                                   artist: 'Funkadelic' },
  { rank: 361, title: 'The Black Parade',                                            artist: 'My Chemical Romance' },
  { rank: 362, title: 'Never Too Much',                                              artist: 'Luther Vandross' },
  { rank: 363, title: 'Mothership Connection',                                       artist: 'Parliament' },
  { rank: 364, title: 'More Songs About Buildings and Food',                         artist: 'Talking Heads' },
  { rank: 365, title: 'Madvillainy',                                                 artist: 'Madvillain' },
  { rank: 366, title: 'Rocks',                                                       artist: 'Aerosmith' },
  { rank: 367, title: "If You're Reading This It's Too Late",                        artist: 'Drake' },
  { rank: 368, title: 'All Things Must Pass',                                        artist: 'George Harrison' },
  { rank: 369, title: 'The Infamous',                                                artist: 'Mobb Deep' },
  { rank: 370, title: 'Tha Carter II',                                               artist: 'Lil Wayne' },
  { rank: 371, title: 'Anthology',                                                   artist: 'The Temptations' },
  { rank: 372, title: 'Cheap Thrills',                                               artist: 'Big Brother and the Holding Company' },
  { rank: 373, title: 'Hot Buttered Soul',                                           artist: 'Isaac Hayes' },
  { rank: 374, title: 'King of the Delta Blues Singers',                             artist: 'Robert Johnson' },
  { rank: 375, title: 'Dookie',                                                      artist: 'Green Day' },
  { rank: 376, title: 'In the Aeroplane Over the Sea',                               artist: 'Neutral Milk Hotel' },
  { rank: 377, title: 'Fever to Tell',                                               artist: 'Yeah Yeah Yeahs' },
  { rank: 378, title: 'Run-D.M.C.',                                                  artist: 'Run-DMC' },
  { rank: 379, title: 'Moving Pictures',                                             artist: 'Rush' },
  { rank: 380, title: 'Mingus Ah Um',                                                artist: 'Charles Mingus' },
  { rank: 381, title: "(Pronounced 'Lĕh-'nérd 'Skin-'nérd)",                        artist: 'Lynyrd Skynyrd' },
  { rank: 382, title: 'Currents',                                                    artist: 'Tame Impala' },
  { rank: 383, title: 'Mezzanine',                                                   artist: 'Massive Attack' },
  { rank: 384, title: 'The Kinks Are the Village Green Preservation Society',        artist: 'The Kinks' },
  { rank: 385, title: 'Rocket to Russia',                                            artist: 'Ramones' },
  { rank: 386, title: 'Donuts',                                                      artist: 'J Dilla' },
  { rank: 387, title: 'In Rainbows',                                                 artist: 'Radiohead' },
  { rank: 388, title: 'Young, Gifted and Black',                                     artist: 'Aretha Franklin' },
  { rank: 389, title: 'The Emancipation of Mimi',                                   artist: 'Mariah Carey' },
  { rank: 390, title: 'Surfer Rosa',                                                 artist: 'Pixies' },
  { rank: 391, title: 'Kaleidoscope',                                                artist: 'Kelis' },
  { rank: 392, title: 'Proud Mary: The Best of Ike & Tina Turner',                  artist: 'Ike & Tina Turner' },
  { rank: 393, title: '1989',                                                        artist: 'Taylor Swift' },
  { rank: 394, title: 'Diana',                                                       artist: 'Diana Ross' },
  { rank: 395, title: 'Black Messiah',                                               artist: "D'Angelo and the Vanguard" },
  { rank: 396, title: 'Something/Anything?',                                         artist: 'Todd Rundgren' },
  { rank: 397, title: 'When We All Fall Asleep, Where Do We Go?',                   artist: 'Billie Eilish' },
  { rank: 398, title: 'The Raincoats',                                               artist: 'The Raincoats' },
  { rank: 399, title: 'Brian Wilson Presents Smile',                                 artist: 'Brian Wilson' },
  { rank: 400, title: 'Beauty and the Beat',                                         artist: "The Go-Go's" },
  { rank: 401, title: 'Blondie',                                                     artist: 'Blondie' },
  { rank: 402, title: 'Expensive Shit',                                              artist: 'Fela Kuti' },
  { rank: 403, title: 'Supreme Clientele',                                           artist: 'Ghostface Killah' },
  { rank: 404, title: 'Rapture',                                                     artist: 'Anita Baker' },
  { rank: 405, title: 'Nuggets: Original Artyfacts from the First Psychedelic Era, 1965-1968', artist: 'Various artists' },
  { rank: 406, title: '69 Love Songs',                                               artist: 'The Magnetic Fields' },
  { rank: 407, title: 'Everybody Knows This Is Nowhere',                             artist: 'Neil Young' },
  { rank: 408, title: 'Ace of Spades',                                               artist: 'Motörhead' },
  { rank: 409, title: "Workingman's Dead",                                           artist: 'Grateful Dead' },
  { rank: 410, title: 'Wild Honey',                                                  artist: 'The Beach Boys' },
  { rank: 411, title: 'Love and Theft',                                              artist: 'Bob Dylan' },
  { rank: 412, title: 'Going to a Go-Go',                                            artist: 'Smokey Robinson' },
  { rank: 413, title: "Cosmo's Factory",                                             artist: 'Creedence Clearwater Revival' },
  { rank: 414, title: 'Risqué',                                                      artist: 'Chic' },
  { rank: 415, title: 'Look-Ka Py Py',                                               artist: 'The Meters' },
  { rank: 416, title: 'Things Fall Apart',                                           artist: 'The Roots' },
  { rank: 417, title: 'The Shape of Jazz to Come',                                   artist: 'Ornette Coleman' },
  { rank: 418, title: 'Brothers in Arms',                                            artist: 'Dire Straits' },
  { rank: 419, title: 'Chief',                                                       artist: 'Eric Church' },
  { rank: 420, title: "That's the Way of the World",                                 artist: 'Earth, Wind & Fire' },
  { rank: 421, title: 'Arular',                                                      artist: 'M.I.A.' },
  { rank: 422, title: "Let's Get It On",                                             artist: 'Marvin Gaye' },
  { rank: 423, title: 'I Can Hear the Heart Beating as One',                         artist: 'Yo La Tengo' },
  { rank: 424, title: 'Odelay',                                                      artist: 'Beck' },
  { rank: 425, title: 'Paul Simon',                                                  artist: 'Paul Simon' },
  { rank: 426, title: 'Lucinda Williams',                                            artist: 'Lucinda Williams' },
  { rank: 427, title: 'Call Me',                                                     artist: 'Al Green' },
  { rank: 428, title: 'New Day Rising',                                              artist: 'Hüsker Dü' },
  { rank: 429, title: 'Reach Out',                                                   artist: 'Four Tops' },
  { rank: 430, title: 'Un Verano Sin Ti',                                            artist: 'Bad Bunny' },
  { rank: 431, title: 'How Will the Wolf Survive?',                                  artist: 'Los Lobos' },
  { rank: 432, title: 'Confessions',                                                 artist: 'Usher' },
  { rank: 433, title: 'Sound of Silver',                                             artist: 'LCD Soundsystem' },
  { rank: 434, title: 'Crooked Rain, Crooked Rain',                                  artist: 'Pavement' },
  { rank: 435, title: 'Actually',                                                    artist: 'Pet Shop Boys' },
  { rank: 436, title: 'All Eyez on Me',                                              artist: '2Pac' },
  { rank: 437, title: 'Demon Days',                                                  artist: 'Gorillaz' },
  { rank: 438, title: 'Parklife',                                                    artist: 'Blur' },
  { rank: 439, title: 'Sex Machine',                                                 artist: 'James Brown' },
  { rank: 440, title: "Coal Miner's Daughter",                                       artist: 'Loretta Lynn' },
  { rank: 441, title: 'Blackout',                                                    artist: 'Britney Spears' },
  { rank: 442, title: 'Beauty Behind the Madness',                                   artist: 'The Weeknd' },
  { rank: 443, title: 'Scary Monsters (and Super Creeps)',                           artist: 'David Bowie' },
  { rank: 444, title: 'Extraordinary Machine',                                       artist: 'Fiona Apple' },
  { rank: 445, title: 'Close to the Edge',                                           artist: 'Yes' },
  { rank: 446, title: 'Journey in Satchidananda',                                    artist: 'Alice Coltrane' },
  { rank: 447, title: 'X 100pre',                                                    artist: 'Bad Bunny' },
  { rank: 448, title: 'Complete & Unbelievable: The Otis Redding Dictionary of Soul', artist: 'Otis Redding' },
  { rank: 449, title: 'Elephant',                                                    artist: 'The White Stripes' },
  { rank: 450, title: 'Ram',                                                         artist: 'Paul McCartney' },
  { rank: 451, title: 'First Take',                                                  artist: 'Roberta Flack' },
  { rank: 452, title: 'Anthology',                                                   artist: 'The Supremes' },
  { rank: 453, title: 'Pretty Hate Machine',                                         artist: 'Nine Inch Nails' },
  { rank: 454, title: 'Ege Bamyası',                                                 artist: 'Can' },
  { rank: 455, title: 'Bo Diddley / Go Bo Diddley',                                  artist: 'Bo Diddley' },
  { rank: 456, title: "Al Green's Greatest Hits",                                    artist: 'Al Green' },
  { rank: 457, title: 'I Do Not Want What I Haven\'t Got',                           artist: 'Sinéad O\'Connor' },
  { rank: 458, title: 'Southeastern',                                                artist: 'Jason Isbell' },
  { rank: 459, title: 'Man on the Moon: The End of Day',                             artist: 'Kid Cudi' },
  { rank: 460, title: 'Melodrama',                                                   artist: 'Lorde' },
  { rank: 461, title: 'For Emma, Forever Ago',                                       artist: 'Bon Iver' },
  { rank: 462, title: 'The Gilded Palace of Sin',                                    artist: 'The Flying Burrito Brothers' },
  { rank: 463, title: 'Eli and the Thirteenth Confession',                           artist: 'Laura Nyro' },
  { rank: 464, title: '3 + 3',                                                       artist: 'The Isley Brothers' },
  { rank: 465, title: 'The Best of the Classic Years',                               artist: 'King Sunny Adé' },
  { rank: 466, title: 'Red',                                                         artist: 'Black Uhuru' },
  { rank: 467, title: "BLACKsummers'night",                                          artist: 'Maxwell' },
  { rank: 468, title: 'Some Girls',                                                  artist: 'The Rolling Stones' },
  { rank: 469, title: 'Clandestino',                                                 artist: 'Manu Chao' },
  { rank: 470, title: '400 Degreez',                                                 artist: 'Juvenile' },
  { rank: 471, title: 'Surrealistic Pillow',                                         artist: 'Jefferson Airplane' },
  { rank: 472, title: 'Ctrl',                                                        artist: 'SZA' },
  { rank: 473, title: 'Barrio Fino',                                                 artist: 'Daddy Yankee' },
  { rank: 474, title: '#1 Record',                                                   artist: 'Big Star' },
  { rank: 475, title: 'Sheryl Crow',                                                 artist: 'Sheryl Crow' },
  { rank: 476, title: 'Kimono My House',                                             artist: 'Sparks' },
  { rank: 477, title: "Moanin' in the Moonlight",                                    artist: "Howlin' Wolf" },
  { rank: 478, title: 'Something Else by the Kinks',                                 artist: 'The Kinks' },
  { rank: 479, title: 'Amor Prohibido',                                              artist: 'Selena' },
  { rank: 480, title: 'The Weight of These Wings',                                   artist: 'Miranda Lambert' },
  { rank: 481, title: "If You're Feeling Sinister",                                  artist: 'Belle and Sebastian' },
  { rank: 482, title: 'Bizarre Ride II the Pharcyde',                                artist: 'The Pharcyde' },
  { rank: 483, title: 'The Anthology: 1947-1972',                                    artist: 'Muddy Waters' },
  { rank: 484, title: 'Born This Way',                                               artist: 'Lady Gaga' },
  { rank: 485, title: 'I Want to See the Bright Lights Tonight',                     artist: 'Richard Thompson' },
  { rank: 486, title: 'Continuum',                                                   artist: 'John Mayer' },
  { rank: 487, title: 'Damaged',                                                     artist: 'Black Flag' },
  { rank: 488, title: 'The Stooges',                                                 artist: 'The Stooges' },
  { rank: 489, title: 'Back to Mono (1958-1969)',                                    artist: 'Various artists' },
  { rank: 490, title: 'Heart Like a Wheel',                                          artist: 'Linda Ronstadt' },
  { rank: 491, title: "Harry's House",                                               artist: 'Harry Styles' },
  { rank: 492, title: 'Nick of Time',                                                artist: 'Bonnie Raitt' },
  { rank: 493, title: 'Here, My Dear',                                               artist: 'Marvin Gaye' },
  { rank: 494, title: 'Presenting the Fabulous Ronettes Featuring Veronica',         artist: 'The Ronettes' },
  { rank: 495, title: 'II',                                                          artist: 'Boyz II Men' },
  { rank: 496, title: '¿Dónde Están los Ladrones?',                                  artist: 'Shakira' },
  { rank: 497, title: 'The Indestructible Beat of Soweto',                           artist: 'Various artists' },
  { rank: 498, title: 'Suicide',                                                     artist: 'Suicide' },
  { rank: 499, title: 'Ask Rufus',                                                   artist: 'Rufus featuring Chaka Khan' },
  { rank: 500, title: 'Funeral',                                                     artist: 'Arcade Fire' },
];

// ── Spotify auth ──────────────────────────────────────────────────────────────

const SPOTIFY_TOKEN_URL = 'https://accounts.spotify.com/api/token';
const SPOTIFY_API = 'https://api.spotify.com/v1';

let tokenCache: { value: string; expiresAt: number } | null = null;

async function getToken(): Promise<string> {
  if (tokenCache && Date.now() < tokenCache.expiresAt) return tokenCache.value;
  const id = process.env.SPOTIFY_CLIENT_ID;
  const secret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!id || !secret) throw new Error('SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET not set');
  const res = await fetch(SPOTIFY_TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) throw new Error(`Token fetch ${res.status}`);
  const data = await res.json() as { access_token: string; expires_in: number };
  tokenCache = { value: data.access_token, expiresAt: Date.now() + (data.expires_in - 60) * 1000 };
  return tokenCache.value;
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

class RateLimitError extends Error {
  retryAfterSec: number;
  constructor(sec: number) { super(`RATE_LIMIT:${sec}`); this.retryAfterSec = sec; }
}

async function spotifyGet(path: string, attempt = 0): Promise<any> {
  const token = await getToken();
  const url = path.startsWith('https://') ? path : `${SPOTIFY_API}${path}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 429) {
    const raw = Number(res.headers.get('Retry-After') ?? 5);
    const sec = isNaN(raw) ? 5 : raw;
    if (sec > 120 || attempt >= 3) throw new RateLimitError(sec);
    console.log(`  [rate limit] waiting ${sec}s… (attempt ${attempt + 1}/3)`);
    await sleep(sec * 1000);
    return spotifyGet(path, attempt + 1);
  }
  if (!res.ok) throw new Error(`Spotify ${res.status}: ${path}`);
  return res.json();
}

type AlbumHit = { id: string; title: string; artist: string; coverUrl: string | null };

async function searchAlbum(title: string, artist: string): Promise<AlbumHit | null> {
  const params = new URLSearchParams({ q: `${artist} ${title}`, type: 'album', limit: '10' });
  const json = await spotifyGet(`/search?${params}`);
  const items: any[] = json?.albums?.items ?? [];
  if (items.length === 0) return null;

  const scored = items.map(item => {
    const itemArtist = item.artists?.map((a: any) => a.name).join(', ') ?? '';
    return { item, score: matchScore(title, item.name, artist, itemArtist) };
  }).sort((a, b) => b.score - a.score);

  const best = scored[0];
  if (best.score < MATCH_THRESHOLD) return null;

  return {
    id: best.item.id,
    title: best.item.name,
    artist: best.item.artists?.[0]?.name ?? artist,
    coverUrl: best.item.images?.[0]?.url ?? null,
  };
}

// ── Main ──────────────────────────────────────────────────────────────────────

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

async function main() {
  if (!process.env.SPOTIFY_CLIENT_ID || !process.env.SPOTIFY_CLIENT_SECRET) {
    console.error('Missing SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET');
    process.exit(1);
  }
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }

  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  // Resolve category
  const { data: category } = await db
    .from('ranking_categories')
    .select('id, title')
    .eq('slug', CATEGORY_SLUG)
    .maybeSingle();

  if (!category) {
    console.error(`No ranking category found for slug "${CATEGORY_SLUG}"`);
    console.error('Available slugs: run SELECT slug FROM ranking_categories;');
    process.exit(1);
  }
  console.log(`Category: ${category.title} (${CATEGORY_SLUG})\n`);

  // Canary Spotify check
  try {
    process.stdout.write('Checking Spotify access… ');
    await spotifyGet('/search?q=test&type=artist&limit=1');
    console.log('OK\n');
  } catch (err: any) {
    if (err instanceof RateLimitError) {
      const mins = Math.ceil(err.retryAfterSec / 60);
      console.log(`RATE LIMITED\n\nWait ${mins} minute(s) and try again.\n`);
    } else {
      console.log(`FAILED — ${err.message}\n`);
    }
    process.exit(1);
  }

  const done = loadState();
  let seeded = 0;
  let skipped = 0;
  let failed = 0;

  for (const entry of RS500) {
    const key = `${entry.rank}|${entry.title}`;

    if (done.has(key)) {
      skipped++;
      continue;
    }

    await sleep(DELAY_MS);

    let hit: AlbumHit | null = null;

    if (entry.spotifyId) {
      try {
        const data = await spotifyGet(`/albums/${entry.spotifyId}`);
        hit = {
          id: data.id,
          title: data.name,
          artist: data.artists?.[0]?.name ?? entry.artist,
          coverUrl: data.images?.[0]?.url ?? null,
        };
      } catch (err: any) {
        console.warn(`  ✗ #${entry.rank} ID fetch failed: ${entry.artist} — ${entry.title}: ${err.message}`);
        failed++;
        continue;
      }
    } else {
      hit = await searchAlbum(entry.title, entry.artist);
    }

    if (!hit) {
      console.warn(`  ✗ #${entry.rank} Not found: ${entry.artist} — ${entry.title}`);
      failed++;
      continue;
    }

    const seedVotes = parseFloat((1.0 / entry.rank).toFixed(4));
    console.log(`  #${String(entry.rank).padStart(3)} [${seedVotes.toFixed(4)}] ${hit.artist} — ${hit.title}`);

    if (DRY_RUN) { skipped++; continue; }

    // Upsert into releases so the leaderboard can display title/artist/cover
    await db.from('releases').upsert({
      id: hit.id,
      title: hit.title,
      artist: hit.artist,
      cover_url: hit.coverUrl,
      release_type: 'Album',
    }, { onConflict: 'id', ignoreDuplicates: true });

    // Upsert seed entry
    const { error } = await db.from('ranking_seed_entries').upsert({
      category_id: category.id,
      release_id: hit.id,
      seed_votes: seedVotes,
    }, { onConflict: 'category_id,release_id' });

    if (error) {
      console.error(`    DB error: ${error.message}`);
      failed++;
    } else {
      seeded++;
      done.add(key);
      saveState(done);
    }
  }

  console.log(`\nDone. seeded=${seeded} skipped=${skipped} failed=${failed}`);
  if (failed > 0) {
    console.log('Re-run to retry failed entries, or add spotifyId fields to the RS500 array for stubborn ones.');
  }
}

main().catch((e) => {
  if (e instanceof RateLimitError) {
    const mins = Math.ceil(e.retryAfterSec / 60);
    console.error(`\nSpotify rate limit hit mid-run. Wait ${mins} minute(s) and re-run to resume.\n`);
  } else {
    console.error(e);
  }
  process.exit(1);
});
