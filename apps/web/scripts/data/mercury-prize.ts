/**
 * Mercury Prize — complete winners + shortlisted nominees.
 *
 * year = ceremony year
 * won  = true  → normalized_score 1.0 (award_win)
 *        false → normalized_score 0.35 (award_nomination)
 * scope_country = 'uk'
 *
 * Data source: Wikipedia "Mercury Prize"
 */

export type MercuryEntry = {
  year: number;
  album: string;
  artist: string;
  won: boolean;
  mbid?: string;  // hardcoded MB release-group MBID override when search can't find it
};

export const MERCURY_PRIZE: MercuryEntry[] = [
  // ── 1992 (1st) ────────────────────────────────────────────────────────────
  { year: 1992, won: true,  album: 'Screamadelica',                                        artist: 'Primal Scream' },
  { year: 1992, won: false, album: 'Soul Murder',                                           artist: 'Barry Adamson' },
  { year: 1992, won: false, album: 'Rising Above Bedlam',                                   artist: "Jah Wobble's Invaders of the Heart" },
  { year: 1992, won: false, album: "Honey's Dead",                                          artist: 'The Jesus and Mary Chain' },
  { year: 1992, won: false, album: 'Celebration',                                           artist: 'Bheki Mseleku' },
  { year: 1992, won: false, album: 'Foxbase Alpha',                                         artist: 'Saint Etienne' },
  { year: 1992, won: false, album: 'Stars',                                                 artist: 'Simply Red' },
  { year: 1992, won: false, album: 'Achtung Baby',                                          artist: 'U2' },
  { year: 1992, won: false, album: 'The Protecting Veil',                                   artist: 'John Tavener' },
  { year: 1992, won: false, album: 'Road to Freedom',                                       artist: 'Young Disciples' },

  // ── 1993 (2nd) ────────────────────────────────────────────────────────────
  { year: 1993, won: true,  album: 'Suede',                                                 artist: 'Suede' },
  { year: 1993, won: false, album: 'No Reservations',                                       artist: 'Apache Indian' },
  { year: 1993, won: false, album: 'New Wave',                                              artist: 'The Auteurs' },
  { year: 1993, won: false, album: "Jesus' Blood Never Failed Me Yet",                      artist: 'Gavin Bryars' },
  { year: 1993, won: false, album: 'So Close',                                              artist: 'Dina Carroll' },
  { year: 1993, won: false, album: 'Rid of Me',                                             artist: 'PJ Harvey' },
  { year: 1993, won: false, album: 'Republic',                                              artist: 'New Order' },
  { year: 1993, won: false, album: 'Connected',                                             artist: 'Stereo MCs' },
  { year: 1993, won: false, album: "Ten Summoner's Tales",                                  artist: 'Sting' },
  { year: 1993, won: false, album: 'Portraits Plus',                                        artist: 'Stan Tracey' },

  // ── 1994 (3rd) ────────────────────────────────────────────────────────────
  { year: 1994, won: true,  album: 'Elegant Slumming',                                      artist: 'M People' },
  { year: 1994, won: false, album: 'Parklife',                                              artist: 'Blur' },
  { year: 1994, won: false, album: 'Head Like a Rock',                                      artist: 'Ian McNabb' },
  { year: 1994, won: false, album: 'What Silence Knows',                                    artist: 'Shara Nelson' },
  { year: 1994, won: false, album: 'The Piano',                                             artist: 'Michael Nyman' },
  { year: 1994, won: false, album: 'Music for the Jilted Generation',                       artist: 'The Prodigy' },
  { year: 1994, won: false, album: "His 'n' Hers",                                          artist: 'Pulp' },
  { year: 1994, won: false, album: 'Everything Changes',                                    artist: 'Take That' },
  { year: 1994, won: false, album: 'Troublegum',                                            artist: 'Therapy?' },
  { year: 1994, won: false, album: 'Wild Wood',                                             artist: 'Paul Weller' },

  // ── 1995 (4th) ────────────────────────────────────────────────────────────
  { year: 1995, won: true,  album: 'Dummy',                                                 artist: 'Portishead' },
  { year: 1995, won: false, album: 'Into the Blue',                                         artist: 'Guy Barker' },
  { year: 1995, won: false, album: 'Elastica',                                              artist: 'Elastica' },
  { year: 1995, won: false, album: 'To Bring You My Love',                                  artist: 'PJ Harvey' },
  { year: 1995, won: false, album: 'Leftism',                                               artist: 'Leftfield' },
  { year: 1995, won: false, album: 'Seven Last Words from the Cross',                       artist: 'James MacMillan' },
  { year: 1995, won: false, album: 'Days Like This',                                        artist: 'Van Morrison' },
  { year: 1995, won: false, album: 'Definitely Maybe',                                      artist: 'Oasis' },
  { year: 1995, won: false, album: 'I Should Coco',                                         artist: 'Supergrass' },
  { year: 1995, won: false, album: 'Maxinquaye',                                            artist: 'Tricky' },

  // ── 1996 (5th) ────────────────────────────────────────────────────────────
  { year: 1996, won: true,  album: 'Different Class',                                       artist: 'Pulp' },
  { year: 1996, won: false, album: 'Help',                                                  artist: 'Various Artists' },
  { year: 1996, won: false, album: "It's Great When You're Straight... Yeah",               artist: 'Black Grape' },
  { year: 1996, won: false, album: 'Everything Must Go',                                    artist: 'Manic Street Preachers' },
  { year: 1996, won: false, album: 'Return of the Mack',                                    artist: 'Mark Morrison' },
  { year: 1996, won: false, album: "(What's the Story) Morning Glory?",                     artist: 'Oasis' },
  { year: 1996, won: false, album: 'Modern Day Jazz Stories',                               artist: 'Courtney Pine' },
  { year: 1996, won: false, album: 'Second Toughest in the Infants',                        artist: 'Underworld' },
  { year: 1996, won: false, album: 'Norma Waterson',                                        artist: 'Norma Waterson' },

  // ── 1997 (6th) ────────────────────────────────────────────────────────────
  { year: 1997, won: true,  album: 'New Forms',                                             artist: 'Roni Size' },
  { year: 1997, won: false, album: 'Dig Your Own Hole',                                     artist: 'The Chemical Brothers' },
  { year: 1997, won: false, album: 'Trailer Park',                                          artist: 'Beth Orton' },
  { year: 1997, won: false, album: 'Vanishing Point',                                       artist: 'Primal Scream' },
  { year: 1997, won: false, album: 'The Fat of the Land',                                   artist: 'The Prodigy' },
  { year: 1997, won: false, album: 'OK Computer',                                           artist: 'Radiohead' },
  { year: 1997, won: false, album: 'Spice',                                                 artist: 'Spice Girls' },
  { year: 1997, won: false, album: 'Coming Up',                                             artist: 'Suede' },

  // ── 1998 (7th) ────────────────────────────────────────────────────────────
  { year: 1998, won: true,  album: 'Bring It On',                                           artist: 'Gomez' },
  { year: 1998, won: false, album: 'Two Pages',                                             artist: '4hero' },
  { year: 1998, won: false, album: "Rafi's Revenge",                                        artist: 'Asian Dub Foundation' },
  { year: 1998, won: false, album: 'Red Rice',                                              artist: 'Eliza Carthy' },
  { year: 1998, won: false, album: 'International Velvet',                                  artist: 'Catatonia' },
  { year: 1998, won: false, album: 'When I Was Born for the 7th Time',                      artist: 'Cornershop' },
  { year: 1998, won: false, album: 'Mezzanine',                                             artist: 'Massive Attack' },
  { year: 1998, won: false, album: 'Decksandrumsandrockandroll',                            artist: 'Propellerheads' },
  { year: 1998, won: false, album: 'This Is Hardcore',                                      artist: 'Pulp' },
  { year: 1998, won: false, album: 'Urban Hymns',                                           artist: 'The Verve' },
  { year: 1998, won: false, album: 'Life Thru a Lens',                                      artist: 'Robbie Williams' },

  // ── 1999 (8th) ────────────────────────────────────────────────────────────
  { year: 1999, won: true,  album: 'Ok',                                                    artist: 'Talvin Singh' },
  { year: 1999, won: false, album: '13',                                                    artist: 'Blur' },
  { year: 1999, won: false, album: 'Surrender',                                             artist: 'The Chemical Brothers' },
  { year: 1999, won: false, album: 'Sunday 8PM',                                            artist: 'Faithless' },
  { year: 1999, won: false, album: 'This Is My Truth Tell Me Yours',                        artist: 'Manic Street Preachers' },
  { year: 1999, won: false, album: 'Central Reservation',                                   artist: 'Beth Orton' },
  { year: 1999, won: false, album: 'Sleepless',                                             artist: 'Kate Rusby' },
  { year: 1999, won: false, album: 'Performance and Cocktails',                             artist: 'Stereophonics' },
  { year: 1999, won: false, album: 'Beaucoup Fish',                                         artist: 'Underworld' },

  // ── 2000 (9th) ────────────────────────────────────────────────────────────
  { year: 2000, won: true,  album: 'The Hour of Bewilderbeast',                             artist: 'Badly Drawn Boy' },
  { year: 2000, won: false, album: 'Alone with Everybody',                                  artist: 'Richard Ashcroft' },
  { year: 2000, won: false, album: 'Parachutes',                                            artist: 'Coldplay' },
  { year: 2000, won: false, album: 'Sincere',                                               artist: 'MJ Cole' },
  { year: 2000, won: false, album: 'The Contino Sessions',                                  artist: 'Death in Vegas' },
  { year: 2000, won: false, album: 'The Great Eastern',                                     artist: 'The Delgados' },
  { year: 2000, won: false, album: 'Lost Souls',                                            artist: 'Doves' },
  { year: 2000, won: false, album: 'Rhythm and Stealth',                                    artist: 'Leftfield' },
  { year: 2000, won: false, album: 'Beyond Skin',                                           artist: 'Nitin Sawhney' },
  { year: 2000, won: false, album: 'Little Black Numbers',                                  artist: 'Kathryn Williams' },

  // ── 2001 (10th) ───────────────────────────────────────────────────────────
  { year: 2001, won: true,  album: 'Stories from the City, Stories from the Sea',           artist: 'PJ Harvey' },
  { year: 2001, won: false, album: 'Rooty',                                                 artist: 'Basement Jaxx' },
  { year: 2001, won: false, album: 'Asleep in the Back',                                    artist: 'Elbow' },
  { year: 2001, won: false, album: 'Felt Mountain',                                         artist: 'Goldfrapp' },
  { year: 2001, won: false, album: 'Gorillaz',                                              artist: 'Gorillaz' },
  { year: 2001, won: false, album: 'Here Be Monsters',                                      artist: 'Ed Harcourt' },
  { year: 2001, won: false, album: 'Tom McRae',                                             artist: 'Tom McRae' },
  { year: 2001, won: false, album: 'Amnesiac',                                              artist: 'Radiohead' },
  { year: 2001, won: false, album: 'Salt Rain',                                             artist: 'Susheela Raman' },
  { year: 2001, won: false, album: 'Rings Around the World',                                artist: 'Super Furry Animals' },
  { year: 2001, won: false, album: 'The Optimist LP',                                       artist: 'Turin Brakes' },
  { year: 2001, won: false, album: 'Simple Things',                                         artist: 'Zero 7' },

  // ── 2002 (11th) ───────────────────────────────────────────────────────────
  { year: 2002, won: true,  album: 'A Little Deeper',                                       artist: 'Ms. Dynamite' },
  { year: 2002, won: false, album: 'Sunshine Hit Me',                                       artist: 'The Bees' },
  { year: 2002, won: false, album: 'Heathen',                                               artist: 'David Bowie' },
  { year: 2002, won: false, album: 'The Coral',                                             artist: 'The Coral' },
  { year: 2002, won: false, album: 'The Last Broadcast',                                    artist: 'Doves' },
  { year: 2002, won: false, album: 'Holes in the Wall',                                     artist: 'The Electric Soft Parade' },
  { year: 2002, won: false, album: 'Night on My Side',                                      artist: 'Gemma Hayes' },
  { year: 2002, won: false, album: 'Who I Am',                                              artist: 'Beverley Knight' },
  { year: 2002, won: false, album: 'Run Come Save Me',                                      artist: 'Roots Manuva' },
  { year: 2002, won: false, album: 'Original Pirate Material',                              artist: 'The Streets' },

  // ── 2003 (12th) ───────────────────────────────────────────────────────────
  { year: 2003, won: true,  album: 'Boy in da Corner',                                      artist: 'Dizzee Rascal' },
  { year: 2003, won: false, album: 'Vehicles and Animals',                                  artist: 'Athlete' },
  { year: 2003, won: false, album: 'A Rush of Blood to the Head',                           artist: 'Coldplay' },
  { year: 2003, won: false, album: 'Permission to Land',                                    artist: 'The Darkness' },
  { year: 2003, won: false, album: 'Floetic',                                               artist: 'Floetry' },
  { year: 2003, won: false, album: 'Lost Horizons',                                         artist: 'Lemon Jelly' },
  { year: 2003, won: false, album: 'So Much for the City',                                  artist: 'The Thrills' },
  { year: 2003, won: false, album: 'Quixotic',                                              artist: 'Martina Topley-Bird' },
  { year: 2003, won: false, album: 'Hail to the Thief',                                     artist: 'Radiohead' },

  // ── 2004 (13th) ───────────────────────────────────────────────────────────
  { year: 2004, won: true,  album: 'Franz Ferdinand',                                       artist: 'Franz Ferdinand' },
  { year: 2004, won: false, album: 'Kish Kash',                                             artist: 'Basement Jaxx' },
  { year: 2004, won: false, album: 'Dear Catastrophe Waitress',                             artist: 'Belle & Sebastian' },
  { year: 2004, won: false, album: 'Thank You',                                             artist: 'Jamelia' },
  { year: 2004, won: false, album: 'Hopes and Fears',                                       artist: 'Keane' },
  { year: 2004, won: false, album: 'Final Straw',                                           artist: 'Snow Patrol' },
  { year: 2004, won: false, album: 'The Soul Sessions',                                     artist: 'Joss Stone' },
  { year: 2004, won: false, album: "A Grand Don't Come for Free",                           artist: 'The Streets' },
  { year: 2004, won: false, album: 'Frank',                                                 artist: 'Amy Winehouse' },
  { year: 2004, won: false, album: 'Cuckooland',                                            artist: 'Robert Wyatt' },

  // ── 2005 (14th) ───────────────────────────────────────────────────────────
  { year: 2005, won: true,  album: 'I Am a Bird Now',                                       artist: 'Antony and the Johnsons' },
  { year: 2005, won: false, album: 'Silent Alarm',                                          artist: 'Bloc Party' },
  { year: 2005, won: false, album: 'X&Y',                                                   artist: 'Coldplay' },
  { year: 2005, won: false, album: 'Thunder, Lightning, Strike',                            artist: 'The Go! Team' },
  { year: 2005, won: false, album: 'Stars of CCTV',                                         artist: 'Hard-Fi' },
  { year: 2005, won: false, album: 'Employment',                                            artist: 'Kaiser Chiefs' },
  { year: 2005, won: false, album: 'Eye to the Telescope',                                  artist: 'KT Tunstall' },
  { year: 2005, won: false, album: 'The Magic Numbers',                                     artist: 'The Magic Numbers' },
  { year: 2005, won: false, album: 'Arular',                                                artist: 'M.I.A.' },
  { year: 2005, won: false, album: 'A Certain Trigger',                                     artist: 'Maximo Park' },

  // ── 2006 (15th) ───────────────────────────────────────────────────────────
  { year: 2006, won: true,  album: "Whatever People Say I Am, That's What I'm Not",         artist: 'Arctic Monkeys' },
  { year: 2006, won: false, album: 'Ballad of the Broken Seas',                             artist: 'Isobel Campbell and Mark Lanegan' },
  { year: 2006, won: false, album: 'The Back Room',                                         artist: 'Editors' },
  { year: 2006, won: false, album: 'Through the Windowpane',                                artist: 'Guillemots' },
  { year: 2006, won: false, album: 'Coles Corner',                                          artist: 'Richard Hawley' },
  { year: 2006, won: false, album: 'The Warning',                                           artist: 'Hot Chip' },
  { year: 2006, won: false, album: 'Black Holes & Revelations',                             artist: 'Muse' },
  { year: 2006, won: false, album: 'White Bread Black Beer',                                artist: 'Scritti Politti' },
  { year: 2006, won: false, album: 'The Eraser',                                            artist: 'Thom Yorke' },

  // ── 2007 (16th) ───────────────────────────────────────────────────────────
  { year: 2007, won: true,  album: 'Myths of the Near Future',                              artist: 'Klaxons' },
  { year: 2007, won: false, album: 'Favourite Worst Nightmare',                             artist: 'Arctic Monkeys' },
  { year: 2007, won: false, album: 'Fur and Gold',                                          artist: 'Bat for Lashes' },
  { year: 2007, won: false, album: 'Maths + English',                                       artist: 'Dizzee Rascal' },
  { year: 2007, won: false, album: 'Panic Prevention',                                      artist: 'Jamie T' },
  { year: 2007, won: false, album: 'Hats Off to the Buskers',                               artist: 'The View' },
  { year: 2007, won: false, album: 'Back to Black',                                         artist: 'Amy Winehouse' },

  // ── 2008 (17th) ───────────────────────────────────────────────────────────
  { year: 2008, won: true,  album: 'The Seldom Seen Kid',                                   artist: 'Elbow' },
  { year: 2008, won: false, album: '19',                                                    artist: 'Adele' },
  { year: 2008, won: false, album: 'Untrue',                                                artist: 'Burial' },
  { year: 2008, won: false, album: 'Shine',                                                 artist: 'Estelle' },
  { year: 2008, won: false, album: 'The Age of the Understatement',                         artist: 'The Last Shadow Puppets' },
  { year: 2008, won: false, album: 'Alas, I Cannot Swim',                                   artist: 'Laura Marling' },
  { year: 2008, won: false, album: 'Stainless Style',                                       artist: 'Neon Neon' },
  { year: 2008, won: false, album: 'Raising Sand',                                          artist: 'Robert Plant & Alison Krauss' },
  { year: 2008, won: false, album: 'In Rainbows',                                           artist: 'Radiohead' },

  // ── 2009 (18th) ───────────────────────────────────────────────────────────
  { year: 2009, won: true,  album: 'Speech Therapy',                                        artist: 'Speech Debelle' },
  { year: 2009, won: false, album: 'Two Suns',                                              artist: 'Bat for Lashes' },
  { year: 2009, won: false, album: 'Lungs',                                                 artist: 'Florence and the Machine' },
  { year: 2009, won: false, album: 'Friendly Fires',                                        artist: 'Friendly Fires' },
  { year: 2009, won: false, album: 'Glasvegas',                                             artist: 'Glasvegas' },
  { year: 2009, won: false, album: 'Primary Colours',                                       artist: 'The Horrors' },
  { year: 2009, won: false, album: 'West Ryder Pauper Lunatic Asylum',                      artist: 'Kasabian' },
  { year: 2009, won: false, album: 'La Roux',                                               artist: 'La Roux' },

  // ── 2010 (19th) ───────────────────────────────────────────────────────────
  { year: 2010, won: true,  album: 'xx',                                                    artist: 'The xx' },
  { year: 2010, won: false, album: 'The Sea',                                               artist: 'Corinne Bailey Rae' },
  { year: 2010, won: false, album: 'Only Revolutions',                                      artist: 'Biffy Clyro' },
  { year: 2010, won: false, album: 'Tongue n\' Cheek',                                      artist: 'Dizzee Rascal' },
  { year: 2010, won: false, album: 'Total Life Forever',                                    artist: 'Foals' },
  { year: 2010, won: false, album: 'I Speak Because I Can',                                 artist: 'Laura Marling' },
  { year: 2010, won: false, album: 'Sigh No More',                                          artist: 'Mumford & Sons' },
  { year: 2010, won: false, album: 'Becoming a Jackal',                                     artist: 'Villagers' },
  { year: 2010, won: false, album: 'Wake Up the Nation',                                    artist: 'Paul Weller' },
  { year: 2010, won: false, album: 'Two Dancers',                                           artist: 'Wild Beasts' },

  // ── 2011 (20th) ───────────────────────────────────────────────────────────
  { year: 2011, won: true,  album: 'Let England Shake',                                     artist: 'PJ Harvey' },
  { year: 2011, won: false, album: '21',                                                    artist: 'Adele' },
  { year: 2011, won: false, album: 'James Blake',                                           artist: 'James Blake' },
  { year: 2011, won: false, album: 'Anna Calvi',                                            artist: 'Anna Calvi' },
  { year: 2011, won: false, album: 'Build a Rocket Boys!',                                  artist: 'Elbow' },
  { year: 2011, won: false, album: 'Man Alive',                                             artist: 'Everything Everything' },
  { year: 2011, won: false, album: 'Peanut Butter Blues & Melancholy Jam',                  artist: 'Ghostpoet' },
  { year: 2011, won: false, album: 'On a Mission',                                          artist: 'Katy B' },
  { year: 2011, won: false, album: 'Diamond Mine',                                          artist: 'King Creosote & Jon Hopkins' },
  { year: 2011, won: false, album: 'The English Riviera',                                   artist: 'Metronomy' },
  { year: 2011, won: false, album: 'Disc-Overy',                                            artist: 'Tinie Tempah' },

  // ── 2012 (21st) ───────────────────────────────────────────────────────────
  { year: 2012, won: true,  album: 'An Awesome Wave',                                       artist: 'alt-J' },
  { year: 2012, won: false, album: 'Django Django',                                         artist: 'Django Django' },
  { year: 2012, won: false, album: 'Plumb',                                                 artist: 'Field Music' },
  { year: 2012, won: false, album: "Standing at the Sky's Edge",                            artist: 'Richard Hawley' },
  { year: 2012, won: false, album: 'Every Kingdom',                                         artist: 'Ben Howard' },
  { year: 2012, won: false, album: 'Home Again',                                            artist: 'Michael Kiwanuka' },
  { year: 2012, won: false, album: 'Is Your Love Big Enough?',                              artist: 'Lianne La Havas' },
  { year: 2012, won: false, album: 'Given to the Wild',                                     artist: 'The Maccabees' },
  { year: 2012, won: false, album: 'ill Manors',                                            artist: 'Plan B' },
  { year: 2012, won: false, album: 'Devotion',                                              artist: 'Jessie Ware' },

  // ── 2013 (22nd) ───────────────────────────────────────────────────────────
  { year: 2013, won: true,  album: 'Overgrown',                                             artist: 'James Blake' },
  { year: 2013, won: false, album: 'AM',                                                    artist: 'Arctic Monkeys' },
  { year: 2013, won: false, album: 'The Next Day',                                          artist: 'David Bowie' },
  { year: 2013, won: false, album: 'Jake Bugg',                                             artist: 'Jake Bugg' },
  { year: 2013, won: false, album: 'Settle',                                                artist: 'Disclosure' },
  { year: 2013, won: false, album: 'Holy Fire',                                             artist: 'Foals' },
  { year: 2013, won: false, album: 'Immunity',                                              artist: 'Jon Hopkins' },
  { year: 2013, won: false, album: 'Once I Was an Eagle',                                   artist: 'Laura Marling' },
  { year: 2013, won: false, album: 'Sing to the Moon',                                      artist: 'Laura Mvula' },
  { year: 2013, won: false, album: 'Home',                                                  artist: 'Rudimental' },
  { year: 2013, won: false, album: 'Silence Yourself',                                      artist: 'Savages' },
  { year: 2013, won: false, album: 'Awayland',                                              artist: 'Villagers' },

  // ── 2014 (23rd) ───────────────────────────────────────────────────────────
  { year: 2014, won: true,  album: 'Dead',                                                  artist: 'Young Fathers' },
  { year: 2014, won: false, album: 'Everyday Robots',                                       artist: 'Damon Albarn' },
  { year: 2014, won: false, album: 'So Long, See You Tomorrow',                             artist: 'Bombay Bicycle Club' },
  { year: 2014, won: false, album: 'One Breath',                                            artist: 'Anna Calvi' },
  { year: 2014, won: false, album: 'Total Strife Forever',                                  artist: 'East India Youth' },
  { year: 2014, won: false, album: 'LP1',                                                   artist: 'FKA Twigs' },
  { year: 2014, won: false, album: 'V2.0',                                                  artist: 'GoGo Penguin' },
  { year: 2014, won: false, album: 'Jungle',                                                artist: 'Jungle' },
  { year: 2014, won: false, album: 'Royal Blood',                                           artist: 'Royal Blood' },
  { year: 2014, won: false, album: 'Everybody Down',                                        artist: 'Kate Tempest' },

  // ── 2015 (24th) ───────────────────────────────────────────────────────────
  { year: 2015, won: true,  album: 'At Least for Now',                                      artist: 'Benjamin Clementine' },
  { year: 2015, won: false, album: 'Syro',                                                  artist: 'Aphex Twin' },
  { year: 2015, won: false, album: 'Matador',                                               artist: 'Gaz Coombes' },
  { year: 2015, won: false, album: 'How Big, How Blue, How Beautiful',                      artist: 'Florence and the Machine' },
  { year: 2015, won: false, album: 'Shedding Skin',                                         artist: 'Ghostpoet' },
  { year: 2015, won: false, album: 'Hairless Toys',                                         artist: 'Roisin Murphy' },
  { year: 2015, won: false, album: 'My Love Is Cool',                                       artist: 'Wolf Alice' },
  { year: 2015, won: false, album: 'In Colour',                                             artist: 'Jamie xx' },

  // ── 2016 (25th) ───────────────────────────────────────────────────────────
  { year: 2016, won: true,  album: 'Konnichiwa',                                            artist: 'Skepta' },
  { year: 2016, won: false, album: 'Hopelessness',                                          artist: 'Anohni' },
  { year: 2016, won: false, album: 'The Bride',                                             artist: 'Bat for Lashes' },
  { year: 2016, won: false, album: 'Blackstar',                                             artist: 'David Bowie' },
  { year: 2016, won: false, album: 'Made in the Manor',                                     artist: 'Kano' },
  { year: 2016, won: false, album: 'Love & Hate',                                           artist: 'Michael Kiwanuka' },
  { year: 2016, won: false, album: 'The Dreaming Room',                                     artist: 'Laura Mvula' },
  { year: 2016, won: false, album: 'I Like It When You Sleep, for You Are So Beautiful yet So Unaware of It', artist: 'The 1975' },
  { year: 2016, won: false, album: 'A Moon Shaped Pool',                                    artist: 'Radiohead' },
  { year: 2016, won: false, album: 'Adore Life',                                            artist: 'Savages' },

  // ── 2017 (26th) ───────────────────────────────────────────────────────────
  { year: 2017, won: true,  album: 'Process',                                               artist: 'Sampha' },
  { year: 2017, won: false, album: 'Relaxer',                                               artist: 'alt-J' },
  { year: 2017, won: false, album: 'Love in the 4th Dimension',                             artist: 'The Big Moon' },
  { year: 2017, won: false, album: 'Blossoms',                                              artist: 'Blossoms' },
  { year: 2017, won: false, album: "Yesterday's Gone",                                      artist: 'Loyle Carner' },
  { year: 2017, won: false, album: 'How to Be a Human Being',                               artist: 'Glass Animals' },
  { year: 2017, won: false, album: 'Common Sense',                                          artist: 'J Hus' },
  { year: 2017, won: false, album: 'Divide',                                                artist: 'Ed Sheeran' },
  { year: 2017, won: false, album: 'Gang Signs & Prayer',                                   artist: 'Stormzy' },
  { year: 2017, won: false, album: 'Let Them Eat Chaos',                                    artist: 'Kae Tempest' },
  { year: 2017, won: false, album: 'I See You',                                             artist: 'The xx' },

  // ── 2018 (27th) ───────────────────────────────────────────────────────────
  { year: 2018, won: true,  album: 'Visions of a Life',                                     artist: 'Wolf Alice' },
  { year: 2018, won: false, album: 'Tranquility Base Hotel + Casino',                        artist: 'Arctic Monkeys' },
  { year: 2018, won: false, album: 'A Fever Dream',                                         artist: 'Everything Everything' },
  { year: 2018, won: false, album: 'High as Hope',                                          artist: 'Florence and the Machine' },
  { year: 2018, won: false, album: 'Lost & Found',                                          artist: 'Jorja Smith' },
  { year: 2018, won: false, album: 'The Ooz',                                               artist: 'King Krule' },
  { year: 2018, won: false, album: 'No Shame',                                              artist: 'Lily Allen' },
  { year: 2018, won: false, album: 'Holiday Destination',                                   artist: 'Nadine Shah' },
  { year: 2018, won: false, album: 'Your Queen Is a Reptile',                               artist: 'Sons of Kemet' },

  // ── 2019 (28th) ───────────────────────────────────────────────────────────
  { year: 2019, won: true,  album: 'Psychodrama',                                           artist: 'Dave' },
  { year: 2019, won: false, album: 'Hunter',                                                artist: 'Anna Calvi' },
  { year: 2019, won: false, album: 'Schlagenheim',                                          artist: 'Black Midi' },
  { year: 2019, won: false, album: 'Reward',                                                artist: 'Cate Le Bon' },
  { year: 2019, won: false, album: 'Everything Not Saved Will Be Lost Part 1',              artist: 'Foals' },
  { year: 2019, won: false, album: 'Dogrel',                                                artist: 'Fontaines D.C.' },
  { year: 2019, won: false, album: 'Joy as an Act of Resistance',                           artist: 'Idles' },
  { year: 2019, won: false, album: 'Grey Area',                                             artist: 'Little Simz' },
  { year: 2019, won: false, album: 'Nothing Great About Britain',                           artist: 'slowthai' },
  { year: 2019, won: false, album: 'A Brief Inquiry into Online Relationships',              artist: 'The 1975' },

  // ── 2020 (29th) ───────────────────────────────────────────────────────────
  { year: 2020, won: true,  album: 'Kiwanuka',                                              artist: 'Michael Kiwanuka' },
  { year: 2020, won: false, album: 'How I\'m Feeling Now',                                  artist: 'Charli XCX' },
  { year: 2020, won: false, album: 'Future Nostalgia',                                      artist: 'Dua Lipa' },
  { year: 2020, won: false, album: 'Seeking Thrills',                                       artist: 'Georgia' },
  { year: 2020, won: false, album: 'Hoodies All Summer',                                    artist: 'Kano' },
  { year: 2020, won: false, album: 'Song for Our Daughter',                                 artist: 'Laura Marling' },
  { year: 2020, won: false, album: 'Dark Matter',                                           artist: 'Moses Boyd' },
  { year: 2020, won: false, album: 'Every Bad',                                             artist: 'Porridge Radio' },
  { year: 2020, won: false, album: 'Heavy Is the Head',                                     artist: 'Stormzy' },

  // ── 2021 (30th) ───────────────────────────────────────────────────────────
  { year: 2021, won: true,  album: 'Collapsed in Sunbeams',                                  artist: 'Arlo Parks' },
  { year: 2021, won: false, album: 'For the First Time',                                    artist: 'Black Country, New Road' },
  { year: 2021, won: false, album: 'Not Your Muse',                                         artist: 'Celeste' },
  { year: 2021, won: false, album: 'Promises',                                              artist: 'Floating Points' },
  { year: 2021, won: false, album: 'Conflict of Interest',                                  artist: 'Ghetts' },
  { year: 2021, won: false, album: 'Pink Noise',                                            artist: 'Laura Mvula' },
  { year: 2021, won: false, album: 'As the Love Continues',                                 artist: 'Mogwai' },
  { year: 2021, won: false, album: 'Source',                                                artist: 'Nubya Garcia' },
  { year: 2021, won: false, album: 'Untitled (Rise)',                                       artist: 'Sault' },
  { year: 2021, won: false, album: 'Blue Weekend',                                          artist: 'Wolf Alice' },

  // ── 2022 (31st) ───────────────────────────────────────────────────────────
  { year: 2022, won: true,  album: 'Sometimes I Might Be Introvert',                        artist: 'Little Simz' },
  { year: 2022, won: false, album: 'Tresor',                                                artist: 'Gwenno' },
  { year: 2022, won: false, album: "Harry's House",                                         artist: 'Harry Styles' },
  { year: 2022, won: false, album: 'Skin',                                                  artist: 'Joy Crookes' },
  { year: 2022, won: false, album: 'Reason to Smile',                                       artist: 'Kojey Radical' },
  { year: 2022, won: false, album: 'Supernova',                                             artist: 'Nova Twins' },
  { year: 2022, won: false, album: 'Seventeen Going Under',                                 artist: 'Sam Fender' },
  { year: 2022, won: false, album: 'Prioritise Pleasure',                                   artist: 'Self Esteem' },
  { year: 2022, won: false, album: 'Wet Leg',                                               artist: 'Wet Leg' },
  { year: 2022, won: false, album: 'The Overload',                                          artist: 'Yard Act' },

  // ── 2023 (32nd) ───────────────────────────────────────────────────────────
  { year: 2023, won: true,  album: 'Where I\'m Meant to Be',                                artist: 'Ezra Collective' },
  { year: 2023, won: false, album: 'The Car',                                               artist: 'Arctic Monkeys' },
  { year: 2023, won: false, album: 'Actual Life 3',                                         artist: 'Fred Again' },
  { year: 2023, won: false, album: 'Beautiful and Brutal Yard',                             artist: 'J Hus' },
  { year: 2023, won: false, album: 'That! Feels Good!',                                     artist: 'Jessie Ware' },
  { year: 2023, won: false, album: 'I Love You Jennifer B',                                 artist: 'Jockstrap' },
  { year: 2023, won: false, album: 'False Lankum',                                          artist: 'Lankum' },
  { year: 2023, won: false, album: 'Hugo',                                                  artist: 'Loyle Carner' },
  { year: 2023, won: false, album: 'Messy',                                                 artist: 'Olivia Dean' },
  { year: 2023, won: false, album: 'My 21st Century Blues',                                 artist: 'Raye' },
  { year: 2023, won: false, album: 'Nymph',                                                 artist: 'Shygirl' },
  { year: 2023, won: false, album: 'Heavy Heavy',                                           artist: 'Young Fathers' },

  // ── 2024 (33rd) ───────────────────────────────────────────────────────────
  { year: 2024, won: true,  album: 'This Could Be Texas',                                   artist: 'English Teacher' },
  { year: 2024, won: false, album: 'When Will We Land?',                                    artist: "Barry Can't Swim" },
  { year: 2024, won: false, album: 'Lives Outgrown',                                        artist: 'Beth Gibbons' },
  { year: 2024, won: false, album: 'Early Twenties',                                        artist: 'Cat Burns' },
  { year: 2024, won: false, album: 'Brat',                                                  artist: 'Charli XCX' },
  { year: 2024, won: false, album: 'Crazymad, for Me',                                      artist: 'CMAT' },
  { year: 2024, won: false, album: 'Black Rainbows',                                        artist: 'Corinne Bailey Rae' },
  { year: 2024, won: false, album: 'On Purpose, with Purpose',                              artist: 'Ghetts' },
  { year: 2024, won: false, album: 'Prelude to Ecstasy',                                    artist: 'The Last Dinner Party' },
  { year: 2024, won: false, album: 'Silence Is Loud',                                       artist: 'Nia Archives' },

  // ── 2025 (34th) ───────────────────────────────────────────────────────────
  { year: 2025, won: true,  album: 'People Watching',                                       artist: 'Sam Fender' },
  { year: 2025, won: false, album: 'Euro-Country',                                          artist: 'CMAT' },
  { year: 2025, won: false, album: 'Weirdo',                                                artist: 'Emma-Jean Thackray' },
  { year: 2025, won: false, album: 'Eusexua',                                               artist: 'FKA Twigs' },
  { year: 2025, won: false, album: 'Romance',                                               artist: 'Fontaines D.C.' },
  { year: 2025, won: false, album: 'Afrikan Alien',                                         artist: 'Pa Salieu' },
  { year: 2025, won: false, album: 'Fancy That',                                            artist: 'PinkPantheress' },
  { year: 2025, won: false, album: 'More',                                                  artist: 'Pulp' },
  { year: 2025, won: false, album: 'The Clearing',                                          artist: 'Wolf Alice' },
];
