import React, { useState } from 'react';
import {
  Award,
  BarChart3,
  Building2,
  CalendarClock,
  Camera,
  CheckCircle2,
  Cloud,
  FileText,
  Globe,
  Headphones,
  Info,
  Lock,
  Mail,
  MapPin,
  MessageCircle,
  Package,
  Phone,
  Printer,
  Shield,
  ShieldCheck,
  Sparkles,
  Users,
} from 'lucide-react';
import type { Lang } from '../i18n';

interface AboutViewProps {
  lang: Lang;
}

type PolicyTab = 'terms' | 'privacy' | 'security';

const KEY_FEATURES = [
  {
    icon: Printer,
    title: 'দ্রুত বিলিং ও ইনভয়েসিং',
    desc: 'কয়েক সেকেন্ডের মধ্যে পস (POS) রিসিট ও ইনভয়েস তৈরি ও প্রিন্ট করার সুবিধা।',
  },
  {
    icon: Camera,
    title: 'স্মার্ট বারকোড স্ক্যানার',
    desc: 'মোবাইল ক্যামেরা বা এক্সটার্নাল স্ক্যানার দিয়ে দ্রুত পণ্য স্ক্যানিং।',
  },
  {
    icon: Package,
    title: 'স্টক ও ইনভেন্টরি ম্যানেজমেন্ট',
    desc: 'পণ্যের মজুদ, মেয়াদোত্তীর্ণের তারিখ এবং লো-স্টক অ্যালার্ট।',
  },
  {
    icon: BarChart3,
    title: 'দৈনিক হিসাব ও রিপোর্ট',
    desc: 'প্রতিদিনের বিক্রয়, খরচ এবং নিট লাভ-ক্ষতির স্বয়ংক্রিয় রিপোর্ট।',
  },
  {
    icon: Users,
    title: 'কাস্টমার ও সাপ্লায়ার ম্যানেজমেন্ট',
    desc: 'বাকি-বকেয়ার হিসাব এবং কাস্টমারের ক্রয় ইতিহাস সংরক্ষণ।',
  },
  {
    icon: Cloud,
    title: 'ক্লাউড ব্যাকআপ ও অফলাইন মোড',
    desc: 'ইন্টারনেট ছাড়াও কাজ করার সুবিধা এবং স্বয়ংক্রিয় ক্লাউড ব্যাকআপ।',
  },
];

const POLICY_SECTIONS: Record<
  PolicyTab,
  {
    label: string;
    subtitle: string;
    items: Array<{ title: string; detail: string }>;
  }
> = {
  terms: {
    label: 'ব্যবহারের শর্তাবলি (Terms & Conditions)',
    subtitle: 'এটি ব্যবহারকারী এবং সফটওয়্যার প্রতিষ্ঠানের মধ্যকার আইনি চুক্তি:',
    items: [
      {
        title: 'সেবা গ্রহণের যোগ্যতা ও অ্যাকাউন্ট নিরাপত্তা',
        detail:
          'ব্যবহারকারীকে সঠিক তথ্য দিয়ে অ্যাকাউন্ট খুলতে হবে এবং নিজের ইউজারনেম ও পাসওয়ার্ডের গোপনীয়তা রক্ষার দায়িত্ব ব্যবহারকারীর নিজের।',
      },
      {
        title: 'সফটওয়্যারের সঠিক ব্যবহার',
        detail:
          'সফটওয়্যারটি শুধুমাত্র বৈধ ব্যবসা পরিচালনার কাজে ব্যবহার করতে হবে। কোনো বেআইনি পণ্য বিক্রি বা অবৈধ লেনদেনের হিসাব রাখতে এটি ব্যবহার করা যাবে না।',
      },
      {
        title: 'সাবস্ক্রিপশন ও পেমেন্ট নীতি',
        detail:
          'মাসিক বা বাৎসরিক ফি পরিশোধের নিয়ম, মেয়াদ শেষ হলে অ্যাকাউন্ট সাময়িক স্থগিত হওয়ার শর্ত এবং রিফান্ড পলিসি (টাকা ফেরতের নিয়মাবলি) প্রযোজ্য।',
      },
      {
        title: 'মেধাস্বত্ব (Intellectual Property)',
        detail:
          '"আমার পস" সফটওয়্যারের লোগো, ডিজাইন, সোর্স কোড এবং ফিচারের সম্পূর্ণ মালিকানা ডেভেলপার প্রতিষ্ঠানের। অনুমতি ছাড়া তা কপি বা পরিবর্তন করা দণ্ডনীয়।',
      },
      {
        title: 'দায়বদ্ধতার সীমাবদ্ধতা (Limitation of Liability)',
        detail:
          'ইন্টারনেট সংযোগ বিচ্ছিন্নতা বা ব্যবহারকারীর ডিভাইসের ত্রুটির কারণে সাময়িক কোনো অসুবিধা হলে প্রতিষ্ঠান দায়ী থাকবে না (তবে অফলাইন মোড ও অটো-সিঙ্ক সুবিধা সচল রয়েছে)।',
      },
    ],
  },
  privacy: {
    label: 'গোপনীয়তা নীতি (Privacy Policy)',
    subtitle: 'ব্যবহারকারীর ব্যক্তিগত এবং ব্যবসার তথ্য কীভাবে সংগ্রহ ও ব্যবহার করা হয়:',
    items: [
      {
        title: 'কী কী তথ্য সংগ্রহ করা হয়',
        detail:
          'রেজিস্ট্রেশনের সময় ব্যবসার নাম, মালিকের নাম, মোবাইল নম্বর, ইমেইল, ঠিকানা এবং সফটওয়্যারে এন্ট্রি করা বেচাকেনা ও স্টকের তথ্য।',
      },
      {
        title: 'তথ্য ব্যবহারের উদ্দেশ্য',
        detail:
          'সংগৃহীত তথ্য শুধুমাত্র সফটওয়্যারের সেবা প্রদান, কাস্টমার সাপোর্ট দেওয়া, রিপোর্ট তৈরি এবং সফটওয়্যারের মানোন্নয়নের কাজে ব্যবহৃত হবে।',
      },
      {
        title: 'তৃতীয় পক্ষের সাথে তথ্য শেয়ার না করা',
        detail:
          'ব্যবহারকারীর অনুমতি বা আদালতের বৈধ নির্দেশ ছাড়া কোনো তৃতীয় পক্ষ (Third Party) বা বিজ্ঞাপনদাতার কাছে ব্যবসার কোনো তথ্য বিক্রি বা হস্তান্তর করা হবে না।',
      },
      {
        title: 'তথ্য মুছে ফেলার অধিকার (Data Deletion)',
        detail:
          'ব্যবহারকারী চাইলে যেকোনো সময় তার অ্যাকাউন্ট বন্ধ করে সার্ভার থেকে ব্যবসার সমস্ত তথ্য স্থায়ীভাবে মুছে ফেলার অনুরোধ করতে পারবেন।',
      },
    ],
  },
  security: {
    label: 'ডেটা নিরাপত্তা নীতিমালা (Data Security Policy)',
    subtitle: 'ব্যবসার আর্থিক হিসাব সুরক্ষিত রাখতে আমাদের গৃহীত নিরাপত্তা ব্যবস্থাসমূহ:',
    items: [
      {
        title: 'ডেটা এনক্রিপশন (Encryption)',
        detail:
          'ব্যবহারকারীর ডিভাইস থেকে সার্ভারে তথ্য আদান-প্রদানের সময় SSL/TLS এনক্রিপশন এবং ডেটাবেজে সংরক্ষণের সময় AES-256 এনক্রিপশন ব্যবহার করা হয়, যাতে কেউ তথ্য হ্যাক বা পড়তে না পারে।',
      },
      {
        title: 'স্বয়ংক্রিয় ক্লাউড ব্যাকআপ',
        detail:
          'কোনো কারণে ব্যবহারকারীর মোবাইল বা কম্পিউটার নষ্ট হয়ে গেলে বা হারিয়ে গেলে যেন ব্যবসার হিসাব না হারায়, সেজন্য প্রতিদিন স্বয়ংক্রিয়ভাবে নিরাপদ ক্লাউড সার্ভারে ব্যাকআপ রাখা হয়।',
      },
      {
        title: 'অ্যাক্সেস কন্ট্রোল (Role-Based Access)',
        detail:
          'দোকানের মালিক চাইলে স্টাফ বা সেলসম্যানদের জন্য আলাদা পারমিশন সেট করতে পারবেন, যাতে স্টাফরা ব্যবসার মোট লাভ-ক্ষতি বা গোপন তথ্য দেখতে না পান।',
      },
      {
        title: 'নিরাপত্তা অডিট',
        detail:
          'হ্যাকিং বা ম্যালওয়্যার আক্রমণ থেকে বাঁচতে নিয়মিত সার্ভার সিকিউরিটি আপডেট ও মনিটরিং করা হয়।',
      },
    ],
  },
};

export const AboutView: React.FC<AboutViewProps> = ({ lang }) => {
  const [activePolicy, setActivePolicy] = useState<PolicyTab>('terms');
  const policy = POLICY_SECTIONS[activePolicy];

  return (
    <div className="space-y-5 max-w-6xl mx-auto">
      {/* Hero / Version & Last Updated */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-5">
          <div className="space-y-2 max-w-2xl">
            <div className="inline-flex items-center gap-2 text-xs font-semibold text-teal-700 dark:text-teal-400">
              <Info className="w-4 h-4" />
              <span>{lang === 'bn' ? 'সফটওয়্যার পরিচিতি ও সিস্টেম তথ্য' : 'About Software & System Information'}</span>
            </div>
            <h1 className="font-display font-bold text-2xl text-slate-900 dark:text-white tracking-tight">
              আমার পস (AMAR POS) — Smart AI POS
            </h1>
            <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
              &ldquo;আমার পস&rdquo; (AMAR POS) হলো একটি আধুনিক, সহজ এবং নির্ভরযোগ্য পয়েন্ট অফ সেল (Point of Sale) ও
              ব্যবসা ব্যবস্থাপনা সফটওয়্যার। খুচরা দোকান, সুপারশপ, ফার্মেসি, রেস্তোরাঁ এবং পাইকারি ব্যবসার দৈনন্দিন
              বেচাকেনা, স্টক ম্যানেজমেন্ট ও লাভ-ক্ষতির হিসাব নির্ভুলভাবে পরিচালনার জন্য এটি তৈরি করা হয়েছে। যেকোনো সময়,
              যেকোনো স্থান থেকে আপনার ব্যবসার পূর্ণ নিয়ন্ত্রণ রাখুন হাতের মুঠোয়।
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 gap-3 shrink-0 lg:w-80">
            <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-3.5 text-xs space-y-1">
              <div className="text-[11px] text-slate-500 flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-teal-700" />
                <span>১. ভার্সন (Version)</span>
              </div>
              <div className="font-mono font-bold text-sm text-slate-900 dark:text-white">v1.0.0 (Build 102)</div>
              <div className="text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                স্থিতিশীল সংস্করণ / Stable Release
              </div>
            </div>

            <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-3.5 text-xs space-y-1">
              <div className="text-[11px] text-slate-500 flex items-center gap-1.5">
                <CalendarClock className="w-3.5 h-3.5 text-teal-700" />
                <span>২. সর্বশেষ আপডেট (Last Updated)</span>
              </div>
              <div className="font-semibold text-sm text-slate-900 dark:text-white">২২ নভেম্বর, ২০২৬</div>
            </div>
          </div>
        </div>

        {/* What's New */}
        <div className="mt-5 pt-4 border-t border-slate-200 dark:border-slate-800">
          <div className="text-xs font-semibold text-slate-900 dark:text-white mb-2">
            নতুন যা যুক্ত হয়েছে (What&apos;s New):
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5 text-xs">
            {[
              'দ্রুত বারকোড স্ক্যানিং এবং ইনভয়েস প্রিন্টিং স্পিড উন্নত করা হয়েছে।',
              'অফলাইন মোডে ডেটা সিঙ্ক (Data Sync) আরও নির্ভুল করা হয়েছে।',
              'ছোটখাটো বাগ ফিক্স এবং পারফরম্যান্স আপগ্রেড।',
            ].map((item, idx) => (
              <div
                key={idx}
                className="flex items-start gap-2 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 p-3 text-slate-600 dark:text-slate-300"
              >
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                <span>{item}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Key Features */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-display font-semibold text-sm text-slate-900 dark:text-white">
            ৪. মূল বৈশিষ্ট্যসমূহ (Key Features)
          </h2>
          <span className="text-[11px] text-slate-500">{lang === 'bn' ? '৩ ও ৪ নং সেকশন' : 'Overview & Key Features'}</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
          {KEY_FEATURES.map((feat) => {
            const Icon = feat.icon;
            return (
              <div
                key={feat.title}
                className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/60 p-4 space-y-1.5"
              >
                <div className="flex items-center gap-2 font-semibold text-xs text-slate-900 dark:text-white">
                  <div className="p-1.5 rounded-md bg-teal-50 dark:bg-teal-950/50 text-teal-700 dark:text-teal-400">
                    <Icon className="w-4 h-4" />
                  </div>
                  <span>{feat.title}</span>
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">{feat.desc}</p>
              </div>
            );
          })}
        </div>
      </div>

      {/* Developer Info, Contact & License Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* 5. Developer / Company Info */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-3 text-xs">
          <h2 className="font-display font-semibold text-sm flex items-center gap-2 text-slate-900 dark:text-white">
            <Building2 className="w-4 h-4 text-teal-700" />
            <span>৫. ডেভেলপার তথ্য (Developer Info)</span>
          </h2>
          <div className="space-y-2.5 pt-1 text-slate-600 dark:text-slate-300">
            <div>
              <div className="text-[11px] text-slate-400">তৈরি ও পরিচালনায়</div>
              <div className="font-semibold text-sm text-slate-900 dark:text-white">
                ইসলাম মেডিকেল এন্ড ই-সেন্টার
              </div>
            </div>
            <div className="flex items-start gap-2">
              <MapPin className="w-4 h-4 text-teal-700 shrink-0 mt-0.5" />
              <span>
                বাড়ি নং: হাওলাদার বাড়ি, রোড নং: নিশানবাড়ীয়া রোড, এলাকা: গাজীমাহমুদ চৌরাস্তা, বরিশাল, বাংলাদেশ
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Globe className="w-4 h-4 text-teal-700 shrink-0" />
              <a
                href="https://www.amarpos.com"
                target="_blank"
                rel="noopener noreferrer"
                className="text-teal-700 dark:text-teal-400 hover:underline font-medium"
              >
                www.amarpos.com
              </a>
            </div>
          </div>
        </div>

        {/* 6. Contact & Support */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-3 text-xs">
          <h2 className="font-display font-semibold text-sm flex items-center gap-2 text-slate-900 dark:text-white">
            <Headphones className="w-4 h-4 text-teal-700" />
            <span>৬. যোগাযোগ ও সাপোর্ট (Contact & Support)</span>
          </h2>
          <p className="text-slate-500 dark:text-slate-400">
            সফটওয়্যার ব্যবহারে যেকোনো সমস্যা বা পরামর্শের জন্য আমাদের সাপোর্ট টিমের সাথে যোগাযোগ করুন:
          </p>
          <div className="space-y-2.5 pt-1">
            <a
              href="tel:+8801719565306"
              className="flex items-center gap-2.5 p-2.5 rounded-lg border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-950 transition-colors"
            >
              <Phone className="w-4 h-4 text-teal-700 shrink-0" />
              <div>
                <div className="font-semibold text-slate-900 dark:text-white">+৮৮০ ১৭১৯৫৬৫৩০৬</div>
                <div className="text-[11px] text-slate-500">হেল্পলাইন (সকাল ৯টা - রাত ১০টা)</div>
              </div>
            </a>

            <a
              href="mailto:support@amarpos.com"
              className="flex items-center gap-2.5 p-2.5 rounded-lg border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-950 transition-colors"
            >
              <Mail className="w-4 h-4 text-teal-700 shrink-0" />
              <div>
                <div className="font-semibold text-slate-900 dark:text-white">support@amarpos.com</div>
                <div className="text-[11px] text-slate-500">সাপোর্ট ইমেইল</div>
              </div>
            </a>

            <a
              href="https://wa.me/8801719565306"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2.5 p-2.5 rounded-lg border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/50 dark:bg-emerald-950/20 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 transition-colors"
            >
              <MessageCircle className="w-4 h-4 text-emerald-600 shrink-0" />
              <div>
                <div className="font-semibold text-emerald-800 dark:text-emerald-300">+৮৮০ ১৭১৯৫৬৫৩০৬</div>
                <div className="text-[11px] text-emerald-700/80 dark:text-emerald-400/80">হোয়াটসঅ্যাপ সাপোর্ট</div>
              </div>
            </a>
          </div>
        </div>

        {/* 8. License Info */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-3 text-xs flex flex-col justify-between">
          <div className="space-y-3">
            <h2 className="font-display font-semibold text-sm flex items-center gap-2 text-slate-900 dark:text-white">
              <Award className="w-4 h-4 text-teal-700" />
              <span>৮. লাইসেন্স তথ্য (License Info)</span>
            </h2>
            <div className="space-y-2.5 pt-1">
              <div className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800">
                <div className="text-[11px] text-emerald-700 dark:text-emerald-300">সাবস্ক্রিপশন প্ল্যান</div>
                <div className="font-semibold text-sm text-emerald-900 dark:text-emerald-100 mt-0.5">
                  প্রিমিয়াম প্যাকেজ (সক্রিয় / Active)
                </div>
              </div>
              <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                <div className="text-[11px] text-slate-500">মেয়াদ শেষ হবে</div>
                <div className="font-semibold text-sm text-slate-900 dark:text-white mt-0.5">২১ নভেম্বর, ২০২৭</div>
              </div>
            </div>
          </div>

          <div className="pt-3 border-t border-slate-200 dark:border-slate-800 text-[11px] text-slate-500 dark:text-slate-400">
            © ২০২৬ আমার পস (AMAR POS)। সর্বস্বত্ব সংরক্ষিত।
          </div>
        </div>
      </div>

      {/* 7. Legal & Policies */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-display font-semibold text-sm flex items-center gap-2 text-slate-900 dark:text-white">
              <ShieldCheck className="w-4 h-4 text-teal-700" />
              <span>৭. আইনি তথ্য ও নীতিমালা (Legal & Policies)</span>
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              আপনার ব্যবসার প্রতিটি তথ্য আমাদের কাছে ১০০% নিরাপদ ও এনক্রিপ্টেড অবস্থায় সংরক্ষিত থাকে। বিস্তারিত জানতে
              নিচের ট্যাবগুলো দেখুন:
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 border-b border-slate-200 dark:border-slate-800 pb-3">
          {(
            [
              { id: 'terms', label: 'ব্যবহারের শর্তাবলি (Terms)', icon: FileText },
              { id: 'privacy', label: 'গোপনীয়তা নীতি (Privacy Policy)', icon: Shield },
              { id: 'security', label: 'ডেটা নিরাপত্তা নীতিমালা (Security)', icon: Lock },
            ] as const
          ).map((tab) => {
            const Icon = tab.icon;
            const active = activePolicy === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActivePolicy(tab.id)}
                className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold transition-colors ${
                  active
                    ? 'bg-teal-700 text-white'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        <div className="space-y-3 text-xs">
          <div className="font-semibold text-sm text-slate-900 dark:text-white">{policy.label}</div>
          <p className="text-slate-500 dark:text-slate-400">{policy.subtitle}</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {policy.items.map((item) => (
              <div
                key={item.title}
                className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-3.5 space-y-1"
              >
                <div className="font-semibold text-slate-900 dark:text-white flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 text-teal-700 shrink-0" />
                  <span>{item.title}</span>
                </div>
                <p className="text-slate-600 dark:text-slate-300 leading-relaxed">{item.detail}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
