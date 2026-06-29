// Grammy Award for Best Alternative Music Album
// year = ceremony year. Source: Wikipedia
import type { GrammyEntry } from './grammy-aoty';
export type { GrammyEntry };

export const GRAMMY_ALTERNATIVE: GrammyEntry[] = [
  // ── 1991 ──────────────────────────────────────────────────────────────────
  { year: 1991, won: true,  album: "I Do Not Want What I Haven't Got",            artist: 'Sinéad O\'Connor' },
  { year: 1991, won: false, album: 'All Shook Down',                              artist: 'The Replacements' },
  { year: 1991, won: false, album: 'The Sensual World',                           artist: 'Kate Bush' },
  // ── 1992 ──────────────────────────────────────────────────────────────────
  { year: 1992, won: true,  album: 'Out of Time',                                 artist: 'R.E.M.' },
  { year: 1992, won: false, album: 'Mighty Like a Rose',                          artist: 'Elvis Costello' },
  { year: 1992, won: false, album: 'Nevermind',                                   artist: 'Nirvana' },
  // ── 1993 ──────────────────────────────────────────────────────────────────
  { year: 1993, won: true,  album: 'Bone Machine',                                artist: 'Tom Waits' },
  { year: 1993, won: false, album: 'Nonsuch',                                     artist: 'XTC' },
  { year: 1993, won: false, album: 'Wish',                                        artist: 'The Cure' },
  { year: 1993, won: false, album: 'Your Arsenal',                                artist: 'Morrissey' },
  // ── 1994 ──────────────────────────────────────────────────────────────────
  { year: 1994, won: true,  album: 'Zooropa',                                     artist: 'U2' },
  { year: 1994, won: false, album: 'Automatic for the People',                    artist: 'R.E.M.' },
  { year: 1994, won: false, album: 'In Utero',                                    artist: 'Nirvana' },
  { year: 1994, won: false, album: 'Siamese Dream',                               artist: 'The Smashing Pumpkins' },
  // ── 1995 ──────────────────────────────────────────────────────────────────
  { year: 1995, won: true,  album: 'Dookie',                                      artist: 'Green Day' },
  { year: 1995, won: false, album: 'The Downward Spiral',                         artist: 'Nine Inch Nails' },
  { year: 1995, won: false, album: 'Fumbling Towards Ecstasy',                    artist: 'Sarah McLachlan' },
  { year: 1995, won: false, album: 'Under the Pink',                              artist: 'Tori Amos' },
  // ── 1996 ──────────────────────────────────────────────────────────────────
  { year: 1996, won: true,  album: 'MTV Unplugged in New York',                   artist: 'Nirvana' },
  { year: 1996, won: false, album: 'Foo Fighters',                                artist: 'Foo Fighters' },
  { year: 1996, won: false, album: 'Post',                                        artist: 'Björk' },
  { year: 1996, won: false, album: 'To Bring You My Love',                        artist: 'PJ Harvey' },
  // ── 1997 ──────────────────────────────────────────────────────────────────
  { year: 1997, won: true,  album: 'Odelay',                                      artist: 'Beck' },
  { year: 1997, won: false, album: 'Boys for Pele',                               artist: 'Tori Amos' },
  { year: 1997, won: false, album: 'Mellon Collie and the Infinite Sadness',      artist: 'The Smashing Pumpkins' },
  { year: 1997, won: false, album: 'New Adventures in Hi-Fi',                     artist: 'R.E.M.' },
  // ── 1998 ──────────────────────────────────────────────────────────────────
  { year: 1998, won: true,  album: 'OK Computer',                                 artist: 'Radiohead' },
  { year: 1998, won: false, album: 'Dig Your Own Hole',                           artist: 'The Chemical Brothers' },
  { year: 1998, won: false, album: 'The Fat of the Land',                         artist: 'The Prodigy' },
  { year: 1998, won: false, album: 'Homogenic',                                   artist: 'Björk' },
  // ── 1999 ──────────────────────────────────────────────────────────────────
  { year: 1999, won: true,  album: 'Hello Nasty',                                 artist: 'Beastie Boys' },
  { year: 1999, won: false, album: 'Adore',                                       artist: 'The Smashing Pumpkins' },
  { year: 1999, won: false, album: 'From the Choirgirl Hotel',                    artist: 'Tori Amos' },
  { year: 1999, won: false, album: 'Is This Desire?',                             artist: 'PJ Harvey' },
  // ── 2000 ──────────────────────────────────────────────────────────────────
  { year: 2000, won: true,  album: 'Mutations',                                   artist: 'Beck' },
  { year: 2000, won: false, album: 'The Fragile',                                 artist: 'Nine Inch Nails' },
  { year: 2000, won: false, album: 'Play',                                        artist: 'Moby' },
  { year: 2000, won: false, album: 'To Venus and Back',                           artist: 'Tori Amos' },
  // ── 2001 ──────────────────────────────────────────────────────────────────
  { year: 2001, won: true,  album: 'Kid A',                                       artist: 'Radiohead' },
  { year: 2001, won: false, album: 'Bloodflowers',                                artist: 'The Cure' },
  { year: 2001, won: false, album: 'Midnite Vultures',                            artist: 'Beck' },
  { year: 2001, won: false, album: 'When the Pawn...',                            artist: 'Fiona Apple' },
  // ── 2002 ──────────────────────────────────────────────────────────────────
  { year: 2002, won: true,  album: 'Parachutes',                                  artist: 'Coldplay' },
  { year: 2002, won: false, album: 'Amnesiac',                                    artist: 'Radiohead' },
  { year: 2002, won: false, album: 'Vespertine',                                  artist: 'Björk' },
  // ── 2003 ──────────────────────────────────────────────────────────────────
  { year: 2003, won: true,  album: 'A Rush of Blood to the Head',                 artist: 'Coldplay' },
  { year: 2003, won: false, album: 'Sea Change',                                  artist: 'Beck' },
  // ── 2004 ──────────────────────────────────────────────────────────────────
  { year: 2004, won: true,  album: 'Elephant',                                    artist: 'The White Stripes' },
  { year: 2004, won: false, album: 'Fever to Tell',                               artist: 'Yeah Yeah Yeahs' },
  { year: 2004, won: false, album: 'Hail to the Thief',                           artist: 'Radiohead' },
  // ── 2005 ──────────────────────────────────────────────────────────────────
  { year: 2005, won: true,  album: 'A Ghost Is Born',                             artist: 'Wilco' },
  { year: 2005, won: false, album: 'Franz Ferdinand',                             artist: 'Franz Ferdinand' },
  { year: 2005, won: false, album: 'Good News for People Who Love Bad News',      artist: 'Modest Mouse' },
  { year: 2005, won: false, album: 'Medúlla',                                     artist: 'Björk' },
  { year: 2005, won: false, album: 'Uh Huh Her',                                  artist: 'PJ Harvey' },
  // ── 2006 ──────────────────────────────────────────────────────────────────
  { year: 2006, won: true,  album: 'Get Behind Me Satan',                         artist: 'The White Stripes' },
  { year: 2006, won: false, album: 'Funeral',                                     artist: 'Arcade Fire' },
  { year: 2006, won: false, album: 'Guero',                                       artist: 'Beck' },
  { year: 2006, won: false, album: 'Plans',                                       artist: 'Death Cab for Cutie' },
  // ── 2007 ──────────────────────────────────────────────────────────────────
  { year: 2007, won: true,  album: 'St. Elsewhere',                               artist: 'Gnarls Barkley' },
  { year: 2007, won: false, album: 'At War with the Mystics',                     artist: 'The Flaming Lips' },
  { year: 2007, won: false, album: 'Show Your Bones',                             artist: 'Yeah Yeah Yeahs' },
  { year: 2007, won: false, album: "Whatever People Say I Am, That's What I'm Not", artist: 'Arctic Monkeys' },
  // ── 2008 ──────────────────────────────────────────────────────────────────
  { year: 2008, won: true,  album: 'Icky Thump',                                  artist: 'The White Stripes' },
  { year: 2008, won: false, album: 'Alright, Still',                              artist: 'Lily Allen' },
  { year: 2008, won: false, album: 'Neon Bible',                                  artist: 'Arcade Fire' },
  { year: 2008, won: false, album: 'Volta',                                       artist: 'Björk' },
  { year: 2008, won: false, album: 'Wincing the Night Away',                      artist: 'The Shins' },
  // ── 2009 ──────────────────────────────────────────────────────────────────
  { year: 2009, won: true,  album: 'In Rainbows',                                 artist: 'Radiohead' },
  { year: 2009, won: false, album: 'Evil Urges',                                  artist: 'My Morning Jacket' },
  { year: 2009, won: false, album: 'Modern Guilt',                                artist: 'Beck' },
  { year: 2009, won: false, album: 'Narrow Stairs',                               artist: 'Death Cab for Cutie' },
  // ── 2010 ──────────────────────────────────────────────────────────────────
  { year: 2010, won: true,  album: 'Wolfgang Amadeus Phoenix',                    artist: 'Phoenix' },
  { year: 2010, won: false, album: "It's Blitz!",                                 artist: 'Yeah Yeah Yeahs' },
  { year: 2010, won: false, album: 'Sounds of the Universe',                      artist: 'Depeche Mode' },
  // ── 2011 ──────────────────────────────────────────────────────────────────
  { year: 2011, won: true,  album: 'Brothers',                                    artist: 'The Black Keys' },
  { year: 2011, won: false, album: 'Contra',                                      artist: 'Vampire Weekend' },
  { year: 2011, won: false, album: 'The Suburbs',                                 artist: 'Arcade Fire' },
  // ── 2012 ──────────────────────────────────────────────────────────────────
  { year: 2012, won: true,  album: 'Bon Iver',                                    artist: 'Bon Iver' },
  { year: 2012, won: false, album: 'The King of Limbs',                           artist: 'Radiohead' },
  { year: 2012, won: false, album: 'Torches',                                     artist: 'Foster the People' },
  // ── 2013 ──────────────────────────────────────────────────────────────────
  { year: 2013, won: true,  album: 'Making Mirrors',                              artist: 'Gotye' },
  { year: 2013, won: false, album: 'Bad as Me',                                   artist: 'Tom Waits' },
  { year: 2013, won: false, album: 'Biophilia',                                   artist: 'Björk' },
  { year: 2013, won: false, album: "Hurry Up, We're Dreaming",                    artist: 'M83' },
  { year: 2013, won: false, album: 'The Idler Wheel...',                          artist: 'Fiona Apple' },
  // ── 2014 ──────────────────────────────────────────────────────────────────
  { year: 2014, won: true,  album: 'Modern Vampires of the City',                 artist: 'Vampire Weekend' },
  { year: 2014, won: false, album: 'Hesitation Marks',                            artist: 'Nine Inch Nails' },
  { year: 2014, won: false, album: 'Lonerism',                                    artist: 'Tame Impala' },
  { year: 2014, won: false, album: 'Trouble Will Find Me',                        artist: 'The National' },
  // ── 2015 ──────────────────────────────────────────────────────────────────
  { year: 2015, won: true,  album: 'St. Vincent',                                 artist: 'St. Vincent' },
  { year: 2015, won: false, album: 'Lazaretto',                                   artist: 'Jack White' },
  { year: 2015, won: false, album: 'Melophobia',                                  artist: 'Cage the Elephant' },
  { year: 2015, won: false, album: 'Reflektor',                                   artist: 'Arcade Fire' },
  // ── 2016 ──────────────────────────────────────────────────────────────────
  { year: 2016, won: true,  album: 'Sound & Color',                               artist: 'Alabama Shakes' },
  { year: 2016, won: false, album: 'Currents',                                    artist: 'Tame Impala' },
  { year: 2016, won: false, album: 'Star Wars',                                   artist: 'Wilco' },
  { year: 2016, won: false, album: 'Vulnicura',                                   artist: 'Björk' },
  // ── 2017 ──────────────────────────────────────────────────────────────────
  { year: 2017, won: true,  album: 'Blackstar',                                   artist: 'David Bowie' },
  { year: 2017, won: false, album: '22, A Million',                               artist: 'Bon Iver' },
  { year: 2017, won: false, album: 'The Hope Six Demolition Project',             artist: 'PJ Harvey' },
  { year: 2017, won: false, album: 'A Moon Shaped Pool',                          artist: 'Radiohead' },
  // ── 2018 ──────────────────────────────────────────────────────────────────
  { year: 2018, won: true,  album: 'Sleep Well Beast',                            artist: 'The National' },
  { year: 2018, won: false, album: 'American Dream',                              artist: 'LCD Soundsystem' },
  { year: 2018, won: false, album: 'Everything Now',                              artist: 'Arcade Fire' },
  { year: 2018, won: false, album: 'Humanz',                                      artist: 'Gorillaz' },
  { year: 2018, won: false, album: 'Pure Comedy',                                 artist: 'Father John Misty' },
  // ── 2019 ──────────────────────────────────────────────────────────────────
  { year: 2019, won: true,  album: 'Colors',                                      artist: 'Beck' },
  { year: 2019, won: false, album: 'American Utopia',                             artist: 'David Byrne' },
  { year: 2019, won: false, album: 'Masseduction',                                artist: 'St. Vincent' },
  { year: 2019, won: false, album: 'Tranquility Base Hotel & Casino',             artist: 'Arctic Monkeys' },
  { year: 2019, won: false, album: 'Utopia',                                      artist: 'Björk' },
  // ── 2020 ──────────────────────────────────────────────────────────────────
  { year: 2020, won: true,  album: 'Father of the Bride',                         artist: 'Vampire Weekend' },
  { year: 2020, won: false, album: 'Anima',                                       artist: 'Thom Yorke' },
  { year: 2020, won: false, album: 'Assume Form',                                 artist: 'James Blake' },
  { year: 2020, won: false, album: 'I, I',                                        artist: 'Bon Iver' },
  { year: 2020, won: false, album: 'U.F.O.F.',                                    artist: 'Big Thief' },
  // ── 2021 ──────────────────────────────────────────────────────────────────
  { year: 2021, won: true,  album: 'Fetch the Bolt Cutters',                      artist: 'Fiona Apple' },
  { year: 2021, won: false, album: 'Hyperspace',                                  artist: 'Beck' },
  { year: 2021, won: false, album: 'Jaime',                                       artist: 'Brittany Howard' },
  { year: 2021, won: false, album: 'Punisher',                                    artist: 'Phoebe Bridgers' },
  { year: 2021, won: false, album: 'The Slow Rush',                               artist: 'Tame Impala' },
  // ── 2022 ──────────────────────────────────────────────────────────────────
  { year: 2022, won: true,  album: "Daddy's Home",                                artist: 'St. Vincent' },
  { year: 2022, won: false, album: 'Collapsed in Sunbeams',                       artist: 'Arlo Parks' },
  { year: 2022, won: false, album: 'Jubilee',                                     artist: 'Japanese Breakfast' },
  { year: 2022, won: false, album: 'Shore',                                       artist: 'Fleet Foxes' },
  // ── 2023 ──────────────────────────────────────────────────────────────────
  { year: 2023, won: true,  album: 'Wet Leg',                                     artist: 'Wet Leg' },
  { year: 2023, won: false, album: 'Dragon New Warm Mountain I Believe in You',   artist: 'Big Thief' },
  { year: 2023, won: false, album: 'Fossora',                                     artist: 'Björk' },
  { year: 2023, won: false, album: 'We',                                          artist: 'Arcade Fire' },
  // ── 2024 ──────────────────────────────────────────────────────────────────
  { year: 2024, won: true,  album: 'The Record',                                  artist: 'Boygenius' },
  { year: 2024, won: false, album: 'The Car',                                     artist: 'Arctic Monkeys' },
  { year: 2024, won: false, album: 'Cracker Island',                              artist: 'Gorillaz' },
  { year: 2024, won: false, album: 'Did You Know That There\'s a Tunnel Under Ocean Blvd', artist: 'Lana Del Rey' },
  { year: 2024, won: false, album: 'I Inside the Old Year Dying',                 artist: 'PJ Harvey' },
  // ── 2025 ──────────────────────────────────────────────────────────────────
  { year: 2025, won: true,  album: 'All Born Screaming',                          artist: 'St. Vincent' },
  { year: 2025, won: false, album: 'Charm',                                       artist: 'Clairo' },
  { year: 2025, won: false, album: 'What Now',                                    artist: 'Brittany Howard' },
  { year: 2025, won: false, album: 'Wild God',                                    artist: 'Nick Cave and the Bad Seeds' },
  // ── 2026 ──────────────────────────────────────────────────────────────────
  { year: 2026, won: true,  album: 'Songs of a Lost World',                       artist: 'The Cure' },
  { year: 2026, won: false, album: 'Sable, Fable',                                artist: 'Bon Iver' },
];
