"""Build the master album sheet for a batch of ranking reels.

    python -I reels/data/build_master.py

Every reel's pool is chosen by an outside rule (an award's winners, or one artist's studio albums), never by taste.
Writes reels/data/albums.csv: one row per album (deduplicated across reels), with the reels it belongs to, links to
look up RYM/AOTY by hand, and empty rym / aoty_user columns to fill in. Re-running keeps anything already typed in.
Discographies come from MusicBrainz (official API, 1 req/s): release groups of primary type Album with no
secondary type (so no live albums, compilations or soundtracks).
"""
import csv, json, os, re, time, unicodedata, urllib.parse, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'albums.csv')
UA = 'insta-posts/0.1 (music education carousel generator)'

# ---- award pools: (ceremony year, artist_ko, artist_en, album) ------------------------------------------------
# 2004–2022 from ko.wikipedia 한국대중음악상; 2023–2026 from en.wikipedia 20th–23rd Korean Music Awards.
KMA = {
 'kma-aoty': ('한대음 올해의 음반', [
  (2004,'더더','The The','The The Band'),(2005,'마이 앤트 메리','My Aunt Mary','Just Pop'),(2006,'두번째 달','2nd Moon','두번째 달'),
  (2007,'스왈로우','Swallow','Aresco'),(2008,'이적','Lee Juck','나무로 만든 노래'),(2009,'언니네 이발관',"Sister's Barbershop",'가장 보통의 존재'),
  (2010,'서울전자음악단','Seoul Electric Band','Life Is Strange'),(2011,'가리온','Garion','가리온 2'),(2012,'장기하와 얼굴들','Kiha & The Faces','장기하와 얼굴들'),
  (2013,'3호선 버터플라이','3rd Line Butterfly','Dreamtalk'),(2014,'윤영배','Yoon Young Bae','위험한 세계'),(2015,'로로스',"Loro's",'W.A.N.D.Y'),
  (2016,'이센스','E SENS','The Anecdote'),(2017,'조동진','Cho Dong Jin','나무가 되어'),(2018,'강태구','Kang Tae Gu','bleu'),
  (2019,'장필순','Jang Pil Soon','soony eight : 소길花'),(2020,'백예린','Yerin Baek','Our love is great'),(2021,'정밀아','Jung Mila','청파소나타'),
  (2022,'이랑','Lang Lee','늑대가 나타났다'),(2023,'250','250','뽕'),(2024,'빈지노','Beenzino','NOWITZKI'),
  (2025,'단편선 순간들','Danpyunsun and the Moments','음악만세'),(2026,'추다혜차지스','Chudahye Chagis','소수민족')]),
 'kma-hiphop': ('한대음 최우수 랩&힙합 음반', [
  (2005,'바비 킴','Bobby Kim','Beats Within My Soul'),(2006,'다이나믹 듀오','Dynamic Duo','Double Dynamite'),(2007,'더 콰이엇','The Quiett','Q Train'),
  (2008,'에픽하이','Epik High','Remapping the Human Soul'),(2009,'버벌진트','Verbal Jint','누명'),(2010,'드렁큰 타이거','Drunken Tiger','Feel gHood Muzik: The 8th Wonder'),
  (2011,'가리온','Garion','가리온 2'),(2012,'시모 & 무드슐라','Simo & Mood Schula','Simo & Mood Schula'),(2013,'소리헤다','Sorihedda','소리헤다 2'),
  (2014,'팔로알토','Paloalto','Chief Life'),(2015,'화지','Hwaji','eAT'),(2016,'이센스','E SENS','The Anecdote'),(2017,'화지','Hwaji','ZISSOU'),
  (2018,'비앙 X 쿤디판다','Bian X Khundi Panda','재건축'),(2019,'뱃사공','Baetsagong','탕아'),(2020,'씨잼','C JAMM','킁'),
  (2021,'쿤디판다','Khundi Panda','가로사옥'),(2022,'최엘비','CHOILB','독립음악'),(2023,'넉살 & 까데호','Nucksal & Cadejo','Sincerely Yours'),
  (2024,'빈지노','Beenzino','NOWITZKI'),(2025,'비프리 & 허키 시바세키','B-Free & Hukky Shibaseki','Odyssey. 1'),(2026,'식케이 & 릴 모쉬핏','Sik-K & Lil Moshpit','K-FLIP+')]),
 'kma-modernrock': ('한대음 최우수 모던록 음반', [
  (2005,'마이 앤트 메리','My Aunt Mary','Just Pop'),(2006,'몽구스','Mongoose','Dancing Zoo'),(2007,'스왈로우','Swallow','Aresco'),
  (2008,'못','Mot','이상한 계절'),(2008,'허클베리 핀','Huckleberry Finn','환상...나의 환멸'),(2009,'언니네 이발관',"Sister's Barbershop",'가장 보통의 존재'),
  (2010,'검정치마','The Black Skirts','201'),(2011,'9와 숫자들','9 and the Numbers','9와 숫자들'),(2012,'이승열','Yi Sung Yol','Why We Fail'),
  (2013,'3호선 버터플라이','3rd Line Butterfly','Dreamtalk'),(2014,'윤영배','Yoon Young Bae','위험한 세계'),(2015,'로로스',"Loro's",'W.A.N.D.Y'),
  (2016,'칵스','The Koxx','The New Normal'),(2017,'이상의 날개','Wings of Yi Sang','의식의 흐름'),(2018,'혁오','HYUKOH','23'),
  (2019,'세이수미','Say Sue Me','Where We Were Together'),(2020,'검정치마','The Black Skirts','THIRSTY'),(2021,'조동익','Cho Dong Ik','푸른 베개'),
  (2022,'이상의 날개','Wings of Yi Sang','희망과 절망의 경계'),(2023,'검정치마','The Black Skirts','Teen Troubles'),(2024,'실리카겔','Silica Gel','POWER ANDRE 99'),
  (2025,'단편선 순간들','Danpyunsun and the Moments','음악만세'),(2026,'신인류','Shin In Ryu','Shining Strike')]),
 'kma-pop': ('한대음 최우수 팝 음반', [
  (2005,'클래지콰이','Clazziquai','Instant Pig'),(2006,'W & Whale','W & Whale','Where the Story Ends'),(2007,'박선주','Park Sun Joo','A4rism'),
  (2008,'이적','Lee Juck','나무로 만든 노래'),(2009,'김동률','Kim Dong Ryul','Monologue'),(2010,'이소라','Lee So Ra','7집'),(2011,'조규찬','Cho Kyu Chan','9'),
  (2012,'야광토끼','Neon Bunny','Seoulight'),(2013,'버스커 버스커','Busker Busker','버스커 버스커'),(2014,'선우정아','Sunwoojunga',"It's Okay, Dear"),
  (2015,'악동뮤지션','AKMU','PLAY'),(2016,'하비누아주','Habinoaju','청춘'),(2017,'조동진','Cho Dong Jin','나무가 되어'),(2018,'아이유','IU','Palette'),
  (2019,'장필순','Jang Pil Soon','soony eight : 소길花'),(2020,'백예린','Yerin Baek','Our love is great'),(2021,'백예린','Yerin Baek','Every letter I sent you.'),
  (2022,'아이유','IU','LILAC'),(2023,'이찬혁','Lee Chan Hyuk','ERROR'),(2024,'이진아','Lee Jin Ah','Hearts of the City'),(2025,'존 박','John Park','PSST!'),
  (2026,'이찬혁','Lee Chan Hyuk','EROS')]),
 'kma-rnb': ('한대음 최우수 R&B&소울 음반', [
  (2005,'거미','Gummy',"It's Different"),(2006,'윈디시티','Windy City','Love Record: Love, Power And Unity'),(2007,'펑카프릭 부스터','Funkafric Booster','One'),
  (2008,'윤미래','Yoonmirae','Yoonmirae'),(2009,'태양','Taeyang','Hot'),(2010,'라디','Ra.D','Real Collabo'),(2011,'진보','Jinbo','Afterwork'),
  (2012,'보니','Boni','1990'),(2013,'나얼','Naul','Principle of my Soul'),(2014,'자이언티','Zion.T','Red Light'),(2015,'크러쉬','Crush','Crush On You'),
  (2016,'서사무엘','Samuel Seo','FRAMEWORKS'),(2017,'박재범','Jay Park','EVERYTHING YOU WANTED'),(2018,'히피는 집시였다','Hippy Was Gipsy','Paradise'),
  (2019,'제이클레프','Jclef','flaw, flaw'),(2020,'서사무엘','Samuel Seo','The Misfit'),(2021,'선우정아','Sunwoojunga','Serenade'),
  (2022,'타마','THAMA',"DON'T DIE COLORS"),(2023,'에이트레인','A.Train','Private Pink'),(2024,'저드','Jerd','Bomm'),
  (2025,'수민 & 슬롬','Sumin & Slom','Miniseries 2'),(2026,'윤다혜','Yoon Da Hye','Wang')]),
 'kma-electronic': ('한대음 최우수 일렉트로닉 음반', [
  (2007,'엄정화','Uhm Jung Hwa','Prestige'),(2008,'하우스룰즈','House Rulez','Mojito'),(2009,'W & Whale','W & Whale','Hardboiled'),
  (2010,'브라운 아이드 걸스','Brown Eyed Girls','Sound G.'),(2011,'2NE1','2NE1','To Anyone'),(2012,'이디오테잎','IDIOTAPE','11111101'),
  (2013,'글렌체크','Glen Check','Haute Couture'),(2014,'글렌체크','Glen Check','YOUTH!'),(2015,'HEO','HEO','Structure'),(2016,'트램폴린','Trampauline','MARGINAL'),
  (2017,'키라라','Kirara','moves'),(2018,'씨피카','Cifika','My Ego'),(2019,'공중도둑','Mid-Air Thief','무너지기'),(2020,'림킴','LIM KIM','GENERASIAN'),
  (2021,'모과','MOGWAA','Open Mind'),(2022,'해파리','HAEPAARY','Born by Gorgeousness'),(2023,'250','250','뽕'),
  (2024,'예츠비','Yetsuby','My Star My Planet My Earth'),(2025,'넷갈라','Net Gala','Galapaggot'),(2026,'키라라','Kirara','Kirara')]),
 'kma-folk': ('한대음 최우수 포크 음반', [
  (2015,'김사월 X 김해원','Kim Sawol X Kim Haewon','비밀'),(2016,'김사월','Kim Sawol','수잔'),(2017,'이민휘','Lee Minhwi','빌린 입'),
  (2018,'강태구','Kang Tae Gu','bleu'),(2019,'김사월','Kim Sawol','로맨스'),(2020,'천용성','Chun Yong Sung','김일성이 죽던 해'),
  (2021,'정밀아','Jung Mila','청파소나타'),(2022,'이랑','Lang Lee','늑대가 나타났다'),(2023,'선과 원','Line and Circle','Night and Day'),
  (2024,'여유와 설빈','Yeoyu and Solbin','Comedy'),(2025,'모허','Moher','Kaleidoscope'),(2026,'권나무','Kwon Tree','The Fragrance of Life')]),
 'kma-rock': ('한대음 최우수 록 음반', [
  (2006,'블랙홀','Blackhole','Hero'),(2007,'머스탱스','The Mustangs','The Mustangs'),(2008,'할로우 잰','Hollow Jan','Rough Draft In Progress'),
  (2009,'갤럭시 익스프레스','Galaxy Express','Noise On Fire'),(2010,'서울전자음악단','Seoul Electric Band','Life Is Strange'),(2011,'크래쉬','Crash','The Paragon of Animals'),
  (2012,'장기하와 얼굴들','Kiha & The Faces','장기하와 얼굴들'),(2013,'정차식','Jung Cha Sik','격동하는 현재사'),(2014,'옐로우 몬스터즈','Yellow Monsters','Red Flag'),
  (2015,'단편선과 선원들','Danpyunsun and the Sailors','동물'),(2016,'더 모노톤즈','The Monotones','Into The Night'),(2017,'ABTB','ABTB','Attraction Between Two Bodies'),
  (2018,'로다운 30','Lowdown 30','B'),(2019,'라이프 앤 타임','Life and Time','Age'),(2020,'잠비나이','Jambinai','ONDA'),(2021,'ABTB','ABTB','daydream'),
  (2022,'소음발광','Soumbalgwang','기쁨, 꽃'),(2023,'콩코드','Concorde','Supersonic Airliner'),(2024,'오버드라이브 필로소피','OVerdrive Philosophy','64 see me'),
  (2025,'소음발광','Soumbalgwang','Fire & Light'),(2026,'와와와 & 노리도감','Wah Wah Wah & Noridogam','UBUBU')]),
}
# 한국힙합어워즈 올해의 힙합 앨범 (en.wikipedia Korean Hip-hop Awards)
KHA = ('한국힙합어워즈 올해의 힙합 앨범', [
  (2017,'넉살','Nucksal','작은 것들의 신'),(2018,'리짓군즈','Legit Goons','Junk Drunk Love'),(2019,'XXX','XXX','Language'),(2020,'씨잼','C JAMM','킁'),
  (2021,'빌스택스','Bill Stax','Detox'),(2022,'창모','Changmo','Underground Rockstar'),(2023,'릴 모쉬핏','Lil Moshpit','AAA'),(2024,'빈지노','Beenzino','NOWITZKI'),
  (2025,'비프리 & 허키 시바세키','B-Free & Hukky Shibaseki','Odyssey. 1'),(2026,'식케이 & 릴 모쉬핏','Sik-K & Lil Moshpit','K-FLIP+')])

# ---- discography pools: (slug, title, artist_ko, artist_en, [MusicBrainz artist names to merge]) ----------------
DISCOS = [
 ('disco-epikhigh','에픽하이 정규 앨범','에픽하이','Epik High',['Epik High']),
 ('disco-dynamicduo','다이나믹 듀오 정규 앨범','다이나믹 듀오','Dynamic Duo',['Dynamic Duo']),
 ('disco-blackskirts','검정치마 정규 앨범','검정치마','The Black Skirts',['검정치마']),
 ('disco-hyukoh','혁오 앨범·EP','혁오','HYUKOH',['혁오']),
 ('disco-barbershop','언니네 이발관 정규 앨범','언니네 이발관',"Sister's Barbershop",['언니네 이발관']),
 ('disco-kanye','칸예 웨스트 정규 앨범','칸예 웨스트','Kanye West',['Kanye West']),
 ('disco-radiohead','라디오헤드 정규 앨범','라디오헤드','Radiohead',['Radiohead']),
 ('disco-kendrick','켄드릭 라마 정규 앨범','켄드릭 라마','Kendrick Lamar',['Kendrick Lamar']),
 ('disco-tyler','타일러 더 크리에이터 정규 앨범','타일러 더 크리에이터','Tyler, the Creator',['Tyler, the Creator']),
 ('disco-beatles','비틀스 정규 앨범','비틀스','The Beatles',['The Beatles']),
 ('disco-yumdda','염따 앨범','염따','YUMDDA',['YUMDDA']),
 ('disco-arcticmonkeys','악틱 몽키즈 정규 앨범','악틱 몽키즈','Arctic Monkeys',['Arctic Monkeys']),
]
WITH_EPS = {'disco-hyukoh', 'disco-yumdda'}
# MusicBrainz cleanup: titles to drop (instrumental editions, singles/EPs typed as albums) and albums it lacks
EXCLUDE = {'disco-epikhigh': {"WE'VE DONE SOMETHING WONDERFUL The Instrumentals", '[e]'}}
EXTRA = {'disco-epikhigh': [('2021', 'Epik High Is Here 上 (Part 1)')]}
# Album-level award wins for the foreign discographies (the awards part of the score). Grammy album categories
# only (Album of the Year / Best Rap Album / Best Alternative Music Album …), plus Mercury Prize and BRIT British
# Album for Arctic Monkeys, who never won a Grammy. Prefilled from memory: verify, and fill the 2026 ceremony.
AWARDS = {
 ('Kanye West', 'The College Dropout'): ['Grammy 2005 Best Rap Album'],
 ('Kanye West', 'Late Registration'): ['Grammy 2006 Best Rap Album'],
 ('Kanye West', 'Graduation'): ['Grammy 2008 Best Rap Album'],
 ('Kanye West', 'My Beautiful Dark Twisted Fantasy'): ['Grammy 2012 Best Rap Album'],
 ('Kanye West', 'Jesus Is King'): ['Grammy 2021 Best Contemporary Christian Music Album'],
 ('Kendrick Lamar', 'To Pimp a Butterfly'): ['Grammy 2016 Best Rap Album'],
 ('Kendrick Lamar', 'DAMN.'): ['Grammy 2018 Best Rap Album'],
 ('Kendrick Lamar', 'Mr. Morale & The Big Steppers'): ['Grammy 2023 Best Rap Album'],
 ('Tyler, the Creator', 'IGOR'): ['Grammy 2020 Best Rap Album'],
 ('Tyler, the Creator', 'CALL ME IF YOU GET LOST'): ['Grammy 2022 Best Rap Album'],
 ('Radiohead', 'OK Computer'): ['Grammy 1998 Best Alternative Music Performance'],
 ('Radiohead', 'Kid A'): ['Grammy 2001 Best Alternative Music Album'],
 ('Radiohead', 'In Rainbows'): ['Grammy 2009 Best Alternative Music Album'],
 ("The Beatles", "Sgt. Pepper's Lonely Hearts Club Band"): ['Grammy 1968 Album of the Year'],
 ('Arctic Monkeys', "Whatever People Say I Am, That's What I'm Not"): ['Mercury Prize 2006', 'BRIT 2007 British Album'],
 ('Arctic Monkeys', 'Favourite Worst Nightmare'): ['BRIT 2008 British Album'],
 ('Arctic Monkeys', 'AM'): ['BRIT 2014 British Album'],
}
AWARD_CHECK = {('Kanye West', 'Bully'): 'check release (2025?)', ('Kendrick Lamar', 'GNX'): 'check the 2026 Grammys (Best Rap Album?)', ('Tyler, the Creator', 'CHROMAKOPIA'): 'check the 2026 Grammys'}

# Big foreign catalogs: MusicBrainz lists bootlegs and tributes as albums, so their studio albums are listed here.
STATIC = {
 'disco-kanye': [('2004','The College Dropout'),('2005','Late Registration'),('2007','Graduation'),('2008','808s & Heartbreak'),
   ('2010','My Beautiful Dark Twisted Fantasy'),('2013','Yeezus'),('2016','The Life of Pablo'),('2018','ye'),('2019','Jesus Is King'),
   ('2021','Donda'),('2025','Bully')],
 'disco-radiohead': [('1993','Pablo Honey'),('1995','The Bends'),('1997','OK Computer'),('2000','Kid A'),('2001','Amnesiac'),
   ('2003','Hail to the Thief'),('2007','In Rainbows'),('2011','The King of Limbs'),('2016','A Moon Shaped Pool')],
 'disco-kendrick': [('2011','Section.80'),('2012','good kid, m.A.A.d city'),('2015','To Pimp a Butterfly'),('2017','DAMN.'),
   ('2022','Mr. Morale & the Big Steppers'),('2024','GNX')],
 'disco-tyler': [('2011','Goblin'),('2013','Wolf'),('2015','Cherry Bomb'),('2017','Flower Boy'),('2019','IGOR'),
   ('2021','CALL ME IF YOU GET LOST'),('2024','CHROMAKOPIA'),('2025',"DON'T TAP THE GLASS")],
 'disco-beatles': [('1963','Please Please Me'),('1963','With the Beatles'),('1964',"A Hard Day's Night"),('1964','Beatles for Sale'),
   ('1965','Help!'),('1965','Rubber Soul'),('1966','Revolver'),('1967',"Sgt. Pepper's Lonely Hearts Club Band"),('1967','Magical Mystery Tour'),
   ('1968','The Beatles (White Album)'),('1969','Yellow Submarine'),('1969','Abbey Road'),('1970','Let It Be')],
 'disco-arcticmonkeys': [('2006',"Whatever People Say I Am, That's What I'm Not"),('2007','Favourite Worst Nightmare'),('2009','Humbug'),
   ('2011','Suck It and See'),('2013','AM'),('2018','Tranquility Base Hotel & Casino'),('2022','The Car')],
}

SUBNAMES = {'서태지와 아이들': ('서태지와 아이들', 'Seo Taiji and Boys'), '서태지': ('서태지', 'Seo Taiji')}

def norm(s):
    return re.sub(r'[^\w+]', '', unicodedata.normalize('NFC', s).lower())

def mb(path, **q):
    q['fmt'] = 'json'
    url = f'https://musicbrainz.org/ws/2/{path}?{urllib.parse.urlencode(q)}'
    for attempt in range(5):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': UA})
            with urllib.request.urlopen(req, timeout=30) as r:
                time.sleep(1.1)
                return json.load(r)
        except Exception as e:
            time.sleep(3 + attempt * 3)
    raise RuntimeError('MusicBrainz failed: ' + url)

def discography(names, eps=False):
    out = []
    for name in names:
        hits = mb('artist', query=f'artist:"{name}"', limit=5)['artists']
        hit = next((a for a in hits if norm(a['name']) == norm(name) or any(norm(x.get('name', '')) == norm(name) for x in a.get('aliases', []))), hits[0] if hits else None)
        if not hit:
            print('  ! no MusicBrainz artist for', name); continue
        rgs, off = [], 0
        while True:
            page = mb('release-group', artist=hit['id'], type='album|ep' if eps else 'album', limit=100, offset=off)
            rgs += page['release-groups']; off += 100
            if off >= page.get('release-group-count', 0): break
        for g in rgs:
            if g.get('primary-type') in (('Album', 'EP') if eps else ('Album',)) and not g.get('secondary-types'):
                out.append((g.get('first-release-date', '')[:4], name, g['title'], g['id']))
        print(f'  {name} -> {hit["name"]} ({hit["id"][:8]}): {sum(1 for x in out if x[1] == name)} studio albums')
    return sorted(out)

def main():
    old = {}
    if os.path.exists(OUT):
        for r in csv.DictReader(open(OUT, encoding='utf8')):
            old[r['id']] = r
            if 'kma_wins' in r and not r.get('award_wins'): r['award_wins'] = r['kma_wins']
    # earlier per-reel sheets (hand-entered ratings, Last.fm aliases/title variants) seed rows not yet in the master
    for legacy in ('002-kma-hiphop', '003-kma-aoty'):
        lp = os.path.join(HERE, '..', 'work', legacy, 'albums.csv')
        if not os.path.exists(lp): continue
        for r in csv.DictReader(open(lp, encoding='utf8')):
            lid = norm(r['artist_en'] or r['artist_ko']) + '__' + norm(r['album'])
            cur = old.setdefault(lid, {})
            for k in ('rym', 'aoty_user', 'kma_wins', 'aliases', 'album_search', 'notes'):
                if r.get(k) and not cur.get(k) and not (k == 'kma_wins' and legacy == '003-kma-aoty' and not r.get('rym')):
                    cur['award_wins' if k == 'kma_wins' else k] = r[k]
    albums = {}  # id -> row
    def add(reel, artist_ko, artist_en, album, year='', award=None, mbid=''):
        aid = norm(artist_en or artist_ko) + '__' + norm(album)
        r = albums.setdefault(aid, {'id': aid, 'artist_ko': artist_ko, 'artist_en': artist_en, 'album': album, 'year': year,
                                    'reels': [], 'kma_album_wins': 0, 'awards': [], 'mbid': mbid})
        if reel not in r['reels']: r['reels'].append(reel)
        if award: r['awards'].append(award)
        if award and award.startswith('KMA'): r['kma_album_wins'] += 1
        if year and not r['year']: r['year'] = year
    for slug, (title, rows) in KMA.items():
        for y, ko, en, al in rows:
            add(slug, ko, en, al, award=f'KMA {y} {title.replace("한대음 ", "")}')
    for y, ko, en, al in KHA[1]:
        add('kha-hiphop', ko, en, al, award=f'KHA {y} 올해의 힙합 앨범')
    for slug, title, ko, en, names in DISCOS:
        print(slug)
        found = [(y, names[0], al, '') for y, al in STATIC[slug]] if slug in STATIC else discography(names, slug in WITH_EPS)
        for year, qname, album, mbid in found:
            # discography rows join award rows when artist_en + album match
            a_ko, a_en = (ko, en) if len(names) == 1 else SUBNAMES.get(qname, (qname, qname))
            if album in EXCLUDE.get(slug, ()): continue
            add(slug, a_ko, a_en, album, year, mbid=mbid)
            for aw in {(norm(k[0]), norm(k[1])): v for k, v in AWARDS.items()}.get((norm(a_en), norm(album)), []):
                albums[norm(a_en) + '__' + norm(album)]['awards'].append(aw)
                albums[norm(a_en) + '__' + norm(album)]['kma_album_wins'] += 1
        for year, album in EXTRA.get(slug, []):
            add(slug, ko, en, album, year)
    cols = ['id', 'artist_ko', 'album', 'year', 'rym', 'aoty_user', 'award_wins', 'rym_search', 'aoty_search', 'awards_known', 'notes', 'reels', 'artist_en', 'aliases', 'album_search']
    with open(OUT, 'w', encoding='utf8', newline='') as f:
        w = csv.DictWriter(f, fieldnames=cols, lineterminator='\n'); w.writeheader()
        for r in sorted(albums.values(), key=lambda r: (r['artist_en'].lower(), r['year'], r['album'])):
            q = f"{r['artist_en']} {r['album']}"
            prev = old.get(r['id'], {})
            w.writerow({'id': r['id'], 'artist_ko': r['artist_ko'], 'artist_en': r['artist_en'], 'album': r['album'], 'year': prev.get('year') or r['year'],
                        'reels': ';'.join(r['reels']), 'rym': prev.get('rym', ''), 'aoty_user': prev.get('aoty_user', ''),
                        'award_wins': prev.get('award_wins') or r['kma_album_wins'], 'awards_known': '; '.join(r['awards']),
                        'rym_search': 'https://rateyourmusic.com/search?' + urllib.parse.urlencode({'searchterm': q, 'searchtype': 'l'}),
                        'aoty_search': 'https://www.albumoftheyear.org/search/?' + urllib.parse.urlencode({'q': q}),
                        'notes': prev.get('notes') or ('살아숨셔 = Breathe series' if 'Breathe' in r['album'] else '') or next((v for k, v in AWARD_CHECK.items() if norm(k[0]) == norm(r['artist_en']) and norm(k[1]) == norm(r['album'])), ''), 'aliases': prev.get('aliases', ''), 'album_search': prev.get('album_search', '')})
    reels = {}
    for r in albums.values():
        for s in r['reels']: reels[s] = reels.get(s, 0) + 1
    print(f'\n{len(albums)} albums across {len(reels)} reels:', reels)

if __name__ == '__main__':
    main()
