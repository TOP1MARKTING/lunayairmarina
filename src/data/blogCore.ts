/**
 * Server-safe blog types and default posts.
 * No browser APIs (window), CMS store, or import.meta dependencies.
 */

const gallery1 = "/images/gallery/gallery-01-marina.jpg";
const gallery2 = "/images/gallery/gallery-02-deck.jpg";
const yacht1 = "/images/fleet/fleet-01.jpg";
const aboutMarina = "/images/about/yacht_side_transom_landscape.png";

export type Localized = { en: string; ar: string };

export type BlogInline =
  { type: "text"; text: Localized } | { type: "keyword"; text: Localized; href: string };

export type BlogBlock =
  | { id: string; type: "paragraph"; spans: BlogInline[] }
  | { id: string; type: "heading"; level: 2 | 3; text: Localized }
  | { id: string; type: "image"; src: string; alt: Localized; caption?: Localized }
  | { id: string; type: "quote"; text: Localized };

export interface BlogPost {
  id: string;
  slug: string;
  title: Localized;
  excerpt: Localized;
  coverImage: string;
  coverAlt: Localized;
  author: Localized;
  publishedAt: string;
  updatedAt: string;
  status: "published" | "draft";
  seoTitle: Localized;
  seoDescription: Localized;
  focusKeyword: Localized;
  tags: Localized[];
  blocks: BlogBlock[];
  /** Optional category label (EN/AR) shown on the article */
  category?: Localized;
  /** Show in “trending / featured” surfaces when true */
  featured?: boolean;
}

export const BLOG_STORAGE_KEY = "lunayairmarina.blog.posts.v2";

export type BlogLanguage = "en" | "ar";

export function tx(value: Localized | string | undefined, language: BlogLanguage): string {
  if (!value) return "";
  if (typeof value === "string") return value;
  return value[language] || value.en || value.ar || "";
}

function L(en: string, ar: string): Localized {
  return { en, ar };
}

export const DEFAULT_BLOG_POSTS: BlogPost[] = [
  {
    id: "b1",
    slug: "yacht-management-red-sea-guide",
    title: L(
      "Complete Guide to Yacht Management in the Red Sea",
      "الدليل الشامل لإدارة اليخوت في البحر الأحمر",
    ),
    excerpt: L(
      "What yacht owners should expect from professional management across Jeddah, the Red Sea and the Arabian Gulf.",
      "ما الذي يتوقعه ملاك اليخوت من الإدارة الاحترافية في جدة والبحر الأحمر والخليج العربي.",
    ),
    coverImage: gallery2,
    coverAlt: L(
      "Aerial view of a marina with luxury yachts",
      "منظر جوي لمارينا مليء باليخوت الفاخرة",
    ),
    author: L("lunayairmarina Editorial", "فريق تحرير lunayairmarina"),
    publishedAt: "2026-06-12T09:00:00.000Z",
    updatedAt: "2026-07-20T11:00:00.000Z",
    status: "published",
    seoTitle: L(
      "Yacht Management in the Red Sea | lunayairmarina",
      "إدارة اليخوت في البحر الأحمر | lunayairmarina",
    ),
    seoDescription: L(
      "Learn how professional yacht management works in the Red Sea: maintenance, crew, compliance and owner reporting with lunayairmarina.",
      "تعرّف على إدارة اليخوت الاحترافية في البحر الأحمر: الصيانة والطواقم والامتثال والتقارير مع lunayairmarina.",
    ),
    focusKeyword: L("yacht management Red Sea", "إدارة اليخوت البحر الأحمر"),
    tags: [L("yacht management", "إدارة اليخوت"), L("Red Sea", "البحر الأحمر"), L("Jeddah", "جدة")],
    blocks: [
      {
        id: "b1-h1",
        type: "heading",
        level: 2,
        text: L(
          "Why Red Sea yacht management is different",
          "لماذا تختلف إدارة اليخوت في البحر الأحمر",
        ),
      },
      {
        id: "b1-p1",
        type: "paragraph",
        spans: [
          {
            type: "text",
            text: L(
              "Operating a private yacht between Jeddah and the Arabian Gulf requires more than a captain. Owners need structured ",
              "تشغيل يخت خاص بين جدة والخليج العربي يحتاج أكثر من قبطان. يحتاج الملاك إلى ",
            ),
          },
          {
            type: "keyword",
            text: L("yacht management", "إدارة يخوت"),
            href: "/services",
          },
          {
            type: "text",
            text: L(
              " covering technical supervision, crew payroll, berthing and transparent financial control.",
              " منظمة تغطي الإشراف الفني ورواتب الطاقم والرسو والرقابة المالية الشفافة.",
            ),
          },
        ],
      },
      {
        id: "b1-img1",
        type: "image",
        src: aboutMarina,
        alt: L("Luxury yacht berthed at dusk in a marina", "يخت فاخر راسٍ عند الغروب في المارينا"),
        caption: L(
          "Dedicated berthing and operations planning protect asset value.",
          "الرسو المخصص وتخطيط العمليات يحميان قيمة الأصول.",
        ),
      },
      {
        id: "b1-p2",
        type: "paragraph",
        spans: [
          { type: "text", text: L("At ", "في ") },
          { type: "keyword", text: L("lunayairmarina", "lunayairmarina"), href: "/about" },
          {
            type: "text",
            text: L(
              ", every vessel is assigned a dedicated manager, a documented maintenance programme and 24/7 marine response.",
              "، يُعيَّن لكل سفينة مدير مخصص وبرنامج صيانة موثّق واستجابة بحرية على مدار الساعة.",
            ),
          },
        ],
      },
      {
        id: "b1-h2",
        type: "heading",
        level: 2,
        text: L(
          "What Google-ready owners look for",
          "ما الذي يبحث عنه الملاك في المحتوى الاحترافي",
        ),
      },
      {
        id: "b1-p3",
        type: "paragraph",
        spans: [
          {
            type: "text",
            text: L(
              "Clear service pages, expert articles and internal links help owners discover trusted operators. Use focused keywords naturally, add descriptive image alt text, and keep publishing practical guides.",
              "صفحات الخدمات الواضحة والمقالات المتخصصة والروابط الداخلية تساعد الملاك على اكتشاف المشغّلين الموثوقين. استخدم الكلمات المفتاحية بشكل طبيعي، وأضف نصوصًا بديلة للصور، واستمر في نشر أدلة عملية.",
            ),
          },
        ],
      },
      {
        id: "b1-q1",
        type: "quote",
        text: L(
          "Discretion, precision and care are the standards that keep a yacht ready for every season.",
          "السرية والدقة والعناية هي المعايير التي تبقي اليخت جاهزًا لكل موسم.",
        ),
      },
    ],
  },
  {
    id: "b2",
    slug: "marina-operations-best-practices",
    title: L(
      "Marina Operations Best Practices for Visiting Yachts",
      "أفضل ممارسات عمليات المارينا لليخوت الزائرة",
    ),
    excerpt: L(
      "Agency support, berth allocation and concierge logistics for international yachts arriving in Saudi waters.",
      "دعم الوكالة وتخصيص المراسي ولوجستيات الكونسيرج لليخوت الدولية القادمة إلى المياه السعودية.",
    ),
    coverImage: yacht1,
    coverAlt: L(
      "White motor yacht cruising near marina docks",
      "يخت أبيض آلي يبحر قرب أرصفة المارينا",
    ),
    author: L("lunayairmarina Operations", "عمليات lunayairmarina"),
    publishedAt: "2026-05-03T10:30:00.000Z",
    updatedAt: "2026-05-03T10:30:00.000Z",
    status: "published",
    seoTitle: L(
      "Marina Operations for Visiting Yachts | lunayairmarina",
      "عمليات المارينا لليخوت الزائرة | lunayairmarina",
    ),
    seoDescription: L(
      "Best practices for visiting yacht agency services, marina berthing and logistics in Saudi Arabia with lunayairmarina.",
      "أفضل الممارسات لخدمات وكالة اليخوت الزائرة والرسو واللوجستيات في السعودية مع lunayairmarina.",
    ),
    focusKeyword: L("marina operations", "عمليات المارينا"),
    tags: [L("marina", "مارينا"), L("visiting yachts", "يخوت زائرة"), L("agency", "وكالة")],
    blocks: [
      {
        id: "b2-p1",
        type: "paragraph",
        spans: [
          {
            type: "text",
            text: L("Successful ", "تبدأ "),
          },
          {
            type: "keyword",
            text: L("marina operations", "عمليات المارينا"),
            href: "/services",
          },
          {
            type: "text",
            text: L(
              " start before the yacht arrives: permits, berth allocation, provisioning and crew coordination.",
              " الناجحة قبل وصول اليخت: التصاريح وتخصيص الرصيف والتموين وتنسيق الطاقم.",
            ),
          },
        ],
      },
      {
        id: "b2-img1",
        type: "image",
        src: gallery1,
        alt: L(
          "Jacuzzi sundeck overlooking open blue water",
          "جاكوزي على السطح المطل على المياه الزرقاء",
        ),
        caption: L(
          "Owner experience depends on seamless shore-side coordination.",
          "تجربة المالك تعتمد على تنسيق ساحلي سلس.",
        ),
      },
      {
        id: "b2-p2",
        type: "paragraph",
        spans: [
          {
            type: "text",
            text: L(
              "If you are planning a Red Sea season, speak with our team through the ",
              "إذا كنت تخطط لموسم في البحر الأحمر، تواصل مع فريقنا عبر ",
            ),
          },
          {
            type: "keyword",
            text: L("contact page", "صفحة التواصل"),
            href: "/contact",
          },
          {
            type: "text",
            text: L(" for a private consultation.", " للحصول على استشارة خاصة."),
          },
        ],
      },
    ],
  },
];