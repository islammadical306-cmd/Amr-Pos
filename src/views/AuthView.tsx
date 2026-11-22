import React, { useEffect, useState } from 'react';
import { CheckSquare, Eye, EyeOff, FileCheck2, Lock, ShieldCheck, Store, UserPlus } from 'lucide-react';
import { apiFetch, setAuthToken } from '../lib/api';
import type { AuthUser } from '../types';
import type { Lang } from '../i18n';

interface AuthViewProps {
  needsBootstrap: boolean;
  lang: Lang;
  onToggleLang: () => void;
  onAuthenticated: (user: AuthUser) => void;
  onOpenStorefront: () => void;
}

type AuthMode = 'login' | 'signup';

export const AuthView: React.FC<AuthViewProps> = ({
  needsBootstrap,
  lang,
  onToggleLang,
  onAuthenticated,
  onOpenStorefront,
}) => {
  const [mode, setMode] = useState<AuthMode>(needsBootstrap ? 'signup' : 'login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const [acceptedPolicy, setAcceptedPolicy] = useState(false);
  const [policyAttempted, setPolicyAttempted] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);

  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setMode(needsBootstrap ? 'signup' : 'login');
  }, [needsBootstrap]);

  const switchMode = (nextMode: AuthMode) => {
    setMode(nextMode);
    setError('');
    setPolicyAttempted(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (isSignup) {
      if (name.trim().length < 2) {
        setError(lang === 'bn' ? 'অনুগ্রহ করে কমপক্ষে ২ অক্ষরের পূর্ণ নাম লিখুন।' : 'Please enter your full name (at least 2 characters).');
        return;
      }
      if (password.length < 6) {
        setError(lang === 'bn' ? 'পাসওয়ার্ড কমপক্ষে ৬ অক্ষরের হতে হবে।' : 'Password must be at least 6 characters long.');
        return;
      }
      if (password !== confirmPassword) {
        setError(lang === 'bn' ? 'পাসওয়ার্ড এবং নিশ্চিত পাসওয়ার্ড মেলেনি।' : 'Password and confirm password do not match.');
        return;
      }
      if (!acceptedPolicy) {
        setPolicyAttempted(true);
        setError(
          lang === 'bn'
            ? 'সাইন আপের আগে অনুগ্রহ করে নিরাপত্তা ও নীতিমালা (১–৩) পড়ে সম্মতি টিকমার্ক দিন।'
            : 'Please check the mandatory Security & Policy Agreement box (rules 1–3) before signing up.'
        );
        return;
      }
    }

    setLoading(true);
    try {
      const endpoint = mode === 'signup' ? '/api/auth/signup' : '/api/auth/login';
      const body =
        mode === 'signup'
          ? { name: name.trim(), email: email.trim(), password, confirmPassword, acceptedPolicy, rememberMe }
          : { email: email.trim(), password, rememberMe };

      const data = await apiFetch<{ token: string; user: AuthUser }>(endpoint, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      setAuthToken(data.token);
      onAuthenticated(data.user);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const isSignup = mode === 'signup';

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex flex-col justify-between p-4 sm:p-6">
      <header className="max-w-5xl w-full mx-auto flex items-center justify-between gap-4">
        <div className="font-display font-bold text-xl tracking-tight text-slate-900 dark:text-white whitespace-nowrap shrink-0">
          AmarPOS Smart AI
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onToggleLang}
            className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
          >
            {lang === 'en' ? 'বাংলা' : 'English'}
          </button>
          <button
            type="button"
            onClick={onOpenStorefront}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-xs font-medium hover:opacity-90 whitespace-nowrap shrink-0"
          >
            <Store className="w-3.5 h-3.5" />
            {lang === 'bn' ? 'অনলাইন স্টোর দেখুন' : 'Visit Storefront'}
          </button>
        </div>
      </header>

      <main className="max-w-lg w-full mx-auto my-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 sm:p-7 shadow-sm">
        {/* Always-available Login & Sign Up switcher */}
        <div className="grid grid-cols-2 gap-2 p-1 rounded-xl bg-slate-100 dark:bg-slate-800/80 mb-5">
          <button
            type="button"
            onClick={() => switchMode('login')}
            className={`flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-xs font-semibold transition-colors ${
              !isSignup
                ? 'bg-white dark:bg-slate-900 text-teal-700 dark:text-teal-400 shadow-xs'
                : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <Lock className="w-3.5 h-3.5" />
            <span>{lang === 'bn' ? 'লগইন (Login)' : 'Login / Sign In'}</span>
          </button>
          <button
            type="button"
            onClick={() => switchMode('signup')}
            className={`flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-xs font-semibold transition-colors ${
              isSignup
                ? 'bg-white dark:bg-slate-900 text-teal-700 dark:text-teal-400 shadow-xs'
                : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <UserPlus className="w-3.5 h-3.5" />
            <span>{lang === 'bn' ? 'সাইন আপ (Sign Up)' : 'Sign Up / Register'}</span>
          </button>
        </div>

        <div className="flex items-center gap-3 mb-5">
          <div className="w-10 h-10 rounded-lg bg-teal-700/10 text-teal-700 dark:text-teal-400 flex items-center justify-center shrink-0">
            {isSignup ? <ShieldCheck className="w-5 h-5" /> : <Lock className="w-5 h-5" />}
          </div>
          <div>
            <h1 className="font-display text-lg font-bold text-slate-900 dark:text-white">
              {isSignup
                ? needsBootstrap
                  ? lang === 'bn'
                    ? 'প্রথমবার সুপার অ্যাডমিন সাইন আপ'
                    : 'Claim Super Admin Account'
                  : lang === 'bn'
                    ? 'নতুন স্টাফ / POS অ্যাকাউন্ট সাইন আপ'
                    : 'Create POS Staff Account'
                : lang === 'bn'
                  ? 'অ্যাডমিন ও POS স্টাফ লগইন'
                  : 'Admin & Staff POS Login'}
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {isSignup
                ? needsBootstrap
                  ? lang === 'bn'
                    ? 'প্রথম অ্যাকাউন্টটি সম্পূর্ণ নিয়ন্ত্রণসহ সুপার অ্যাডমিন হবে'
                    : 'The first account becomes Super Admin with full store access'
                  : lang === 'bn'
                    ? 'নির্দিষ্ট নিরাপত্তা ও নীতিমালার অধীনে নতুন অ্যাকাউন্ট তৈরি করুন'
                    : 'Register a new account under defined store security policy'
                : lang === 'bn'
                  ? 'আপনার ইমেইল ও পাসওয়ার্ড দিয়ে দ্রুত প্রবেশ করুন'
                  : 'Sign in quickly with your email and password'}
            </p>
          </div>
        </div>

        {error && (
          <div className="mb-4 rounded-lg border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/40 px-3.5 py-2.5 text-xs text-red-700 dark:text-red-300">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-3.5">
          {isSignup && (
            <>
              <div className="rounded-lg border border-teal-200 dark:border-teal-900/60 bg-teal-50/70 dark:bg-teal-950/30 px-3 py-2 text-[11px] text-teal-800 dark:text-teal-300 flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 shrink-0" />
                <span>
                  {needsBootstrap
                    ? lang === 'bn'
                      ? 'রোল নীতিমালা: প্রথম অ্যাকাউন্ট → সুপার অ্যাডমিন (Super Admin)'
                      : 'Role Policy: First Account → Super Admin (Full Control)'
                    : lang === 'bn'
                      ? 'রোল নীতিমালা: নতুন সাইন আপ → POS ক্যাশিয়ার (সুপার অ্যাডমিন ভেতর থেকে অ্যাডমিন রোল দিতে পারবেন)'
                      : 'Role Policy: Public Sign Up → POS Cashier (Super Admin can upgrade role inside Users)'}
                </span>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  {lang === 'bn' ? 'পূর্ণ নাম' : 'Full Name'}
                </label>
                <input
                  type="text"
                  required
                  minLength={2}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={lang === 'bn' ? 'যেমন: মাহমুদুল হাসান' : 'e.g. Mahmudul Hasan'}
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3.5 py-2 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-600"
                />
              </div>
            </>
          )}

          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
              {lang === 'bn' ? 'ইমেইল ঠিকানা' : 'Email Address'}
            </label>
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="admin@amarcare.com"
              className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3.5 py-2 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-600"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
              {lang === 'bn' ? 'পাসওয়ার্ড' : 'Password'}
            </label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                required
                minLength={6}
                autoComplete={isSignup ? 'new-password' : 'current-password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={lang === 'bn' ? 'কমপক্ষে ৬ অক্ষরের পাসওয়ার্ড' : 'Minimum 6 characters'}
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 pl-3.5 pr-10 py-2 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-600"
              />
              <button
                type="button"
                onClick={() => setShowPassword((s) => !s)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {isSignup && (
            <>
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  {lang === 'bn' ? 'পাসওয়ার্ড নিশ্চিত করুন' : 'Confirm Password'}
                </label>
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  minLength={6}
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder={lang === 'bn' ? 'পুনরায় একই পাসওয়ার্ড লিখুন' : 'Re-enter password'}
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3.5 py-2 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-600"
                />
              </div>

              {/* Specific Security & Policy Instructions Box (Sign Up Only) */}
              <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-950/60 p-3.5 space-y-2">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-800 dark:text-slate-100">
                  <FileCheck2 className="w-4 h-4 text-teal-700 dark:text-teal-400 shrink-0" />
                  <span>
                    {lang === 'bn'
                      ? 'নির্দিষ্ট সিকিউরিটি ও নীতিমালা নির্দেশনা (১–৩)'
                      : 'Defined Security & Policy Instructions (Rules 1–3)'}
                  </span>
                </div>
                <ol className="space-y-1.5 text-[11px] leading-relaxed text-slate-600 dark:text-slate-300 list-decimal pl-4">
                  <li>
                    {lang === 'bn'
                      ? 'অ্যাকাউন্ট ও রোল নীতিমালা: প্রথম সাইন আপ অ্যাকাউন্ট সুপার অ্যাডমিন হবে; পরবর্তী সাইন আপ নিরাপত্তার স্বার্থে POS ক্যাশিয়ার হিসেবে চালু হবে ও অ্যাডমিন অনুমোদনে রোল পরিবর্তনযোগ্য।'
                      : 'Account & Role Policy: The first sign-up creates the Super Admin; subsequent sign-ups default to POS Cashier and require Super Admin promotion for admin privileges.'}
                  </li>
                  <li>
                    {lang === 'bn'
                      ? 'সিকিউরিটি ও সেশন নীতিমালা: পাসওয়ার্ড ন্যূনতম ৬ অক্ষরের হতে হবে। লগইন ধরে রাখুন চালু থাকলে ৩০ দিন পর্যন্ত সেশন সুরক্ষিত কুকিতে সংরক্ষিত থাকবে এবং প্রতিটি লগইন অডিট লগে রেকর্ড হবে।'
                      : 'Security & Session Policy: Passwords require 6+ characters. Keeping Login active stores a secure 30-day HttpOnly session to prevent repeated sign-ins, and all actions are audit-logged.'}
                  </li>
                  <li>
                    {lang === 'bn'
                      ? 'POS ও ফার্মেসি বিধিমালা: মেয়াদোত্তীর্ণ পণ্য বিক্রয় নিষিদ্ধ; প্রতিটি বিক্রয় ও বাকি আদায়ে ব্যাচ, মেয়াদ ও মূল্য ম্যানুয়ালি যাচাই করতে হবে।'
                      : 'POS & Pharmacy Integrity: Expired stock sales are prohibited; batch, expiry date, and price must be verified before completing invoices.'}
                  </li>
                </ol>
              </div>

              {/* Specific Mandatory Checkmark (Sign Up Only) */}
              <label
                htmlFor="policy-accept-checkbox"
                className={`flex items-start gap-2.5 p-2.5 rounded-lg border cursor-pointer transition-colors text-xs ${
                  acceptedPolicy
                    ? 'border-teal-600 bg-teal-50/70 dark:bg-teal-950/30 text-slate-900 dark:text-slate-100'
                    : policyAttempted
                      ? 'border-red-400 bg-red-50/70 dark:bg-red-950/30 text-red-800 dark:text-red-200'
                      : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-700 dark:text-slate-300'
                }`}
              >
                <input
                  id="policy-accept-checkbox"
                  type="checkbox"
                  checked={acceptedPolicy}
                  onChange={(e) => {
                    setAcceptedPolicy(e.target.checked);
                    if (e.target.checked) {
                      setPolicyAttempted(false);
                      setError('');
                    }
                  }}
                  className="mt-0.5 h-4 w-4 rounded border-slate-300 text-teal-700 focus:ring-teal-600 accent-teal-700 shrink-0"
                />
                <span className="leading-snug">
                  <strong className="font-semibold">
                    {lang === 'bn' ? '[বাধ্যতামূলক নীতিমালা সম্মতি]' : '[Required Policy Consent]'}
                  </strong>{' '}
                  {lang === 'bn'
                    ? 'আমি উপরের ১–৩ নং নির্দিষ্ট সিকিউরিটি, রোল ও POS ব্যবহারের নীতিমালা পড়েছি এবং সম্পূর্ণভাবে মেনে চলতে সম্মত আছি।'
                    : 'I have read and agree to comply strictly with Security & Policy Rules 1–3 above.'}
                </span>
              </label>
            </>
          )}

          <label
            htmlFor="remember-session-checkbox"
            className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/40 cursor-pointer text-xs text-slate-700 dark:text-slate-300"
          >
            <input
              id="remember-session-checkbox"
              type="checkbox"
              checked={rememberMe}
              onChange={(e) => setRememberMe(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-teal-700 focus:ring-teal-600 accent-teal-700 shrink-0"
            />
            <CheckSquare className="w-3.5 h-3.5 text-teal-700 dark:text-teal-400 shrink-0" />
            <span>
              {lang === 'bn'
                ? 'আমাকে লগইন অবস্থায় রাখুন (৩০ দিন পর্যন্ত বারবার লগইন করতে হবে না)'
                : 'Keep me signed in (Stay logged in for 30 days across reloads)'}
            </span>
          </label>

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-teal-700 hover:bg-teal-800 disabled:opacity-60 text-white py-2.5 text-sm font-semibold transition-colors"
          >
            {loading
              ? lang === 'bn'
                ? 'অপেক্ষা করুন...'
                : 'Please wait...'
              : isSignup
                ? needsBootstrap
                  ? lang === 'bn'
                    ? 'সুপার অ্যাডমিন অ্যাকাউন্ট তৈরি ও প্রবেশ করুন'
                    : 'Claim Super Admin & Launch POS'
                  : lang === 'bn'
                    ? 'সাইন আপ ও POS-এ প্রবেশ করুন'
                    : 'Sign Up & Launch POS'
                : lang === 'bn'
                  ? 'লগইন করুন'
                  : 'Sign In to POS'}
          </button>
        </form>
      </main>

      <footer className="max-w-5xl w-full mx-auto text-center text-xs text-slate-500 dark:text-slate-400">
        AmarPOS Smart AI · Offline-First Retail & Pharmacy POS · BDT (৳)
      </footer>
    </div>
  );
};
