import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex h-dvh flex-col items-center justify-center gap-4 bg-[var(--bg)] px-6 text-center">
      <p className="text-base font-semibold text-[var(--text-main)]">页面不存在</p>
      <Link
        href="/"
        className="rounded-lg bg-[var(--primary-light)] px-4 py-2 text-sm text-white"
      >
        返回检修首页
      </Link>
    </div>
  );
}
