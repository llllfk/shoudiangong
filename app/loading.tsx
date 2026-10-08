export default function Loading() {
  return (
    <div className="flex h-dvh flex-col items-center justify-center gap-4 bg-white">
      <div
        className="spinner h-[38px] w-[38px] rounded-full border-[3px] border-[rgba(18,48,92,0.15)] border-t-[#12305c]"
        aria-hidden="true"
      />
      <span className="text-sm tracking-wide text-[var(--text-sub)]">
        正在加载检修系统
      </span>
    </div>
  );
}
