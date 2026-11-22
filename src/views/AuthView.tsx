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
  lang,
  onToggleLang,
  onAuthenticated,
  onOpenStorefront,
}) => {
  // Always default to 'login' mode on load as requested
  const [mode, setMode] = useState<AuthMode>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // Pre-checked policy agreement
  const [acceptedPolicy, setAcceptedPolicy] = useState(true);
  const [rememberMe, setRememberMe] = useState(true);

  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const switchMode = (nextMode: AuthMode) => {
    setMode(nextMode);
    setError('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    const cleanEmail = email.trim();
    const cleanPassword = password.trim();

    if (isSignup) {
      if (name.trim().length < 2) {
        setError(lang === 'bn' ? 'অনুগ্রহ করে কমপক্ষে ২ অক্ষরের পূর্ণ নাম লিখুন।' : 'Please enter your full name (at least 2 characters).');
        return;
      }
      if (cleanPassword.length < 6) {
        setError(lang === 'bn' ? 'পাসওয়ার্ড কমপক্ষে ৬ অক্ষরের হতে হবে।' : 'Password must be at least 6 characters long.');
        return;
      }
      if (cleanPassword !== confirmPassword.trim()) {
        setError(lang === 'bn' ? 'পাসওয়ার্ড এবং নিশ্চিত পাসওয়ার্ড মেলেনি।' : 'Password and confirm password do not match.');
        return;
      }
      if (!acceptedPolicy) {
        setError(
          lang === 'bn'
            ? 'সাইন আপের আগে অনুগ্রহ করে পলিসিতে সম্মতি টিকমার্ক দিন।'
            : 'Please agree to the policy before signing up.'
        );
        return;
      }
    }

    setLoading(true);
    try {
      const endpoint = mode === 'signup' ? '/api/auth/signup' : '/api/auth/login';
      const body =
        mode === 'signup'
          ? { name: name.trim(), email: cleanEmail, password: cleanPassword, confirmPassword: confirmPassword.trim(), acceptedPolicy, rememberMe }
          : { email: cleanEmail, password: cleanPassword, rememberMe };

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
        <div className="flex items-center gap-3 mb-5">
          <div className="w-10 h-10 rounded-lg bg-teal-700/10 text-teal-700 dark:text-teal-400 flex items-center justify-center shrink-0">
            {isSignup ? <ShieldCheck className="w-5 h-5" /> : <Lock className="w-5 h-5" />}
          </div>
          <div>
            <h1 className="font-display text-lg font-bold text-slate-900 dark:text-white">
              {isSignup
                ? lang === 'bn'
                  ? 'নতুন অ্যাকাউন্ট সাইন আপ / রেজিস্টার'
                  : 'Create Account / Sign Up'
                : lang === 'bn'
                  ? 'অ্যাডমিন ও POS স্টাফ লগইন'
                  : 'Admin & Staff POS Login'}
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {isSignup
                ? lang === 'bn'
                  ? 'পলিসি মেনে নতুন সুরক্ষিত অ্যাকাউন্ট তৈরি করুন'
                  : 'Register a secure account under defined store policy'
                : lang === 'bn'
                  ? 'আপনার ইমেইল ও পাসওয়ার্ড দিয়ে দ্রুত প্রবেশ করুন'
                  : 'Sign in quickly with your email and password'}
            </p>
          </div>
        </div>

        {/* Default Admin Quick-Fill Banner (Login Mode Only) */}
        {!isSignup && (
          <div className="mb-4 rounded-lg border border-teal-200/80 dark:border-teal-900/60 bg-teal-50/60 dark:bg-teal-950/30 p-2.5 text-xs text-slate-700 dark:text-slate-300 flex items-center justify-between gap-2">
            <div className="space-y-0.5">
              <div className="font-semibold text-teal-800 dark:text-teal-300 text-[11px]">
                {lang === 'bn' ? 'ডিফল্ট সুপার অ্যাডমিন লগইন তথ্য:' : 'Default Super Admin Login:'}
              </div>
              <div className="text-[11px] font-mono text-slate-600 dark:text-slate-400">
                admin@amarpos.com · admin123
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                setEmail('admin@amarpos.com');
                setPassword('admin123');
              }}
              className="px-2.5 py-1 rounded bg-teal-700 text-white hover:bg-teal-800 text-[11px] font-medium shrink-0 transition-colors shadow-xs"
            >
              {lang === 'bn' ? 'অটো বসান' : 'Fill'}
            </button>
          </div>
        )}

        {error && (
          <div className="mb-4 rounded-lg border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/40 px-3.5 py-2.5 text-xs text-red-700 dark:text-red-300">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-3.5">
          {isSignup && (
            <>
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
              placeholder="admin@amarpos.com"
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

              {/* Collapsed Rules 1–3 Details */}
              <details className="text-[11px] text-slate-500 dark:text-slate-400 rounded-lg border border-slate-200 dark:border-slate-800 p-2.5 bg-slate-50/50 dark:bg-slate-950/40">
                <summary className="cursor-pointer font-medium text-slate-700 dark:text-slate-300 hover:text-teal-700 dark:hover:text-teal-400">
                  {lang === 'bn' ? 'নিরাপত্তা ও পলিসি বিস্তারিত দেখুন (১–৩)' : 'View Security & Policy Rules (1–3)'}
                </summary>
                <ol className="mt-2 space-y-1.5 leading-relaxed list-decimal pl-4 pt-1 border-t border-slate-200 dark:border-slate-800">
                  <li>
                    {lang === 'bn'
                      ? 'অ্যাকাউন্ট ও রোল নীতিমালা: অ্যাকাউন্ট সুরক্ষিত থাকবে ও সকল কার্যক্রম অডিট লগে রেকর্ড হবে।'
                      : 'Account Policy: Secure admin access & audit tracking is enabled.'}
                  </li>
                  <li>
                    {lang === 'bn'
                      ? 'পাসওয়ার্ড ন্যূনতম ৬ অক্ষরের হতে হবে এবং লগইন সেশন নিরাপদ কুকিতে সংরক্ষিত থাকবে।'
                      : 'Passwords require 6+ characters with secure HttpOnly sessions.'}
                  </li>
                  <li>
                    {lang === 'bn'
                      ? 'POS ও ফার্মেসি বিধিমালা: প্রতিটি বিক্রয় ও স্টক হিসাব নির্ভুলভাবে সংরক্ষিত হবে।'
                      : 'POS Integrity: All transactions & inventory movements are accurately logged.'}
                  </li>
                </ol>
              </details>

              {/* Clean Pre-Checked Policy Checkbox */}
              <label
                htmlFor="policy-accept-checkbox"
                className="flex items-center gap-2.5 p-2.5 rounded-lg border border-teal-300 dark:border-teal-800 bg-teal-50/70 dark:bg-teal-950/40 cursor-pointer text-xs text-slate-800 dark:text-slate-200"
              >
                <input
                  id="policy-accept-checkbox"
                  type="checkbox"
                  checked={acceptedPolicy}
                  onChange={(e) => {
                    setAcceptedPolicy(e.target.checked);
                    if (e.target.checked) setError('');
                  }}
                  className="h-4 w-4 rounded border-slate-300 text-teal-700 focus:ring-teal-600 accent-teal-700 shrink-0"
                />
                <span className="font-medium leading-snug">
                  {lang === 'bn'
                    ? 'পলিসি মেনে চলব (সিকিউরিটি ও ব্যবহার নির্দেশিকায় সম্মত)'
                    : 'I agree to the Store Security & Usage Policy'}
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
                ? lang === 'bn'
                  ? 'সাইন আপ ও POS-এ প্রবেশ করুন'
                  : 'Sign Up & Launch POS'
                : lang === 'bn'
                  ? 'লগইন করুন'
                  : 'Sign In to POS'}
          </button>

          {/* Toggle between Login and Sign Up at the BOTTOM of the card */}
          <div className="pt-3 text-center border-t border-slate-100 dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400">
            {isSignup ? (
              <>
                <span>{lang === 'bn' ? 'ইতিমধ্যে অ্যাকাউন্ট আছে?' : 'Already have an account?'}</span>{' '}
                <button
                  type="button"
                  onClick={() => switchMode('login')}
                  className="font-semibold text-teal-700 hover:text-teal-800 dark:text-teal-400 dark:hover:text-teal-300 underline underline-offset-2 ml-1"
                >
                  {lang === 'bn' ? 'লগইন করুন' : 'Sign In / Login'}
                </button>
              </>
            ) : (
              <>
                <span>{lang === 'bn' ? 'নতুন অ্যাকাউন্ট প্রয়োজন?' : "Don't have an account?"}</span>{' '}
                <button
                  type="button"
                  onClick={() => switchMode('signup')}
                  className="font-semibold text-teal-700 hover:text-teal-800 dark:text-teal-400 dark:hover:text-teal-300 underline underline-offset-2 ml-1"
                >
                  {lang === 'bn' ? 'সাইন আপ / রেজিস্টার করুন' : 'Sign Up / Register'}
                </button>
              </>
            )}
          </div>
        </form>
      </main>

      <footer className="max-w-5xl w-full mx-auto text-center text-xs text-slate-500 dark:text-slate-400">
        AmarPOS Smart AI · Offline-First Retail & Pharmacy POS · BDT (৳)
      </footer>
    </div>
  );
};
