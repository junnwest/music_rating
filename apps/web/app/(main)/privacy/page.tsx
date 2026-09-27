import Link from 'next/link';
import type { LucideIcon } from 'lucide-react';
import {
  Shield, Lock, Globe, Eye, Trash2, Cookie, Mail, FileText, ArrowLeft, Scale,
  Users, Server, Baby, KeyRound, Languages,
} from 'lucide-react';
import { getServerLang } from '../../../lib/i18n/server';

// Written to the PIPC's 개인정보 처리방침 작성지침 (2025.4) -- every item PIPA
// Art. 30 / Enforcement Decree Art. 31 requires, plus the Art. 28-8 overseas
// transfer disclosure. Keep the processor table in sync with the services the
// code actually calls (see .env.example); an undisclosed processor is a
// PIPA violation, not a docs nit.

// A string is a paragraph; a string[] is a bulleted list; a table is a table.
type Table = { head: string[]; rows: string[][] };
type Block = string | string[] | Table;
type Section = { icon: LucideIcon; title: string; body: Block[] };
type Doc = { title: string; updated: string; back: string; intro: string; sections: Section[] };

const EMAIL = 'admin@sillajuku.com';

const ko: Doc = {
  title: '개인정보처리방침',
  updated: '시행일: 2026년 9월 27일',
  back: '홈으로',
  intro:
    'sillajuku(이하 "서비스")를 운영하는 개인사업자(이하 "운영자")는 「개인정보 보호법」 등 관계 법령을 준수하며, 이용자의 개인정보를 보호하고 관련 고충을 원활하게 처리하기 위해 다음과 같이 개인정보처리방침을 정하여 공개합니다. 본 방침은 sillajuku 웹사이트와 iOS 앱에 모두 적용됩니다.',
  sections: [
    {
      icon: Shield,
      title: '1. 처리하는 개인정보의 항목, 목적 및 보유 기간',
      body: [
        '운영자는 서비스 제공에 필요한 최소한의 개인정보만 처리합니다. 주민등록번호 등 고유식별정보와 민감정보는 수집하지 않습니다.',
        {
          head: ['구분', '처리 항목', '처리 목적', '보유 기간'],
          rows: [
            ['회원가입·로그인 (필수)', '소셜 로그인(Google, Apple, Spotify) 계정 식별자, 이메일 주소, 이름(제공된 경우)', '회원 식별, 로그인, 계정 관리, 부정 이용 방지', '탈퇴 시까지'],
            ['프로필 (필수·선택)', '필수: 사용자 이름, 표시 이름\n선택: 프로필 사진, 소개', '프로필 표시, 회원 간 식별', '탈퇴 시까지 (선택 항목은 삭제 시까지)'],
            ['서비스 이용 (필수)', '평점, 리뷰·댓글, 믹스, 좋아요, 팔로우·팔로우 요청, 공개 범위·알림 설정, 알림 내역, 퀘스트 진행 상황', '서비스 제공, 취향 분석, 추천, 랭킹·통계 산출', '탈퇴 시까지'],
            ['음악 서비스 연동 (선택)', 'Spotify·Apple Music에서 이용자가 허용한 청취 데이터(자주 듣는 아티스트·곡, 최근 재생 기록 등)', '맞춤 추천, 평가할 앨범 제안', '연동 해제 또는 탈퇴 시까지'],
            ['전화번호 인증 (선택)', '전화번호, 인증 일시', '친구 초대 기능 제공, 창립 멤버 배지 1인 1회 발급 확인', '전화번호 삭제 또는 탈퇴 시까지'],
            ['창립 멤버 배지 (선택)', '전화번호의 일방향 해시값, 배지 번호, 발급 일시', '같은 전화번호로 배지가 중복 발급되는 것을 방지', '배지 제도 운영 종료 시까지 (탈퇴 시 계정과의 연결은 끊어짐)'],
            ['푸시 알림 (선택)', '기기 푸시 토큰', '알림 발송', '알림 해제, 로그아웃 또는 탈퇴 시까지'],
            ['자동 수집', 'IP 주소, 기기·운영체제·브라우저 정보, 접속 일시, 서비스 이용 기록, 오류·성능 기록', '서비스 운영, 보안, 오류 분석, 서비스 개선', '수집일로부터 최대 1년'],
          ],
        },
        '검색어는 계정과 연결하지 않은 상태로 저장되며, 인기 검색어와 검색 품질 개선을 위한 통계로만 이용됩니다.',
        '카메라와 사진 보관함 접근은 이용자가 해당 기능을 사용할 때만 요청합니다. 공유 이미지를 만들 때 사용하는 사진은 기기 안에서만 처리되며, 프로필 사진으로 선택한 이미지만 서버에 저장됩니다.',
      ],
    },
    {
      icon: Scale,
      title: '2. 개인정보 처리의 근거',
      body: [
        [
          '필수 항목은 이용자와의 서비스 이용계약을 이행하기 위해 처리합니다(「개인정보 보호법」 제15조제1항제4호).',
          '선택 항목(음악 서비스 연동, 전화번호 인증, 창립 멤버 배지, 푸시 알림, 선택 프로필 항목)은 이용자의 동의를 받아 처리합니다(같은 항 제1호). 동의하지 않아도 서비스의 기본 기능은 이용할 수 있으며, 해당 기능만 이용할 수 없습니다.',
          '자동 수집 정보는 서비스의 안전한 운영과 개선을 위해 필요한 범위에서 처리합니다(같은 항 제6호).',
        ],
        '이용자는 언제든지 설정에서 선택 기능을 해제하거나 아래 연락처로 요청하여 동의를 철회할 수 있습니다.',
      ],
    },
    {
      icon: Trash2,
      title: '3. 개인정보의 파기',
      body: [
        '운영자는 보유 기간이 끝나거나 처리 목적이 달성된 개인정보를 지체 없이 파기합니다. 탈퇴한 회원의 개인정보는 늦어도 30일 이내에 파기하며, 백업 데이터에 남은 사본도 30일 이내에 삭제됩니다. 전자적 파일은 복구할 수 없는 방법으로 삭제하며, 종이 문서로는 개인정보를 보관하지 않습니다.',
        '다음의 경우에는 예외적으로 정해진 기간 동안 보관합니다.',
        [
          '계정 비활성화: 이용자가 계정을 비활성화하면 다른 이용자에게 표시되지 않은 상태로 보관되며, 재활성화하거나 탈퇴할 때까지 유지됩니다.',
          '이용 제한으로 해지된 계정: 재가입 방지와 분쟁 대응을 위해 계정 식별자와 조치 기록을 해지일로부터 1년간 보관합니다.',
          '창립 멤버 배지: 전화번호의 해시값은 중복 발급 방지를 위해 위 1항의 기간 동안 보관합니다.',
          '「통신비밀보호법」: 서비스 접속 기록(로그인 기록, IP 주소)은 3개월간 보관합니다.',
        ],
        '개인을 식별할 수 없도록 집계되거나 비식별 처리된 통계(종합 점수, 랭킹 등)는 개인정보가 아니므로 탈퇴 후에도 유지될 수 있습니다.',
      ],
    },
    {
      icon: Users,
      title: '4. 개인정보의 제3자 제공과 공개 정보',
      body: [
        '운영자는 이용자의 개인정보를 제3자에게 판매하거나 제공하지 않습니다. 다만 법령에 따라 수사기관 등이 적법한 절차로 요구하는 경우에는 예외로 합니다.',
        '프로필, 평점, 리뷰, 공개 믹스, 팔로우 관계는 기본적으로 다른 이용자에게 공개됩니다. 비공개 계정으로 설정하면 이용자가 승인한 팔로워만 이를 볼 수 있습니다. 비공개 계정의 평점도 개인을 드러내지 않는 방식으로 종합 점수에 반영됩니다.',
      ],
    },
    {
      icon: Server,
      title: '5. 개인정보 처리위탁 및 국외 이전',
      body: [
        '운영자는 서비스 운영을 위해 다음과 같이 업무를 위탁하고 있으며, 일부 수탁자는 국외에서 개인정보를 처리합니다. 이 국외 이전은 서비스 이용계약의 이행에 필요한 처리위탁·보관으로서 「개인정보 보호법」 제28조의8제1항제3호에 근거합니다. 개인정보는 서비스를 이용할 때마다 정보통신망을 통해 전송되며, 수탁자는 위탁 계약이 끝나거나 위 1항의 보유 기간이 끝날 때까지 보관합니다.',
        {
          head: ['수탁자 (처리 국가)', '위탁 업무', '이전되는 항목'],
          rows: [
            ['Supabase Inc. (서버: 대한민국 서울 / 본사: 미국)', '데이터베이스, 로그인 인증, 파일 저장', '위 1항의 계정·프로필·이용 정보, 전화번호'],
            ['Vercel Inc. (미국)', '웹사이트 호스팅, 서버 기능 실행', 'IP 주소, 접속 기록, 요청 처리에 필요한 정보'],
            ['Upstash Inc. (미국)', '캐시, 요청 횟수 제한', 'IP 주소, 계정 식별자 (단기 보관)'],
            ['PostHog Inc. (미국)', '웹 이용 분석', '접속·이용 기록, 기기·브라우저 정보, IP 주소'],
            ['Functional Software Inc. (Sentry) (미국)', '오류·성능 분석', '오류 기록, 기기 정보, IP 주소'],
            ['Twilio Inc. (미국)', '인증 문자 발송', '전화번호'],
            ['Apple Inc. (미국)', 'iOS 푸시 알림 발송', '기기 푸시 토큰, 알림 내용'],
            ['Jina AI GmbH (독일)', '검색어 의미 분석', '검색어 (계정 정보 없이 전송)'],
          ],
        },
        '국외 이전을 원하지 않는 경우 선택 기능(전화번호 인증, 푸시 알림)을 사용하지 않거나 탈퇴할 수 있습니다. 다만 데이터베이스와 호스팅 등 필수 위탁 없이는 서비스를 제공할 수 없습니다.',
        'Google, Apple, Spotify 로그인과 Spotify·Apple Music 연동은 이용자가 직접 선택하여 해당 사업자와 연결하는 것이며, 해당 사업자의 개인정보 처리에는 각 사업자의 방침이 적용됩니다.',
      ],
    },
    {
      icon: Eye,
      title: '6. 이용자의 권리와 행사 방법',
      body: [
        '이용자는 언제든지 자신의 개인정보에 대해 열람, 정정, 삭제, 처리정지를 요구하고 동의를 철회할 수 있습니다.',
        [
          '앱과 웹의 설정에서 프로필 수정, 공개 범위 변경, 음악 서비스 연동 해제, 알림 설정, 계정 비활성화 및 탈퇴를 직접 할 수 있습니다.',
          `그 밖의 요청은 ${EMAIL}로 보내 주시면 10일 이내에 조치하고 결과를 알려 드립니다.`,
          '법정대리인이나 위임을 받은 자를 통해서도 권리를 행사할 수 있으며, 이 경우 위임장을 제출해야 합니다.',
          '법령에 따라 보관이 필요하거나 다른 사람의 권리를 침해할 우려가 있는 경우에는 요구가 제한될 수 있으며, 이때는 그 사유를 알려 드립니다.',
        ],
      ],
    },
    {
      icon: Baby,
      title: '7. 만 14세 미만 아동',
      body: [
        '서비스는 만 14세 미만 아동의 가입을 받지 않습니다. 만 14세 미만 아동의 개인정보가 수집된 사실을 알게 되면 지체 없이 해당 계정과 개인정보를 삭제합니다.',
      ],
    },
    {
      icon: Lock,
      title: '8. 개인정보의 안전성 확보 조치',
      body: [
        [
          '관리적 조치: 개인정보에 접근할 수 있는 사람을 운영자로 최소화하고, 접근 권한과 인증 키를 별도로 관리합니다.',
          '기술적 조치: 모든 전송 구간을 암호화(HTTPS/TLS)하고, 데이터베이스에 행 단위 접근 제어를 적용하며, 비밀번호는 저장하지 않습니다(소셜 로그인). 창립 멤버 배지의 전화번호는 해시값으로만 보관하며, 오류와 비정상적인 접근을 모니터링합니다.',
          '물리적 조치: 개인정보는 클라우드 사업자의 보안 데이터센터에 저장되며, 운영자는 별도의 물리적 서버를 운영하지 않습니다.',
        ],
      ],
    },
    {
      icon: Cookie,
      title: '9. 쿠키 등 자동 수집 장치',
      body: [
        '웹사이트는 로그인 유지와 언어 설정 저장을 위한 필수 쿠키와 브라우저 저장소만 사용합니다. 이용 분석(PostHog)과 오류 분석(Sentry)은 쿠키나 지속적인 식별자를 브라우저에 저장하지 않는 방식으로 작동하며, 이용 분석은 브라우저의 "추적 안 함(Do Not Track)" 설정을 따릅니다.',
        '운영자는 맞춤형 광고를 하지 않으며, 행태정보를 광고 목적으로 이용하거나 제3자에게 제공하지 않습니다. iOS 앱은 광고 식별자(IDFA)를 수집하지 않고, 다른 회사의 앱이나 웹사이트에서 이용자를 추적하지 않습니다.',
        '브라우저 설정에서 쿠키를 거부할 수 있으나, 이 경우 로그인이 유지되지 않습니다.',
      ],
    },
    {
      icon: KeyRound,
      title: '10. 개인정보 보호책임자',
      body: [
        '운영자는 개인정보 처리에 관한 업무를 총괄하고 이용자의 고충을 처리하기 위해 다음과 같이 개인정보 보호책임자를 지정하고 있습니다.',
        [
          '개인정보 보호책임자: sillajuku 대표(개인사업자)',
          `연락처: ${EMAIL}`,
        ],
        '개인정보와 관련한 문의, 불만 처리, 피해 구제 요청은 위 연락처로 보내 주시면 지체 없이 답변하고 처리하겠습니다.',
      ],
    },
    {
      icon: Mail,
      title: '11. 권익침해 구제 방법',
      body: [
        '개인정보 침해에 대한 상담이나 구제가 필요한 경우 다음 기관에 문의할 수 있습니다.',
        [
          '개인정보분쟁조정위원회: 1833-6972 (www.kopico.go.kr)',
          '개인정보침해신고센터: 118 (privacy.kisa.or.kr)',
          '대검찰청: 1301 (www.spo.go.kr)',
          '경찰청: 182 (ecrm.police.go.kr)',
        ],
      ],
    },
    {
      icon: Globe,
      title: '12. 해외 이용자',
      body: [
        '서비스는 대한민국에서 운영되며 「개인정보 보호법」에 따라 개인정보를 처리합니다. 거주 국가의 법률이 이용자에게 추가적인 권리를 보장하는 경우(예: 유럽연합 GDPR의 열람·정정·삭제·처리제한·이동·반대의 권리, 캘리포니아 CCPA의 알 권리·삭제 요구권) 해당 권리도 위 6항의 방법으로 행사할 수 있습니다. 운영자는 개인정보를 판매하거나 CCPA에서 정의하는 "공유"를 하지 않습니다.',
      ],
    },
    {
      icon: FileText,
      title: '13. 방침의 변경',
      body: [
        '본 방침이 변경되는 경우 시행 7일 전부터 서비스에 공지하며, 수집 항목이나 이용 목적 등 이용자의 권리에 중요한 변경이 있는 경우에는 시행 30일 전부터 공지하고 전자우편 또는 서비스 내 알림으로 알립니다.',
        [
          '2026년 9월 27일: 전면 개정 (한국어 방침 신설, 처리 항목·보유 기간·처리위탁·국외 이전·보호책임자 명시, 전화번호 인증·창립 멤버 배지·푸시 알림·계정 비활성화 반영)',
          '2026년 8월: 이전 방침 (영문)',
        ],
      ],
    },
    {
      icon: Languages,
      title: '14. 언어',
      body: [
        '본 방침은 한국어와 영어로 제공되며, 두 버전의 내용이 서로 다른 경우 한국어 버전이 우선합니다.',
      ],
    },
  ],
};

const en: Doc = {
  title: 'Privacy Policy',
  updated: 'Effective: September 27, 2026',
  back: 'Back to home',
  intro:
    'sillajuku (the "Service") is operated by a sole proprietor registered in the Republic of Korea ("we"). We follow the Personal Information Protection Act of Korea (PIPA) and other applicable laws, and publish this policy to explain how we handle your personal information and how you can reach us. It applies to both the sillajuku website and the iOS app.',
  sections: [
    {
      icon: Shield,
      title: '1. What We Collect, Why, and for How Long',
      body: [
        'We process only the personal information the Service needs. We do not collect resident registration numbers or other unique identifiers, or sensitive information.',
        {
          head: ['Category', 'Information', 'Purpose', 'Retention'],
          rows: [
            ['Sign-up and login (required)', 'Account identifier from your social login (Google, Apple, Spotify), email address, name (if provided)', 'Identifying you, login, account management, abuse prevention', 'Until you delete your account'],
            ['Profile (required and optional)', 'Required: username, display name\nOptional: profile photo, bio', 'Showing your profile, telling users apart', 'Until you delete your account (optional items until you remove them)'],
            ['Service activity (required)', 'Ratings, reviews and comments, Mixes, likes, follows and follow requests, privacy and notification settings, notification history, quest progress', 'Providing the Service, taste analysis, recommendations, rankings and statistics', 'Until you delete your account'],
            ['Music service connection (optional)', 'Listening data you authorize from Spotify or Apple Music (top artists and tracks, recently played, etc.)', 'Personalized recommendations, suggesting albums to rate', 'Until you disconnect or delete your account'],
            ['Phone verification (optional)', 'Phone number, verification time', 'Friend invites, making sure each person claims one founding badge', 'Until you remove the number or delete your account'],
            ['Founding badge (optional)', 'One-way hash of your phone number, badge number, claim time', 'Preventing the same phone number from claiming a second badge', 'Until the founding badge program ends (unlinked from your account when you delete it)'],
            ['Push notifications (optional)', 'Device push token', 'Sending notifications', 'Until you turn notifications off, sign out, or delete your account'],
            ['Collected automatically', 'IP address, device, OS and browser information, access times, usage records, error and performance logs', 'Operating and securing the Service, diagnosing errors, improving the Service', 'Up to 1 year from collection'],
          ],
        },
        'Search queries are stored without being linked to your account, and are used only for Popular Searches and search-quality statistics.',
        'We ask for camera and photo-library access only when you use a feature that needs it. Photos used to make share images are processed on your device; only an image you choose as your profile photo is stored on our servers.',
      ],
    },
    {
      icon: Scale,
      title: '2. Legal Basis',
      body: [
        [
          'Required information is processed to perform our contract with you, that is, to provide the Service (PIPA Art. 15(1)(4)).',
          'Optional information (music service connection, phone verification, founding badge, push notifications, optional profile fields) is processed with your consent (Art. 15(1)(1)). If you do not consent, you can still use the core Service; only that feature is unavailable.',
          'Automatically collected information is processed to the extent needed to run the Service securely and improve it (Art. 15(1)(6)).',
        ],
        'You can withdraw consent at any time by turning the feature off in Settings or contacting us.',
      ],
    },
    {
      icon: Trash2,
      title: '3. Deletion',
      body: [
        'We delete personal information without delay once its retention period ends or its purpose is fulfilled. When you delete your account, your personal information is destroyed within 30 days, and copies in backups are removed within 30 days. Electronic files are deleted so they cannot be recovered; we keep no personal information on paper.',
        'The following are kept for a set period as exceptions:',
        [
          'Deactivated accounts: hidden from other users and kept until you reactivate or delete the account.',
          'Accounts terminated for violations: the account identifier and enforcement records are kept for 1 year from termination to prevent re-registration and to handle disputes.',
          'Founding badge: the phone-number hash is kept for the period stated in Section 1 to prevent duplicate claims.',
          'Korea\'s Protection of Communications Secrets Act: access records (login records, IP addresses) are kept for 3 months.',
        ],
        'Statistics that have been aggregated or de-identified so they cannot identify you (such as overall scores and rankings) are not personal information and may remain after you delete your account.',
      ],
    },
    {
      icon: Users,
      title: '4. Sharing and Public Information',
      body: [
        'We do not sell or provide your personal information to third parties, except when a court, investigative authority, or other body requests it through a lawful procedure.',
        'Your profile, ratings, reviews, public Mixes, and follows are visible to other users by default. If you make your account private, only followers you approve can see them. Ratings from private accounts still count toward overall scores in a way that does not reveal you.',
      ],
    },
    {
      icon: Server,
      title: '5. Service Providers and International Transfers',
      body: [
        'We use the following service providers to run the Service, and some of them process personal information outside Korea. These transfers are outsourcing and storage needed to perform our contract with you, under PIPA Art. 28-8(1)(3). Information is sent over the network whenever you use the Service, and providers keep it until their contract with us ends or the retention period in Section 1 ends.',
        {
          head: ['Provider (country)', 'Service', 'Information transferred'],
          rows: [
            ['Supabase Inc. (servers: Seoul, Korea / company: USA)', 'Database, login and authentication, file storage', 'Account, profile, and activity information in Section 1; phone number'],
            ['Vercel Inc. (USA)', 'Website hosting, server functions', 'IP address, access records, information needed to handle requests'],
            ['Upstash Inc. (USA)', 'Caching, rate limiting', 'IP address, account identifier (short-term)'],
            ['PostHog Inc. (USA)', 'Web product analytics', 'Access and usage records, device and browser information, IP address'],
            ['Functional Software Inc. (Sentry) (USA)', 'Error and performance diagnostics', 'Error logs, device information, IP address'],
            ['Twilio Inc. (USA)', 'Sending verification text messages', 'Phone number'],
            ['Apple Inc. (USA)', 'Delivering iOS push notifications', 'Device push token, notification content'],
            ['Jina AI GmbH (Germany)', 'Understanding the meaning of search queries', 'Search query (sent without account information)'],
          ],
        },
        'If you do not want your information transferred abroad, you can skip the optional features (phone verification, push notifications) or delete your account. The Service cannot run without its essential providers, such as the database and hosting.',
        'Signing in with Google, Apple, or Spotify, and connecting Spotify or Apple Music, are connections you choose to make with those companies; their own privacy policies govern how they handle your information.',
      ],
    },
    {
      icon: Eye,
      title: '6. Your Rights',
      body: [
        'You may at any time ask to access, correct, delete, or stop the processing of your personal information, and withdraw your consent.',
        [
          'In Settings on the app or website, you can edit your profile, change who can see your account, disconnect music services, manage notifications, and deactivate or delete your account yourself.',
          `For anything else, email ${EMAIL}. We will act on your request and tell you the result within 10 days.`,
          'You may also exercise these rights through a legal representative or someone you authorize, who must provide a power of attorney.',
          'A request may be limited where the law requires us to keep the information or where it could infringe someone else\'s rights; if so, we will tell you why.',
        ],
      ],
    },
    {
      icon: Baby,
      title: '7. Children Under 14',
      body: [
        'The Service does not accept users under 14. If we learn that we have collected personal information from a child under 14, we will delete the account and its information without delay.',
      ],
    },
    {
      icon: Lock,
      title: '8. How We Protect Your Information',
      body: [
        [
          'Administrative: access to personal information is limited to the operator, and access rights and keys are managed separately.',
          'Technical: all traffic is encrypted (HTTPS/TLS), the database enforces row-level access control, and we store no passwords (social login only). Phone numbers for the founding badge are kept only as hashes, and we monitor for errors and unusual access.',
          'Physical: information is stored in cloud providers\' secured data centers; we run no physical servers of our own.',
        ],
      ],
    },
    {
      icon: Cookie,
      title: '9. Cookies and Similar Technologies',
      body: [
        'The website uses only strictly necessary cookies and browser storage, to keep you signed in and remember your language. Our product analytics (PostHog) and error diagnostics (Sentry) run without setting cookies or persistent identifiers in your browser, and analytics honors your browser\'s "Do Not Track" signal.',
        'We do not run targeted advertising, and we do not use or share behavioral information for advertising. The iOS app does not collect the advertising identifier (IDFA) and does not track you across other companies\' apps or websites.',
        'You can block cookies in your browser settings, but you will not stay signed in.',
      ],
    },
    {
      icon: KeyRound,
      title: '10. Privacy Officer',
      body: [
        'We have designated a privacy officer who is responsible for how personal information is handled and for resolving your concerns.',
        [
          'Privacy officer: Representative of sillajuku (sole proprietor)',
          `Contact: ${EMAIL}`,
        ],
        'Send any privacy questions, complaints, or requests for remedy to this address, and we will respond and act without delay.',
      ],
    },
    {
      icon: Mail,
      title: '11. Where to Get Help',
      body: [
        'If you need advice on or a remedy for a privacy violation, you can contact the following Korean bodies:',
        [
          'Personal Information Dispute Mediation Committee: 1833-6972 (www.kopico.go.kr)',
          'Personal Information Infringement Report Center: 118 (privacy.kisa.or.kr)',
          'Supreme Prosecutors\' Office: 1301 (www.spo.go.kr)',
          'Korean National Police Agency: 182 (ecrm.police.go.kr)',
        ],
        'If you live outside Korea, you may also contact the data protection authority where you live.',
      ],
    },
    {
      icon: Globe,
      title: '12. Users Outside Korea',
      body: [
        'The Service is operated from Korea and processes personal information under PIPA. If the law where you live gives you additional rights, such as the rights of access, rectification, erasure, restriction, portability, and objection under the EU GDPR, or the rights to know and to delete under California\'s CCPA, you can exercise them the same way as in Section 6. We do not sell personal information or "share" it as the CCPA defines that term.',
      ],
    },
    {
      icon: FileText,
      title: '13. Changes to This Policy',
      body: [
        'We will post any change to this policy on the Service at least 7 days before it takes effect. For changes that matter to your rights, such as new kinds of information or new purposes, we will post them at least 30 days in advance and also notify you by email or in-app notice.',
        [
          'September 27, 2026: full revision (Korean version added; information, retention, service providers, international transfers, and privacy officer set out in detail; phone verification, founding badge, push notifications, and account deactivation added)',
          'August 2026: previous policy (English only)',
        ],
      ],
    },
    {
      icon: Languages,
      title: '14. Language',
      body: [
        'This policy is available in Korean and English. If the two versions conflict, the Korean version prevails.',
      ],
    },
  ],
};

function renderBlock(block: Block, i: number) {
  if (typeof block === 'string') {
    return <p key={i} className="text-[14px] leading-relaxed text-mid">{block}</p>;
  }
  if (Array.isArray(block)) {
    return (
      <ul key={i} className="list-disc pl-5 flex flex-col gap-1.5">
        {block.map((item, j) => (
          <li key={j} className="text-[14px] leading-relaxed text-mid">{item}</li>
        ))}
      </ul>
    );
  }
  return (
    <div key={i} className="overflow-x-auto rounded-lg border border-divider">
      <table className="w-full min-w-[560px] border-collapse text-left text-[13px] leading-relaxed">
        <thead className="bg-surface">
          <tr>
            {block.head.map((h) => (
              <th key={h} className="px-3 py-2 font-semibold text-ink border-b border-divider align-top">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {block.rows.map((row, r) => (
            <tr key={r} className="border-b border-divider last:border-b-0">
              {row.map((cell, c) => (
                <td key={c} className={`px-3 py-2 align-top whitespace-pre-line ${c === 0 ? 'font-medium text-ink' : 'text-mid'}`}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function PrivacyPage() {
  const c = getServerLang() === 'ko' ? ko : en;

  return (
    <div className="flex-1">
      {/* Hero */}
      <div className="border-b border-divider bg-surface">
        <div className="max-w-[720px] mx-auto px-5 py-12 md:py-16">
          <Link href="/" className="inline-flex items-center gap-1.5 text-[12px] text-muted hover:text-ink transition mb-4">
            <ArrowLeft size={14} /> {c.back}
          </Link>
          <div className="flex items-center gap-3 mb-3">
            <Shield size={28} className="text-ink" strokeWidth={1.8} />
            <h1 className="text-[28px] md:text-[34px] font-extrabold text-ink tracking-tight">{c.title}</h1>
          </div>
          <p className="text-[13px] text-muted">{c.updated}</p>
        </div>
      </div>

      {/* Body */}
      <div className="max-w-[720px] mx-auto px-5 py-10 pb-20">
        <p className="text-[14px] leading-relaxed text-mid mb-10">{c.intro}</p>
        <div className="flex flex-col gap-8">
          {c.sections.map(({ icon: Icon, title, body }) => (
            <div key={title} className="flex gap-4">
              <div className="flex-shrink-0 mt-0.5">
                <div className="w-9 h-9 rounded-xl bg-surface border border-divider flex items-center justify-center">
                  <Icon size={16} strokeWidth={1.8} className="text-muted" />
                </div>
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="text-[15px] font-bold text-ink mb-2">{title}</h2>
                <div className="flex flex-col gap-3">{body.map(renderBlock)}</div>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-12 pt-8 border-t border-divider">
          <a
            href={`mailto:${EMAIL}`}
            className="inline-flex items-center gap-2 text-[13px] font-semibold text-ink border border-divider rounded-lg px-4 py-2 hover:bg-surface transition"
          >
            <Mail size={14} /> {EMAIL}
          </a>
        </div>
      </div>
    </div>
  );
}
