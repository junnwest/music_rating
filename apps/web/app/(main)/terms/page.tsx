import Link from 'next/link';
import type { LucideIcon } from 'lucide-react';
import {
  FileText, CheckCircle, AlertCircle, Music, AlertTriangle, ArrowLeft, Mail,
  User, BarChart3, Shield, Link2, Settings, Scale, Languages,
} from 'lucide-react';
import { getServerLang } from '../../../lib/i18n/server';

// A string is a paragraph; a string[] is a bulleted list.
type Block = string | string[];
type Section = { icon: LucideIcon; title: string; body: Block[] };

const EMAIL = 'admin@sillajuku.com';

const en: { title: string; updated: string; back: string; footer: [string, string, string]; sections: Section[] } = {
  title: 'Terms of Service',
  updated: 'Last updated: September 27, 2026',
  back: 'Back to home',
  footer: ['By using sillajuku, you agree to these terms and our ', 'Privacy Policy', '.'],
  sections: [
    {
      icon: CheckCircle,
      title: '1. Acceptance and Changes to These Terms',
      body: [
        'These Terms govern your use of sillajuku, including the website, the iOS app, and related features (the "Service"). By creating an account or using the Service, you agree to these Terms. If you do not agree, please do not use the Service.',
        'We may amend these Terms to the extent permitted by applicable law. We will post the amended Terms, with their effective date, at least 7 days before they take effect, or at least 30 days before for changes that are material or unfavorable to you, which we will also announce by email or in-app notice.',
        'If you do not agree to the amended Terms, you may stop using the Service and delete your account. If we clearly told you that not objecting before the effective date would count as acceptance, and you do not object, you will be treated as having accepted the amended Terms.',
      ],
    },
    {
      icon: User,
      title: '2. Your Account',
      body: [
        'You must be at least 14 years old, or the minimum age of digital consent in your country if higher. We do not accept users below that age. You agree to provide accurate information when registering and to keep it current.',
        'You are responsible for keeping your login credentials confidential and for all activity under your account. You may not sell, transfer, or lend your account to anyone else. If you learn that your account has been used without permission, notify us right away.',
        'We may refuse or later cancel a registration that uses false or someone else\'s information, comes from a user previously removed under these Terms, is created in bulk or by automated means, or is intended for improper use of the Service.',
      ],
    },
    {
      icon: Music,
      title: '3. Your Content and the License You Give Us',
      body: [
        '"User Content" means anything you post or submit on the Service, including ratings, reviews, comments, Mixes, lists, tier lists, and profile information. You keep the copyright in your User Content, and you are responsible for it.',
        'By posting User Content, you grant sillajuku a worldwide, non-exclusive, royalty-free license to use, host, store, reproduce, modify, adapt, edit, translate, excerpt, create derivative works of, publish, publicly display, perform, transmit, and distribute it, in any media or format now known or later developed. We may sublicense these rights only to service providers who help us operate the Service, and only for that purpose. We may use it to operate, display, and improve the Service, to promote sillajuku, and for statistics, research, and developing new features and services. This includes, for example:',
        [
          'reformatting, resizing, shortening, excerpting, or translating your content so it fits a layout, device, or language, for example in previews, notifications, and share images;',
          'featuring your content in curated or editorial selections, charts, highlights, and year-in-review features;',
          'reproducing and displaying your content on other channels we or our partners operate, such as our social media accounts, newsletters, and app store pages;',
          'giving your content to press and media outlets so they can report on sillajuku.',
        ],
        `We respect your privacy settings. We will not use content from a private account in promotion outside the Service. When we feature your content outside the Service, we may credit you by your username, but we will not share any other personal information without your consent. You can opt out of promotion outside the Service at any time with the "Feature my ratings on sillajuku's social media" switch in Settings or by emailing ${EMAIL}; after that we will not use your content in new promotional material, and if you ask we will remove or de-identify material already published. You will not be paid for any use of your User Content.`,
        'This license lasts until you delete the content or your account. After that we will not make new uses of it, except that (a) copies may stay in backups for a limited time, (b) apart from the removal described above, we do not have to withdraw promotional material that was already published, (c) Aggregated Data (Section 4) is not affected, and (d) we are not responsible for copies that other users or third parties have quoted, saved, or re-shared.',
        'You confirm that you have all the rights needed to post your User Content and to grant this license, and that it does not infringe anyone\'s copyright, privacy, reputation, or other rights. You are responsible for any legal liability arising from your User Content. If you send us feedback or suggestions, we may use them freely without any obligation to you.',
      ],
    },
    {
      icon: BarChart3,
      title: '4. Ratings, Aggregated Data, and Analysis',
      body: [
        'sillajuku works by learning from activity across the Service. We analyze ratings, reviews, listening data you choose to import, and how the Service is used to produce aggregate scores, rankings, charts, statistics, recommendations, and taste insights, and to build and improve our features, including our recommendation and taste-analysis systems.',
        'The data we create by aggregating, analyzing, or de-identifying User Content and activity ("Aggregated Data") belongs entirely to sillajuku. We may use, publish, and share Aggregated Data for any purpose, as long as it does not identify you, and it stays in place after you delete your content or account. Our Privacy Policy explains how we handle your personal information.',
      ],
    },
    {
      icon: AlertCircle,
      title: '5. Prohibited Conduct',
      body: [
        'You may not:',
        [
          'give false information, use someone else\'s information, or pretend to be another person, sillajuku, or its staff;',
          'manipulate ratings, rankings, or charts, for example by using fake or duplicate accounts, organizing coordinated rating campaigns, or buying or selling ratings, follows, or likes;',
          'crawl, scrape, collect, extract, or copy data or content from the Service, by automated or manual means, or sell or redistribute it, without our written permission. This includes using it to train machine-learning or AI models;',
          'infringe the intellectual property, privacy, or other rights of sillajuku or anyone else;',
          'insult, harass, threaten, or defame others, or post hateful content;',
          'post obscene, violent, or illegal content, spam, or unsolicited advertising;',
          'gain unauthorized access, hack, spread malware, or interfere with the Service or its infrastructure;',
          'use the Service for commercial or promotional purposes without our permission;',
          'otherwise violate applicable law.',
        ],
      ],
    },
    {
      icon: Shield,
      title: '6. Moderation, Takedowns, and Enforcement',
      body: [
        'We may use automated systems and human review to detect profanity, spam, and violations of these Terms. We may hide, restrict, or remove User Content that violates these Terms, our policies, or the law, or that there is good reason to believe infringes someone\'s rights. We may do this even when no one has reported it, including temporary measures allowed by applicable law.',
        `If you believe content on sillajuku infringes your copyright or other rights, send a written notice to ${EMAIL} that includes: (1) a description of the work or right you say is infringed; (2) the URL or location of the material; (3) your name, address, phone number, and email; (4) a statement that you believe in good faith the use is not authorized by the rights holder, its agent, or the law; (5) a statement, under penalty of perjury, that the notice is accurate and that you are authorized to act for the rights holder; and (6) your physical or electronic signature. We will handle valid notices under applicable law, including Korea's Act on Promotion of Information and Communications Network Utilization and Information Protection and the U.S. DMCA.`,
        'Depending on how serious a violation is, we may warn you, remove content, restrict features, suspend your account for a period, or terminate it. We will normally notify you first. For serious illegal conduct, such as hacking, distributing malware, or large-scale infringement, we may suspend your account permanently without notice. We will terminate the accounts of repeat infringers.',
        `If you believe an action was a mistake, you can appeal by contacting ${EMAIL}. If we agree, we will restore your account or content promptly.`,
      ],
    },
    {
      icon: Music,
      title: '7. Music Data',
      body: [
        'Music metadata, cover art, and related information come from a combination of third-party catalogs and databases, including MusicBrainz (released under a CC0 public-domain dedication), the Cover Art Archive, Deezer, Last.fm, and Apple/iTunes. We are not affiliated with, endorsed by, or sponsored by any of these services. Album artwork, artist images, and metadata remain the property of their respective rights holders and are used for informational cataloging purposes. We do not guarantee that this information is accurate or complete.',
      ],
    },
    {
      icon: Link2,
      title: '8. Connected Services',
      body: [
        'You may choose to connect third-party services such as Spotify to import listening data and personalize your experience. Your use of those services is still governed by their own terms and privacy policies, and you are responsible for following them. You can disconnect a service at any time. Disconnecting stops future imports and, if you ask, removes the imported data from your account.',
      ],
    },
    {
      icon: Settings,
      title: '9. The Service and Changes to It',
      body: [
        'We may add, change, or discontinue features, designs, or parts of the Service when needed. We may also pause the Service temporarily for maintenance, equipment replacement, outages, or other operational reasons. Where practical, we will give notice in advance. Where that is not possible, we will give it afterward. We will announce changes that are unfavorable to you by email or in-app notice. We do not provide compensation when free features change or end.',
        'We may send you emails the Service needs, such as account verification, security alerts, and notices of important changes, whatever your email preferences are. You can opt out of optional updates at any time in Settings.',
        'These Terms do not give you any right to use the sillajuku name, logo, trademarks, or other brand features.',
      ],
    },
    {
      icon: FileText,
      title: '10. Account Deletion and Termination',
      body: [
        'You may delete your account at any time from Settings. When you do, your User Content is deleted as described in our Privacy Policy. This does not apply to Aggregated Data, content that another user co-created or has copied, or records we must keep by law.',
        'If an account was removed for violating these Terms or the law, we may keep its identifier and related records for as long as the law allows, to protect other users, prevent re-registration, and respond to requests from courts or authorities.',
      ],
    },
    {
      icon: AlertTriangle,
      title: '11. Disclaimers and Limitation of Liability',
      body: [
        'The Service is provided "as is" and "as available," without warranties of any kind. We do not guarantee that the Service will be uninterrupted or error-free. Ratings and reviews are the personal opinions of individual users, not ours, and we do not guarantee that any information on the Service is accurate or reliable.',
        'We are not responsible for disputes between users, or between users and third parties, that arise through the Service. We are also not responsible for failures caused by events beyond our reasonable control, such as natural disasters, telecom outages, or third-party login failures, or for losses caused by your own failure to follow these Terms or to keep your credentials secure.',
        'To the fullest extent permitted by law, we are not liable for indirect, incidental, special, or consequential damages, or for lost data or profits. Nothing in these Terms limits our liability for our own intentional misconduct or gross negligence, or any liability that cannot be limited by law.',
      ],
    },
    {
      icon: Scale,
      title: '12. Governing Law and Jurisdiction',
      body: [
        'These Terms are governed by the laws of the Republic of Korea. Any lawsuit between you and sillajuku will be filed with the court that has jurisdiction under the Civil Procedure Act of the Republic of Korea. Nothing in these Terms takes away the mandatory consumer protections of the law of the country where you live.',
      ],
    },
    {
      icon: Languages,
      title: '13. Language',
      body: [
        'These Terms are available in Korean and English. If the two versions conflict, the Korean version prevails to the extent permitted by applicable law.',
      ],
    },
    {
      icon: Mail,
      title: '14. Contact',
      body: [`sillajuku is operated by a sole proprietor registered in the Republic of Korea. For legal questions, contact ${EMAIL}.`],
    },
  ],
};

const ko: typeof en = {
  title: '이용약관',
  updated: '최종 수정일: 2026년 9월 27일',
  back: '홈으로',
  footer: ['sillajuku를 이용하면 본 약관 및 ', '개인정보처리방침', '에 동의하는 것으로 봅니다.'],
  sections: [
    {
      icon: CheckCircle,
      title: '제1조 (약관의 동의 및 개정)',
      body: [
        '본 약관은 sillajuku(이하 "회사")가 제공하는 웹사이트, iOS 앱 및 관련 제반 서비스(이하 "서비스")의 이용에 관한 조건을 정합니다. 회원은 계정을 생성하거나 서비스를 이용함으로써 본 약관에 동의하게 되며, 동의하지 않는 경우 서비스를 이용하지 마시기 바랍니다.',
        '회사는 관련 법령에 위배되지 않는 범위에서 본 약관을 개정할 수 있습니다. 개정 약관은 적용일자 7일 전부터 적용일자와 함께 게시하며, 회원에게 불리하거나 중요한 변경의 경우에는 적용일자 30일 전부터 게시하고 전자우편 또는 서비스 내 공지로 알립니다.',
        '회원은 개정 약관에 동의하지 않을 경우 서비스 이용을 중단하고 탈퇴할 수 있습니다. 회사가 적용일자까지 거부 의사를 표시하지 않으면 동의한 것으로 본다는 뜻을 명확히 고지하였음에도 회원이 거부 의사를 표시하지 않은 경우, 회원은 개정 약관에 동의한 것으로 봅니다.',
      ],
    },
    {
      icon: User,
      title: '제2조 (회원 계정)',
      body: [
        '회원은 만 14세 이상이어야 하며, 거주 국가의 디지털 동의 최소 연령이 더 높은 경우 그 연령 이상이어야 합니다. 해당 연령 미만인 경우 가입할 수 없습니다. 회원은 가입 시 정확한 정보를 제공하고, 변경 사항이 있으면 이를 최신으로 유지해야 합니다.',
        '회원은 자신의 로그인 정보를 안전하게 관리할 책임이 있으며, 계정에서 이루어지는 모든 활동에 대해 책임을 집니다. 회원은 계정을 제3자에게 판매, 양도, 대여할 수 없으며, 계정이 무단으로 사용되고 있음을 알게 된 경우 즉시 회사에 알려야 합니다.',
        '회사는 허위 정보나 타인의 정보를 이용한 신청, 본 약관에 따라 이용 자격을 상실한 적이 있는 자의 신청, 자동화된 방법 등으로 계정을 대량 생성하는 경우, 부정한 용도로 서비스를 이용하려는 경우에는 가입을 승낙하지 않거나 사후에 이용계약을 해지할 수 있습니다.',
      ],
    },
    {
      icon: Music,
      title: '제3조 (게시물의 권리와 이용 허락)',
      body: [
        '"게시물"이란 회원이 서비스에 게시하거나 제출한 평점, 리뷰, 댓글, 믹스, 리스트, 티어리스트, 프로필 정보 등 일체의 콘텐츠를 말합니다. 게시물의 저작권은 이를 작성한 회원에게 있으며, 게시물에 대한 책임 또한 회원에게 있습니다.',
        '회원은 게시물을 등록함으로써 회사에게 해당 게시물을 현재 알려져 있거나 향후 개발되는 모든 매체와 형식으로 이용, 저장, 복제, 수정, 편집, 번역, 발췌, 2차적 저작물 작성, 게시, 전시, 공연, 전송, 배포, 공중송신할 수 있는 전 세계적이고 비독점적이며 무상인 권리를 허락합니다. 회사는 서비스 운영을 돕는 수탁자에게 그 목적의 범위에서만 이 권리를 재허락할 수 있습니다. 회사는 이를 서비스의 운영, 노출 및 개선, 서비스 홍보, 통계 조사·연구 및 새로운 기능과 서비스의 개발을 위해 이용할 수 있으며, 여기에는 다음과 같은 이용 형태가 포함되나 이에 한정되지 않습니다.',
        [
          '미리보기, 알림, 공유 이미지 등 화면 구성이나 기기, 언어에 맞도록 게시물의 형식을 변경하거나 크기를 조정·축약·발췌·번역하는 것',
          '큐레이션 및 에디토리얼 콘텐츠, 차트, 하이라이트, 연말 결산 등의 기능에 게시물을 소개하는 것',
          '회사의 소셜 미디어 계정, 뉴스레터, 앱스토어 페이지 등 회사 또는 제휴사가 운영하는 다른 채널에 게시물을 복제·전시하는 것',
          '서비스 홍보를 위해 언론 및 미디어에 게시물의 내용을 제공하여 보도하게 하는 것',
        ],
        `회사는 회원의 공개 설정을 존중하며, 비공개 계정의 게시물은 서비스 외부의 홍보에 사용하지 않습니다. 서비스 외부에서 게시물을 소개하는 경우 회원의 사용자 이름을 출처로 표시할 수 있으나, 회원의 별도 동의 없이 그 밖의 회원정보를 제공하지 않습니다. 회원은 언제든지 설정의 "sillajuku 소셜 미디어에 내 평가 소개 허용"을 끄거나 ${EMAIL}로 요청하여 자신의 게시물을 서비스 외부 홍보에 사용하지 않도록 할 수 있으며, 회사는 이후 새로 제작하는 홍보물에 해당 게시물을 사용하지 않고, 요청이 있으면 이미 게시된 홍보물에서도 삭제하거나 회원을 알아볼 수 없도록 수정합니다. 회원은 게시물의 이용에 대해 별도의 대가를 청구하지 않습니다.`,
        '본 조의 이용 허락은 회원이 해당 게시물을 삭제하거나 탈퇴할 때까지 유지됩니다. 삭제 또는 탈퇴 이후 회사는 해당 게시물을 새롭게 이용하지 않습니다. 다만 (가) 백업 데이터에 일정 기간 사본이 남을 수 있고, (나) 위에서 정한 삭제 요청의 경우를 제외하고 이미 제작·게시된 홍보물을 회수할 의무는 없으며, (다) 제4조의 집계 데이터에는 영향이 없고, (라) 다른 회원이나 제3자가 인용, 저장, 재공유한 사본에 대해서는 회사가 책임을 지지 않습니다.',
        '회원은 게시물을 등록하고 본 조의 권리를 허락하는 데 필요한 모든 권리를 보유하고 있으며, 게시물이 타인의 저작권, 개인정보, 명예 등 권리를 침해하지 않음을 보증합니다. 게시물로 인하여 발생하는 민·형사상 책임은 회원에게 있습니다. 회원이 회사에 제공한 의견이나 제안은 회사가 별도의 의무 없이 자유롭게 활용할 수 있습니다.',
      ],
    },
    {
      icon: BarChart3,
      title: '제4조 (평점, 집계 데이터 및 분석)',
      body: [
        'sillajuku는 서비스 전반의 활동을 바탕으로 작동합니다. 회사는 평점, 리뷰, 회원이 연동하여 가져온 청취 데이터 및 서비스 이용 기록을 분석하여 종합 점수, 랭킹, 차트, 통계, 추천 및 취향 분석 정보를 만들고, 추천 및 취향 분석 시스템을 포함한 서비스 기능을 개발하고 개선합니다.',
        '회사가 게시물과 이용 기록을 집계, 분석 또는 비식별 처리하여 만들어 낸 데이터(이하 "집계 데이터")에 대한 권리는 전적으로 회사에 있습니다. 회사는 회원 개인을 식별할 수 없는 범위에서 집계 데이터를 목적에 제한 없이 이용, 공개, 제공할 수 있으며, 집계 데이터는 회원이 게시물을 삭제하거나 탈퇴한 후에도 유지됩니다. 개인정보의 처리에 관하여는 개인정보처리방침이 적용됩니다.',
      ],
    },
    {
      icon: AlertCircle,
      title: '제5조 (금지 행위)',
      body: [
        '회원은 다음 각 호의 행위를 해서는 안 됩니다.',
        [
          '허위 정보를 등록하거나, 타인의 정보를 도용하거나, 타인, 회사 또는 회사의 운영자·임직원을 사칭하는 행위',
          '허위 또는 중복 계정의 사용, 조직적인 평점 몰이, 평점·팔로우·좋아요의 매매 등으로 평점, 랭킹 또는 차트를 조작하는 행위',
          '회사의 서면 허락 없이 자동 또는 수동 방식으로 서비스의 데이터나 콘텐츠를 크롤링, 스크래핑, 수집, 추출, 복제하거나 이를 판매·재배포하는 행위(머신러닝·AI 모델 학습에 이용하는 행위를 포함합니다)',
          '회사 또는 제3자의 지적재산권, 개인정보 등 권리를 침해하는 행위',
          '타인을 모욕, 비방, 희롱, 위협하거나 명예를 훼손하는 행위 또는 혐오 표현을 게시하는 행위',
          '음란하거나 폭력적인 정보, 불법 정보, 스팸 또는 광고성 정보를 게시하는 행위',
          '무단 접근, 해킹, 악성 프로그램 유포 등 서비스 또는 그 설비의 정상적인 운영을 방해하는 행위',
          '회사의 허락 없이 서비스를 영업·광고 등 상업적 목적으로 이용하는 행위',
          '기타 관계 법령에 위반되는 행위',
        ],
      ],
    },
    {
      icon: Shield,
      title: '제6조 (게시물의 관리 및 이용 제한)',
      body: [
        '회사는 자동화된 시스템과 사람의 검토를 통해 욕설, 스팸 및 본 약관 위반 행위를 모니터링할 수 있으며, 본 약관, 회사 정책 또는 관계 법령에 위반되거나 권리 침해가 인정될 만한 사유가 있는 게시물에 대해서는 신고가 없더라도 비공개, 노출 제한, 삭제 또는 관계 법령에 따른 임시조치를 할 수 있습니다.',
        `게시물이 자신의 저작권 등 권리를 침해한다고 판단하는 권리자는 ${EMAIL}로 다음 사항을 포함한 서면 요청을 보낼 수 있습니다: (1) 침해되었다고 주장하는 저작물 또는 권리에 대한 설명, (2) 해당 게시물의 URL 또는 위치, (3) 요청인의 이름, 주소, 전화번호, 전자우편 주소, (4) 해당 이용이 권리자, 그 대리인 또는 법률에 의해 허락되지 않았다고 선의로 믿는다는 진술, (5) 요청 내용이 정확하며 요청인이 권리자를 대리할 권한이 있다는 진술, (6) 요청인의 서명 또는 전자서명. 회사는 정보통신망 이용촉진 및 정보보호 등에 관한 법률, 저작권법 및 미국 DMCA 등 관계 법령에 따라 조치합니다.`,
        '회사는 위반 행위의 경중에 따라 경고, 게시물 삭제, 기능 제한, 기간을 정한 이용 정지 또는 이용계약 해지 등의 조치를 할 수 있으며, 원칙적으로 사전에 통지합니다. 다만 해킹, 악성 프로그램 유포, 대규모 권리 침해 등 관계 법령을 중대하게 위반한 경우에는 사전 통지 없이 즉시 영구 이용 정지를 할 수 있으며, 반복적인 권리 침해자의 계정은 해지합니다.',
        `회원은 이러한 조치에 대해 ${EMAIL}로 이의신청을 할 수 있으며, 회사가 이의가 정당하다고 인정하는 경우 즉시 계정 또는 게시물을 복구합니다.`,
      ],
    },
    {
      icon: Music,
      title: '제7조 (음악 데이터)',
      body: [
        '음악 메타데이터, 앨범 아트 및 관련 정보는 MusicBrainz(CC0 퍼블릭 도메인), Cover Art Archive, Deezer, Last.fm, Apple/iTunes 등 제3자 카탈로그와 데이터베이스에서 제공받습니다. 회사는 이들 서비스와 제휴하거나 이들로부터 보증 또는 후원을 받고 있지 않습니다. 앨범 아트, 아티스트 이미지 및 메타데이터의 권리는 각 권리자에게 있으며, 정보 제공 및 카탈로그 목적으로 이용됩니다. 회사는 해당 정보의 정확성이나 완전성을 보증하지 않습니다.',
      ],
    },
    {
      icon: Link2,
      title: '제8조 (연동 서비스)',
      body: [
        '회원은 Spotify 등 제3자 서비스를 연동하여 청취 데이터를 가져오고 맞춤 경험을 받을 수 있습니다. 해당 서비스의 이용에는 각 서비스의 약관과 개인정보처리방침이 적용되며, 회원은 이를 준수할 책임이 있습니다. 회원은 언제든지 연동을 해제할 수 있으며, 연동을 해제하면 이후의 데이터 가져오기가 중단되고, 요청 시 계정에 저장된 연동 데이터가 삭제됩니다.',
      ],
    },
    {
      icon: Settings,
      title: '제9조 (서비스의 제공 및 변경)',
      body: [
        '회사는 필요한 경우 서비스의 기능, 디자인 또는 일부를 추가, 변경 또는 중단할 수 있으며, 설비의 보수점검, 교체, 장애 또는 운영상 상당한 이유가 있는 경우 서비스 제공을 일시적으로 중단할 수 있습니다. 가능한 경우 사전에 공지하며, 부득이한 사유가 있는 경우 사후에 공지할 수 있습니다. 회원에게 불리한 변경은 전자우편 또는 서비스 내 공지로 알립니다. 무료로 제공되는 서비스의 변경 또는 중단에 대해서는 별도로 보상하지 않습니다.',
        '회사는 계정 인증, 보안 알림, 중요한 변경 사항 안내 등 서비스 이용에 필요한 정보를 회원의 수신 설정과 관계없이 전자우편으로 보낼 수 있습니다. 선택적인 소식은 설정에서 언제든지 수신을 거부할 수 있습니다.',
        '본 약관은 회원에게 sillajuku의 명칭, 로고, 상표 등 브랜드 요소를 사용할 권리를 부여하지 않습니다.',
      ],
    },
    {
      icon: FileText,
      title: '제10조 (탈퇴 및 이용계약의 해지)',
      body: [
        '회원은 언제든지 설정에서 탈퇴할 수 있습니다. 탈퇴 시 회원의 게시물은 개인정보처리방침에 따라 삭제됩니다. 다만 집계 데이터, 다른 회원과 공동으로 작성되었거나 다른 회원이 복제한 콘텐츠, 관계 법령에 따라 보관해야 하는 기록은 예외로 합니다.',
        '본 약관 또는 관계 법령 위반으로 이용계약이 해지된 경우, 회사는 다른 회원 보호, 재가입 방지 및 법원·수사기관 등의 요청 대응을 위해 관계 법령이 허용하는 범위에서 해당 계정의 식별 정보와 관련 기록을 보관할 수 있습니다.',
      ],
    },
    {
      icon: AlertTriangle,
      title: '제11조 (책임의 제한)',
      body: [
        '서비스는 "있는 그대로" 제공되며, 회사는 서비스가 중단 없이 또는 오류 없이 제공된다는 점을 보증하지 않습니다. 평점과 리뷰는 개별 회원의 의견이며 회사의 의견이 아니고, 회사는 서비스에 게재된 정보의 정확성이나 신뢰성을 보증하지 않습니다.',
        '회사는 서비스를 매개로 회원 간 또는 회원과 제3자 간에 발생한 분쟁에 대해 책임을 지지 않습니다. 또한 천재지변, 기간통신사업자의 서비스 중지, 제3자 로그인 인증 장애 등 회사가 합리적으로 통제할 수 없는 사유로 인한 장애나, 약관 미준수 또는 로그인 정보 관리 소홀 등 회원의 귀책사유로 발생한 손해에 대해 책임을 지지 않습니다.',
        '관계 법령이 허용하는 최대한의 범위에서, 회사는 간접적, 부수적, 특별 또는 결과적 손해나 데이터 또는 이익의 손실에 대해 책임을 지지 않습니다. 다만 회사의 고의 또는 중대한 과실로 인한 손해나 법령상 제한할 수 없는 책임은 그러하지 아니합니다.',
      ],
    },
    {
      icon: Scale,
      title: '제12조 (준거법 및 재판관할)',
      body: [
        '본 약관은 대한민국 법률을 준거법으로 합니다. 회사와 회원 간에 발생한 분쟁에 관한 소송은 민사소송법상의 관할법원에 제기합니다. 본 약관의 어떠한 내용도 회원이 거주하는 국가의 법률이 보장하는 강행적인 소비자 보호 권리를 제한하지 않습니다.',
      ],
    },
    {
      icon: Languages,
      title: '제13조 (언어)',
      body: [
        '본 약관은 한국어와 영어로 제공되며, 두 버전의 내용이 서로 다른 경우 관계 법령이 허용하는 범위에서 한국어 버전이 우선합니다.',
      ],
    },
    {
      icon: Mail,
      title: '제14조 (문의)',
      body: [`sillajuku는 대한민국의 개인사업자가 운영합니다. 법률 관련 문의는 ${EMAIL}로 연락해 주시기 바랍니다.`],
    },
  ],
};

export default function TermsPage() {
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
            <FileText size={28} className="text-ink" strokeWidth={1.8} />
            <h1 className="text-[28px] md:text-[34px] font-extrabold text-ink tracking-tight">{c.title}</h1>
          </div>
          <p className="text-[13px] text-muted">{c.updated}</p>
        </div>
      </div>

      {/* Body */}
      <div className="max-w-[720px] mx-auto px-5 py-10 pb-20">
        <div className="flex flex-col gap-8">
          {c.sections.map(({ icon: Icon, title, body }) => (
            <div key={title} className="flex gap-4">
              <div className="flex-shrink-0 mt-0.5">
                <div className="w-9 h-9 rounded-xl bg-surface border border-divider flex items-center justify-center">
                  <Icon size={16} strokeWidth={1.8} className="text-muted" />
                </div>
              </div>
              <div className="min-w-0">
                <h2 className="text-[15px] font-bold text-ink mb-2">{title}</h2>
                <div className="flex flex-col gap-3">
                  {body.map((block, i) =>
                    typeof block === 'string' ? (
                      <p key={i} className="text-[14px] leading-relaxed text-mid">{block}</p>
                    ) : (
                      <ul key={i} className="list-disc pl-5 flex flex-col gap-1.5">
                        {block.map((item, j) => (
                          <li key={j} className="text-[14px] leading-relaxed text-mid">{item}</li>
                        ))}
                      </ul>
                    ),
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-12 pt-8 border-t border-divider">
          <p className="text-[13px] text-muted">
            {c.footer[0]}
            <Link href="/privacy" className="text-ink underline hover:opacity-70">{c.footer[1]}</Link>
            {c.footer[2]}
          </p>
        </div>
      </div>
    </div>
  );
}
