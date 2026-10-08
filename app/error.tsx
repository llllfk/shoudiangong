"use client";

export default function Error({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex h-dvh flex-col items-center justify-center gap-4 bg-[var(--bg)] px-6 text-center">
      <p className="text-base font-semibold text-[var(--text-main)]">
        页面出现异常
      </p>
      <p className="text-sm text-[var(--text-sub)]">请重试，或刷新后继续检修。</p>
      <button
        type="button"
        onClick={reset}
        className="rounded-lg bg-[var(--primary-light)] px-4 py-2 text-sm text-white"
      >
        重试
      </button>
    </div>
  );
}
